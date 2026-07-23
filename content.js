const EXTENSION_VERSION = "23.2.3";

const CONFIG = {
  maxListingsPerDomPass: 160,
  maxQueuedInspections: 12,
  listingProcessingConcurrency: 3,
  detailMaxRetries: 1,
  detailRetryDelayMs: 1200,
  uploadBatchSize: 10,
  uploadDelayMs: 1200,
  uploadRetryMs: 5000,
  uploadMaxRetries: 3,
  progressSyncDelayMs: 1800,
  persistDelayMs: 700,
  runtimeProgressPersistDelayMs: 250,
  scanDebounceMs: 160,
  autoLoadPauseMs: 900,
  autoLoadStepRatio: 0.72,
  autoLoadMaxStalls: 10,
  autoLoadEndConfirmations: 4,
  growthTimeoutMs: 3500,
  activeRunStorageKey: "scannerV19:activeRun",
  evaluatorLifecycleVersionKey: "scannerEvaluatorLifecycleVersion",
  panelMinimisedStorageKey: "scannerPanelMinimised"
};

const DEFAULT_SETTINGS = {
  enabled: true,
  autoLoadEnabled: true,
  autoOpenResults: true,
  targetMatches: 20,
  maximumProcessed: 150,
  maximumDurationSeconds: 300,
  minYear: null,
  maxYear: null,
  minPrice: null,
  maxPrice: null,
  maxMileage: null,
  unknownMileagePolicy: "keep",
  excludeCategories: ["S", "N", "C", "D"],
  excludedKeywords: [],
  acceptedMakes: [],
  acceptedModels: [],
  activeSavedSearchId: null,
  activeFilterConfig: null,
  scannerDebugDiagnostics: false,
  scannerPanelMinimised: false
};

const FINAL_LISTING_STATUSES = new Set([
  "matched",
  "rejected",
  "unavailable"
]);

let settings = { ...DEFAULT_SETTINGS };
let currentRouteKey = getRouteKey();
let sourceSearchRouteKey = null;
let scanGeneration = 0;
let scanningActive = false;
let autoLoadingActive = false;
let autoLoadStopRequested = true;
let scrollState = "idle";
let finalising = false;
let scanFinalised = false;
let scanStartedAt = null;
let scanCompletedAt = null;
let scanDeadlineAt = null;
let scanStatus = "idle";
let lifecycleState = "idle";
let historicalScanStatus = null;
let stopReason = null;
let runToken = null;
let remoteRun = null;
let remoteCompleted = false;
let remoteSyncState = "idle";
let remoteSyncError = null;
let resultsOpenedForScanId = null;

let ledgerByListingId = new Map();
let resultByListingId = new Map();
let cardByListingId = new Map();
let queuedListingIds = new Set();
let pendingUploadsByListingId = new Map();

let scanTimer = null;
let persistTimer = null;
let uploadTimer = null;
let progressTimer = null;
let runtimeProgressTimer = null;
let deadlineTimer = null;
let elapsedTimer = null;
let observerTimer = null;
let scrollTimer = null;
let uploadInFlight = false;
let uploadRetryCount = 0;
let lastUploadAttemptAt = null;
let progressSyncInFlight = false;
let completionInFlight = false;
let latestRuntimeProgress = null;
let panelElements = null;
let observerConnected = false;
let lifecycleDiagnostics = [];
let performanceDiagnostics = ScannerDiagnostics.create();
let storageHealth = {
  estimatedBytes: 0,
  softLimitBytes: ScannerStorage.SOFT_LIMIT_BYTES,
  pruneCount: 0,
  lastQuotaFailure: null,
  persistenceDegraded: false,
  nearSoftLimit: false
};
let storageFixedBytes = 0;
let processingQueue = null;
let domMutationVersion = 0;
let debugSummaryLastLoggedAt = 0;
let imageDiagnosticsLogged = new Set();
let filterDiagnosticsByListingId = new Map();
let diagnosticTimelineByListingId = new Map();
let usingPersistedSettingsSnapshot = false;
const scanDelayWaits = new Set();

function resetPerformanceDiagnostics() {
  performanceDiagnostics = ScannerDiagnostics.create({
    enabled: settings.scannerDebugDiagnostics === true,
    maxListings: 520,
    maxScrolls: 100
  });
  debugSummaryLastLoggedAt = 0;
}

function maybeLogPerformanceSummary(progress) {
  if (!performanceDiagnostics.enabled) return;
  const now = Date.now();
  if (now - debugSummaryLastLoggedAt < 10000) return;
  debugSummaryLastLoggedAt = now;
  console.info("Marketplace Vehicle Scanner timing summary:", {
    processed: progress.processed,
    queued: progress.queued,
    activeWorkers: progress.scanning,
    ...progress.performanceDiagnostics
  });
}

function maybeLogImageExtractionDiagnostics(listingId, result, metadata = {}) {
  if (!settings.scannerDebugDiagnostics || !result) return;
  const listingIdHash = ListingDetailsExtractor.shortPathHash(String(listingId || ""));
  if (imageDiagnosticsLogged.has(listingIdHash) || imageDiagnosticsLogged.size >= 25) return;
  imageDiagnosticsLogged.add(listingIdHash);
  const resolved = ListingDetailsExtractor.resolveListingImages(result, {
    listingId,
    sourceListingId: metadata.imageOwnerListingId,
    imageUrl: metadata.imageUrl
  });
  const diagnostics = result.imageDiagnostics || {};
  console.info("Marketplace Vehicle Scanner image ownership summary:", {
    listingIdHash,
    selectedExtractionSource: resolved.imageExtractionSource,
    imageExtractionStatus: resolved.imageExtractionStatus,
    declaredPhotoCount: Number(diagnostics.declaredPhotoCount) || null,
    galleryCandidateCount: Number(diagnostics.galleryCandidateCount) || 0,
    acceptedCount: Number(diagnostics.acceptedCount) || resolved.imageUrls.length,
    rejectionReasonCounts: { ...(diagnostics.rejectionReasons || {}) },
    carouselControlsDetected: diagnostics.carouselControlsDetected === true,
    cardFallbackUsed: resolved.imageExtractionSource === "card_thumbnail"
  });
}

function diagnosticReasons(values) {
  return (Array.isArray(values) ? values : []).slice(0, 6).map(value => truncate(value, 120));
}

function knownCanonicalFields(facts = {}) {
  return ["price", "mileage", "year", "make", "model", "transmission", "fuelType", "colour", "bodyType", "categoryStatus"]
    .filter(field => facts[field] !== null && facts[field] !== undefined && facts[field] !== "unknown");
}

function diagnosticReasonCodesForEvaluation(evaluation = {}) {
  if (evaluation.decision === "match") return ["match"];
  const rules = [
    [/year/i, "year"], [/price/i, "price"], [/mileage/i, "mileage"],
    [/make/i, "make"], [/model/i, "model"], [/transmission/i, "transmission"],
    [/fuel/i, "fuel"], [/colour/i, "colour"], [/body/i, "body"],
    [/category|repaired/i, "category"], [/keyword/i, "keyword"]
  ];
  const mapReasons = (reasons, suffix) => reasons.map(reason => {
    const match = rules.find(([pattern]) => pattern.test(String(reason)));
    return `${match?.[1] || "filter"}_${suffix}`;
  });
  return [...new Set([
    ...(evaluation.rejectionReasonCodes || []),
    ...mapReasons(evaluation.rejectionReasons || [], "rejected"),
    ...mapReasons(evaluation.unresolvedReasons || [], "detail_required")
  ])].slice(0, 12);
}

function buildUnrestrictedCoreDiagnosticConfig() {
  return FilterDomain.normaliseFilterConfig({
    advancedFiltersEnabled: false,
    includeUnavailableOptional: true,
    vehicle: { makes: [], models: [], minYear: null, maxYear: null },
    priceMileage: { minPrice: null, maxPrice: null, minMileage: null, maxMileage: null },
    specification: {
      transmissions: { mode: "any", include: [], exclude: [] },
      fuelTypes: { mode: "any", include: [], exclude: [] },
      colours: { mode: "any", include: [], exclude: [] },
      bodyTypes: { mode: "any", include: [], exclude: [] }
    },
    category: { mode: "any", statuses: [], includeRepairedVehicles: true },
    text: { requiredKeywords: [], excludedKeywords: [] },
    scan: settings.activeFilterConfig?.scan || {}
  });
}

function getDiagnosticFilterProfile() {
  const config = FilterDomain.normaliseFilterConfig(settings.activeFilterConfig || settings);
  const restrictionKeys = [];
  if (config.vehicle.makes.length) restrictionKeys.push("make");
  if (config.vehicle.models.length) restrictionKeys.push("model");
  for (const field of ["minYear", "maxYear"]) if (config.vehicle[field] !== null) restrictionKeys.push(field);
  for (const field of ["minPrice", "maxPrice", "minMileage", "maxMileage"]) {
    if (config.priceMileage[field] !== null) restrictionKeys.push(field);
  }
  if (config.specification.transmissions.mode !== "any") restrictionKeys.push("transmission");
  if (config.category.mode !== "any") restrictionKeys.push("category");
  if (config.text.excludedKeywords.length) restrictionKeys.push("excludedKeywords");
  if (config.advancedFiltersEnabled) restrictionKeys.push("advanced");
  return {
    source: settings.activeSavedSearchId ? "dashboard_saved_search" : "local_draft",
    categoryMode: config.category.mode,
    advancedFiltersEnabled: config.advancedFiltersEnabled,
    restrictionKeys
  };
}

function recordFilterDiagnostic(listingId, patch = {}, complete = false) {
  if (!settings.scannerDebugDiagnostics) return;
  const listingIdHash = ListingDetailsExtractor.shortPathHash(String(listingId || ""));
  if (!filterDiagnosticsByListingId.has(listingIdHash) && filterDiagnosticsByListingId.size >= 40) return;
  const current = filterDiagnosticsByListingId.get(listingIdHash) || {
    listingIdHash,
    filterSource: settings.activeSavedSearchId ? "dashboard_saved_search" : "local_draft",
    activeSavedSearchId: settings.activeSavedSearchId || "local",
    filterFingerprintHash: ListingDetailsExtractor.shortPathHash(getFilterFingerprint())
  };
  const next = { ...current, ...patch };
  filterDiagnosticsByListingId.set(listingIdHash, next);
  if (complete) console.info("Marketplace Vehicle Scanner filter decision:", next);
}

function sanitiseDiagnosticText(value, limit = 120) {
  return truncate(String(value || "")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/(bearer|token|cookie|password|authorization|session)\s*[:=]?\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim(), limit);
}

function diagnosticError(error) {
  return {
    errorClass: sanitiseDiagnosticText(error?.name || "Error", 40),
    errorMessage: sanitiseDiagnosticText(error instanceof Error ? error.message : error, 120)
  };
}

function safeDiagnosticDetails(details = {}) {
  const allowedBooleanFields = [
    "cardUrlResolved", "detailRequired", "provenReject", "staticAttempted",
    "staticCompleted", "renderedAttempted", "renderedCompleted", "payloadBuilt",
    "payloadValid", "uploadAttempted", "uploadCompleted",
    "hasDescription", "hasMileage", "hasPrice", "hasYear", "hasIdentity", "hasImages",
    "detailInspectionAttempted", "staticInspectionCompleted", "renderedInspectionCompleted"
  ];
  const allowedNumberFields = ["durationMs", "imageCount"];
  const safe = {};
  for (const field of allowedBooleanFields) {
    if (typeof details[field] === "boolean") safe[field] = details[field];
  }
  for (const field of allowedNumberFields) {
    if (Number.isFinite(details[field])) safe[field] = Math.max(0, Math.round(details[field]));
  }
  for (const field of ["decision", "outcome", "errorClass", "errorMessage", "finalizationStage"]) {
    if (details[field] !== null && details[field] !== undefined) {
      safe[field] = sanitiseDiagnosticText(details[field], field === "errorMessage" ? 120 : 50);
    }
  }
  for (const field of ["knownFields", "reasonCodes", "finalizationReasonCodes"]) {
    if (Array.isArray(details[field])) {
      safe[field] = details[field].slice(0, 12).map(value => sanitiseDiagnosticText(value, 50));
    }
  }
  return safe;
}

function recordDiagnosticStage(listingId, stage, details = {}) {
  if (!settings.scannerDebugDiagnostics) return;
  const listingIdHash = ListingDetailsExtractor.shortPathHash(String(listingId || ""));
  if (!diagnosticTimelineByListingId.has(listingIdHash) && diagnosticTimelineByListingId.size >= 8) return;
  const current = diagnosticTimelineByListingId.get(listingIdHash) || {
    listingIdHash,
    stages: []
  };
  if (current.stages.length >= 24) return;
  current.stages.push({
    stage: sanitiseDiagnosticText(stage, 50),
    at: new Date().toISOString(),
    ...safeDiagnosticDetails(details)
  });
  diagnosticTimelineByListingId.set(listingIdHash, current);
}

function getScannerDiagnosticReport() {
  const counts = countStates();
  const readyToCopy = Boolean(
    scanStartedAt &&
    scanCompletedAt &&
    !scanningActive
  );
  return {
    reportVersion: 1,
    mode: "normal_debug",
    uploadEnabled: true,
    maximumListings: settings.maximumProcessed,
    startedAt: scanStartedAt ? new Date(scanStartedAt).toISOString() : null,
    completedAt: scanCompletedAt ? new Date(scanCompletedAt).toISOString() : null,
    elapsedMs: scanStartedAt
      ? (scanCompletedAt || Date.now()) - scanStartedAt
      : 0,
    readyToCopy,
    status: scanStatus,
    stopReason: stopReason ? sanitiseDiagnosticText(stopReason, 50) : null,
    filterProfile: getDiagnosticFilterProfile(),
    counts: {
      discovered: counts.discovered,
      processed: counts.processed,
      matched: counts.matched,
      rejected: counts.rejected,
      unavailable: counts.unavailable
    },
    listings: [...diagnosticTimelineByListingId.values()].map(item => ({
      listingIdHash: item.listingIdHash,
      stages: item.stages.map(stage => ({ ...stage }))
    }))
  };
}

