"use strict";

const elements = Object.fromEntries([
  "connectionDot", "connectionStatus", "version", "openDashboard", "warnings", "savedSearch", "refreshSearches",
  "sourceStatus", "summaryHeadline", "filterSummary", "openSettings", "discovered", "queued", "inspecting",
  "matched", "rejected", "unresolved", "pendingUpload", "uploaded", "reasonSection", "reasonCounts", "status",
  "startScan", "pauseScan", "resumeScan", "stopScan", "openResults", "retrySync", "discardScan"
].map(id => [id, document.querySelector(`#${id}`)]));

let storedSettings = null;
let savedSearches = [];
let currentConfig = FilterDomain.normaliseFilterConfig({});
let latestProgress = null;
let connectionState = "checking";

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

function setConnection(state, message) {
  connectionState = state;
  elements.connectionDot.className = state === "connected" ? "connected" : state === "error" ? "error" : "";
  elements.connectionStatus.textContent = message;
  updateWarnings();
}

function renderSummary(config) {
  const summary = FilterDomain.filterSummary(config)
    .filter(item => item.label !== "Advanced" || config.advancedFiltersEnabled);
  elements.summaryHeadline.textContent = `${summary[0].value} · ${summary.at(-1).value}`;
  elements.filterSummary.replaceChildren(...summary.map(item => {
    const box = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = item.label;
    const value = document.createElement("span");
    value.textContent = item.value;
    box.append(label, value);
    return box;
  }));
}

function populateSavedSearches(selectedId = "") {
  const localOption = elements.savedSearch.options[0];
  elements.savedSearch.replaceChildren(localOption, ...savedSearches.map(search => {
    const option = document.createElement("option");
    option.value = search.id;
    option.textContent = search.name;
    return option;
  }));
  elements.savedSearch.value = savedSearches.some(search => search.id === selectedId) ? selectedId : "";
}

async function chooseSource(id) {
  const search = savedSearches.find(item => item.id === id);
  if (search) {
    currentConfig = await ScannerSettings.activateDashboardSearch(search);
    storedSettings.activeSavedSearchId = search.id;
    storedSettings.activeFilterConfig = currentConfig;
    elements.sourceStatus.textContent = `Dashboard search “${search.name}” is active and read-only. Edit it in the dashboard.`;
  } else {
    currentConfig = await ScannerSettings.saveLocalDraft(storedSettings.localFilterDraft || currentConfig);
    storedSettings.activeSavedSearchId = null;
    storedSettings.activeFilterConfig = currentConfig;
    elements.sourceStatus.textContent = "Local draft is active. Open full settings to edit it.";
  }
  renderSummary(currentConfig);
  updateWarnings();
}

async function refreshSavedSearches(silent = false) {
  elements.refreshSearches.disabled = true;
  setConnection("checking", "Checking dashboard…");
  try {
    savedSearches = await ScannerSettings.fetchSavedSearches();
    const selectedId = elements.savedSearch.value || storedSettings.activeSavedSearchId || "";
    populateSavedSearches(selectedId);
    setConnection("connected", "Dashboard connected");
    if (elements.savedSearch.value) await chooseSource(elements.savedSearch.value);
  } catch (error) {
    setConnection("error", "Dashboard unavailable");
    if (!silent) elements.status.textContent = error.message || String(error);
  } finally {
    elements.refreshSearches.disabled = false;
  }
}

function reasonLabel(reason) {
  const labels = { target_reached: "target reached", processed_limit_reached: "found-listing cap reached", duration_limit_reached: "time limit reached", no_more_results: "no more results", user_stopped: "stopped by user", storage_soft_limit: "paused to protect recovery data", storage_quota: "paused because recovery storage is unavailable", extension_closed: "interrupted after navigation or restart", error: "scanner error" };
  return labels[reason] || reason || "";
}

