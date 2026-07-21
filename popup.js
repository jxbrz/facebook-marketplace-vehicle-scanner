const CANONICAL_DASHBOARD_ORIGIN = "https://sourcing.kelmarvehiclesltd.co.uk";
const LEGACY_DASHBOARD_ORIGIN = "https://facebook-web-filter.vercel.app";

const DEFAULTS = {
  dashboardUrl: CANONICAL_DASHBOARD_ORIGIN,
  extensionApiToken: "",
  activeSavedSearchId: null,
  activeFilterConfig: null,
  runtimeProgress: null
};

const elements = Object.fromEntries([
  "connectionDot", "connectionStatus", "version", "openDashboard", "warnings", "savedSearch", "refreshSearches",
  "savedSearchHelp", "discovered", "queued", "inspecting", "matched", "rejected", "unresolved", "pendingUpload",
  "uploaded", "makeSearch", "makeOptions", "modelSearch", "modelOptions", "modelHelp", "minYear", "maxYear",
  "minPrice", "maxPrice", "minMileage", "maxMileage", "transmissionInclude", "transmissionExclude", "fuelInclude",
  "fuelExclude", "colourInclude", "colourExclude", "bodyInclude", "bodyExclude", "categoryStatuses",
  "includeRepairedVehicles", "requiredKeywords", "excludedKeywords", "unknownPolicies", "targetMatches",
  "maximumProcessed", "maximumDurationMinutes", "autoLoadEnabled", "autoOpenResults", "dashboardUrl",
  "extensionApiToken", "extensionOrigin", "reasonSection", "reasonCounts", "recoveryActions", "recoveryTitle",
  "recoveryText", "resumeScan", "discardScan", "openResults", "retrySync", "clearState", "status", "startScan",
  "pauseScan", "stopScan"
].map(id => [id, document.querySelector(`#${id}`)]));

const UNKNOWN_FIELDS = [
  ["price", "Price"], ["mileage", "Mileage"], ["year", "Year"], ["makeModel", "Make and model"],
  ["categoryStatus", "Category status"], ["transmission", "Transmission"], ["fuelType", "Fuel type"],
  ["colour", "Colour"], ["bodyType", "Body type"]
];
const POLICY_OPTIONS = [
  ["inspect_then_reject", "Inspect, then reject"], ["include_with_warning", "Include with warning"],
  ["exclude", "Exclude if unknown"], ["ignore_filter_for_unknown", "Ignore filter if unknown"]
];
const COLOURS = ["black", "white", "silver", "grey", "blue", "red", "green", "yellow", "orange", "brown", "beige", "purple", "gold", "bronze", "other"];
const BODY_TYPES = ["hatchback", "saloon", "estate", "suv", "coupe", "convertible", "mpv", "pickup", "van", "other"];

let latestProgress = null;
let savedSearches = [];
let currentConfig = FilterDomain.normaliseFilterConfig({ excludedCategories: ["S", "N", "C", "D"] });
let connectionState = "checking";
let draftTimer = null;

function canonicaliseLegacyDashboardUrl(parsed) {
  if (parsed.origin !== LEGACY_DASHBOARD_ORIGIN) return parsed;
  return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, `${CANONICAL_DASHBOARD_ORIGIN}/`);
}

function normaliseDashboardUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  try { return canonicaliseLegacyDashboardUrl(new URL(trimmed)).toString().replace(/\/$/, ""); }
  catch { return trimmed; }
}

function valueOrNull(input) {
  if (!input.value.trim()) return null;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : null;
}

function lines(input) {
  return input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
}

function selectedValues(select) {
  return [...select.selectedOptions].map(option => option.value);
}

function setSelectedValues(select, values) {
  const selected = new Set(values || []);
  for (const option of select.options) option.selected = selected.has(option.value);
}

function selectedMakes() {
  return [...elements.makeOptions.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
}

function selectedModels() {
  return [...elements.modelOptions.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
}

function optionLabel(value) {
  return value === "semiautomatic" ? "Semi-automatic" : value === "suv" || value === "lpg" ? value.toUpperCase() : value.replace(/\b\w/g, character => character.toUpperCase());
}

function fillOptions(select, values) {
  select.replaceChildren(...values.map(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = optionLabel(value);
    return option;
  }));
}

function checkbox(value, checked, type) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = value;
  input.checked = checked;
  input.dataset.choiceType = type;
  const span = document.createElement("span");
  span.textContent = value;
  label.append(input, span);
  return label;
}