function recordLifecycleDiagnostic(event, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    event: String(event).slice(0, 80),
    lifecycleState,
    scanStatus,
    ...Object.fromEntries(
      Object.entries(details).slice(0, 8).map(([key, value]) => [
        String(key).slice(0, 40),
        typeof value === "string" ? value.slice(0, 120) : Boolean(value)
      ])
    )
  };
  lifecycleDiagnostics = [...lifecycleDiagnostics, entry].slice(-30);
  console.info("Marketplace Vehicle Scanner lifecycle:", entry);
}

function scanIsRunning() {
  return scanningActive && ScannerLifecycle.permitsScanningActivity(lifecycleState);
}

function waitForScanDelay(milliseconds) {
  return new Promise(resolve => {
    const wait = { timer: null, resolve };
    wait.timer = setTimeout(() => {
      scanDelayWaits.delete(wait);
      resolve();
    }, milliseconds);
    scanDelayWaits.add(wait);
  });
}

function cancelScanDelays() {
  for (const wait of scanDelayWaits) {
    clearTimeout(wait.timer);
    wait.resolve();
  }
  scanDelayWaits.clear();
}

function getRouteKey() {
  return `${location.pathname}${location.search}`;
}

function isListingRoute() {
  return /\/marketplace\/item\/\d+/.test(location.pathname);
}

function isMarketplaceSearchRoute() {
  return location.pathname.includes("/marketplace") && !isListingRoute();
}

function normaliseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampInteger(value, minimum, maximum, fallback) {
  const numeric = Math.trunc(Number(value));

  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function truncate(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function deriveScanName() {
  const url = new URL(location.href);
  const query =
    url.searchParams.get("query") ||
    url.searchParams.get("q") ||
    url.searchParams.get("keyword");

  if (query) {
    return query.trim().slice(0, 120);
  }

  const title = document.title
    .replace(/\s*\|\s*Facebook.*$/i, "")
    .replace(/Marketplace\s*[-–:]?\s*/i, "")
    .trim();

  return title || "Facebook Marketplace vehicle scan";
}

function normaliseListingUrl(href) {
  return ScannerRuntime.normaliseListingUrl(href, location.origin);
}

function getUniqueListingIds(element) {
  const ids = new Set();

  for (const link of element.querySelectorAll?.('a[href*="/item/"]') ?? []) {
    const listing = normaliseListingUrl(link.href);
    if (listing) ids.add(listing.id);
  }

  return ids;
}

function findCard(anchor, listingId) {
  let node = anchor;

  for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
    const rect = node.getBoundingClientRect();
    const imageCount = node.querySelectorAll?.("img").length ?? 0;
    const uniqueIds = getUniqueListingIds(node);
    const sensibleSize =
      rect.width >= 130 &&
      rect.height >= 140 &&
      rect.width <= 760 &&
      rect.height <= 1000;

    if (
      sensibleSize &&
      imageCount >= 1 &&
      uniqueIds.has(listingId) &&
      uniqueIds.size <= 2
    ) {
      return node;
    }
  }

  const rect = anchor.getBoundingClientRect();

  if (rect.width >= 130 && rect.height >= 140 && anchor.querySelector("img")) {
    return anchor;
  }

  return null;
}

function getCardLines(card) {
  return (card.innerText || card.textContent || "")
    .split(/\n+/)
    .map(value => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter(value => !/^(Not scanned|Queued|Scanning…|Matches filters)$/i.test(value));
}

function extractCardMetadata(card, listingId, sourceAnchor) {
  const lines = getCardLines(card);
  const text = lines.join(" ");
  const yearMatch = text.match(/\b(19[8-9]\d|20[0-3]\d)\b/);
  const priceMatch = text.match(/£\s?(\d{1,3}(?:,\d{3})+|\d{3,7})(?!\d)/);
  const mileageMatch =
    text.match(/\b(\d{1,3}(?:,\d{3})+)\s*(?:miles?|mi)\b/i) ||
    text.match(/\b(\d{1,3}(?:\.\d{1,2})?)\s*k\s*(?:miles?|mi)?\b/i);

  let mileage = null;

  if (mileageMatch) {
    mileage = Number(mileageMatch[1].replace(/,/g, ""));

    if (/\bk\b/i.test(mileageMatch[0])) {
      mileage = Math.round(mileage * 1000);
    }
  }

  const priceLineIndex = lines.findIndex(line => /£\s?\d/.test(line));
  const titleCandidates = lines.filter(line =>
    !/£\s?\d/.test(line) &&
    !/^(Sponsored|Ad|Pending|Sold)$/i.test(line) &&
    !/^\d+\s*(?:miles?|mi)$/i.test(line)
  );

  let title = titleCandidates.find(line => /\b(19[8-9]\d|20[0-3]\d)\b/.test(line));

  if (!title && priceLineIndex >= 0) {
    title = lines.slice(priceLineIndex + 1).find(line =>
      !/^(Sponsored|Ad|Pending|Sold)$/i.test(line)
    );
  }

  if (!title) {
    title = titleCandidates[0] || null;
  }

  const titleIndex = title ? lines.indexOf(title) : -1;
  let locationText = null;

  if (titleIndex >= 0) {
    locationText = lines.slice(titleIndex + 1).find(line =>
      !/\b(?:miles?|mi)\b/i.test(line) &&
      !/^(Petrol|Diesel|Electric|Hybrid|Manual|Automatic|Auto)$/i.test(line)
    ) || null;
  }

  const lowerText = text.toLowerCase();
  const fuelType =
    lowerText.includes("plug-in hybrid") ? "plug-in hybrid" :
    lowerText.includes("hybrid") ? "hybrid" :
    lowerText.includes("electric") ? "electric" :
    lowerText.includes("diesel") ? "diesel" :
    lowerText.includes("petrol") ? "petrol" : null;

  const transmission =
    /\bautomatic\b|\bauto\b/i.test(text) ? "automatic" :
    /\bmanual\b/i.test(text) ? "manual" : null;

  const sellerType = /\bdealer(?:ship)?\b/i.test(text) ? "dealer" : null;
  const listingAnchors = [sourceAnchor, ...card.querySelectorAll('a[href*="/item/"]')]
    .filter(Boolean)
    .filter((anchor, index, values) => values.indexOf(anchor) === index)
    .filter(anchor => normaliseListingUrl(anchor.href)?.id === listingId);
  const image = listingAnchors.map(anchor => anchor.querySelector("img[src]")).find(Boolean) || null;
  const imageUrl = image?.currentSrc || image?.src || null;

  return {
    cardText: truncate(text, 1800),
    title: title ? truncate(title, 240) : null,
    price: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null,
    year: yearMatch ? Number(yearMatch[1]) : null,
    mileage: Number.isFinite(mileage) ? mileage : null,
    location: locationText ? truncate(locationText, 180) : null,
    sellerType,
    fuelType,
    transmission,
    imageUrl: imageUrl ? truncate(imageUrl, 1600) : null,
    imageOwnerListingId: imageUrl ? listingId : null
  };
}

function getViewportPriority(card) {
  const rect = card.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const horizontalVisible = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
  const verticalVisible = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);

  if (horizontalVisible > 0 && verticalVisible > 0) {
    return 100000 + Math.round(horizontalVisible * verticalVisible);
  }

  const distance = rect.top > viewportHeight
    ? rect.top - viewportHeight
    : Math.abs(rect.bottom);

  return Math.max(0, 50000 - Math.round(distance));
}

function cleanupLegacyCardDecorations() {
  for (const strip of document.querySelectorAll(".mcf-status-strip")) {
    strip.remove();
  }

  for (const card of document.querySelectorAll(
    ".mcf-hidden, .mcf-dimmed, .mcf-badges-only, [data-mcf-status], [data-mcf-listing-id]"
  )) {
    card.classList.remove("mcf-hidden", "mcf-dimmed", "mcf-badges-only");
    delete card.dataset.mcfStatus;
    delete card.dataset.mcfListingId;
    card.style.removeProperty("position");
  }
}

function getFilterFingerprint() {
  return FilterDomain.filterFingerprint(settings.activeFilterConfig || settings);
}

function enrichVehicleIdentity(metadata, result, final = false) {
  const config = FilterDomain.normaliseFilterConfig(settings.activeFilterConfig || settings);
  const identity = VehicleIdentity.identifyVehicle({
    structuredMake: result?.detectedMake,
    structuredModel: result?.detectedModel,
    listingTitle: result?.listingTitle,
    vehicleAttributes: result?.vehicleAttributes,
    cardTitle: metadata.title
  }, {
    makes: config.vehicle.makes,
    models: config.vehicle.models,
    final
  });
  return {
    ...(result || {}),
    detectedMake: identity.detectedMake,
    detectedModel: identity.detectedModel,
    makeModelSource: identity.source,
    vehicleIdentityDiagnostics: identity.diagnostics
  };
}

function combineCategoryResult(metadata, result = null) {
  return ListingCategoryPipeline.classifyFinalCategory(metadata, result);
}

function vehicleAttribute(result, labels) {
  const wanted = new Set(labels.map(VehicleCatalogue.key));
  for (const [label, value] of Object.entries(result?.vehicleAttributes || {})) {
    if (wanted.has(VehicleCatalogue.key(label))) return value;
  }
  return null;
}

function buildCanonicalFacts(metadata = {}, result = null, options = {}) {
  const detailAvailable = options.detailCompleted === undefined
    ? Boolean(result)
    : options.detailCompleted === true;
  const category = result?.detected && ["S", "N", "C", "D"].includes(result.category)
    ? `cat_${result.category.toLowerCase()}`
    : null;
  return ListingFacts.normaliseListingFacts({
    listingId: result?.listingId || metadata.listingId,
    listingUrl: result?.finalUrl || metadata.url,
    title: result?.listingTitle || metadata.title,
    description: result?.fullDescription,
    price: toNullableNonNegativeInteger(result?.price) ?? toNullableNonNegativeInteger(metadata.price),
    mileage: getMileageForFilter(metadata, result),
    year: toNullableVehicleYear(result?.year) ?? toNullableVehicleYear(metadata.year),
    make: result?.detectedMake || vehicleAttribute(result, ["make", "manufacturer", "marque"]),
    model: result?.detectedModel || vehicleAttribute(result, ["model", "vehicle model"]),
    derivative: vehicleAttribute(result, ["trim", "derivative", "variant"]),
    transmission: result?.transmission || metadata.transmission,
    fuelType: result?.fuelType || metadata.fuelType,
    colour: vehicleAttribute(result, ["colour", "color", "primary colour"]),
    bodyType: vehicleAttribute(result, ["body type", "body style", "vehicle type"]),
    categoryStatus: category,
    categoryDetected: Boolean(category),
    categoryEvidence: result?.match,
    sellerType: result?.sellerType || metadata.sellerType,
    location: result?.location || metadata.location,
    cardText: metadata.cardText,
    sources: {
      price: result?.price !== null && result?.price !== undefined ? "listing_detail" : "search_card",
      mileage: result?.mileageDetail ? "listing_detail" : metadata.mileage !== null && metadata.mileage !== undefined ? "search_card" : "unknown",
      year: result?.year !== null && result?.year !== undefined ? "listing_detail" : "search_card",
      make: result?.makeModelSource || (detailAvailable ? "listing_detail" : "search_card"),
      model: result?.makeModelSource || (detailAvailable ? "listing_detail" : "search_card"),
      transmission: result?.transmission ? "listing_detail" : "search_card",
      fuelType: result?.fuelType ? "listing_detail" : "search_card",
      colour: detailAvailable ? "listing_detail" : "unknown",
      bodyType: detailAvailable ? "listing_detail" : "unknown",
      categoryStatus: detailAvailable ? "trusted_listing_evidence" : "search_card",
      textCorpus: detailAvailable ? "listing_detail" : "search_card"
    }
  });
}

function evaluateFilters(metadata, result = null, options = {}) {
  const phase = options.phase || (result ? "final" : "prefilter");
  const facts = buildCanonicalFacts(metadata, result, {
    detailCompleted: phase !== "prefilter" && Boolean(result)
  });
  const evaluation = FilterDomain.evaluateFilters(
    facts,
    settings.activeFilterConfig || settings,
    { phase }
  );
  const primaryReason = evaluation.rejectionReasons[0] || evaluation.unresolvedReasons[0] || null;
  return {
    ...evaluation,
    facts,
    rejected: evaluation.decision === "reject",
    reason: primaryReason,
    code: evaluation.decision === "reject"
      ? "filter_rejected"
      : evaluation.decision === "unresolved" ? "filter_unresolved" : null
  };
}

function isFinalStatus(status) {
  return FINAL_LISTING_STATUSES.has(status);
}

function getLedgerEntry(listingId) {
  return ledgerByListingId.get(listingId) || null;
}

function upsertLedgerEntry(listingId, patch = {}) {
  const now = Date.now();
  const current = ledgerByListingId.get(listingId) || {
    listingId,
    url: null,
    status: "discovered",
    workState: "unseen",
    reason: null,
    code: null,
    source: "search-card",
    metadata: null,
    discoveredAt: now,
    processedAt: null,
    updatedAt: now
  };

  const next = {
    ...current,
    ...patch,
    listingId,
    metadata: patch.metadata
      ? { ...(current.metadata || {}), ...patch.metadata }
      : current.metadata,
    updatedAt: now
  };

  ledgerByListingId.set(listingId, next);
  return next;
}

function markDiscovered(listing, metadata) {
  const current = getLedgerEntry(listing.id);

  if (current) {
    performanceDiagnostics.increment("duplicateSkipped");
  } else {
    performanceDiagnostics.recordListing(listing.id, "discovered");
    performanceDiagnostics.increment("discovered");
    recordDiagnosticStage(listing.id, "discovered", {
      cardUrlResolved: Boolean(listing.url)
    });
    recordDiagnosticStage(listing.id, "card_metadata_extracted", {
      knownFields: knownCanonicalFields(buildCanonicalFacts(metadata, null))
    });
  }

  return upsertLedgerEntry(listing.id, {
    url: listing.url,
    status: current?.status || "discovered",
    metadata,
    discoveredAt: current?.discoveredAt || Date.now()
  });
}

function markFinal(listingId, status, options = {}) {
  const finalizationStage = options.finalizationStage || "detail";
  const evaluation = options.result?.filterEvaluation || null;
  const cardDecision = finalizationStage === "card"
    ? ScannerDecisionPolicy.cardFinalizationDecision(evaluation)
    : null;
  if (finalizationStage === "card" && !cardDecision.mayFinalize) {
    throw new Error("Unsafe card-stage finalization was blocked pending detail inspection.");
  }
  const current = getLedgerEntry(listingId);
  const entry = upsertLedgerEntry(listingId, {
    status,
    workState: options.workState || (status === "unavailable" ? "failed_final" : "processed"),
    reason: options.reason || (status === "matched" ? "Matches selected filters" : null),
    code: options.code || (status === "unavailable" ? "unavailable" : null),
    source: options.source || "listing-result",
    metadata: options.metadata,
    detailInspectionAttempted: options.detailInspectionAttempted ?? current?.detailInspectionAttempted ?? false,
    staticInspectionCompleted: options.staticInspectionCompleted ?? current?.staticInspectionCompleted ?? false,
    renderedInspectionCompleted: options.renderedInspectionCompleted ?? current?.renderedInspectionCompleted ?? false,
    finalizationStage,
    finalizationReasonCodes: cardDecision?.reasonCodes || options.finalizationReasonCodes || diagnosticReasonCodesForEvaluation(evaluation || {}),
    cardFinalizationValidated: finalizationStage === "card" ? true : null,
    processedAt: Date.now()
  });

  queuedListingIds.delete(listingId);
  performanceDiagnostics.recordListing(listingId, "processingComplete");
  queueRemoteListing(entry, options.result || null);
  updateProgress();
  schedulePersist();
  scheduleRemoteProgressSync();
  evaluateAndFinaliseIfNeeded();
  recordDiagnosticStage(listingId, "terminal", {
    decision: status,
    outcome: options.code || status,
    reasonCodes: options.code ? [options.code] : [],
    detailInspectionAttempted: entry.detailInspectionAttempted === true,
    staticInspectionCompleted: entry.staticInspectionCompleted === true,
    renderedInspectionCompleted: entry.renderedInspectionCompleted === true,
    finalizationStage: entry.finalizationStage,
    finalizationReasonCodes: entry.finalizationReasonCodes
  });
  return entry;
}

function classifyListing(listingId, metadata, result, source) {
  const combinedResult = enrichVehicleIdentity(
    metadata,
    combineCategoryResult(metadata, result),
    true
  );
  const evaluation = evaluateFilters(metadata, combinedResult);
  const status = evaluation.decision === "reject"
    ? "rejected"
    : evaluation.decision === "unresolved" ? "unavailable" : "matched";

  const classifiedResult = {
    ...combinedResult,
    canonicalFacts: evaluation.facts,
    filterEvaluation: evaluation
  };
  resultByListingId.set(listingId, classifiedResult);
  recordDiagnosticStage(listingId, "facts_merged", {
    knownFields: knownCanonicalFields(evaluation.facts),
    hasDescription: Boolean(result?.fullDescription),
    hasMileage: evaluation.facts.mileage !== null && evaluation.facts.mileage !== undefined,
    hasPrice: evaluation.facts.price !== null && evaluation.facts.price !== undefined,
    hasYear: evaluation.facts.year !== null && evaluation.facts.year !== undefined,
    hasIdentity: Boolean(evaluation.facts.make || evaluation.facts.model),
    hasImages: Array.isArray(result?.imageUrls) && result.imageUrls.length > 0,
    imageCount: Array.isArray(result?.imageUrls) ? result.imageUrls.length : 0
  });
  recordDiagnosticStage(listingId, "final_evaluation", {
    decision: evaluation.decision,
    detailRequired: evaluation.detailRequired === true,
    provenReject: evaluation.provenReject === true,
    reasonCodes: diagnosticReasonCodesForEvaluation(evaluation)
  });
  if (settings.scannerDebugDiagnostics) {
    const unrestrictedCoreEvaluation = FilterDomain.evaluateFilters(
      evaluation.facts,
      buildUnrestrictedCoreDiagnosticConfig(),
      { phase: "final" }
    );
    recordDiagnosticStage(listingId, "unrestricted_core_evaluation", {
      decision: unrestrictedCoreEvaluation.decision,
      detailRequired: unrestrictedCoreEvaluation.detailRequired === true,
      provenReject: unrestrictedCoreEvaluation.provenReject === true,
      reasonCodes: diagnosticReasonCodesForEvaluation(unrestrictedCoreEvaluation)
    });
  }
  recordFilterDiagnostic(listingId, {
    canonicalKnownFields: knownCanonicalFields(evaluation.facts),
    finalDecision: evaluation.decision,
    finalReasons: diagnosticReasons(evaluation.rejectionReasons.length ? evaluation.rejectionReasons : evaluation.unresolvedReasons)
  }, true);

  return markFinal(listingId, status, {
    reason: evaluation.reason,
    code: evaluation.code,
    source,
    finalizationStage: source === "cached-listing-result" ? "cached_detail" : "detail",
    finalizationReasonCodes: diagnosticReasonCodesForEvaluation(evaluation),
    metadata,
    result: classifiedResult
  });
}

function countStates() {
  const finalCounts = ListingCategoryPipeline.countFinalOutcomes(
    ledgerByListingId.values(),
    settings.targetMatches
  );
  const counts = {
    discovered: ledgerByListingId.size,
    processed: finalCounts.processed,
    matched: finalCounts.matched,
    rejected: finalCounts.rejected,
    unavailable: finalCounts.unavailable,
    queued: 0,
    scanning: 0,
    activeWork: 0,
    pending: 0,
    uploaded: 0,
    rejectionReasonCounts: {}
  };

  for (const entry of ledgerByListingId.values()) {
    if (entry.status === "queued") counts.queued += 1;
    if (entry.status === "scanning") counts.scanning += 1;
    if (entry.uploadedAt) counts.uploaded += 1;
    if (entry.reason && ["rejected", "unavailable"].includes(entry.status)) {
      const reason = truncate(entry.reason, 120);
      counts.rejectionReasonCounts[reason] = (counts.rejectionReasonCounts[reason] || 0) + 1;
    }
  }

  counts.activeWork = counts.queued + counts.scanning;
  counts.pending = Math.max(0, counts.discovered - counts.processed);
  counts.invariantValid =
    counts.processed === counts.matched + counts.rejected + counts.unavailable &&
    counts.discovered === counts.processed + counts.pending;

  return counts;
}

function getElapsedSeconds() {
  if (!scanStartedAt) return 0;
  const end = scanCompletedAt || Date.now();
  return Math.max(0, Math.floor((end - scanStartedAt) / 1000));
}

function getProgressPayload() {
  const counts = countStates();

  return {
    discoveredCount: counts.discovered,
    processedCount: counts.processed,
    matchedCount: counts.matched,
    rejectedCount: counts.rejected,
    unavailableCount: counts.unavailable
  };
}

function getRuntimeProgress() {
  const counts = countStates();
  performanceDiagnostics.setGauges({
    queueSize: counts.queued,
    activeWorkers: counts.scanning,
    processed: counts.processed
  });

  return {
    ...counts,
    inspecting: counts.scanning,
    unresolved: counts.unavailable,
    scanningActive,
    executionState: scanIsRunning() ? "running" : "idle",
    lifecycleState,
    historicalScanStatus,
    interrupted: lifecycleState === "interrupted",
    paused: lifecycleState === "paused",
    canResume: ["interrupted", "paused"].includes(lifecycleState),
    autoLoadingActive,
    scrollState,
    targetMatches: settings.targetMatches,
    maximumProcessed: settings.maximumProcessed,
    maximumDurationSeconds: settings.maximumDurationSeconds,
    elapsedSeconds: getElapsedSeconds(),
    targetReached: counts.matched >= settings.targetMatches,
    processedLimitReached: counts.processed >= settings.maximumProcessed,
    durationLimitReached: Boolean(
      scanDeadlineAt && Date.now() >= scanDeadlineAt
    ),
    scanStatus,
    stopReason,
    scanId: remoteRun?.scanId || null,
    resultsUrl: remoteRun?.resultsUrl || null,
    remoteCompleted,
    remoteSyncState,
    remoteSyncError,
    pendingUploadCount: pendingUploadsByListingId.size,
    canRetrySync: Boolean(remoteRun && (pendingUploadsByListingId.size || !remoteCompleted)),
    sourceSearchUrl: sourceSearchRouteKey
      ? new URL(sourceSearchRouteKey, location.origin).toString()
      : null,
    startedAt: scanStartedAt,
    completedAt: scanCompletedAt,
    updatedAt: Date.now(),
    invariantValid: counts.invariantValid,
    lifecycleDiagnostics,
    performanceDiagnostics: performanceDiagnostics.snapshot(),
    storageHealth: { ...storageHealth },
    activeFilterSource: settings.activeSavedSearchId ? "dashboard_saved_search" : "local_draft",
    activeSavedSearchId: settings.activeSavedSearchId || null,
    filterFingerprintHash: ListingDetailsExtractor.shortPathHash(getFilterFingerprint()),
    usingPersistedSettingsSnapshot
  };
}

function updateProgress() {
  const progress = getRuntimeProgress();
  latestRuntimeProgress = progress;
  renderPanel(progress);
  maybeLogPerformanceSummary(progress);

  clearTimeout(runtimeProgressTimer);
  runtimeProgressTimer = setTimeout(() => {
    chrome.storage.local.set({ runtimeProgress: latestRuntimeProgress }).catch(error => {
      if (ScannerStorage.isQuotaError(error)) {
        storageHealth.lastQuotaFailure = new Date().toISOString();
        storageHealth.nearSoftLimit = true;
      }
    });
  }, CONFIG.runtimeProgressPersistDelayMs);
}

function getTerminalCondition() {
  if (!scanIsRunning() || scanFinalised) return null;

  const counts = countStates();

  if (counts.matched >= settings.targetMatches) {
    return { status: "completed", reason: "target_reached" };
  }

  if (counts.processed >= settings.maximumProcessed) {
    return { status: "limit_reached", reason: "processed_limit_reached" };
  }

  if (scanDeadlineAt && Date.now() >= scanDeadlineAt) {
    return { status: "timed_out", reason: "duration_limit_reached" };
  }

  return null;
}

function evaluateAndFinaliseIfNeeded() {
  const condition = getTerminalCondition();

  if (condition) {
    finaliseScan(condition.status, condition.reason).catch(error => {
      console.error("Marketplace Vehicle Scanner finalisation failed:", error);
    });
    return true;
  }

  return false;
}

function collectCards() {
  for (const [listingId, card] of cardByListingId.entries()) {
    if (!card?.isConnected) {
      cardByListingId.delete(listingId);
    }
  }

  const anchors = [
    ...document.querySelectorAll(
      'a[href*="/marketplace/item/"], a[href*="/item/"]'
    )
  ];
  const unique = new Map();

  const discoveryCeiling = Math.min(
    520,
    settings.maximumProcessed + CONFIG.maxQueuedInspections
  );

  for (const anchor of anchors) {
    if (unique.size >= CONFIG.maxListingsPerDomPass) break;

    const listing = normaliseListingUrl(anchor.href);

    if (!listing || unique.has(listing.id)) continue;
    performanceDiagnostics.recordListing(listing.id, "idExtracted");

    if (!ledgerByListingId.has(listing.id) && ledgerByListingId.size >= discoveryCeiling) {
      continue;
    }

    const card = findCard(anchor, listing.id);
    if (!card) continue;

    const rect = card.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const metadata = extractCardMetadata(card, listing.id, anchor);
    markDiscovered(listing, metadata);
    cardByListingId.set(listing.id, card);

    unique.set(listing.id, {
      listing,
      card,
      metadata,
      priority: getViewportPriority(card)
    });
  }

  updateProgress();

  return [...unique.values()]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, CONFIG.maxListingsPerDomPass);
}

