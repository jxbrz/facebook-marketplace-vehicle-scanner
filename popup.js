const DEFAULTS = {
  dashboardUrl: "",
  extensionApiToken: "",
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
  acceptedModels: []
};

const elements = {
  dashboardUrl: document.querySelector("#dashboardUrl"),
  extensionApiToken: document.querySelector("#extensionApiToken"),
  extensionOrigin: document.querySelector("#extensionOrigin"),
  autoLoadEnabled: document.querySelector("#autoLoadEnabled"),
  autoOpenResults: document.querySelector("#autoOpenResults"),
  targetMatches: document.querySelector("#targetMatches"),
  maximumProcessed: document.querySelector("#maximumProcessed"),
  maximumDurationMinutes: document.querySelector("#maximumDurationMinutes"),
  minYear: document.querySelector("#minYear"),
  maxYear: document.querySelector("#maxYear"),
  minPrice: document.querySelector("#minPrice"),
  maxPrice: document.querySelector("#maxPrice"),
  maxMileage: document.querySelector("#maxMileage"),
  unknownMileagePolicy: document.querySelector("#unknownMileagePolicy"),
  acceptedMakes: document.querySelector("#acceptedMakes"),
  acceptedModels: document.querySelector("#acceptedModels"),
  excludedKeywords: document.querySelector("#excludedKeywords"),
  startScan: document.querySelector("#startScan"),
  stopScan: document.querySelector("#stopScan"),
  openResults: document.querySelector("#openResults"),
  retrySync: document.querySelector("#retrySync"),
  clearState: document.querySelector("#clearState"),
  recoveryActions: document.querySelector("#recoveryActions"),
  resumeScan: document.querySelector("#resumeScan"),
  discardScan: document.querySelector("#discardScan"),
  status: document.querySelector("#status"),
  discovered: document.querySelector("#discovered"),
  processed: document.querySelector("#processed"),
  matched: document.querySelector("#matched"),
  rejected: document.querySelector("#rejected"),
  unavailable: document.querySelector("#unavailable"),
  pending: document.querySelector("#pending")
};

let latestProgress = null;

function valueOrNull(input) {
  if (input.value.trim() === "") return null;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : null;
}

function getSelectedCategories() {
  return [...document.querySelectorAll(".category:checked")]
    .map(input => input.value);
}

function getKeywords() {
  return elements.excludedKeywords.value
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean);
}

function normaliseDashboardUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

async function getActiveMarketplaceTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!tab?.id || !tab.url?.includes("facebook.com/marketplace")) {
    throw new Error("Open a Facebook Marketplace search results page first.");
  }

  return tab;
}

async function sendToActiveTab(message) {
  const tab = await getActiveMarketplaceTab();

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "Marketplace scanner did not respond."));
        return;
      }

      resolve(response.result);
    });
  });
}

async function saveSettings() {
  const dashboardUrl = normaliseDashboardUrl(elements.dashboardUrl.value);
  const token = elements.extensionApiToken.value.trim();

  if (!dashboardUrl) {
    throw new Error("Enter the Vercel dashboard URL.");
  }

  let parsed;
  try {
    parsed = new URL(dashboardUrl);
  } catch {
    throw new Error("The dashboard URL is invalid.");
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("The dashboard URL must use HTTPS or HTTP.");
  }

  if (!token) {
    throw new Error("Enter the extension API token.");
  }

  const targetMatches = Math.min(250, Math.max(1, Number(elements.targetMatches.value) || 20));
  const maximumProcessed = Math.min(500, Math.max(1, Number(elements.maximumProcessed.value) || 150));
  const maximumDurationSeconds = Math.min(
    3600,
    Math.max(30, Math.round((Number(elements.maximumDurationMinutes.value) || 5) * 60))
  );

  if (maximumProcessed < targetMatches) {
    throw new Error("Maximum processed must be at least as large as target matches.");
  }

  const next = {
    enabled: true,
    dashboardUrl,
    extensionApiToken: token,
    autoLoadEnabled: elements.autoLoadEnabled.checked,
    autoOpenResults: elements.autoOpenResults.checked,
    targetMatches,
    maximumProcessed,
    maximumDurationSeconds,
    minYear: valueOrNull(elements.minYear),
    maxYear: valueOrNull(elements.maxYear),
    minPrice: valueOrNull(elements.minPrice),
    maxPrice: valueOrNull(elements.maxPrice),
    maxMileage: valueOrNull(elements.maxMileage),
    unknownMileagePolicy: elements.unknownMileagePolicy.value,
    excludeCategories: getSelectedCategories(),
    excludedKeywords: getKeywords(),
    acceptedMakes: VehicleIdentity.normaliseMakeFilters(elements.acceptedMakes.value),
    acceptedModels: VehicleIdentity.normaliseFilterValues(elements.acceptedModels.value)
  };

  await chrome.storage.local.set(next);
  return next;
}

function reasonLabel(reason) {
  const labels = {
    target_reached: "target reached",
    processed_limit_reached: "processing cap reached",
    duration_limit_reached: "time limit reached",
    no_more_results: "no more results found",
    user_stopped: "stopped by user",
    extension_closed: "interrupted after navigation or restart",
    error: "scanner error"
  };

  return labels[reason] || reason || "";
}

