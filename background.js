importScripts("category-detector.js", "listing-details-extractor.js", "payload-normalizer.js");

const MAX_CONCURRENT_REQUESTS = 3;
const MIN_START_GAP_MS = 350;
const REQUEST_TIMEOUT_MS = 15000;
const RENDERED_INSPECTION_TIMEOUT_MS = 12000;

const pendingJobs = [];
const jobsByUrl = new Map();
const controlledDetailTabIds = new Set();
const controlledDetailTabTokens = new Map();
const cancelledInspectionTokens = new Set();
const inspectionControllersByToken = new Map();

let activeRequests = 0;
let lastRequestStartedAt = 0;
let pumpTimer = null;
let renderedInspectionChain = Promise.resolve();

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      error ? reject(error) : resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const onRemoved = removedTabId => {
      if (removedTabId === tabId) finish(new Error("Rendered inspection tab closed before loading."));
    };
    const timeout = setTimeout(
      () => finish(new Error("Rendered inspection timed out while loading.")),
      RENDERED_INSPECTION_TIMEOUT_MS
    );
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === "complete") finish();
    }).catch(finish);
  });
}

async function requestRenderedDetails(tabId, listingId, runToken) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assertInspectionActive(runToken);
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "EXTRACT_RENDERED_LISTING_DETAILS",
        listingId
      });
      if (!response?.ok) throw new Error(response?.error || "Rendered extractor returned no result.");
      return response.result;
    } catch (error) {
      assertInspectionActive(runToken);
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  throw lastError || new Error("Rendered extractor was unavailable.");
}

function assertInspectionActive(runToken) {
  if (runToken && cancelledInspectionTokens.has(runToken)) {
    throw new Error("Listing inspection was cancelled.");
  }
}

async function inspectRenderedListing(url, listingId, runToken) {
  let tabId = null;
  try {
    assertInspectionActive(runToken);
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    if (!Number.isInteger(tab.id)) throw new Error("Rendered inspection tab was not created.");
    tabId = tab.id;
    controlledDetailTabIds.add(tabId);
    controlledDetailTabTokens.set(tabId, runToken || null);
    await chrome.tabs.update(tabId, { url });
    await waitForTabComplete(tabId);
    assertInspectionActive(runToken);
    const result = await requestRenderedDetails(tabId, listingId, runToken);
    assertInspectionActive(runToken);
    return result;
  } finally {
    if (tabId !== null) {
      controlledDetailTabIds.delete(tabId);
      controlledDetailTabTokens.delete(tabId);
      await chrome.tabs.remove(tabId).catch(() => {});
    }
  }
}