function collectScannableEntries() {
  return ScannerRuntime.mergeScannableEntries(
    collectCards(),
    ledgerByListingId.values(),
    CONFIG.maxListingsPerDomPass
  );
}

async function loadCachedResults(listingIds) {
  const results = new Map();
  for (const listingId of listingIds) {
    if (resultByListingId.has(listingId)) {
      results.set(listingId, resultByListingId.get(listingId));
    }
  }
  return results;
}

async function saveCachedResult(listingId, result) {
  // Full detail results are intentionally memory-only. The compact active-run
  // state persists the upload payload only until the dashboard confirms it.
  resultByListingId.set(listingId, result);
}

function sendBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "Extension service worker did not respond."));
        return;
      }

      resolve(response.result);
    });
  });
}

async function inspectListing(url, priority) {
  return sendBackground({
    type: "INSPECT_LISTING",
    url,
    priority,
    runToken,
    debug: settings.scannerDebugDiagnostics === true
  });
}

function toNullableNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Math.round(numeric);
}

function toNullableVehicleYear(value) {
  const year = toNullableNonNegativeInteger(value);

  if (year === null || year < 1886 || year > 2100) {
    return null;
  }

  return year;
}

function getMileageForFilter(metadata, result) {
  return MileageUtils.sourceMileageInMiles(
    result?.mileageDetail,
    metadata.mileage ?? result?.mileage
  );
}

function normaliseFreshFacebookUkMileage(result) {
  if (!result?.mileageDetail) return result;
  return {
    ...result,
    mileageDetail: MileageUtils.normaliseOperationalMileage(result.mileageDetail, {
      source: "facebook_marketplace",
      market: "GB"
    })
  };
}