function renderMakes(values = []) {
  const selected = new Set(VehicleCatalogue.normaliseMakes(values));
  elements.makeOptions.replaceChildren(...VehicleCatalogue.CATALOGUE.map(item => checkbox(item.make, selected.has(item.make), "make")));
  filterChoiceGrid(elements.makeOptions, elements.makeSearch.value);
}

function renderModels(values = []) {
  const makes = selectedMakes();
  const compatible = VehicleCatalogue.modelsForMakes(makes);
  const selected = new Set(VehicleCatalogue.normaliseModels(values, makes));
  if (!compatible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-choice";
    empty.textContent = "Any model";
    elements.modelOptions.replaceChildren(empty);
    elements.modelSearch.disabled = true;
    elements.modelHelp.textContent = "Choose one or more makes to select specific models. No model selection means any model.";
    return;
  }
  elements.modelSearch.disabled = false;
  elements.modelOptions.replaceChildren(...compatible.map(item => checkbox(item.model, selected.has(item.model), "model")));
  elements.modelHelp.textContent = selected.size ? `${selected.size} model${selected.size === 1 ? "" : "s"} selected.` : "Any model is selected.";
  filterChoiceGrid(elements.modelOptions, elements.modelSearch.value);
}

function filterChoiceGrid(container, query) {
  const needle = VehicleCatalogue.key(query);
  for (const label of container.querySelectorAll("label")) {
    label.classList.toggle("hidden", Boolean(needle && !VehicleCatalogue.key(label.textContent).includes(needle)));
  }
}

function initialiseStaticControls() {
  fillOptions(elements.colourInclude, COLOURS);
  fillOptions(elements.colourExclude, COLOURS);
  fillOptions(elements.bodyInclude, BODY_TYPES);
  fillOptions(elements.bodyExclude, BODY_TYPES);
  for (const [field, labelText] of UNKNOWN_FIELDS) {
    const label = document.createElement("label");
    label.textContent = labelText;
    const select = document.createElement("select");
    select.id = `unknown-${field}`;
    select.dataset.unknownField = field;
    for (const [value, title] of POLICY_OPTIONS) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = title;
      select.append(option);
    }
    label.append(select);
    elements.unknownPolicies.append(label);
  }
}

function applyConfig(value) {
  currentConfig = FilterDomain.normaliseFilterConfig(value);
  renderMakes(currentConfig.vehicle.makes);
  renderModels(currentConfig.vehicle.models);
  elements.minYear.value = currentConfig.vehicle.minYear ?? "";
  elements.maxYear.value = currentConfig.vehicle.maxYear ?? "";
  elements.minPrice.value = currentConfig.priceMileage.minPrice ?? "";
  elements.maxPrice.value = currentConfig.priceMileage.maxPrice ?? "";
  elements.minMileage.value = currentConfig.priceMileage.minMileage ?? "";
  elements.maxMileage.value = currentConfig.priceMileage.maxMileage ?? "";
  setSelectedValues(elements.transmissionInclude, currentConfig.specification.transmissions.include);
  setSelectedValues(elements.transmissionExclude, currentConfig.specification.transmissions.exclude);
  setSelectedValues(elements.fuelInclude, currentConfig.specification.fuelTypes.include);
  setSelectedValues(elements.fuelExclude, currentConfig.specification.fuelTypes.exclude);
  setSelectedValues(elements.colourInclude, currentConfig.specification.colours.include);
  setSelectedValues(elements.colourExclude, currentConfig.specification.colours.exclude);
  setSelectedValues(elements.bodyInclude, currentConfig.specification.bodyTypes.include);
  setSelectedValues(elements.bodyExclude, currentConfig.specification.bodyTypes.exclude);
  const mode = document.querySelector(`input[name="categoryMode"][value="${currentConfig.category.mode}"]`);
  if (mode) mode.checked = true;
  const categoryStatuses = new Set(currentConfig.category.statuses);
  for (const input of elements.categoryStatuses.querySelectorAll('input[type="checkbox"]')) input.checked = categoryStatuses.has(input.value);
  elements.includeRepairedVehicles.checked = currentConfig.category.includeRepairedVehicles;
  elements.requiredKeywords.value = currentConfig.text.requiredKeywords.join("\n");
  elements.excludedKeywords.value = currentConfig.text.excludedKeywords.join("\n");
  for (const select of elements.unknownPolicies.querySelectorAll("select")) select.value = currentConfig.unknownPolicies[select.dataset.unknownField];
  elements.targetMatches.value = currentConfig.scan.targetMatches;
  elements.maximumProcessed.value = currentConfig.scan.maximumProcessed;
  elements.maximumDurationMinutes.value = currentConfig.scan.maximumDurationSeconds / 60;
  elements.autoLoadEnabled.checked = currentConfig.scan.autoLoadEnabled;
  elements.autoOpenResults.checked = currentConfig.scan.autoOpenResults;
  updateWarnings();
}