function updateReasonCounts(progress) {
  const reasons = Object.entries(progress?.rejectionReasonCounts || {}).sort((left, right) => right[1] - left[1]).slice(0, 6);
  elements.reasonSection.hidden = reasons.length === 0;
  elements.reasonCounts.replaceChildren(...reasons.map(([reason, count]) => {
    const item = document.createElement("li");
    item.textContent = `${count}× ${reason}`;
    return item;
  }));
}

function updateWarnings() {
  const warnings = [];
  if (!currentConfig.scan.autoLoadEnabled) warnings.push("Auto-load is off: only mounted listings will be scanned.");
  if (connectionState === "error") warnings.push("Dashboard disconnected: new scans and uploads cannot start.");
  if (!elements.savedSearch.value) warnings.push("A local draft is active; dashboard searches remain unchanged.");
  if (latestProgress?.storageHealth?.nearSoftLimit) warnings.push("Local recovery storage is nearing its safe limit.");
  if (latestProgress?.remoteSyncError) warnings.push(`Pending upload failed: ${latestProgress.remoteSyncError}`);
  if (latestProgress?.usingPersistedSettingsSnapshot) warnings.push("This resumed scan is using its original filter snapshot; newly selected filters apply only to the next scan.");
  elements.warnings.replaceChildren(...warnings.map(message => {
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    return paragraph;
  }));
  elements.warnings.classList.toggle("visible", warnings.length > 0);
}

function updateProgress(progress) {
  latestProgress = progress || null;
  if (progress?.usingPersistedSettingsSnapshot) elements.sourceStatus.textContent = "Active resumed scan: using its original saved filter snapshot.";
  for (const [id, value] of Object.entries({ discovered: progress?.discovered, queued: progress?.queued, inspecting: progress?.inspecting, matched: progress?.matched, rejected: progress?.rejected, unresolved: progress?.unresolved, pendingUpload: progress?.pendingUploadCount, uploaded: progress?.uploaded })) elements[id].textContent = value ?? 0;
  elements.pauseScan.disabled = !progress?.scanningActive;
  elements.resumeScan.disabled = !progress?.canResume && !progress?.paused;
  elements.stopScan.disabled = !progress?.scanningActive && !progress?.paused;
  elements.startScan.disabled = Boolean(progress?.canResume || progress?.scanningActive);
  elements.openResults.disabled = !progress?.resultsUrl;
  elements.retrySync.disabled = !progress?.canRetrySync;
  elements.discardScan.disabled = !progress?.canResume || Boolean(progress?.paused);
  updateReasonCounts(progress);
  updateWarnings();
  if (progress?.storageHealth?.persistenceDegraded) elements.status.textContent = "Paused: local resume protection is unavailable.";
  else if (!progress?.scanId) elements.status.textContent = "Ready to start a bounded Marketplace scan.";
  else if (progress.remoteSyncError) elements.status.textContent = `Upload error: ${progress.remoteSyncError}`;
  else if (progress.scanningActive) elements.status.textContent = `${progress.matched}/${progress.targetMatches} matched · ${progress.discovered}/${progress.maximumProcessed} found · ${progress.processed} inspected · ${Math.floor((progress.elapsedSeconds || 0) / 60)}m ${(progress.elapsedSeconds || 0) % 60}s`;
  else if (progress.interrupted) elements.status.textContent = "Interrupted scan found. Resume or discard it.";
  else if (progress.paused) elements.status.textContent = "Scan paused.";
  else elements.status.textContent = `${progress.scanStatus}${reasonLabel(progress.stopReason) ? ` — ${reasonLabel(progress.stopReason)}` : ""}. ${progress.matched || 0} matches uploaded.`;
}

async function initialise() {
  elements.version.textContent = `v${chrome.runtime.getManifest().version}`;
  storedSettings = await ScannerSettings.load();
  currentConfig = storedSettings.activeFilterConfig;
  populateSavedSearches(storedSettings.activeSavedSearchId || "");
  renderSummary(currentConfig);
  elements.sourceStatus.textContent = storedSettings.activeSavedSearchId ? "Loading active dashboard search…" : "Local draft is active. Open full settings to edit it.";
  updateProgress(storedSettings.runtimeProgress);
  await refreshSavedSearches(true);
  try { updateProgress(await sendToActiveTab({ type: "GET_SCAN_STATE" })); } catch { /* Popup remains useful away from Marketplace. */ }
}