function queueRenderedInspection(url, listingId, runToken) {
  const inspection = renderedInspectionChain.then(() => inspectRenderedListing(url, listingId, runToken));
  renderedInspectionChain = inspection.catch(() => {});
  return inspection;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/\\u0025/g, "%")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003C/gi, "<")
    .replace(/\\u003E/gi, ">")
    .replace(/\\u0022/g, '"')
    .replace(/\\u0027/g, "'")
    .replace(/\\\//g, "/")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripMarkup(value) {
  return value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseForDetection(html) {
  let text = html;

  for (let pass = 0; pass < 3; pass += 1) {
    text = decodeHtmlEntities(text);
  }

  return stripMarkup(text);
}

function extractCategory(text, source) {
  return CategoryDetector.detectCategory(text, { source });
}

function vehicleAttributeEvidence(attributes) {
  return Object.entries(attributes || {})
    .slice(0, 40)
    .map(([label, value]) => `${String(label).slice(0, 80)}: ${String(value).slice(0, 500)}`)
    .join("\n");
}

function extractMileage(text) {
  const candidates = [
    /\b(\d{1,3}(?:,\d{3})+)\s*(?:miles?|mi)\b/i,
    /\b(\d{1,3}(?:\.\d{1,2})?)\s*k\s*(?:miles?|mi)?\b(?!\s*(?:km|kilomet))/i,
    /\bmileage\s*[:\-]?\s*(\d{1,3}(?:,\d{3})+|\d{3,6})\b(?!\s*(?:km|kilomet))/i
  ];

  for (const pattern of candidates) {
    const match = text.match(pattern);
    if (!match) continue;

    let raw = match[1].replace(/,/g, "");
    let mileage = Number(raw);

    if (/\bk\b/i.test(match[0])) {
      mileage = Math.round(mileage * 1000);
    }

    if (Number.isFinite(mileage) && mileage >= 0 && mileage <= 1000000) {
      return mileage;
    }
  }

  return null;
}

function extractYear(text) {
  const matches = [...text.matchAll(/\b(19[8-9]\d|20[0-3]\d)\b/g)];

  if (!matches.length) return null;

  const years = matches
    .map(match => Number(match[1]))
    .filter(year => year >= 1980 && year <= new Date().getFullYear() + 1);

  if (!years.length) return null;

  return years[0];
}

function extractPrice(text) {
  const matches = [...text.matchAll(/£\s?(\d{1,3}(?:,\d{3})+|\d{3,7})(?!\d)/g)];

  for (const match of matches) {
    const value = Number(match[1].replace(/,/g, ""));

    if (Number.isFinite(value) && value >= 100 && value <= 1000000) {
      return value;
    }
  }

  return null;
}


function extractVehicleMetadata(text) {
  return {
    year: extractYear(text),
    mileage: extractMileage(text),
    price: extractPrice(text)
  };
}

function getListingIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/marketplace\/item\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function extractScopedText(html, listingId) {
  const decoded = normaliseForDetection(html);

  if (!listingId) {
    return {
      text: decoded,
      source: "full-response",
      scopeStart: 0,
      scopeEnd: decoded.length
    };
  }

  const idPositions = [];
  let searchAt = 0;

  while (true) {
    const index = decoded.indexOf(listingId, searchAt);
    if (index < 0) break;

    idPositions.push(index);
    searchAt = index + listingId.length;

    if (idPositions.length >= 20) break;
  }

  if (!idPositions.length) {
    return {
      text: decoded,
      source: "full-response-fallback",
      scopeStart: 0,
      scopeEnd: decoded.length
    };
  }

  let best = null;

  for (const position of idPositions) {
    const start = Math.max(0, position - 12000);
    const end = Math.min(decoded.length, position + 30000);
    const candidate = decoded.slice(start, end);

    const score =
      (/\bdescription\b/i.test(candidate) ? 4 : 0) +
      (/\bmarketplace\b/i.test(candidate) ? 2 : 0) +
      (/\bvehicle\b/i.test(candidate) ? 2 : 0) +
      (candidate.includes("£") ? 1 : 0) +
      (/\bmileage\b/i.test(candidate) ? 1 : 0);

    if (!best || score > best.score) {
      best = { text: candidate, start, end, score };
    }
  }

  return {
    text: best.text,
    source: "listing-id-window",
    scopeStart: best.start,
    scopeEnd: best.end
  };
}

function buildEvidence(text, matchText) {
  if (!matchText) return null;

  const index = text.toLowerCase().indexOf(matchText.toLowerCase());
  if (index < 0) return matchText;

  const start = Math.max(0, index - 140);
  const end = Math.min(text.length, index + matchText.length + 180);

  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

async function fetchWithTimeout(url, runToken) {
  const controller = new AbortController();
  if (runToken) {
    const controllers = inspectionControllersByToken.get(runToken) || new Set();
    controllers.add(controller);
    inspectionControllersByToken.set(runToken, controllers);
  }
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "default",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml"
      }
    });
  } finally {
    clearTimeout(timeout);
    if (runToken) {
      const controllers = inspectionControllersByToken.get(runToken);
      controllers?.delete(controller);
      if (!controllers?.size) inspectionControllersByToken.delete(runToken);
    }
  }
}