function updateProgress(progress) {
  latestProgress = progress || null;
  elements.discovered.textContent = progress?.discovered ?? 0;
  elements.processed.textContent = progress?.processed ?? 0;
  elements.matched.textContent = progress?.matched ?? 0;
  elements.rejected.textContent = progress?.rejected ?? 0;
  elements.unavailable.textContent = progress?.unavailable ?? 0;
  elements.pending.textContent = progress?.pending ?? 0;

  elements.stopScan.disabled = !progress?.scanningActive;
  elements.openResults.disabled = !progress?.resultsUrl;
  elements.retrySync.disabled = !progress?.canRetrySync;
  elements.startScan.disabled = Boolean(progress?.interrupted);
  elements.recoveryActions.hidden = !progress?.interrupted;

  if (!progress?.scanId) {
    elements.status.textContent = "Ready to start a new hosted scan.";
    return;
  }

  if (progress.remoteSyncError) {
    elements.status.textContent =
      `Scan ${progress.scanStatus}. Sync error: ${progress.remoteSyncError}`;
    return;
  }

  if (progress.scanningActive) {
    elements.status.textContent =
      `${progress.matched}/${progress.targetMatches} matches · ` +
      `${progress.processed}/${progress.maximumProcessed} processed · ` +
      `${Math.floor((progress.elapsedSeconds || 0) / 60)}m ${(progress.elapsedSeconds || 0) % 60}s`;
    return;
  }

  if (progress.interrupted) {
    elements.status.textContent = "Interrupted scan found. Choose Resume scan or Discard scan.";
    return;
  }

  const reason = reasonLabel(progress.stopReason);
  elements.status.textContent =
    `${progress.scanStatus}${reason ? ` — ${reason}` : ""}. ` +
    `${progress.matched} matches uploaded.`;
}

async function initialise() {
  const stored = await chrome.storage.local.get(DEFAULTS);

  elements.dashboardUrl.value = stored.dashboardUrl || "";
  elements.extensionApiToken.value = stored.extensionApiToken || "";
  elements.extensionOrigin.textContent = `chrome-extension://${chrome.runtime.id}`;
  elements.autoLoadEnabled.checked = Boolean(stored.autoLoadEnabled);
  elements.autoOpenResults.checked = Boolean(stored.autoOpenResults);
  elements.targetMatches.value = stored.targetMatches ?? 20;
  elements.maximumProcessed.value = stored.maximumProcessed ?? 150;
  elements.maximumDurationMinutes.value =
    (stored.maximumDurationSeconds ?? 300) / 60;
  elements.minYear.value = stored.minYear ?? "";
  elements.maxYear.value = stored.maxYear ?? "";
  elements.minPrice.value = stored.minPrice ?? "";
  elements.maxPrice.value = stored.maxPrice ?? "";
  elements.maxMileage.value = stored.maxMileage ?? "";
  elements.unknownMileagePolicy.value = stored.unknownMileagePolicy ?? "keep";
  elements.acceptedMakes.value = VehicleIdentity.normaliseMakeFilters(stored.acceptedMakes).join(", ");
  elements.acceptedModels.value = VehicleIdentity.normaliseFilterValues(stored.acceptedModels).join(", ");
  elements.excludedKeywords.value = (stored.excludedKeywords ?? []).join("\n");

  for (const input of document.querySelectorAll(".category")) {
    input.checked = true;
  }

  updateProgress(stored.runtimeProgress);

  try {
    const state = await sendToActiveTab({ type: "GET_SCAN_STATE" });
    updateProgress(state);
  } catch {
    // The popup can still be used to configure the server without a Marketplace tab.
  }
}

elements.startScan.addEventListener("click", async () => {
  elements.startScan.disabled = true;

  try {
    const saved = await saveSettings();
    elements.status.textContent = "Creating hosted scan…";
    const progress = await sendToActiveTab({ type: "START_SCAN" });
    updateProgress(progress);
    elements.status.textContent =
      `Hosted scan started: target ${saved.targetMatches}, cap ${saved.maximumProcessed}.`;
  } catch (error) {
    elements.status.textContent = error.message || String(error);
  } finally {
    elements.startScan.disabled = false;
  }
});

elements.stopScan.addEventListener("click", async () => {
  try {
    elements.status.textContent = "Stopping and synchronising…";
    updateProgress(await sendToActiveTab({ type: "STOP_SCAN" }));
  } catch (error) {
    elements.status.textContent = error.message || String(error);
  }
});

elements.resumeScan.addEventListener("click", async () => {
  try {
    elements.status.textContent = "Resuming interrupted scan…";
    updateProgress(await sendToActiveTab({ type: "RESUME_SCAN" }));
  } catch (error) {
    elements.status.textContent = error.message || String(error);
  }
});

elements.discardScan.addEventListener("click", async () => {
  try {
    elements.status.textContent = "Discarding interrupted scan…";
    updateProgress(await sendToActiveTab({ type: "DISCARD_INTERRUPTED_SCAN" }));
  } catch (error) {
    elements.status.textContent = error.message || String(error);
  }
});

elements.openResults.addEventListener("click", async () => {
  try {
    if (!latestProgress?.resultsUrl) {
      throw new Error("No hosted results URL is available yet.");
    }

    await chrome.tabs.create({ url: latestProgress.resultsUrl });
  } catch (error) {
    elements.status.textContent = error.message || String(error);
  }
});

elements.retrySync.addEventListener("click", async () => {
  try {
    elements.status.textContent = "Retrying dashboard sync…";
    updateProgress(await sendToActiveTab({ type: "RETRY_REMOTE_SYNC" }));
  } catch (error) {
    elements.status.textContent = error.message || String(error);
  }
});

elements.clearState.addEventListener("click", async () => {
  try {
    elements.status.textContent = "Clearing local scanner state…";
    await sendToActiveTab({ type: "CLEAR_LOCAL_SCANNER_STATE" });
    updateProgress(null);
  } catch (error) {
    elements.status.textContent = error.message || String(error);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.runtimeProgress) {
    updateProgress(changes.runtimeProgress.newValue);
  }
});

initialise();