elements.savedSearch.addEventListener("change", () => chooseSource(elements.savedSearch.value).catch(error => { elements.status.textContent = error.message || String(error); }));
elements.refreshSearches.addEventListener("click", () => refreshSavedSearches());
elements.openSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
elements.openDashboard.addEventListener("click", () => chrome.tabs.create({ url: `${storedSettings?.dashboardUrl || ScannerSettings.CANONICAL_DASHBOARD_ORIGIN}/saved-searches` }));
elements.startScan.addEventListener("click", async event => {
  event.preventDefault();
  elements.startScan.disabled = true;
  try {
    if (!storedSettings.extensionApiToken) throw new Error("Open full settings and add the dashboard API token first.");
    const validation = FilterDomain.validateFilterConfig(currentConfig);
    if (!validation.valid) throw new Error(validation.errors[0]);
    elements.status.textContent = "Creating hosted scan…";
    updateProgress(await sendToActiveTab({ type: "START_SCAN" }));
  } catch (error) { elements.status.textContent = error.message || String(error); }
  finally { if (!latestProgress?.scanningActive) elements.startScan.disabled = false; }
});
elements.pauseScan.addEventListener("click", async () => { try { elements.status.textContent = "Pausing…"; updateProgress(await sendToActiveTab({ type: "PAUSE_SCAN" })); } catch (error) { elements.status.textContent = error.message || String(error); } });
elements.resumeScan.addEventListener("click", async () => { try { elements.status.textContent = "Resuming…"; updateProgress(await sendToActiveTab({ type: "RESUME_SCAN" })); } catch (error) { elements.status.textContent = error.message || String(error); } });
elements.stopScan.addEventListener("click", async () => { try { elements.status.textContent = "Stopping and uploading…"; updateProgress(await sendToActiveTab({ type: "STOP_SCAN" })); } catch (error) { elements.status.textContent = error.message || String(error); } });
elements.discardScan.addEventListener("click", async () => { try { updateProgress(await sendToActiveTab({ type: "DISCARD_INTERRUPTED_SCAN" })); } catch (error) { elements.status.textContent = error.message || String(error); } });
elements.openResults.addEventListener("click", async () => { try { if (!latestProgress?.resultsUrl) throw new Error("No hosted results are available."); await chrome.tabs.create({ url: latestProgress.resultsUrl }); } catch (error) { elements.status.textContent = error.message || String(error); } });
elements.retrySync.addEventListener("click", async () => { try { elements.status.textContent = "Retrying upload…"; updateProgress(await sendToActiveTab({ type: "RETRY_REMOTE_SYNC" })); } catch (error) { elements.status.textContent = error.message || String(error); } });
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.runtimeProgress) updateProgress(changes.runtimeProgress.newValue);
  if (changes.activeFilterConfig) { currentConfig = FilterDomain.normaliseFilterConfig(changes.activeFilterConfig.newValue); renderSummary(currentConfig); }
  if (changes.activeSavedSearchId && storedSettings) storedSettings.activeSavedSearchId = changes.activeSavedSearchId.newValue || null;
  if (changes.localFilterDraft && storedSettings) storedSettings.localFilterDraft = FilterDomain.normaliseFilterConfig(changes.localFilterDraft.newValue);
  if (changes.extensionApiToken && storedSettings) storedSettings.extensionApiToken = changes.extensionApiToken.newValue || "";
  if (changes.dashboardUrl && storedSettings) storedSettings.dashboardUrl = changes.dashboardUrl.newValue || ScannerSettings.CANONICAL_DASHBOARD_ORIGIN;
});

initialise().catch(error => { setConnection("error", "Setup failed"); elements.status.textContent = error.message || String(error); });