function buildRemoteListing(entry, result = null) {
  const metadata = entry.metadata || {};
  const facts = result?.canonicalFacts || buildCanonicalFacts(metadata, result);
  const listingImages = ListingDetailsExtractor.resolveListingImages(result, {
    listingId: entry.listingId,
    sourceListingId: metadata.imageOwnerListingId,
    imageUrl: metadata.imageUrl
  });
  const vehicleAttributes = { ...(result?.vehicleAttributes || {}) };
  if (result?.detectedMake) vehicleAttributes["Advert make"] = truncate(result.detectedMake, 80);
  if (result?.detectedModel) vehicleAttributes["Advert model"] = truncate(result.detectedModel, 80);
  if (result?.makeModelSource) vehicleAttributes["Advert make/model source"] = truncate(result.makeModelSource, 80);
  const mileageValue = toNullableNonNegativeInteger(result?.mileageDetail?.value);
  const mileageUnit = ["mi", "km"].includes(result?.mileageDetail?.unit)
    ? result.mileageDetail.unit
    : null;
  const hasSourceMileage = mileageValue !== null && mileageUnit !== null;
  const mileageUnitSource = result?.mileageDetail?.unitSource === MileageUtils.FACEBOOK_UK_LABEL_CORRECTION
    ? MileageUtils.FACEBOOK_UK_LABEL_CORRECTION
    : null;
  const categoryEvidence = Array.isArray(result?.evidence)
    ? result.evidence.slice(0, 10).map(item => ({
        category: item.category,
        matchedPhrase: truncate(item.matchedPhrase, 120),
        context: truncate(item.context, 600),
        normalizedMatch: item.normalizedMatch,
        source: item.source,
        detectorRule: item.detectorRule,
        negationEvaluated: item.negationEvaluated
      }))
    : [];
  const negatedCategoryEvidence = Array.isArray(result?.negatedEvidence)
    ? result.negatedEvidence.slice(0, 10).map(item => ({
        category: item.category,
        matchedPhrase: truncate(item.matchedPhrase, 120),
        context: truncate(item.context, 600),
        normalizedMatch: item.normalizedMatch,
        source: item.source,
        detectorRule: item.detectorRule,
        diagnosticReason: item.diagnosticReason
      }))
    : [];

  return {
    externalListingId: entry.listingId,
    sourceUrl: entry.url,
    title: facts.title,
    price: facts.price,
    currency: "GBP",
    year: facts.year,
    mileage: hasSourceMileage
      ? mileageUnit === "mi" ? mileageValue : null
      : facts.mileage,
    mileageValue: hasSourceMileage ? mileageValue : null,
    mileageUnit: hasSourceMileage ? mileageUnit : null,
    mileageOriginalText: hasSourceMileage
      ? truncate(result?.mileageDetail?.originalText, 120)
      : null,
    mileageUnitSource: hasSourceMileage ? mileageUnitSource : null,
    location: facts.location,
    sellerType: facts.sellerType === "unknown" ? null : facts.sellerType,
    fuelType: facts.fuelType === "unknown" ? null : facts.fuelType,
    transmission: facts.transmission === "unknown" ? null : facts.transmission,
    bodyStyle: facts.bodyType === "unknown" ? null : facts.bodyType,
    imageUrl: listingImages.imageUrl,
    imageUrls: listingImages.imageUrls,
    imageExtractionStatus: listingImages.imageExtractionStatus,
    descriptionExcerpt: result?.evidenceExcerpt
      ? truncate(result.evidenceExcerpt, 600)
      : result?.context
        ? truncate(result.context, 600)
        : null,
    fullDescription: result?.fullDescription || null,
    vehicleAttributes,
    sellerName: result?.sellerName || null,
    sellerProfileUrl: result?.sellerProfileUrl || null,
    listedAtText: result?.listedAtText || null,
    status: entry.status,
    rejectionCode: entry.code || null,
    rejectionReason: entry.reason || null,
    categoryDetected: Boolean(result?.detected),
    categoryType: result?.category || null,
    extractionSource:
      result?.listingDetailExtractionSource || result?.source || result?.extractionSource || entry.source || null,
    rawMetadata: {
      cardText: truncate(metadata.cardText, 1500),
      categoryMatch: result?.match || null,
      categoryContext: result?.context ? truncate(result.context, 600) : null,
      categoryNormalizedMatch: result?.normalizedMatch || null,
      categoryDetectorRule: result?.detectorRule || null,
      categoryEvidence,
      negatedCategoryEvidence,
      detectedCategories: result?.detectedCategories || [],
      conflictingCategories: Boolean(result?.conflictingCategories),
      negationEvaluated: Boolean(result?.negationEvaluated),
      fetchedYear: result?.year ?? null,
      fetchedMileage: result?.mileage ?? null,
      fetchedPrice: result?.price ?? null,
      vehicleIdentity: result?.vehicleIdentityDiagnostics || null,
      canonicalFacts: {
        make: facts.make,
        model: facts.model,
        derivative: facts.derivative,
        colour: facts.colour,
        bodyType: facts.bodyType,
        categoryStatus: facts.categoryStatus,
        unknownFields: facts.unknownFields,
        sources: facts.sources,
        confidence: facts.confidence
      },
      filterEvaluation: result?.filterEvaluation ? {
        decision: result.filterEvaluation.decision,
        rejectionReasons: result.filterEvaluation.rejectionReasons,
        unresolvedReasons: result.filterEvaluation.unresolvedReasons,
        warnings: result.filterEvaluation.warnings,
        evaluatedValues: result.filterEvaluation.evaluatedValues,
        missingRequiredFields: result.filterEvaluation.missingRequiredFields,
        diagnostics: result.filterEvaluation.diagnostics
      } : null,
      preliminaryCategoryResult: result?.categoryClassificationDiagnostics?.preliminaryCategoryResult || null,
      finalCategoryResult: result?.categoryClassificationDiagnostics?.finalCategoryResult || null,
      finalCategoryEvidenceSource: result?.categoryClassificationDiagnostics?.finalCategoryEvidenceSource || null,
      reclassifiedAfterRenderedExtraction: Boolean(result?.categoryClassificationDiagnostics?.reclassifiedAfterRenderedExtraction),
      provisionalStatus: result?.categoryClassificationDiagnostics?.provisionalStatus || null,
      finalStatus: result?.categoryClassificationDiagnostics?.finalStatus || entry.status,
      extractionSource: result?.extractionSource || null,
      checkedAt: result?.checkedAt || entry.processedAt || null,
      runtimeLifecycle: {
        evaluatorLifecycleVersion: ScannerDecisionPolicy.EVALUATOR_LIFECYCLE_VERSION,
        detailInspectionAttempted: entry.detailInspectionAttempted === true,
        staticInspectionCompleted: entry.staticInspectionCompleted === true,
        renderedInspectionCompleted: entry.renderedInspectionCompleted === true,
        finalizationStage: entry.finalizationStage || "detail_unavailable",
        finalizationReasonCodes: Array.isArray(entry.finalizationReasonCodes)
          ? entry.finalizationReasonCodes.slice(0, 12)
          : []
      }
    },
    discoveredAt: entry.discoveredAt
      ? new Date(entry.discoveredAt).toISOString()
      : null,
    processedAt: entry.processedAt
      ? new Date(entry.processedAt).toISOString()
      : null
  };
}

function queueRemoteListing(entry, result = null) {
  if (!remoteRun?.scanId || !isFinalStatus(entry.status)) return;
  if (entry.finalizationStage === "card" && entry.cardFinalizationValidated !== true) {
    throw new Error("Unsafe card-stage upload was blocked pending detail inspection.");
  }

  const payload = ScannerStorage.sanitisePendingUpload(buildRemoteListing(entry, result));
  pendingUploadsByListingId.set(entry.listingId, payload);
  recordDiagnosticStage(entry.listingId, "payload_built", {
    payloadBuilt: true,
    payloadValid: true
  });

  if (uploadRetryCount >= CONFIG.uploadMaxRetries) {
    remoteSyncState = "error";
    remoteSyncError = remoteSyncError || "Automatic upload retry limit reached. Use Retry sync.";
  } else {
    remoteSyncState = "pending";
    remoteSyncError = null;
  }
  scheduleUpload();
}

async function pruneUploadedListings(listingIds) {
  const uploadedAt = Date.now();
  for (const listingId of listingIds) {
    resultByListingId.delete(listingId);
    const entry = ledgerByListingId.get(listingId);
    if (entry) {
      ledgerByListingId.set(listingId, {
        listingId,
        status: entry.status,
        workState: "processed",
        reason: entry.reason || null,
        code: entry.code || null,
        source: entry.source || "dashboard-upload",
        discoveredAt: entry.discoveredAt || null,
        processedAt: entry.processedAt || uploadedAt,
        uploadedAt
      });
    }
  }

  // Remove only obsolete extension-owned full-result caches. Settings,
  // credentials, and pending failures are deliberately outside this list.
  if (listingIds.length) {
    await chrome.storage.local.remove(listingIds.map(id => `listing:${id}`)).catch(error => {
      console.warn("Marketplace Vehicle Scanner could not remove a legacy completed cache entry:", {
        quotaRelated: ScannerStorage.isQuotaError(error)
      });
    });
  }
}

function scheduleUpload(delay = CONFIG.uploadDelayMs, retry = false) {
  if (!retry && delay > 0 && uploadRetryCount >= CONFIG.uploadMaxRetries) return;
  clearTimeout(uploadTimer);

  uploadTimer = setTimeout(() => {
    flushPendingUploads().catch(error => {
      console.warn("Marketplace Vehicle Scanner upload failed:", error);
    });
  }, delay);
}

function reserveUploadRetry() {
  if (uploadRetryCount >= CONFIG.uploadMaxRetries) return false;
  uploadRetryCount += 1;
  performanceDiagnostics.increment("retries");
  return true;
}

async function flushPendingUploads(force = false, allowRecreate = true) {
  if (uploadInFlight || !remoteRun?.scanId) return false;
  if (!pendingUploadsByListingId.size) {
    remoteSyncState = remoteCompleted ? "synced" : "idle";
    updateProgress();
    return true;
  }

  uploadInFlight = true;
  remoteSyncState = "syncing";
  remoteSyncError = null;
  updateProgress();

  try {
    do {
      const batchEntries = [...pendingUploadsByListingId.entries()]
        .slice(0, CONFIG.uploadBatchSize);

      if (!batchEntries.length) break;

      const uploadStartedAt = Date.now();
      lastUploadAttemptAt = uploadStartedAt;
      for (const [listingId] of batchEntries) {
        recordDiagnosticStage(listingId, "upload_attempted", {
          uploadAttempted: true,
          uploadCompleted: false
        });
      }
      try {
        await sendBackground({
          type: "REMOTE_UPLOAD_LISTINGS",
          scanId: remoteRun.scanId,
          listings: batchEntries.map(([, listing]) => listing),
          progress: getProgressPayload()
        });
        performanceDiagnostics.recordUpload(
          uploadStartedAt,
          Date.now(),
          batchEntries.length,
          true
        );
        for (const [listingId] of batchEntries) {
          recordDiagnosticStage(listingId, "upload_completed", {
            uploadAttempted: true,
            uploadCompleted: true,
            durationMs: Date.now() - uploadStartedAt,
            outcome: "accepted"
          });
        }
        uploadRetryCount = 0;
      } catch (error) {
        performanceDiagnostics.recordUpload(
          uploadStartedAt,
          Date.now(),
          batchEntries.length,
          false
        );
        if (/timed out/i.test(error instanceof Error ? error.message : String(error))) {
          performanceDiagnostics.increment("timeouts");
        }
        for (const [listingId] of batchEntries) {
          recordDiagnosticStage(listingId, "upload_failed", {
            uploadAttempted: true,
            uploadCompleted: false,
            durationMs: Date.now() - uploadStartedAt,
            outcome: "failed",
            ...diagnosticError(error)
          });
        }
        throw error;
      }

      const uploadedListingIds = [];
      for (const [listingId] of batchEntries) {
        pendingUploadsByListingId.delete(listingId);
        uploadedListingIds.push(listingId);
      }

      await pruneUploadedListings(uploadedListingIds);

      schedulePersist();

      if (!force) break;
    } while (pendingUploadsByListingId.size);

    remoteSyncState = pendingUploadsByListingId.size ? "pending" : "synced";
    remoteSyncError = null;
    updateProgress();
    return pendingUploadsByListingId.size === 0;
  } catch (error) {
    if (
      !force &&
      allowRecreate &&
      isMissingRemoteScanError(error) &&
      reserveUploadRetry()
    ) {
      try {
        await recreateMissingRemoteScan();
        scheduleUpload(0);
        return false;
      } catch (recoveryError) {
        error = recoveryError;
      }
    }

    remoteSyncState = "error";
    remoteSyncError = error instanceof Error ? error.message : String(error);
    updateProgress();
    schedulePersist();

    if (force) {
      throw error;
    }

    if (!scanFinalised && reserveUploadRetry()) {
      scheduleUpload(
        Math.min(CONFIG.uploadRetryMs * (2 ** (uploadRetryCount - 1)), 20000),
        true
      );
    }
    return false;
  } finally {
    uploadInFlight = false;

    if (scanFinalised && !remoteCompleted && remoteSyncState !== "error") {
      setTimeout(() => {
        finaliseRemoteIfReady({ allowRecreate }).catch(error => {
          console.warn("Marketplace Vehicle Scanner completion retry failed:", error);
        });
      }, 0);
    }
  }
}

function scheduleRemoteProgressSync() {
  if (!remoteRun?.scanId || remoteCompleted) return;

  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => {
    syncRemoteProgress().catch(error => {
      console.warn("Marketplace Vehicle Scanner progress sync failed:", error);
    });
  }, CONFIG.progressSyncDelayMs);
}

async function syncRemoteProgress() {
  if (progressSyncInFlight || !remoteRun?.scanId || remoteCompleted) return;

  progressSyncInFlight = true;

  try {
    await sendBackground({
      type: "REMOTE_UPDATE_PROGRESS",
      scanId: remoteRun.scanId,
      progress: getProgressPayload()
    });

    if (!pendingUploadsByListingId.size) {
      remoteSyncState = "synced";
      remoteSyncError = null;
    }
  } catch (error) {
    if (isMissingRemoteScanError(error) && reserveUploadRetry()) {
      try {
        await recreateMissingRemoteScan();
        scheduleUpload(0);
      } catch (recoveryError) {
        remoteSyncState = "error";
        remoteSyncError = recoveryError instanceof Error
          ? recoveryError.message
          : String(recoveryError);
      }
    } else {
      remoteSyncState = "error";
      remoteSyncError = error instanceof Error ? error.message : String(error);
    }
  } finally {
    progressSyncInFlight = false;
    updateProgress();
  }
}

function isRetryableInspectionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|abort|failed to fetch|network|service worker did not respond|Facebook returned HTTP (?:408|425|429|500|502|503|504)\b/i.test(message);
}