function configFromForm() {
  const unknownPolicies = {};
  for (const select of elements.unknownPolicies.querySelectorAll("select")) unknownPolicies[select.dataset.unknownField] = select.value;
  return FilterDomain.normaliseFilterConfig({
    filterSchemaVersion: 2,
    vehicle: { makes: selectedMakes(), models: selectedModels(), minYear: valueOrNull(elements.minYear), maxYear: valueOrNull(elements.maxYear) },
    priceMileage: { minPrice: valueOrNull(elements.minPrice), maxPrice: valueOrNull(elements.maxPrice), minMileage: valueOrNull(elements.minMileage), maxMileage: valueOrNull(elements.maxMileage) },
    specification: {
      transmissions: { include: selectedValues(elements.transmissionInclude), exclude: selectedValues(elements.transmissionExclude) },
      fuelTypes: { include: selectedValues(elements.fuelInclude), exclude: selectedValues(elements.fuelExclude) },
      colours: { include: selectedValues(elements.colourInclude), exclude: selectedValues(elements.colourExclude) },
      bodyTypes: { include: selectedValues(elements.bodyInclude), exclude: selectedValues(elements.bodyExclude) }
    },
    category: {
      mode: document.querySelector('input[name="categoryMode"]:checked')?.value || "any",
      statuses: [...elements.categoryStatuses.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value),
      includeRepairedVehicles: elements.includeRepairedVehicles.checked
    },
    text: { requiredKeywords: lines(elements.requiredKeywords), excludedKeywords: lines(elements.excludedKeywords) },
    unknownPolicies,
    scan: {
      targetMatches: valueOrNull(elements.targetMatches), maximumProcessed: valueOrNull(elements.maximumProcessed),
      maximumDurationSeconds: Math.round((valueOrNull(elements.maximumDurationMinutes) || 5) * 60),
      autoLoadEnabled: elements.autoLoadEnabled.checked, autoOpenResults: elements.autoOpenResults.checked
    }
  });
}

function storageShape(config) {
  return {
    activeFilterConfig: config,
    activeSavedSearchId: elements.savedSearch.value || null,
    targetMatches: config.scan.targetMatches,
    maximumProcessed: config.scan.maximumProcessed,
    maximumDurationSeconds: config.scan.maximumDurationSeconds,
    autoLoadEnabled: config.scan.autoLoadEnabled,
    autoOpenResults: config.scan.autoOpenResults,
    minYear: config.vehicle.minYear,
    maxYear: config.vehicle.maxYear,
    minPrice: config.priceMileage.minPrice,
    maxPrice: config.priceMileage.maxPrice,
    minMileage: config.priceMileage.minMileage,
    maxMileage: config.priceMileage.maxMileage,
    acceptedMakes: config.vehicle.makes,
    acceptedModels: config.vehicle.models,
    excludedKeywords: config.text.excludedKeywords
  };
}

async function persistDraft() {
  const validation = FilterDomain.validateFilterConfig(configFromForm());
  if (!validation.valid) return;
  currentConfig = validation.config;
  await chrome.storage.local.set(storageShape(currentConfig));
}

