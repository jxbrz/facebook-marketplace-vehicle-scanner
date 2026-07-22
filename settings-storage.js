(function initialiseScannerSettings(root, factory) {
  const api = factory(root.FilterDomain);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ScannerSettings = api;
})(typeof globalThis === "object" ? globalThis : this, function createScannerSettings(FilterDomain) {
  "use strict";

  const FILTER_COMPATIBILITY_VERSION = 1;
  const CANONICAL_DASHBOARD_ORIGIN = "https://sourcing.kelmarvehiclesltd.co.uk";
  const LEGACY_DASHBOARD_ORIGIN = "https://facebook-web-filter.vercel.app";
  const DEFAULTS = {
    dashboardUrl: CANONICAL_DASHBOARD_ORIGIN,
    extensionApiToken: "",
    activeSavedSearchId: null,
    activeFilterConfig: null,
    localFilterDraft: null,
    runtimeProgress: null,
    filterCompatibilityVersion: 0
  };

  function migrateLegacyLocalCategoryConfig(value) {
    const config = FilterDomain.normaliseFilterConfig(value);
    if (config.category.mode !== "clean_only") return config;
    return FilterDomain.normaliseFilterConfig({
      ...config,
      category: {
        ...config.category,
        mode: "selected",
        statuses: ["clean", "other", "unknown"]
      }
    });
  }

  function normaliseDashboardUrl(value) {
    const trimmed = String(value || "").trim().replace(/\/+$/, "");
    try {
      const parsed = new URL(trimmed);
      if (parsed.origin === LEGACY_DASHBOARD_ORIGIN) {
        return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, `${CANONICAL_DASHBOARD_ORIGIN}/`).toString().replace(/\/$/, "");
      }
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return trimmed;
    }
  }

  function compatibilityShape(config, activeSavedSearchId) {
    return {
      activeFilterConfig: config,
      activeSavedSearchId: activeSavedSearchId || null,
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

  async function load() {
    const stored = await chrome.storage.local.get(DEFAULTS);
    const dashboardUrl = normaliseDashboardUrl(stored.dashboardUrl) || CANONICAL_DASHBOARD_ORIGIN;
    let activeFilterConfig = FilterDomain.normaliseFilterConfig(stored.activeFilterConfig || stored);
    let localFilterDraft = FilterDomain.normaliseFilterConfig(stored.localFilterDraft || (stored.activeSavedSearchId ? {} : activeFilterConfig));
    const patch = {};
    if (Number(stored.filterCompatibilityVersion) < FILTER_COMPATIBILITY_VERSION) {
      localFilterDraft = migrateLegacyLocalCategoryConfig(localFilterDraft);
      patch.localFilterDraft = localFilterDraft;
      if (!stored.activeSavedSearchId) {
        activeFilterConfig = migrateLegacyLocalCategoryConfig(activeFilterConfig);
        Object.assign(patch, compatibilityShape(activeFilterConfig, null));
      }
      patch.filterCompatibilityVersion = FILTER_COMPATIBILITY_VERSION;
    }
    if (dashboardUrl !== stored.dashboardUrl || !stored.localFilterDraft && !stored.activeSavedSearchId) {
      patch.dashboardUrl = dashboardUrl;
      patch.localFilterDraft = localFilterDraft;
    }
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    return {
      ...stored,
      ...patch,
      dashboardUrl,
      activeFilterConfig,
      localFilterDraft,
      filterCompatibilityVersion: FILTER_COMPATIBILITY_VERSION
    };
  }

  async function saveConnection(dashboardUrl, extensionApiToken) {
    const normalisedUrl = normaliseDashboardUrl(dashboardUrl);
    if (!normalisedUrl) throw new Error("Enter the hosted dashboard URL.");
    try {
      const parsed = new URL(normalisedUrl);
      if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new Error("The dashboard URL must be a valid HTTP or HTTPS address.");
    }
    if (!String(extensionApiToken || "").trim()) throw new Error("Enter the extension API token.");
    await chrome.storage.local.set({ dashboardUrl: normalisedUrl, extensionApiToken: String(extensionApiToken).trim(), enabled: true });
    return normalisedUrl;
  }

  async function activateDashboardSearch(search) {
    const config = FilterDomain.normaliseFilterConfig(search.filterConfig || search.filters);
    await chrome.storage.local.set(compatibilityShape(config, search.id));
    return config;
  }

  async function saveLocalDraft(value) {
    const validation = FilterDomain.validateFilterConfig(value);
    if (!validation.valid) throw new Error(validation.errors[0]);
    await chrome.storage.local.set({
      ...compatibilityShape(validation.config, null),
      localFilterDraft: validation.config
    });
    return validation.config;
  }

  async function sendBackground(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "The extension service worker did not respond.");
    return response.result;
  }

  async function fetchSavedSearches() {
    const response = await sendBackground({ type: "REMOTE_GET_SAVED_SEARCHES" });
    return Array.isArray(response.searches) ? response.searches : [];
  }

  return {
    CANONICAL_DASHBOARD_ORIGIN,
    DEFAULTS,
    FILTER_COMPATIBILITY_VERSION,
    activateDashboardSearch,
    fetchSavedSearches,
    load,
    normaliseDashboardUrl,
    migrateLegacyLocalCategoryConfig,
    saveConnection,
    saveLocalDraft,
    sendBackground
  };
});