function createProcessingQueue() {
  return ScannerRuntime.createBoundedQueue({
    concurrency: CONFIG.listingProcessingConcurrency,
    maxRetries: CONFIG.detailMaxRetries,
    retryDelayMs: attempt => CONFIG.detailRetryDelayMs * Math.max(1, attempt),
    getId: item => item.entry.listing.id,
    shouldRetry: isRetryableInspectionError,
    worker: item => processListing(item.entry, item.generation),
    onState(item, state, details) {
      const { listing, metadata } = item.entry;
      if (item.generation !== scanGeneration || !scanIsRunning()) return;

      if (state === "unseen") {
        queuedListingIds.delete(listing.id);
        upsertLedgerEntry(listing.id, { status: "discovered", workState: "unseen" });
      } else if (state === "queued") {
        queuedListingIds.add(listing.id);
        upsertLedgerEntry(listing.id, {
          status: "queued",
          workState: "queued",
          url: listing.url,
          metadata,
          source: details.retry ? "scan-retry-queue" : "scan-queue"
        });
        performanceDiagnostics.recordListing(listing.id, "queued");
        recordDiagnosticStage(listing.id, "queued_for_detail", {
          outcome: details.retry ? "retry" : "queued"
        });
        if (details.retry) performanceDiagnostics.increment("retries");
      } else if (state === "processing") {
        upsertLedgerEntry(listing.id, {
          status: "scanning",
          workState: "processing",
          metadata,
          source: "listing-request",
          detailInspectionAttempted: true
        });
        performanceDiagnostics.recordListing(listing.id, "processingStart");
        recordDiagnosticStage(listing.id, "detail_inspection_started");
      } else if (state === "failed_retryable") {
        upsertLedgerEntry(listing.id, {
          status: "queued",
          workState: "failed_retryable",
          reason: details.error instanceof Error ? details.error.message : String(details.error),
          source: "listing-retry"
        });
      } else if (state === "failed_final") {
        queuedListingIds.delete(listing.id);
        const message = details.error instanceof Error ? details.error.message : String(details.error);
        recordFilterDiagnostic(listing.id, {
          detailExtractionAttempted: true,
          detailExtractionOutcome: "failed",
          finalDecision: "unavailable",
          finalReasons: [truncate(message, 120)]
        }, true);
        recordDiagnosticStage(listing.id, "detail_inspection_failed", {
          ...diagnosticError(details.error),
          outcome: "failed"
        });
        if (/timed out|abort/i.test(message)) performanceDiagnostics.increment("timeouts");
        markFinal(listing.id, "unavailable", {
          reason: message,
          code: "unavailable",
          source: "request-failed",
          metadata,
          result: null,
          workState: "failed_final",
          detailInspectionAttempted: true,
          finalizationStage: "detail_unavailable",
          finalizationReasonCodes: ["detail_inspection_failed"]
        });
        scheduleScan(0);
      } else if (state === "processed") {
        queuedListingIds.delete(listing.id);
        const entry = getLedgerEntry(listing.id);
        if (entry && isFinalStatus(entry.status)) {
          upsertLedgerEntry(listing.id, { workState: "processed" });
        }
        scheduleScan(0);
      }

      updateProgress();
      schedulePersist();
    }
  });
}

function ensureProcessingQueue() {
  if (!processingQueue || processingQueue.snapshot().stopped) {
    processingQueue = createProcessingQueue();
  }
  return processingQueue;
}

async function processListing(entry, generation) {
  const { listing, metadata, priority } = entry;

  if (!scanIsRunning() || generation !== scanGeneration) return;

  performanceDiagnostics.recordListing(listing.id, "detailFetchStart");
  recordFilterDiagnostic(listing.id, { detailExtractionAttempted: true, detailExtractionOutcome: "started" });
  recordDiagnosticStage(listing.id, "static_extraction_started", {
    staticAttempted: true
  });
  let result;
  try {
    result = normaliseFreshFacebookUkMileage(
      await inspectListing(listing.url, priority)
    );
  } finally {
    performanceDiagnostics.recordListing(listing.id, "detailFetchEnd");
  }

  if (!scanIsRunning() || generation !== scanGeneration) return;

  maybeLogImageExtractionDiagnostics(listing.id, result, metadata);
  recordFilterDiagnostic(listing.id, { detailExtractionOutcome: "completed" });
  const inspection = result?.inspectionDiagnostics || {};
  recordDiagnosticStage(listing.id, "static_extraction_completed", {
    staticAttempted: inspection.staticAttempted === true,
    staticCompleted: inspection.staticCompleted === true,
    durationMs: inspection.staticDurationMs,
    outcome: inspection.staticOutcome || "completed"
  });
  recordDiagnosticStage(listing.id, "rendered_extraction_completed", {
    renderedAttempted: inspection.renderedAttempted === true,
    renderedCompleted: inspection.renderedCompleted === true,
    durationMs: inspection.renderedDurationMs,
    outcome: inspection.renderedOutcome || "not_reported",
    errorClass: inspection.renderedErrorClass,
    errorMessage: inspection.renderedErrorMessage
  });

  upsertLedgerEntry(listing.id, {
    detailInspectionAttempted: true,
    staticInspectionCompleted: inspection.staticCompleted === true,
    renderedInspectionCompleted: inspection.renderedCompleted === true
  });

  await saveCachedResult(listing.id, result);
  classifyListing(listing.id, metadata, result, "facebook-listing-page");
}

async function scanPage() {
  if (!settings.enabled || !scanIsRunning() || finalising || scanFinalised) return;
  if (!isMarketplaceSearchRoute()) return;

  if (sourceSearchRouteKey && getRouteKey() !== sourceSearchRouteKey) {
    await finaliseScan("stopped", "extension_closed");
    return;
  }

  if (evaluateAndFinaliseIfNeeded()) return;

  const entries = collectScannableEntries();
  if (!entries.length) return;

  const cacheIds = entries
    .map(entry => entry.listing.id)
    .filter(id => !resultByListingId.has(id));
  const cachedResults = await loadCachedResults(cacheIds);

  for (const entry of entries) {
    if (!scanIsRunning() || scanFinalised || finalising) break;
    if (evaluateAndFinaliseIfNeeded()) break;

    const counts = countStates();
    const workCommitted = counts.processed + counts.activeWork;

    if (workCommitted >= settings.maximumProcessed) {
      break;
    }

    if (counts.activeWork >= CONFIG.maxQueuedInspections) {
      break;
    }

    const { listing, metadata } = entry;
    const existing = getLedgerEntry(listing.id);

    if (existing && isFinalStatus(existing.status)) continue;
    if (queuedListingIds.has(listing.id) || existing?.status === "scanning") continue;

    const cachedResult =
      resultByListingId.get(listing.id) ||
      cachedResults.get(listing.id) ||
      null;

    if (cachedResult) {
      classifyListing(listing.id, metadata, cachedResult, "cached-listing-result");
      continue;
    }

    const localResult = enrichVehicleIdentity(
      metadata,
      combineCategoryResult(metadata, null),
      false
    );
    const localEvaluation = evaluateFilters(metadata, localResult, { phase: "prefilter" });
    recordDiagnosticStage(listing.id, "card_facts_normalized", {
      knownFields: knownCanonicalFields(localEvaluation.facts)
    });
    recordDiagnosticStage(listing.id, "prefilter_evaluated", {
      decision: localEvaluation.decision,
      detailRequired: localEvaluation.detailRequired === true,
      provenReject: localEvaluation.provenReject === true,
      reasonCodes: diagnosticReasonCodesForEvaluation(localEvaluation)
    });
    recordFilterDiagnostic(listing.id, {
      prefilterDecision: localEvaluation.decision,
      prefilterRejectionReasons: diagnosticReasons(localEvaluation.rejectionReasons),
      prefilterUnresolvedReasons: diagnosticReasons(localEvaluation.unresolvedReasons),
      detailRequired: localEvaluation.detailRequired,
      provenReject: localEvaluation.provenReject,
      detailExtractionAttempted: false,
      canonicalKnownFields: knownCanonicalFields(localEvaluation.facts)
    });
    performanceDiagnostics.recordListing(listing.id, "cheapFilterComplete");

    const cardFinalization = ScannerDecisionPolicy.cardFinalizationDecision(localEvaluation);
    if (cardFinalization.mayFinalize) {
      recordFilterDiagnostic(listing.id, {
        finalDecision: "reject",
        finalReasons: diagnosticReasons(localEvaluation.rejectionReasons)
      }, true);
      markFinal(listing.id, "rejected", {
        reason: localEvaluation.reason,
        code: localEvaluation.code,
        source: "search-card",
        finalizationStage: "card",
        finalizationReasonCodes: cardFinalization.reasonCodes,
        metadata,
        result: {
          ...localResult,
          canonicalFacts: localEvaluation.facts,
          filterEvaluation: localEvaluation
        }
      });
      continue;
    }

    ensureProcessingQueue().enqueue({
      entry,
      generation: scanGeneration
    });
  }

  updateProgress();
  schedulePersist();
}

function scheduleScan(delay = CONFIG.scanDebounceMs) {
  if (!scanIsRunning()) return;
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanPage().catch(error => {
      console.error("Marketplace Vehicle Scanner scan pass failed:", error);
    });
  }, delay);
}

function isScrollableElement(element) {
  if (!element || element === document.body) return false;
  const style = getComputedStyle(element);
  const overflowY = style.overflowY;
  return (
    ["auto", "scroll", "overlay"].includes(overflowY) &&
    element.scrollHeight > element.clientHeight + 120
  );
}

function findResultsScrollContainer() {
  const visibleCards = [...cardByListingId.values()]
    .filter(card => card?.isConnected)
    .slice(0, 12);

  const documentTarget = document.scrollingElement || document.documentElement;
  const candidateStats = new Map();
  const addCandidate = (element, depth) => {
    if (!element) return;
    const current = candidateStats.get(element) || {
      target: element,
      cardCount: 0,
      totalDepth: 0,
      range: Math.max(0, getScrollMetrics(element).max),
      connected: element === documentTarget || element.isConnected !== false
    };
    current.cardCount += 1;
    current.totalDepth += depth;
    candidateStats.set(element, current);
  };

  for (let index = 0; index < visibleCards.length; index += 1) {
    addCandidate(documentTarget, 50);
  }

  for (const card of visibleCards) {
    let node = card.parentElement;

    for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
      if (isScrollableElement(node)) addCandidate(node, depth + 1);
    }
  }

  const selected = ScannerRuntime.chooseScrollCandidate([...candidateStats.values()]);
  return selected?.target || documentTarget;
}

function getScrollMetrics(container) {
  if (
    container === document.scrollingElement ||
    container === document.documentElement ||
    container === document.body
  ) {
    const root = document.scrollingElement || document.documentElement;
    const top = window.scrollY || root.scrollTop || 0;
    const client = window.innerHeight || root.clientHeight || 0;
    const height = Math.max(
      root.scrollHeight,
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0
    );

    return { top, client, height, max: Math.max(0, height - client) };
  }

  return {
    top: container.scrollTop,
    client: container.clientHeight,
    height: container.scrollHeight,
    max: Math.max(0, container.scrollHeight - container.clientHeight)
  };
}

function setScrollTop(container, value) {
  if (
    container === document.scrollingElement ||
    container === document.documentElement ||
    container === document.body
  ) {
    window.scrollTo({ top: value, behavior: "auto" });
    return;
  }

  container.scrollTo({ top: value, behavior: "auto" });
}

function describeScrollTarget(container) {
  if (
    container === document.scrollingElement ||
    container === document.documentElement ||
    container === document.body
  ) {
    return "window";
  }
  const tag = String(container?.tagName || "element").toLowerCase();
  const role = container?.getAttribute?.("role");
  return role ? `${tag}[role=${String(role).slice(0, 40)}]` : tag;
}

function waitForListingGrowth(
  previousCount,
  container,
  previousHeight,
  previousMutationVersion,
  timeoutMs = CONFIG.growthTimeoutMs
) {
  return new Promise(resolve => {
    const startedAt = Date.now();

    const check = () => {
      collectCards();
      const currentCount = ledgerByListingId.size;
      const targetReplaced =
        container !== document.scrollingElement &&
        container !== document.documentElement &&
        container !== document.body &&
        container?.isConnected === false;
      const currentHeight = targetReplaced
        ? 0
        : getScrollMetrics(container).height;
      const grew = currentCount > previousCount || currentHeight > previousHeight;
      const mutated = domMutationVersion > previousMutationVersion;

      if (grew || mutated || targetReplaced) {
        resolve({ grew, mutated, targetReplaced, count: currentCount, height: currentHeight });
        return;
      }

      if (!scanIsRunning() || Date.now() - startedAt >= timeoutMs) {
        resolve({
          grew: false,
          mutated: false,
          targetReplaced: false,
          count: currentCount,
          height: currentHeight
        });
        return;
      }

      waitForScanDelay(120).then(check);
    };

    check();
  });
}

function waitForAnimationFrame(timeoutMs = 120) {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    requestAnimationFrame(finish);
  });
}