function scheduleDraftPersist() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => persistDraft().catch(() => {}), 250);
}

async function saveSettings() {
  const dashboardUrl = normaliseDashboardUrl(elements.dashboardUrl.value);
  const token = elements.extensionApiToken.value.trim();
  if (!dashboardUrl) throw new Error("Enter the hosted dashboard URL.");
  try {
    const parsed = new URL(dashboardUrl);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();
  } catch { throw new Error("The dashboard URL must be a valid HTTP or HTTPS address."); }
  if (!token) throw new Error("Enter the extension API token.");
  const validation = FilterDomain.validateFilterConfig(configFromForm());
  if (!validation.valid) throw new Error(validation.errors[0]);
  currentConfig = validation.config;
  const next = { dashboardUrl, extensionApiToken: token, enabled: true, ...storageShape(currentConfig) };
  await chrome.storage.local.set(next);
  return next;
}

async function getActiveMarketplaceTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url?.includes("facebook.com/marketplace")) throw new Error("Open a Facebook Marketplace search results page first.");
  return tab;
}

async function sendToActiveTab(message) {
  const tab = await getActiveMarketplaceTab();
  const response = await chrome.tabs.sendMessage(tab.id, message);
  if (!response?.ok) throw new Error(response?.error || "The scanner did not respond.");
  return response.result;
}

async function sendBackground(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "The extension service worker did not respond.");
  return response.result;
}

function setConnection(state, message) {
  connectionState = state;
  elements.connectionDot.className = `connection-dot${state === "connected" ? " connected" : state === "error" ? " error" : ""}`;
  elements.connectionStatus.textContent = message;
  updateWarnings();
}

function populateSavedSearches(searches, selectedId) {
  savedSearches = Array.isArray(searches) ? searches : [];
  const local = elements.savedSearch.options[0];
  elements.savedSearch.replaceChildren(local, ...savedSearches.map(search => {
    const option = document.createElement("option");
    option.value = search.id;
    option.textContent = search.name;
    return option;
  }));
  elements.savedSearch.value = savedSearches.some(search => search.id === selectedId) ? selectedId : "";
}

async function refreshSavedSearches(options = {}) {
  elements.refreshSearches.disabled = true;
  setConnection("checking", "Checking dashboard…");
  try {
    const response = await sendBackground({ type: "REMOTE_GET_SAVED_SEARCHES" });
    const selectedId = options.selectedId ?? elements.savedSearch.value;
    populateSavedSearches(response.searches, selectedId);
    setConnection("connected", "Dashboard connected");
    if (options.applySelected && elements.savedSearch.value) {
      const selected = savedSearches.find(search => search.id === elements.savedSearch.value);
      if (selected) applyConfig(selected.filterConfig || selected.filters);
    }
  } catch (error) {
    setConnection("error", "Dashboard unavailable");
    if (!options.silent) elements.status.textContent = error.message || String(error);
  } finally {
    elements.refreshSearches.disabled = false;
  }
}

function reasonLabel(reason) {
  const labels = { target_reached: "target reached", processed_limit_reached: "inspection cap reached", duration_limit_reached: "time limit reached", no_more_results: "no more results", user_stopped: "stopped by user", storage_soft_limit: "paused to protect recovery data", storage_quota: "paused because recovery storage is unavailable", extension_closed: "interrupted after navigation or restart", error: "scanner error" };
  return labels[reason] || reason || "";
}

function updateReasonCounts(progress) {
  const reasons = Object.entries(progress?.rejectionReasonCounts || {}).sort((left, right) => right[1] - left[1]).slice(0, 8);
  elements.reasonSection.hidden = reasons.length === 0;
  elements.reasonCounts.replaceChildren(...reasons.map(([reason, count]) => {
    const item = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = `${count}× `;
    item.append(strong, reason);
    return item;
  }));
}