async function inspectListing(url, runToken) {
  assertInspectionActive(runToken);
  const response = await fetchWithTimeout(url, runToken);

  if (!response.ok) {
    throw new Error(`Facebook returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const listingId = getListingIdFromUrl(url);
  const staticListingDetails = ListingDetailsExtractor.extractListingDetails(html, {
    listingId,
    canonicalUrl: response.url || url
  });
  let renderedListingDetails = null;
  let listingDetails = staticListingDetails;
  if (listingId) {
    try {
      assertInspectionActive(runToken);
      renderedListingDetails = await queueRenderedInspection(response.url || url, listingId, runToken);
      listingDetails = ListingDetailsExtractor.mergeListingDetails(staticListingDetails, renderedListingDetails);
    } catch {
      // Static extraction remains a safe fallback when Facebook cannot render in a background tab.
    }
  }
  const scoped = extractScopedText(html, listingId);

  const scopedCategoryText = scoped.source === "listing-id-window" ? scoped.text : "";
  const preliminaryCategory = CategoryDetector.detectTrustedEvidence([
    { text: scopedCategoryText, source: "facebook-listing-static-scoped" },
    { text: staticListingDetails.fullDescription, source: "facebook-structured-description" },
    { text: staticListingDetails.listingTitle, source: "facebook-structured-title" },
    { text: vehicleAttributeEvidence(staticListingDetails.vehicleAttributes), source: "facebook-structured-attributes" }
  ]);
  const category = CategoryDetector.detectTrustedEvidence([
    { text: scopedCategoryText, source: "facebook-listing-static-scoped" },
    { text: staticListingDetails.fullDescription, source: "facebook-structured-description" },
    { text: staticListingDetails.listingTitle, source: "facebook-structured-title" },
    { text: vehicleAttributeEvidence(staticListingDetails.vehicleAttributes), source: "facebook-structured-attributes" },
    { text: renderedListingDetails?.fullDescription, source: "facebook-rendered-description" },
    { text: renderedListingDetails?.listingTitle, source: "facebook-structured-title" },
    { text: vehicleAttributeEvidence(renderedListingDetails?.vehicleAttributes), source: "facebook-rendered-attributes" }
  ]);
  let metadata = extractVehicleMetadata(scoped.text);
  let extractionSource = scoped.source;
  let extractionText = scoped.text;
  const hasCategoryEvidence = [
    ...(preliminaryCategory.evidence || []),
    ...(preliminaryCategory.negatedEvidence || []),
    ...(preliminaryCategory.ambiguousEvidence || []),
    ...(preliminaryCategory.excludedEvidence || [])
  ].length > 0;

  const scopedDataCount = [
    metadata.year,
    metadata.mileage,
    metadata.price,
    category.detected ? category.category : null,
    hasCategoryEvidence ? "category-evidence" : null
  ].filter(value => value !== null && value !== false).length;

  if (scopedDataCount === 0 && scoped.source === "listing-id-window") {
    extractionText = normaliseForDetection(html);
    metadata = extractVehicleMetadata(extractionText);
    extractionSource = "full-response-fallback";
  }

  const evidenceExcerpt = buildEvidence(extractionText, category.match);
  assertInspectionActive(runToken);

  return {
    ...category,
    ...metadata,
    ...listingDetails,
    listingId,
    evidenceExcerpt,
    extractionSource,
    listingDetailExtractionSource: listingDetails.extractionSource,
    categoryClassificationDiagnostics: {
      preliminaryCategoryResult: CategoryDetector.summariseCategoryResult(preliminaryCategory),
      finalCategoryResult: CategoryDetector.summariseCategoryResult(category),
      finalCategoryEvidenceSource: category.source || null,
      reclassifiedAfterRenderedExtraction: Boolean(
        !preliminaryCategory.detected &&
        category.detected &&
        category.evidence?.some(item => ["facebook-rendered-description", "facebook-rendered-attributes"].includes(item.source))
      ),
      provisionalStatus: preliminaryCategory.detected ? "rejected" : "matched",
      finalStatus: category.detected ? "rejected" : "matched"
    },
    scopeLength: extractionText.length,
    finalUrl: response.url,
    responseLength: html.length,
    checkedAt: Date.now()
  };
}

function schedulePump(delay = 0) {
  if (pumpTimer !== null) return;

  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pumpQueue();
  }, delay);
}

function pumpQueue() {
  while (
    activeRequests < MAX_CONCURRENT_REQUESTS &&
    pendingJobs.length > 0
  ) {
    const elapsed = Date.now() - lastRequestStartedAt;

    if (elapsed < MIN_START_GAP_MS) {
      schedulePump(MIN_START_GAP_MS - elapsed);
      return;
    }

    const job = pendingJobs.shift();
    job.started = true;
    activeRequests += 1;
    lastRequestStartedAt = Date.now();

    inspectListing(job.url, job.runToken)
      .then(result => {
        for (const listener of job.listeners) {
          listener.resolve(result);
        }
      })
      .catch(error => {
        for (const listener of job.listeners) {
          listener.reject(error);
        }
      })
      .finally(() => {
        activeRequests -= 1;
        jobsByUrl.delete(job.key);
        schedulePump();
      });
  }
}

function queueInspection(url, priority = 0, runToken = null) {
  return new Promise((resolve, reject) => {
    if (runToken && cancelledInspectionTokens.has(runToken)) {
      reject(new Error("Listing inspection was cancelled."));
      return;
    }
    const key = `${runToken || "legacy"}:${url}`;
    const existing = jobsByUrl.get(key);

    if (existing) {
      existing.listeners.push({ resolve, reject });

      if (priority > existing.priority && !existing.started) {
        existing.priority = priority;
        pendingJobs.sort((a, b) => b.priority - a.priority);
      }

      return;
    }

    const job = {
      key,
      url,
      runToken,
      priority,
      listeners: [{ resolve, reject }],
      started: false
    };

    jobsByUrl.set(key, job);
    pendingJobs.push(job);
    pendingJobs.sort((a, b) => b.priority - a.priority);
    schedulePump();
  });
}

async function cancelScanInspections(runToken) {
  if (!runToken) return { cancelledJobs: 0, closedTabs: 0 };
  cancelledInspectionTokens.add(runToken);
  for (const controller of inspectionControllersByToken.get(runToken) || []) controller.abort();
  inspectionControllersByToken.delete(runToken);
  while (cancelledInspectionTokens.size > 100) {
    cancelledInspectionTokens.delete(cancelledInspectionTokens.values().next().value);
  }
  let cancelledJobs = 0;
  for (let index = pendingJobs.length - 1; index >= 0; index -= 1) {
    const job = pendingJobs[index];
    if (job.runToken !== runToken || job.started) continue;
    pendingJobs.splice(index, 1);
    jobsByUrl.delete(job.key);
    for (const listener of job.listeners) listener.reject(new Error("Listing inspection was cancelled."));
    cancelledJobs += 1;
  }
  const tabIds = [...controlledDetailTabTokens.entries()]
    .filter(([, token]) => token === runToken)
    .map(([tabId]) => tabId);
  await Promise.all(tabIds.map(tabId => chrome.tabs.remove(tabId).catch(() => {})));
  return { cancelledJobs, closedTabs: tabIds.length };
}

const REMOTE_REQUEST_TIMEOUT_MS = 20000;
const MAX_REMOTE_BATCH_SIZE = 25;

function normaliseDashboardUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error("Dashboard URL is not configured.");
  }

  let parsed;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Dashboard URL is invalid.");
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Dashboard URL must use HTTPS or HTTP.");
  }

  return parsed.toString().replace(/\/$/, "");
}

async function getRemoteConfig() {
  const stored = await chrome.storage.local.get([
    "dashboardUrl",
    "extensionApiToken"
  ]);

  const dashboardUrl = normaliseDashboardUrl(stored.dashboardUrl);
  const token = String(stored.extensionApiToken || "").trim();

  if (!token) {
    throw new Error("Extension API token is not configured.");
  }

  return { dashboardUrl, token };
}

async function remoteRequest(path, options = {}) {
  const { dashboardUrl, token } = await getRemoteConfig();
  const url = new URL(path, `${dashboardUrl}/`);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs || REMOTE_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal
    });

    const raw = await response.text();
    let data = null;

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { message: raw.slice(0, 500) };
      }
    }

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.error ||
        data?.message ||
        `Dashboard returned HTTP ${response.status}`;

      const validationDetails = data?.error?.details
        ? ` ${JSON.stringify(data.error.details)}`
        : "";

      throw new Error(`${String(message)}${validationDetails}`);
    }

    return {
      data,
      dashboardUrl,
      status: response.status
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Dashboard request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normaliseResultsUrl(resultsUrl, dashboardUrl, scanId) {
  if (resultsUrl) {
    try {
      return new URL(resultsUrl, `${dashboardUrl}/`).toString();
    } catch {
      // Fall through to the standard scan route.
    }
  }

  return new URL(`/scans/${encodeURIComponent(scanId)}`, dashboardUrl).toString();
}

async function createRemoteScan(payload) {
  const response = await remoteRequest("/api/extension/scans", {
    method: "POST",
    body: payload
  });

  const scanId = response.data?.scanId;

  if (!scanId) {
    throw new Error("Dashboard did not return a scan ID.");
  }

  return {
    ...response.data,
    scanId,
    resultsUrl: normaliseResultsUrl(
      response.data?.resultsUrl,
      response.dashboardUrl,
      scanId
    )
  };
}

async function uploadRemoteListings(message) {
  const originalListings = Array.isArray(message.listings)
    ? message.listings
    : [];

  if (!message.scanId) {
    throw new Error("Remote scan ID is missing.");
  }

  if (!originalListings.length) {
    return { accepted: 0, inserted: 0, updated: 0 };
  }

  if (originalListings.length > MAX_REMOTE_BATCH_SIZE) {
    throw new Error(
      `Upload batch exceeds ${MAX_REMOTE_BATCH_SIZE} listings.`
    );
  }

  const listings = originalListings.map((listing, index) => {
    try {
      return PayloadNormalizer.normaliseRemoteListing(listing);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Listing ${index + 1} failed upload normalisation: ${message}`);
    }
  });

  const response = await remoteRequest(
    `/api/extension/scans/${encodeURIComponent(message.scanId)}/listings`,
    {
      method: "POST",
      body: {
        listings,
        progress: message.progress
      }
    }
  );

  return response.data || {};
}