async function autoLoadListings() {
  if (!settings.autoLoadEnabled || autoLoadingActive || !scanIsRunning()) return;

  autoLoadingActive = true;
  autoLoadStopRequested = false;
  scrollState = "discovering";
  recordLifecycleDiagnostic("auto_scroll_started");
  let endState = { stalls: 0, endConfirmations: 0, complete: false };
  updateProgress();

  while (
    scanIsRunning() &&
    !scanFinalised &&
    !finalising &&
    !autoLoadStopRequested
  ) {
    if (isListingRoute()) {
      await waitForScanDelay(500);
      continue;
    }

    if (evaluateAndFinaliseIfNeeded()) break;

    scrollState = "discovering";
    await scanPage();

    if (!scanIsRunning() || evaluateAndFinaliseIfNeeded()) break;

    const container = findResultsScrollContainer();
    const before = getScrollMetrics(container);
    const discoveredBeforeScroll = ledgerByListingId.size;
    const step = Math.max(450, Math.round(before.client * CONFIG.autoLoadStepRatio));
    let nextTop = Math.min(before.max, before.top + step);
    let nudgedAtBottom = false;
    const mutationVersionBeforeScroll = domMutationVersion;
    const scrollAttemptedAt = Date.now();
    scrollState = "scrolling";

    if (before.max - before.top < 50) {
      nudgedAtBottom = true;
      setScrollTop(
        container,
        Math.max(0, before.top - Math.round(before.client * 0.18))
      );
      await waitForScanDelay(220);
      nextTop = getScrollMetrics(container).max;
    }

    setScrollTop(container, nextTop);
    await waitForAnimationFrame();

    scrollState = "waiting_for_growth";
    const growth = await waitForListingGrowth(
      discoveredBeforeScroll,
      container,
      before.height,
      mutationVersionBeforeScroll,
      Math.max(CONFIG.growthTimeoutMs, CONFIG.autoLoadPauseMs * 3)
    );
    await scanPage();

    const after = getScrollMetrics(container);
    const atBottom = after.max - after.top < 70;
    const moved = nudgedAtBottom || Math.abs(after.top - before.top) > 2;
    const newCards = Math.max(0, growth.count - discoveredBeforeScroll);
    performanceDiagnostics.recordScroll({
      at: scrollAttemptedAt,
      target: describeScrollTarget(container),
      beforeTop: before.top,
      afterTop: after.top,
      beforeHeight: before.height,
      afterHeight: after.height,
      newCards
    });

    endState = ScannerRuntime.nextEndDetectionState(endState, {
      grew: growth.grew,
      targetReplaced: growth.targetReplaced,
      moved,
      atBottom
    }, {
      maxStalls: CONFIG.autoLoadMaxStalls,
      endConfirmations: CONFIG.autoLoadEndConfirmations
    });

    if (endState.complete) {
      const counts = countStates();
      if (counts.pending === 0) {
        await finaliseScan("completed", "no_more_results");
        break;
      }
      scrollState = "processing";
    }

    updateProgress();
    schedulePersist();
    await waitForScanDelay(CONFIG.autoLoadPauseMs);
  }

  autoLoadingActive = false;
  if (scrollState !== "paused" && scrollState !== "complete" && scrollState !== "error") {
    scrollState = "idle";
  }
  recordLifecycleDiagnostic("auto_scroll_stopped");
  updateProgress();
}

function cancelOutstandingLedgerWork() {
  for (const [listingId, entry] of ledgerByListingId.entries()) {
    if (["queued", "scanning"].includes(entry.status)) {
      upsertLedgerEntry(listingId, {
        status: "discovered",
        workState: "unseen",
        source: "scan-stopped",
        processedAt: null
      });
    }
  }

  queuedListingIds = new Set();
}

function connectDiscoveryObserver() {
  if (observerConnected || !scanIsRunning()) return;
  observer.observe(document.documentElement, { childList: true, subtree: true });
  observerConnected = true;
  recordLifecycleDiagnostic("observer_connected");
}

function disconnectDiscoveryObserver() {
  if (!observerConnected) return;
  observer.disconnect();
  observerConnected = false;
  recordLifecycleDiagnostic("observer_disconnected");
}

function stopScanningActivity(reason) {
  const autoScrollWasActive = autoLoadingActive;
  scanningActive = false;
  autoLoadingActive = false;
  autoLoadStopRequested = true;
  scrollState = reason === "user_paused" ? "paused" : reason === "error" ? "error" : "idle";
  scanGeneration += 1;
  clearTimeout(scanTimer);
  clearTimeout(observerTimer);
  clearTimeout(scrollTimer);
  clearTimeout(progressTimer);
  scanTimer = null;
  observerTimer = null;
  scrollTimer = null;
  progressTimer = null;
  clearDeadlineTimer();
  clearElapsedTimer();
  cancelScanDelays();
  disconnectDiscoveryObserver();
  processingQueue?.stop();
  cancelOutstandingLedgerWork();
  cardByListingId = new Map();
  if (runToken) {
    sendBackground({ type: "CANCEL_SCAN_INSPECTIONS", runToken }).catch(() => {});
  }
  if (autoScrollWasActive) recordLifecycleDiagnostic("auto_scroll_stopped", { reason });
  recordLifecycleDiagnostic("scanning_activity_stopped", { reason });
}

function clearDeadlineTimer() {
  clearTimeout(deadlineTimer);
  deadlineTimer = null;
}

function clearElapsedTimer() {
  clearInterval(elapsedTimer);
  elapsedTimer = null;
}

function armElapsedTimer() {
  clearElapsedTimer();
  elapsedTimer = setInterval(() => {
    if (scanIsRunning()) {
      updateProgress();
    }
  }, 1000);
}

function armDeadlineTimer() {
  clearDeadlineTimer();

  if (!scanDeadlineAt) return;

  deadlineTimer = setTimeout(() => {
    if (scanIsRunning() && !scanFinalised) {
      finaliseScan("timed_out", "duration_limit_reached").catch(error => {
        console.error("Marketplace Vehicle Scanner timeout finalisation failed:", error);
      });
    }
  }, Math.max(0, scanDeadlineAt - Date.now()));
}

async function finaliseRemoteIfReady(options = {}) {
  if (
    !remoteRun?.scanId ||
    remoteCompleted ||
    completionInFlight ||
    !scanFinalised
  ) {
    return false;
  }

  const uploaded = await flushPendingUploads(true, options.allowRecreate !== false);

  if (!uploaded || pendingUploadsByListingId.size) {
    remoteSyncState = "error";
    remoteSyncError = remoteSyncError || "Completed results are waiting to upload.";
    updateProgress();
    return false;
  }

  completionInFlight = true;
  remoteSyncState = "syncing";
  updateProgress();

  try {
    await sendBackground({
      type: "REMOTE_COMPLETE_SCAN",
      scanId: remoteRun.scanId,
      payload: {
        status: scanStatus,
        stopReason,
        completedAt: new Date(scanCompletedAt || Date.now()).toISOString(),
        progress: getProgressPayload()
      }
    });

    remoteCompleted = true;
    remoteSyncState = "synced";
    remoteSyncError = null;
    schedulePersist(0);
    clearTimeout(uploadTimer);
    clearTimeout(progressTimer);
    uploadTimer = null;
    progressTimer = null;
    updateProgress();

    if (
      settings.autoOpenResults &&
      remoteRun.resultsUrl &&
      resultsOpenedForScanId !== remoteRun.scanId
    ) {
      await openResults();
      resultsOpenedForScanId = remoteRun.scanId;
      schedulePersist();
    }

    return true;
  } catch (error) {
    if (options.allowRecreate !== false && isMissingRemoteScanError(error)) {
      try {
        await recreateMissingRemoteScan();
        scheduleUpload(0);
        return false;
      } catch (recoveryError) {
        error = recoveryError;
      }
    }

    remoteSyncState = "error";
    remoteSyncError = error instanceof Error ? error.message : String(error);
    updateProgress();
    return false;
  } finally {
    completionInFlight = false;
  }
}

async function finaliseScan(status, reason) {
  if (finalising || scanFinalised) {
    return finaliseRemoteIfReady();
  }

  finalising = true;
  lifecycleState = ScannerLifecycle.transition(lifecycleState, "STOP");
  recordLifecycleDiagnostic("completion_started", { status, reason });
  stopScanningActivity(reason);

  scanStatus = status;
  stopReason = reason;
  scanCompletedAt = Date.now();
  scanFinalised = true;
  scrollState = status === "failed" ? "error" : "complete";
  lifecycleState = status === "failed"
    ? ScannerLifecycle.transition(lifecycleState, "FAIL")
    : status === "stopped"
      ? ScannerLifecycle.transition(lifecycleState, "STOPPED")
      : ScannerLifecycle.transition(lifecycleState, "COMPLETE");
  historicalScanStatus = status;
  finalising = false;
  clearTimeout(uploadTimer);
  uploadTimer = null;
  recordLifecycleDiagnostic("completion_terminal", { status, reason });

  updateProgress();
  schedulePersist(0);
  await finaliseRemoteIfReady();
  return true;
}

function isMissingRemoteScanError(error) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  return /scan run was not found/i.test(message);
}

async function recreateMissingRemoteScan() {
  const hasPrunedUploads = [...ledgerByListingId.entries()].some(([listingId, entry]) =>
    isFinalStatus(entry.status) &&
    entry.uploadedAt &&
    !pendingUploadsByListingId.has(listingId)
  );
  if (hasPrunedUploads) {
    throw new Error(
      "The hosted scan is missing after confirmed uploads were pruned locally. Start a new scan to avoid incomplete results."
    );
  }

  remoteSyncState = "syncing";
  remoteSyncError = null;
  updateProgress();

  const replacementRun = await sendBackground({
    type: "REMOTE_CREATE_SCAN",
    payload: buildScanCreatePayload()
  });

  remoteRun = replacementRun;
  remoteCompleted = false;
  resultsOpenedForScanId = null;

  remoteSyncState = pendingUploadsByListingId.size
    ? "pending"
    : "synced";

  schedulePersist(0);
  updateProgress();

  return replacementRun;
}

async function retryRemoteSync(options = {}) {
  if (!remoteRun?.scanId) {
    throw new Error("There is no hosted scan to synchronise.");
  }

  const previousLifecycleState = lifecycleState;
  lifecycleState = ScannerLifecycle.transition(lifecycleState, "SYNC");
  remoteSyncError = null;
  remoteSyncState = "syncing";
  uploadRetryCount = 0;
  lastUploadAttemptAt = null;

  updateProgress();
  schedulePersist(0);

  try {
    try {
      await flushPendingUploads(true, options.allowRecreate !== false);
    } catch (error) {
      if (!isMissingRemoteScanError(error) || options.allowRecreate === false) throw error;
      await recreateMissingRemoteScan();
      await flushPendingUploads(true);
    }

    if (scanFinalised) {
      await finaliseRemoteIfReady({ allowRecreate: options.allowRecreate !== false });
    } else {
      await syncRemoteProgress();
    }
    recordLifecycleDiagnostic("remote_sync_finished", { explicit: options.explicit === true });
  } finally {
    if (lifecycleState === "syncing") lifecycleState = previousLifecycleState;
    updateProgress();
  }
  return getRuntimeProgress();
}

async function openResults() {
  if (!remoteRun?.resultsUrl) {
    throw new Error("The dashboard did not provide a results URL.");
  }

  return sendBackground({
    type: "OPEN_EXTERNAL_URL",
    url: remoteRun.resultsUrl
  });
}

function buildScanCreatePayload() {
  return {
    name: deriveScanName(),
    source: "facebook_marketplace",
    sourceSearchUrl: sourceSearchRouteKey
      ? new URL(sourceSearchRouteKey, location.origin).toString()
      : null,
    targetMatches: settings.targetMatches,
    maximumProcessed: settings.maximumProcessed,
    maximumDurationSeconds: settings.maximumDurationSeconds,
    filters: settings.activeFilterConfig,
    extensionVersion: EXTENSION_VERSION
  };
}

function resetRunMemory() {
  stopScanningActivity("reset");
  clearTimeout(scanTimer);
  clearTimeout(uploadTimer);
  clearTimeout(progressTimer);
  clearDeadlineTimer();
  clearElapsedTimer();

  scanGeneration += 1;
  scanningActive = false;
  autoLoadingActive = false;
  autoLoadStopRequested = true;
  scrollState = "idle";
  finalising = false;
  scanFinalised = false;
  scanStartedAt = null;
  scanCompletedAt = null;
  scanDeadlineAt = null;
  scanStatus = "idle";
  lifecycleState = "idle";
  historicalScanStatus = null;
  stopReason = null;
  runToken = null;
  remoteRun = null;
  remoteCompleted = false;
  remoteSyncState = "idle";
  remoteSyncError = null;
  resultsOpenedForScanId = null;
  sourceSearchRouteKey = null;
  ledgerByListingId = new Map();
  resultByListingId = new Map();
  cardByListingId = new Map();
  queuedListingIds = new Set();
  pendingUploadsByListingId = new Map();
  uploadInFlight = false;
  uploadRetryCount = 0;
  lastUploadAttemptAt = null;
  progressSyncInFlight = false;
  completionInFlight = false;
  imageDiagnosticsLogged = new Set();
  filterDiagnosticsByListingId = new Map();
  diagnosticTimelineByListingId = new Map();
  usingPersistedSettingsSnapshot = false;
  processingQueue = createProcessingQueue();
  resetPerformanceDiagnostics();
}

function activateRunningScan(resumed = false) {
  lifecycleState = ScannerLifecycle.transition(lifecycleState, resumed ? "RESUME" : "START");
  scanStatus = "running";
  historicalScanStatus = null;
  scanningActive = true;
  scanFinalised = false;
  autoLoadStopRequested = false;
  scrollState = "discovering";
  scanGeneration += 1;
  ensureProcessingQueue();
  connectDiscoveryObserver();
  armDeadlineTimer();
  armElapsedTimer();
  ensurePanel();
  collectCards();
  updateProgress();
  schedulePersist(0);
  scheduleScan(0);
  recordLifecycleDiagnostic(resumed ? "explicit_resume" : "explicit_start");

  if (settings.autoLoadEnabled) {
    autoLoadListings().catch(error => {
      console.error("Marketplace Vehicle Scanner auto-load failed:", error);
      finaliseScan("failed", "error").catch(() => {});
    });
  }
}

async function startNewScan() {
  if (!isMarketplaceSearchRoute()) {
    throw new Error("Open a Facebook Marketplace search results page first.");
  }

  if (lifecycleState === "interrupted") {
    throw new Error("Resume or discard the interrupted scan before starting a new scan.");
  }
  if (lifecycleState === "paused") {
    throw new Error("Resume or stop the paused scan before starting a new scan.");
  }

  if (remoteRun?.scanId && !remoteCompleted) {
    if (scanningActive && !scanFinalised) {
      await finaliseScan("stopped", "user_stopped");
    }

    await retryRemoteSync();

    if (!remoteCompleted) {
      throw new Error(
        "The previous scan has not fully synchronised. Retry sync before starting another scan."
      );
    }
  }

  await loadSettings();
  resetRunMemory();
  cleanupLegacyCardDecorations();

  sourceSearchRouteKey = getRouteKey();
  currentRouteKey = sourceSearchRouteKey;
  scanStartedAt = Date.now();
  scanDeadlineAt = scanStartedAt + settings.maximumDurationSeconds * 1000;
  scanStatus = "creating";
  lifecycleState = "idle";
  runToken = crypto.randomUUID();
  remoteSyncState = "syncing";
  updateProgress();

  try {
    remoteRun = await sendBackground({
      type: "REMOTE_CREATE_SCAN",
      payload: buildScanCreatePayload()
    });
  } catch (error) {
    resetRunMemory();
    updateProgress();
    throw error;
  }

  remoteSyncState = "synced";
  activateRunningScan(false);

  return getRuntimeProgress();
}