function updateWarnings() {
  const warnings = [];
  if (!elements.autoLoadEnabled.checked) warnings.push("Auto-scroll is off: only currently loaded listings will be scanned.");
  if (connectionState === "error") warnings.push("Dashboard disconnected: new scans and uploads cannot start until the connection recovers.");
  if (!elements.savedSearch.value) warnings.push("No dashboard saved search is active; local filters will be used.");
  if (latestProgress?.storageHealth?.nearSoftLimit) warnings.push("Local recovery storage is nearing its safe limit.");
  if (latestProgress?.remoteSyncError) warnings.push(`Pending upload failed: ${latestProgress.remoteSyncError}`);
  elements.warnings.replaceChildren(...warnings.map(message => {
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    return paragraph;
  }));
  elements.warnings.classList.toggle("visible", warnings.length > 0);
}

function updateProgress(progress) {
  latestProgress = progress || null;
  for (const [id, value] of Object.entries({
    discovered: progress?.discovered, queued: progress?.queued, inspecting: progress?.inspecting,
    matched: progress?.matched, rejected: progress?.rejected, unresolved: progress?.unresolved,
    pendingUpload: progress?.pendingUploadCount, uploaded: progress?.uploaded
  })) elements[id].textContent = value ?? 0;
  elements.pauseScan.disabled = !progress?.scanningActive;
  elements.stopScan.disabled = !progress?.scanningActive && !progress?.paused;
  elements.openResults.disabled = !progress?.resultsUrl;
  elements.retrySync.disabled = !progress?.canRetrySync;
  elements.startScan.disabled = Boolean(progress?.canResume || progress?.scanningActive);
  elements.recoveryActions.hidden = !progress?.canResume;
  elements.discardScan.hidden = Boolean(progress?.paused);
  elements.recoveryTitle.textContent = progress?.paused ? "Scan paused" : "Interrupted scan found";
  elements.recoveryText.textContent = progress?.paused ? "Discovery and inspection are stopped. Resume or stop this scan." : "Open the original Marketplace search, then resume or discard this interrupted run.";
  updateReasonCounts(progress);
  updateWarnings();
  if (progress?.storageHealth?.persistenceDegraded) elements.status.textContent = "Paused: local resume protection is unavailable.";
  else if (!progress?.scanId) elements.status.textContent = "Ready to start a bounded Marketplace scan.";
  else if (progress.remoteSyncError) elements.status.textContent = `Upload error: ${progress.remoteSyncError}`;
  else if (progress.scanningActive) elements.status.textContent = `${progress.matched}/${progress.targetMatches} matched · ${progress.processed}/${progress.maximumProcessed} inspected · ${Math.floor((progress.elapsedSeconds || 0) / 60)}m ${(progress.elapsedSeconds || 0) % 60}s`;
  else if (progress.interrupted) elements.status.textContent = "Interrupted scan found. Resume or discard it.";
  else if (progress.paused) elements.status.textContent = "Scan paused.";
  else elements.status.textContent = `${progress.scanStatus}${reasonLabel(progress.stopReason) ? ` — ${reasonLabel(progress.stopReason)}` : ""}. ${progress.matched || 0} matches uploaded.`;
}

async function initialise() {
  initialiseStaticControls();
  elements.version.textContent = `v${chrome.runtime.getManifest().version}`;
  elements.extensionOrigin.textContent = `chrome-extension://${chrome.runtime.id}`;
  const stored = await chrome.storage.local.get(DEFAULTS);
  const dashboardUrl = normaliseDashboardUrl(stored.dashboardUrl);
  if (dashboardUrl !== stored.dashboardUrl) await chrome.storage.local.set({ dashboardUrl });
  elements.dashboardUrl.value = dashboardUrl;
  elements.extensionApiToken.value = stored.extensionApiToken || "";
  populateSavedSearches([], stored.activeSavedSearchId);
  applyConfig(stored.activeFilterConfig || stored);
  updateProgress(stored.runtimeProgress);
  await refreshSavedSearches({ selectedId: stored.activeSavedSearchId, applySelected: Boolean(stored.activeSavedSearchId), silent: true });
  try { updateProgress(await sendToActiveTab({ type: "GET_SCAN_STATE" })); } catch { /* Configuration remains available away from Marketplace. */ }
}