async function updateRemoteProgress(message) {
  if (!message.scanId) {
    throw new Error("Remote scan ID is missing.");
  }

  const response = await remoteRequest(
    `/api/extension/scans/${encodeURIComponent(message.scanId)}/progress`,
    {
      method: "PATCH",
      body: message.progress
    }
  );

  return response.data || {};
}

async function completeRemoteScan(message) {
  if (!message.scanId) {
    throw new Error("Remote scan ID is missing.");
  }

  const response = await remoteRequest(
    `/api/extension/scans/${encodeURIComponent(message.scanId)}/complete`,
    {
      method: "POST",
      body: message.payload
    }
  );

  return response.data || {};
}

async function getRemoteScan(scanId) {
  if (!scanId) {
    throw new Error("Remote scan ID is missing.");
  }

  const response = await remoteRequest(
    `/api/extension/scans/${encodeURIComponent(scanId)}`
  );

  return response.data || {};
}

function openExternalUrl(url) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Results URL is invalid.");
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS results URLs can be opened.");
  }

  return chrome.tabs.create({ url: parsed.toString() });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = promise => {
    Promise.resolve(promise)
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => {
        console.error("Marketplace Vehicle Scanner request failed:", error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  };

  if (message?.type === "INSPECT_LISTING" && message.url) {
    return respond(
      queueInspection(message.url, Number(message.priority) || 0, message.runToken || null)
    );
  }

  if (message?.type === "CANCEL_SCAN_INSPECTIONS") {
    return respond(cancelScanInspections(message.runToken));
  }

  if (message?.type === "IS_CONTROLLED_DETAIL_TAB") {
    sendResponse({
      ok: true,
      result: Number.isInteger(sender.tab?.id) && controlledDetailTabIds.has(sender.tab.id)
    });
    return false;
  }

  if (message?.type === "REMOTE_CREATE_SCAN") {
    return respond(createRemoteScan(message.payload));
  }

  if (message?.type === "REMOTE_UPLOAD_LISTINGS") {
    return respond(uploadRemoteListings(message));
  }

  if (message?.type === "REMOTE_UPDATE_PROGRESS") {
    return respond(updateRemoteProgress(message));
  }

  if (message?.type === "REMOTE_COMPLETE_SCAN") {
    return respond(completeRemoteScan(message));
  }

  if (message?.type === "REMOTE_GET_SCAN") {
    return respond(getRemoteScan(message.scanId));
  }

  if (message?.type === "OPEN_EXTERNAL_URL") {
    return respond(openExternalUrl(message.url));
  }

  return false;
});