async function pauseScanByUser() {
  if (!scanIsRunning() || !remoteRun?.scanId) {
    throw new Error("There is no running scan to pause.");
  }
  lifecycleState = ScannerLifecycle.transition(lifecycleState, "PAUSE");
  scanStatus = "paused";
  stopScanningActivity("user_paused");
  recordLifecycleDiagnostic("explicit_pause");
  updateProgress();
  schedulePersist(0);
  return getRuntimeProgress();
}

async function resumeInterruptedScan() {
  if (!["interrupted", "paused"].includes(lifecycleState) || !remoteRun?.scanId) {
    throw new Error("There is no paused or interrupted scan to resume.");
  }
  if (!isMarketplaceSearchRoute() || sourceSearchRouteKey !== getRouteKey()) {
    throw new Error("Open the original Marketplace search page before resuming.");
  }
  runToken = crypto.randomUUID();
  if (!scanDeadlineAt || scanDeadlineAt <= Date.now()) {
    scanDeadlineAt = Date.now() + settings.maximumDurationSeconds * 1000;
  }
  activateRunningScan(true);
  return getRuntimeProgress();
}

async function discardInterruptedScan() {
  if (lifecycleState !== "interrupted") {
    throw new Error("There is no interrupted scan to discard.");
  }
  stopScanningActivity("explicit_discard");
  await chrome.storage.local.remove([CONFIG.activeRunStorageKey, "runtimeProgress"]);
  resetRunMemory();
  recordLifecycleDiagnostic("explicit_discard");
  removePanel();
  updateProgress();
  return getRuntimeProgress();
}

async function stopScanByUser() {
  if (!remoteRun?.scanId) {
    scanningActive = false;
    updateProgress();
    return getRuntimeProgress();
  }

  await finaliseScan("stopped", "user_stopped");
  return getRuntimeProgress();
}

function serialiseMap(map) {
  return Object.fromEntries(map.entries());
}

function getActiveRunSource() {
  return {
    evaluatorLifecycleVersion: ScannerDecisionPolicy.EVALUATOR_LIFECYCLE_VERSION,
    sourceSearchRouteKey,
    settingsSnapshot: settings,
    scanStartedAt,
    scanCompletedAt,
    scanDeadlineAt,
    scanStatus,
    lifecycleState,
    historicalScanStatus,
    stopReason,
    runToken,
    scanningActive,
    scanFinalised,
    remoteRun,
    remoteCompleted,
    remoteSyncState,
    remoteSyncError,
    uploadRetryCount,
    lastUploadAttemptAt,
    resultsOpenedForScanId,
    ledger: serialiseMap(ledgerByListingId),
    pendingUploads: serialiseMap(pendingUploadsByListingId),
    lifecycleDiagnostics,
    filterFingerprint: getFilterFingerprint()
  };
}

function buildPersistedActiveRun() {
  let state = ScannerStorage.buildCompactState(getActiveRunSource(), { ...storageHealth });
  const estimatedBytes = storageFixedBytes + ScannerStorage.approximateStorageItemBytes(
    CONFIG.activeRunStorageKey,
    state
  );
  storageHealth.estimatedBytes = estimatedBytes;
  storageHealth.nearSoftLimit = estimatedBytes >= storageHealth.softLimitBytes * 0.8;
  state.storageHealth = { ...storageHealth };
  return state;
}

async function removeStorageKeysInChunks(keys, chunkSize = 100) {
  for (let index = 0; index < keys.length; index += chunkSize) {
    await chrome.storage.local.remove(keys.slice(index, index + chunkSize));
  }
}

async function pruneObsoleteStorage() {
  const allData = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(allData).filter(key =>
    key.startsWith("listing:") ||
    key.startsWith("searchSession:") ||
    key === "lastActiveSearchRouteKey" ||
    key === "activeSearchSession"
  );
  if (keysToRemove.length) await removeStorageKeysInChunks(keysToRemove);
  storageHealth.pruneCount += keysToRemove.length;
  return keysToRemove.length;
}

function enterPersistenceDegradedMode() {
  storageHealth.persistenceDegraded = true;
  storageHealth.nearSoftLimit = true;
  if (scanIsRunning()) {
    lifecycleState = ScannerLifecycle.transition(lifecycleState, "PAUSE");
    scanStatus = "paused";
    stopReason = "storage_quota";
    stopScanningActivity("storage_quota");
    recordLifecycleDiagnostic("storage_persistence_degraded");
  }
  renderPanel(getRuntimeProgress());
}

function pauseAtStorageSoftLimit() {
  if (!scanIsRunning()) return;
  lifecycleState = ScannerLifecycle.transition(lifecycleState, "PAUSE");
  scanStatus = "paused";
  stopReason = "storage_soft_limit";
  stopScanningActivity("storage_soft_limit");
  recordLifecycleDiagnostic("storage_soft_limit_pause");
  updateProgress();
  schedulePersist(0);
}

function schedulePersist(delay = CONFIG.persistDelayMs) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistActiveRun().catch(error => {
      console.warn("Marketplace Vehicle Scanner persistence failed:", error);
    });
  }, delay);
}

async function persistActiveRun() {
  if (!remoteRun?.scanId) {
    await chrome.storage.local.remove(CONFIG.activeRunStorageKey);
    return;
  }

  const outcome = await ScannerStorage.writeWithQuotaRecovery({
    buildValue: buildPersistedActiveRun,
    write: value => chrome.storage.local.set({ [CONFIG.activeRunStorageKey]: value }),
    prune: pruneObsoleteStorage,
    onQuota: () => {
      storageHealth.lastQuotaFailure = new Date().toISOString();
      storageHealth.nearSoftLimit = true;
      console.warn("Marketplace Vehicle Scanner recovery storage reached its quota; pruning completed data.");
    },
    onDegraded: () => {
      storageHealth.lastQuotaFailure = new Date().toISOString();
      enterPersistenceDegradedMode();
      console.warn("Marketplace Vehicle Scanner paused because compact recovery state could not be saved.");
    }
  });

  if (outcome.ok) {
    storageHealth.persistenceDegraded = false;
    if (storageHealth.estimatedBytes >= storageHealth.softLimitBytes) {
      pauseAtStorageSoftLimit();
    }
  }
  return outcome.ok;
}

async function migrateExistingStorage() {
  const allData = await chrome.storage.local.get(null);
  const before = ScannerStorage.measureStorageData(allData);
  const plan = ScannerStorage.migrationPlan(allData, CONFIG.activeRunStorageKey);

  storageFixedBytes = Object.entries(allData)
    .filter(([key]) => key !== CONFIG.activeRunStorageKey && !key.startsWith("listing:"))
    .reduce((total, [key, value]) =>
      total + ScannerStorage.approximateStorageItemBytes(key, value), 0);
  storageHealth.estimatedBytes = before.totalBytes;
  storageHealth.nearSoftLimit = before.totalBytes >= storageHealth.softLimitBytes * 0.8;

  if (!plan.changed) return { changed: false, before, after: before };

  if (plan.keysToRemove.length) {
    await removeStorageKeysInChunks(plan.keysToRemove);
    storageHealth.pruneCount += plan.keysToRemove.length;
  }
  if (plan.migratedState) {
    plan.migratedState.storageHealth = { ...storageHealth };
    await ScannerStorage.writeWithQuotaRecovery({
      buildValue: () => plan.migratedState,
      write: value => chrome.storage.local.set({ [CONFIG.activeRunStorageKey]: value }),
      prune: pruneObsoleteStorage,
      onQuota: () => {
        storageHealth.lastQuotaFailure = new Date().toISOString();
      },
      onDegraded: () => {
        storageHealth.lastQuotaFailure = new Date().toISOString();
        storageHealth.persistenceDegraded = true;
      }
    });
  }

  const afterData = await chrome.storage.local.get(null);
  const after = ScannerStorage.measureStorageData(afterData);
  storageHealth.estimatedBytes = after.totalBytes;
  storageHealth.nearSoftLimit = after.totalBytes >= storageHealth.softLimitBytes * 0.8;
  console.info("Marketplace Vehicle Scanner storage migration:", {
    schemaVersion: ScannerStorage.SCHEMA_VERSION,
    beforeBytes: before.totalBytes,
    afterBytes: after.totalBytes,
    removedLegacyCaches: plan.removedLegacyCaches,
    removedObsoleteKeys: plan.keysToRemove.length - plan.removedLegacyCaches
  });
  return { changed: true, before, after };
}

async function migrateEvaluatorLifecycleState() {
  const allData = await chrome.storage.local.get(null);
  const plan = ScannerStorage.evaluatorLifecycleMigrationPlan(
    allData,
    CONFIG.activeRunStorageKey,
    CONFIG.evaluatorLifecycleVersionKey,
    ScannerDecisionPolicy.EVALUATOR_LIFECYCLE_VERSION
  );
  if (!plan.changed) return false;

  const keysToRemove = plan.keysToRemove.filter(key =>
    !(plan.recoveryState && key === CONFIG.activeRunStorageKey)
  );
  if (keysToRemove.length) await removeStorageKeysInChunks(keysToRemove);
  const patch = {
    [CONFIG.evaluatorLifecycleVersionKey]: ScannerDecisionPolicy.EVALUATOR_LIFECYCLE_VERSION
  };
  if (plan.recoveryState) patch[CONFIG.activeRunStorageKey] = plan.recoveryState;
  await chrome.storage.local.set(patch);
  recordLifecycleDiagnostic("evaluator_lifecycle_upgraded", {
    pendingUploadsPreserved: Boolean(plan.recoveryState)
  });
  return true;
}

async function restoreActiveRun() {
  const stored = await chrome.storage.local.get(CONFIG.activeRunStorageKey);
  const state = stored[CONFIG.activeRunStorageKey];

  if (
    !state ||
    ![19, ScannerStorage.SCHEMA_VERSION].includes(state.version) ||
    state.evaluatorLifecycleVersion !== ScannerDecisionPolicy.EVALUATOR_LIFECYCLE_VERSION ||
    !state.remoteRun?.scanId
  ) {
    lifecycleState = "idle";
    scanningActive = false;
    recordLifecycleDiagnostic("startup_idle", { persisted: false });
    return false;
  }

  const startup = ScannerLifecycle.classifyPersistedRun(state);
  settings = {
    ...DEFAULT_SETTINGS,
    ...(state.settingsSnapshot || {}),
    acceptedMakes: VehicleIdentity.normaliseMakeFilters(state.settingsSnapshot?.acceptedMakes),
    acceptedModels: VehicleIdentity.normaliseFilterValues(state.settingsSnapshot?.acceptedModels),
    activeFilterConfig: FilterDomain.normaliseFilterConfig(
      state.settingsSnapshot?.activeFilterConfig || state.settingsSnapshot || {}
    )
  };
  usingPersistedSettingsSnapshot = true;
  sourceSearchRouteKey = state.sourceSearchRouteKey || null;
  scanStartedAt = state.scanStartedAt || null;
  scanCompletedAt = state.scanCompletedAt || null;
  scanDeadlineAt = state.scanDeadlineAt || null;
  scanStatus = state.scanStatus || "stopped";
  lifecycleState = startup.lifecycleState;
  historicalScanStatus = startup.historicalStatus;
  stopReason = state.stopReason || null;
  runToken = state.runToken || null;
  scanningActive = false;
  autoLoadingActive = false;
  autoLoadStopRequested = true;
  scrollState = lifecycleState === "paused" ? "paused" : "idle";
  scanFinalised = Boolean(state.scanFinalised);
  remoteRun = state.remoteRun;
  remoteCompleted = Boolean(state.remoteCompleted);
  remoteSyncState = state.remoteSyncState || "idle";
  remoteSyncError = state.remoteSyncError || null;
  uploadRetryCount = Math.max(0, Math.min(CONFIG.uploadMaxRetries, Number(state.uploadRetryCount) || 0));
  lastUploadAttemptAt = Number(state.lastUploadAttemptAt) || null;
  resultsOpenedForScanId = state.resultsOpenedForScanId || null;
  ledgerByListingId = new Map(Object.entries(state.ledger || {}));
  resultByListingId = new Map();
  pendingUploadsByListingId = new Map(Object.entries(
    ScannerStorage.compactPendingUploads(state.pendingUploads)
  ));
  storageHealth = {
    ...(state.storageHealth || {}),
    ...storageHealth,
    softLimitBytes: ScannerStorage.SOFT_LIMIT_BYTES
  };
  lifecycleDiagnostics = Array.isArray(state.lifecycleDiagnostics)
    ? state.lifecycleDiagnostics.slice(-30)
    : [];
  queuedListingIds = new Set();
  cardByListingId = new Map();

  for (const [listingId, entry] of ledgerByListingId.entries()) {
    if (["queued", "scanning"].includes(entry.status)) {
      upsertLedgerEntry(listingId, {
        status: "discovered",
        workState: "unseen",
        source: "restored-after-interruption",
        processedAt: null
      });
    }
  }

  if (lifecycleState === "interrupted") {
    historicalScanStatus = state.scanStatus || "running";
    scanStatus = "interrupted";
  }

  ensurePanel();
  recordLifecycleDiagnostic("startup_restored", {
    persistedStatus: state.scanStatus || "unknown",
    startupState: lifecycleState
  });
  updateProgress();

  if (startup.allowSyncRecovery) {
    retryRemoteSync({ allowRecreate: false }).then(() => {
      lifecycleState = "idle";
      historicalScanStatus = scanStatus;
      recordLifecycleDiagnostic("startup_sync_recovered");
      updateProgress();
      schedulePersist(0);
    }).catch(error => {
      lifecycleState = "idle";
      remoteSyncState = "error";
      remoteSyncError = error instanceof Error ? error.message : String(error);
      recordLifecycleDiagnostic("startup_sync_failed");
      updateProgress();
      schedulePersist(0);
    });
  }

  return true;
}