elements.makeOptions.addEventListener("change", event => {
  if (event.target.dataset.choiceType !== "make") return;
  const retained = selectedModels().filter(model => VehicleCatalogue.isModelCompatible(model, selectedMakes()));
  renderModels(retained);
  scheduleDraftPersist();
});
elements.modelOptions.addEventListener("change", scheduleDraftPersist);
elements.makeSearch.addEventListener("input", () => filterChoiceGrid(elements.makeOptions, elements.makeSearch.value));
elements.modelSearch.addEventListener("input", () => filterChoiceGrid(elements.modelOptions, elements.modelSearch.value));
document.querySelector(".scroll-content").addEventListener("change", event => {
  if (event.target === elements.savedSearch || event.target.dataset.choiceType === "make") return;
  updateWarnings();
  scheduleDraftPersist();
});

elements.savedSearch.addEventListener("change", async () => {
  const selected = savedSearches.find(search => search.id === elements.savedSearch.value);
  if (selected) {
    applyConfig(selected.filterConfig || selected.filters);
    elements.savedSearchHelp.textContent = `Loaded “${selected.name}”. Temporary popup changes affect the next scan; edit the saved source in the dashboard.`;
  } else {
    elements.savedSearchHelp.textContent = "Local filters are active. Create a reusable search in the dashboard when ready.";
  }
  await persistDraft();
});
elements.refreshSearches.addEventListener("click", () => refreshSavedSearches({ applySelected: false }));
elements.openDashboard.addEventListener("click", async () => {
  const url = normaliseDashboardUrl(elements.dashboardUrl.value) || CANONICAL_DASHBOARD_ORIGIN;
  await chrome.tabs.create({ url: `${url}/saved-searches` });
});

elements.startScan.addEventListener("click", async () => {
  elements.startScan.disabled = true;
  try {
    const saved = await saveSettings();
    elements.status.textContent = "Creating hosted scan…";
    updateProgress(await sendToActiveTab({ type: "START_SCAN" }));
    elements.status.textContent = `Started: target ${saved.activeFilterConfig.scan.targetMatches}, cap ${saved.activeFilterConfig.scan.maximumProcessed}.`;
  } catch (error) { elements.status.textContent = error.message || String(error); }
  finally { if (!latestProgress?.scanningActive) elements.startScan.disabled = false; }
});
elements.pauseScan.addEventListener("click", async () => { try { elements.status.textContent = "Pausing…"; updateProgress(await sendToActiveTab({ type: "PAUSE_SCAN" })); } catch (error) { elements.status.textContent = error.message || String(error); } });
elements.resumeScan.addEventListener("click", async () => { try { elements.status.textContent = "Resuming…"; updateProgress(await sendToActiveTab({ type: "RESUME_SCAN" })); } catch (error) { elements.status.textContent = error.message || String(error); } });
elements.stopScan.addEventListener("click", async () => { try { elements.status.textContent = "Stopping and uploading…"; updateProgress(await sendToActiveTab({ type: "STOP_SCAN" })); } catch (error) { elements.status.textContent = error.message || String(error); } });
elements.discardScan.addEventListener("click", async () => { try { updateProgress(await sendToActiveTab({ type: "DISCARD_INTERRUPTED_SCAN" })); } catch (error) { elements.status.textContent = error.message || String(error); } });
elements.openResults.addEventListener("click", async () => { try { if (!latestProgress?.resultsUrl) throw new Error("No hosted results are available."); await chrome.tabs.create({ url: latestProgress.resultsUrl }); } catch (error) { elements.status.textContent = error.message || String(error); } });
elements.retrySync.addEventListener("click", async () => { try { elements.status.textContent = "Retrying upload…"; updateProgress(await sendToActiveTab({ type: "RETRY_REMOTE_SYNC" })); } catch (error) { elements.status.textContent = error.message || String(error); } });
elements.clearState.addEventListener("click", async () => { try { await sendToActiveTab({ type: "CLEAR_LOCAL_SCANNER_STATE" }); updateProgress(null); } catch (error) { elements.status.textContent = error.message || String(error); } });
chrome.storage.onChanged.addListener((changes, areaName) => { if (areaName === "local" && changes.runtimeProgress) updateProgress(changes.runtimeProgress.newValue); });

initialise().catch(error => { setConnection("error", "Setup failed"); elements.status.textContent = error.message || String(error); });