async function clearLocalScannerState() {
  if (scanningActive && !scanFinalised) {
    await finaliseScan("stopped", "user_stopped");
  }

  if (remoteRun?.scanId && !remoteCompleted) {
    await retryRemoteSync();

    if (!remoteCompleted) {
      throw new Error(
        "Local state cannot be cleared while hosted results are still waiting to synchronise."
      );
    }
  }

  resetRunMemory();
  cleanupLegacyCardDecorations();

  const allData = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(allData).filter(key =>
    key === CONFIG.activeRunStorageKey ||
    key === "runtimeProgress" ||
    key.startsWith("listing:") ||
    key.startsWith("searchSession:") ||
    key === "lastActiveSearchRouteKey" ||
    key === "activeSearchSession"
  );

  if (keysToRemove.length) {
    await chrome.storage.local.remove(keysToRemove);
  }

  removePanel();
  updateProgress();
  return { clearedKeys: keysToRemove.length };
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const activeFilterConfig = FilterDomain.normaliseFilterConfig(stored.activeFilterConfig || stored);

  settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    targetMatches: activeFilterConfig.scan.targetMatches,
    maximumProcessed: activeFilterConfig.scan.maximumProcessed,
    maximumDurationSeconds: clampInteger(
      activeFilterConfig.scan.maximumDurationSeconds,
      30,
      3600,
      300
    ),
    autoLoadEnabled: activeFilterConfig.scan.autoLoadEnabled,
    autoOpenResults: activeFilterConfig.scan.autoOpenResults,
    minYear: activeFilterConfig.vehicle.minYear,
    maxYear: activeFilterConfig.vehicle.maxYear,
    minPrice: activeFilterConfig.priceMileage.minPrice,
    maxPrice: activeFilterConfig.priceMileage.maxPrice,
    maxMileage: activeFilterConfig.priceMileage.maxMileage,
    excludeCategories: [],
    excludedKeywords: activeFilterConfig.text.excludedKeywords,
    acceptedMakes: activeFilterConfig.vehicle.makes,
    acceptedModels: activeFilterConfig.vehicle.models,
    activeSavedSearchId: stored.activeSavedSearchId || null,
    activeFilterConfig,
    scannerPanelMinimised: stored.scannerPanelMinimised === true
  };
  resetPerformanceDiagnostics();
}

function applyPanelMinimisedPreference(panel, minimised) {
  const isMinimised = minimised === true;
  panel.root.classList.toggle("mcf-panel-minimised", isMinimised);
  panel.expanded.setAttribute("aria-hidden", String(isMinimised));
  panel.restoreButton.hidden = !isMinimised;
}

function setPanelMinimised(minimised) {
  const isMinimised = minimised === true;
  settings.scannerPanelMinimised = isMinimised;
  if (panelElements) {
    applyPanelMinimisedPreference(panelElements, isMinimised);
    (isMinimised ? panelElements.restoreButton : panelElements.minimiseButton).focus({ preventScroll: true });
  }
  chrome.storage.local.set({ [CONFIG.panelMinimisedStorageKey]: isMinimised }).catch(error => {
    console.warn("Marketplace Vehicle Scanner panel preference could not be saved:", error);
  });
}

function ensurePanel() {
  let root = document.querySelector("#mcf-scanner-panel");

  if (!root) {
    root = document.createElement("aside");
    root.id = "mcf-scanner-panel";
    root.setAttribute("aria-live", "polite");

    const header = document.createElement("div");
    header.className = "mcf-panel-header";

    const title = document.createElement("strong");
    title.textContent = "Vehicle scanner";

    const status = document.createElement("span");
    status.className = "mcf-panel-status";

    const minimiseButton = document.createElement("button");
    minimiseButton.type = "button";
    minimiseButton.className = "mcf-panel-minimise";
    minimiseButton.textContent = "−";
    minimiseButton.setAttribute("aria-label", "Minimise scanner panel");
    minimiseButton.title = "Minimise scanner panel";
    minimiseButton.addEventListener("click", () => setPanelMinimised(true));

    header.append(title, status, minimiseButton);

    const counters = document.createElement("div");
    counters.className = "mcf-panel-counters";

    const makeCounter = (label, key) => {
      const wrapper = document.createElement("div");
      const value = document.createElement("strong");
      value.dataset.key = key;
      value.textContent = "0";
      const text = document.createElement("span");
      text.textContent = label;
      wrapper.append(value, text);
      return wrapper;
    };

    counters.append(
      makeCounter("Matches", "matched"),
      makeCounter("Processed", "processed"),
      makeCounter("Rejected", "rejected"),
      makeCounter("Unavailable", "unavailable")
    );

    const limitText = document.createElement("div");
    limitText.className = "mcf-panel-limit";

    const progressTrack = document.createElement("div");
    progressTrack.className = "mcf-panel-progress-track";
    const progressBar = document.createElement("div");
    progressBar.className = "mcf-panel-progress-bar";
    progressTrack.appendChild(progressBar);

    const syncText = document.createElement("div");
    syncText.className = "mcf-panel-sync";

    const storageText = document.createElement("div");
    storageText.className = "mcf-panel-storage";
    storageText.hidden = true;

    const actions = document.createElement("div");
    actions.className = "mcf-panel-actions";

    const stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.textContent = "Stop";
    stopButton.addEventListener("click", () => {
      stopScanByUser().catch(error => {
        remoteSyncError = error.message || String(error);
        updateProgress();
      });
    });

    const resultsButton = document.createElement("button");
    resultsButton.type = "button";
    resultsButton.textContent = "Open results";
    resultsButton.addEventListener("click", () => {
      openResults().catch(error => {
        remoteSyncError = error.message || String(error);
        updateProgress();
      });
    });

    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = "Retry sync";
    retryButton.addEventListener("click", () => {
      retryRemoteSync().catch(error => {
        remoteSyncError = error.message || String(error);
        updateProgress();
      });
    });

    actions.append(stopButton, resultsButton, retryButton);

    const expanded = document.createElement("div");
    expanded.className = "mcf-panel-expanded";
    expanded.append(header, counters, limitText, progressTrack, syncText, storageText, actions);

    const restoreButton = document.createElement("button");
    restoreButton.type = "button";
    restoreButton.className = "mcf-panel-restore";
    restoreButton.setAttribute("aria-label", "Restore scanner panel");
    restoreButton.title = "Restore scanner panel";
    const compactMark = document.createElement("span");
    compactMark.className = "mcf-panel-compact-mark";
    compactMark.setAttribute("aria-hidden", "true");
    compactMark.textContent = "K";
    const compactText = document.createElement("span");
    compactText.className = "mcf-panel-compact-text";
    restoreButton.append(compactMark, compactText);
    restoreButton.addEventListener("click", () => setPanelMinimised(false));

    root.append(expanded, restoreButton);
    document.documentElement.appendChild(root);

    panelElements = {
      root,
      expanded,
      status,
      counters: Object.fromEntries(
        [...root.querySelectorAll("[data-key]")]
          .map(element => [element.dataset.key, element])
      ),
      limitText,
      progressBar,
      syncText,
      storageText,
      stopButton,
      resultsButton,
      retryButton,
      minimiseButton,
      restoreButton,
      compactText
    };
    applyPanelMinimisedPreference(panelElements, settings.scannerPanelMinimised);
  }

  return panelElements;
}

function removePanel() {
  document.querySelector("#mcf-scanner-panel")?.remove();
  panelElements = null;
}

function renderPanel(progress) {
  if (!remoteRun?.scanId) {
    if (panelElements) removePanel();
    return;
  }

  const panel = ensurePanel();
  panel.counters.matched.textContent = String(progress.matched);
  panel.counters.processed.textContent = String(progress.processed);
  panel.counters.rejected.textContent = String(progress.rejected);
  panel.counters.unavailable.textContent = String(progress.unavailable);

  const statusLabels = {
    creating: "Connecting…",
    running: "Running",
    completed: "Complete",
    stopped: "Stopped",
    limit_reached: "Limit reached",
    timed_out: "Timed out",
    failed: "Failed",
    idle: "Idle"
  };

  panel.status.textContent = statusLabels[progress.scanStatus] || progress.scanStatus;
  const compactState = progress.remoteSyncError || progress.scanStatus === "failed"
    ? "Error"
    : progress.paused
      ? "Paused"
      : progress.scanningActive || ["creating", "running"].includes(progress.scanStatus)
        ? "Scanning"
        : progress.interrupted
          ? "Interrupted"
          : progress.scanStatus === "completed"
            ? "Complete"
            : "Idle";
  panel.compactText.textContent = `Kelmar · ${compactState}${progress.matched ? ` · ${progress.matched} match${progress.matched === 1 ? "" : "es"}` : ""}`;
  panel.limitText.textContent =
    `${progress.matched}/${progress.targetMatches} matches · ` +
    `${progress.processed}/${progress.maximumProcessed} processed · ` +
    `${Math.floor(progress.elapsedSeconds / 60)}m ${progress.elapsedSeconds % 60}s`;

  const percentage = Math.min(
    100,
    Math.max(0, (progress.processed / Math.max(1, progress.maximumProcessed)) * 100)
  );
  panel.progressBar.style.width = `${percentage}%`;

  panel.syncText.textContent = progress.remoteSyncError
    ? `Sync error: ${progress.remoteSyncError}`
    : progress.pendingUploadCount
      ? `Uploading ${progress.pendingUploadCount} result${progress.pendingUploadCount === 1 ? "" : "s"}…`
      : progress.remoteCompleted
        ? "Dashboard is up to date."
        : "Connected to dashboard.";

  panel.storageText.hidden = !progress.storageHealth?.nearSoftLimit;
  panel.storageText.textContent = progress.storageHealth?.persistenceDegraded
    ? "Scan paused: local resume protection is temporarily unavailable."
    : "Scanner local recovery storage is nearly full. Uploaded results are being cleaned automatically.";

  panel.stopButton.hidden = !progress.scanningActive;
  panel.resultsButton.disabled = !progress.resultsUrl;
  panel.retryButton.hidden = !progress.canRetrySync || progress.remoteSyncState !== "error";
}

function isExtensionMutation(mutation) {
  const belongsToPanel = node =>
    node instanceof Element &&
    (node.id === "mcf-scanner-panel" || Boolean(node.closest?.("#mcf-scanner-panel")));

  if (belongsToPanel(mutation.target)) return true;

  const nodes = [...mutation.addedNodes, ...mutation.removedNodes]
    .filter(node => node.nodeType === Node.ELEMENT_NODE);

  return nodes.length > 0 && nodes.every(belongsToPanel);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = promise => {
    Promise.resolve(promise)
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  };

  if (message?.type === "START_SCAN") {
    return respond(startNewScan());
  }

  if (message?.type === "STOP_SCAN") {
    return respond(stopScanByUser());
  }

  if (message?.type === "PAUSE_SCAN") {
    return respond(pauseScanByUser());
  }

  if (message?.type === "RESUME_SCAN") {
    return respond(resumeInterruptedScan());
  }

  if (message?.type === "DISCARD_INTERRUPTED_SCAN") {
    return respond(discardInterruptedScan());
  }

  if (message?.type === "GET_SCAN_STATE") {
    sendResponse({ ok: true, result: getRuntimeProgress() });
    return false;
  }

  if (message?.type === "GET_SCANNER_VERSION") {
    sendResponse({
      ok: true,
      result: {
        extensionVersion: EXTENSION_VERSION,
        evaluatorLifecycleVersion: ScannerDecisionPolicy.EVALUATOR_LIFECYCLE_VERSION
      }
    });
    return false;
  }

  if (message?.type === "GET_SCANNER_DIAGNOSTIC_REPORT") {
    sendResponse({ ok: true, result: getScannerDiagnosticReport() });
    return false;
  }

  if (message?.type === "OPEN_RESULTS") {
    return respond(openResults());
  }

  if (message?.type === "RETRY_REMOTE_SYNC") {
    return respond(retryRemoteSync({ explicit: true }));
  }

  if (message?.type === "CLEAR_LOCAL_SCANNER_STATE") {
    return respond(clearLocalScannerState());
  }

  return false;
});

const observer = new MutationObserver(mutations => {
  if (!scanIsRunning() || isListingRoute()) return;

  if (mutations.every(isExtensionMutation)) return;
  domMutationVersion += 1;

  clearTimeout(observerTimer);
  observerTimer = setTimeout(() => {
    currentRouteKey = getRouteKey();
    scheduleScan(0);
  }, CONFIG.scanDebounceMs);
});

async function initialiseScanner() {
  const controlledDetailTab = await sendBackground({ type: "IS_CONTROLLED_DETAIL_TAB" })
    .catch(() => false);
  if (controlledDetailTab) return;

  window.addEventListener("scroll", () => {
    if (!scanIsRunning() || isListingRoute()) return;

    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => scheduleScan(0), CONFIG.scanDebounceMs);
  }, { passive: true });

  window.addEventListener("popstate", () => {
    currentRouteKey = getRouteKey();

    if (scanIsRunning() && sourceSearchRouteKey === currentRouteKey) {
      scheduleScan(100);
    }
  });

  cleanupLegacyCardDecorations();
  await loadSettings();
  await migrateEvaluatorLifecycleState();
  await migrateExistingStorage();
  const restored = await restoreActiveRun();
  if (!restored) updateProgress();
}

globalThis.measureKelmarScannerStorage = async function measureKelmarScannerStorage() {
  const report = ScannerStorage.measureStorageData(await chrome.storage.local.get(null));
  console.table(report.rows);
  console.table(report.largestCollections);
  console.info("Marketplace Vehicle Scanner storage totals:", {
    totalBytes: report.totalBytes,
    softLimitBytes: report.softLimitBytes,
    averageListingBytes: report.averageListingBytes,
    maximumListingBytes: report.maximumListingBytes,
    duplicateListingIds: report.duplicateListingIds,
    imageUrlCount: report.imageUrlCount,
    imageUrlBytes: report.imageUrlBytes,
    descriptionBytes: report.descriptionBytes,
    diagnosticsBytes: report.diagnosticsBytes,
    completedWorkBytes: report.completedWorkBytes,
    pendingUploadBytes: report.pendingUploadBytes
  });
  return report;
};

initialiseScanner().catch(error => {
  console.error("Marketplace Vehicle Scanner initialisation failed:", error);
  updateProgress();
});
