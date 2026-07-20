(function initialiseScannerStorage(root, factory) {
  const storage = factory();
  if (typeof module === "object" && module.exports) module.exports = storage;
  root.ScannerStorage = storage;
})(typeof globalThis === "object" ? globalThis : this, function createScannerStorageModule() {
  "use strict";

  const SCHEMA_VERSION = 20;
  const SOFT_LIMIT_BYTES = 4 * 1024 * 1024;
  const MAX_COMPLETED_MARKERS = 500;
  const MAX_IMAGE_URLS = 20;
  const MAX_LIFECYCLE_DIAGNOSTICS = 30;
  const SENSITIVE_KEY_PATTERN = /token|password|secret|api.?key|authorization|cookie/i;
  const DESCRIPTION_KEY_PATTERN = /description|excerpt|context/i;
  const IMAGE_KEY_PATTERN = /image|photo|thumbnail/i;

  function jsonStringify(value) {
    const json = JSON.stringify(value);
    return json === undefined ? "" : json;
  }

  function utf8Bytes(value) {
    const text = typeof value === "string" ? value : jsonStringify(value);
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text).byteLength;
    if (typeof Buffer === "function") return Buffer.byteLength(text, "utf8");
    return unescape(encodeURIComponent(text)).length;
  }

  function approximateStorageItemBytes(key, value) {
    return utf8Bytes(String(key)) + utf8Bytes(value);
  }

  function truncate(value, limit) {
    if (value === null || value === undefined) return null;
    return String(value).slice(0, limit);
  }

  function validHttpsUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" ? value : null;
    } catch {
      return null;
    }
  }

  function normaliseImageUrls(values, limit = MAX_IMAGE_URLS) {
    const output = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const url = validHttpsUrl(value);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      output.push(url);
      if (output.length >= limit) break;
    }
    return output;
  }

  function sanitisePendingUpload(payload) {
    if (!payload || typeof payload !== "object") return null;
    const imageUrls = normaliseImageUrls(payload.imageUrls);
    const imageUrl = validHttpsUrl(payload.imageUrl) || imageUrls[0] || null;
    return {
      ...payload,
      imageUrl,
      imageUrls
    };
  }

  function compactMetadata(metadata) {
    if (!metadata || typeof metadata !== "object") return null;
    const compact = {
      title: truncate(metadata.title, 300),
      cardText: truncate(metadata.cardText, 1500),
      price: Number.isFinite(Number(metadata.price)) ? Number(metadata.price) : null,
      year: Number.isFinite(Number(metadata.year)) ? Number(metadata.year) : null,
      mileage: Number.isFinite(Number(metadata.mileage)) ? Number(metadata.mileage) : null,
      location: truncate(metadata.location, 160),
      sellerType: truncate(metadata.sellerType, 80),
      fuelType: truncate(metadata.fuelType, 80),
      transmission: truncate(metadata.transmission, 80),
      imageUrl: validHttpsUrl(metadata.imageUrl)
    };
    return Object.fromEntries(Object.entries(compact).filter(([, value]) => value !== null));
  }

  function isFinalEntry(entry) {
    return ["matched", "rejected", "unavailable"].includes(entry?.status);
  }

  function compactLedgerEntry(entry, listingId) {
    const final = isFinalEntry(entry);
    const compact = {
      listingId: String(entry?.listingId || listingId || ""),
      status: truncate(entry?.status || "discovered", 40),
      workState: truncate(entry?.workState || (final ? "processed" : "unseen"), 40),
      discoveredAt: Number.isFinite(Number(entry?.discoveredAt)) ? Number(entry.discoveredAt) : null,
      processedAt: Number.isFinite(Number(entry?.processedAt)) ? Number(entry.processedAt) : null,
      uploadedAt: Number.isFinite(Number(entry?.uploadedAt)) ? Number(entry.uploadedAt) : null,
      reason: truncate(entry?.reason, 500),
      code: truncate(entry?.code, 80),
      source: truncate(entry?.source, 100)
    };
    if (!final) {
      compact.url = validHttpsUrl(entry?.url);
      compact.metadata = compactMetadata(entry?.metadata);
    }
    return Object.fromEntries(Object.entries(compact).filter(([, value]) => value !== null));
  }

  function objectEntries(value) {
    if (value instanceof Map) return [...value.entries()];
    return Object.entries(value && typeof value === "object" ? value : {});
  }

  function compactLedger(value) {
    const entries = objectEntries(value);
    const finalEntries = [];
    const activeEntries = [];
    for (const [listingId, entry] of entries) {
      const item = [String(listingId), compactLedgerEntry(entry, listingId)];
      if (isFinalEntry(entry)) finalEntries.push(item);
      else activeEntries.push(item);
    }
    const keptFinal = finalEntries.slice(-MAX_COMPLETED_MARKERS);
    return Object.fromEntries([...keptFinal, ...activeEntries]);
  }

  function compactPendingUploads(value) {
    const output = {};
    for (const [listingId, payload] of objectEntries(value)) {
      const sanitised = sanitisePendingUpload(payload);
      if (!sanitised) continue;
      const canonicalId = String(sanitised.externalListingId || listingId || "");
      if (!canonicalId) continue;
      output[canonicalId] = { ...sanitised, externalListingId: canonicalId };
    }
    return output;
  }

  function compactLifecycleDiagnostics(value) {
    return (Array.isArray(value) ? value : [])
      .slice(-MAX_LIFECYCLE_DIAGNOSTICS)
      .map(item => ({
        at: truncate(item?.at, 40),
        event: truncate(item?.event, 80),
        lifecycleState: truncate(item?.lifecycleState, 40),
        scanStatus: truncate(item?.scanStatus, 40)
      }));
  }

  function buildCompactState(source = {}, health = null) {
    const pendingUploads = compactPendingUploads(source.pendingUploads);
    const ledger = compactLedger(source.ledger);
    if (source.version === 19) {
      for (const [listingId, entry] of Object.entries(ledger)) {
        if (isFinalEntry(entry) && !pendingUploads[listingId] && !entry.uploadedAt) {
          entry.uploadedAt = Number(source.savedAt) || Date.now();
        }
      }
    }
    const state = {
      version: SCHEMA_VERSION,
      sourceSearchRouteKey: truncate(source.sourceSearchRouteKey, 2000),
      settingsSnapshot: source.settingsSnapshot || {},
      scanStartedAt: source.scanStartedAt || null,
      scanCompletedAt: source.scanCompletedAt || null,
      scanDeadlineAt: source.scanDeadlineAt || null,
      scanStatus: source.scanStatus || "idle",
      lifecycleState: source.lifecycleState || "idle",
      historicalScanStatus: source.historicalScanStatus || null,
      stopReason: truncate(source.stopReason, 120),
      runToken: truncate(source.runToken, 200),
      scanningActive: Boolean(source.scanningActive),
      scanFinalised: Boolean(source.scanFinalised),
      remoteRun: source.remoteRun || null,
      remoteCompleted: Boolean(source.remoteCompleted),
      remoteSyncState: source.remoteSyncState || "idle",
      remoteSyncError: truncate(source.remoteSyncError, 500),
      uploadRetryCount: Math.max(0, Math.min(3, Number(source.uploadRetryCount) || 0)),
      lastUploadAttemptAt: Number.isFinite(Number(source.lastUploadAttemptAt))
        ? Number(source.lastUploadAttemptAt)
        : null,
      resultsOpenedForScanId: truncate(source.resultsOpenedForScanId, 200),
      ledger,
      pendingUploads,
      lifecycleDiagnostics: compactLifecycleDiagnostics(source.lifecycleDiagnostics),
      filterFingerprint: truncate(source.filterFingerprint, 4000),
      storageHealth: health || source.storageHealth || null,
      savedAt: Date.now()
    };
    return Object.fromEntries(Object.entries(state).filter(([, value]) => value !== null));
  }

  function migrateActiveState(state) {
    if (!state || typeof state !== "object" || !state.remoteRun?.scanId) return null;
    return buildCompactState(state, state.storageHealth || null);
  }

  function migrationPlan(storageData, activeRunKey) {
    const state = storageData?.[activeRunKey];
    const legacyCacheKeys = Object.keys(storageData || {}).filter(key => key.startsWith("listing:"));
    const obsoleteKeys = Object.keys(storageData || {}).filter(key =>
      key.startsWith("searchSession:") ||
      key === "lastActiveSearchRouteKey" ||
      key === "activeSearchSession"
    );
    const migratedState = migrateActiveState(state);
    const changed = Boolean(
      legacyCacheKeys.length ||
      obsoleteKeys.length ||
      (state && state.version !== SCHEMA_VERSION) ||
      state?.results
    );
    return {
      changed,
      migratedState,
      keysToRemove: [...new Set([...legacyCacheKeys, ...obsoleteKeys])],
      removedLegacyCaches: legacyCacheKeys.length
    };
  }

  function isQuotaError(error) {
    return /quota|kQuotaBytes/i.test(error instanceof Error ? error.message : String(error));
  }

  async function writeWithQuotaRecovery(options) {
    const firstValue = options.buildValue();
    try {
      await options.write(firstValue);
      return { ok: true, retried: false, value: firstValue };
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      await options.onQuota?.(error);
    }

    await options.prune();
    const retryValue = options.buildValue();
    try {
      await options.write(retryValue);
      return { ok: true, retried: true, value: retryValue };
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      await options.onDegraded?.(error);
      return { ok: false, retried: true, degraded: true, error };
    }
  }

  function recordCount(value) {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === "object") return Object.keys(value).length;
    return value === undefined ? 0 : 1;
  }

  function nestedRecordSizes(value) {
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).map(([id, record]) => ({ id, bytes: utf8Bytes(record) }));
  }

  function collectMetrics(value, path = "", metrics = null) {
    const output = metrics || {
      imageUrlCount: 0,
      imageUrlBytes: 0,
      descriptionBytes: 0,
      diagnosticsBytes: 0,
      completedWorkBytes: 0
    };
    if (typeof value === "string") {
      const bytes = utf8Bytes(value);
      if (IMAGE_KEY_PATTERN.test(path) && /^https?:/i.test(value)) {
        output.imageUrlCount += 1;
        output.imageUrlBytes += bytes;
      }
      if (DESCRIPTION_KEY_PATTERN.test(path)) output.descriptionBytes += bytes;
      return output;
    }
    if (!value || typeof value !== "object") return output;
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (/diagnostic/i.test(key)) output.diagnosticsBytes += utf8Bytes(child);
      if (/^(matched|rejected|unavailable)$/.test(String(child?.status || ""))) {
        output.completedWorkBytes += utf8Bytes(child);
      }
      collectMetrics(child, childPath, output);
    }
    return output;
  }

  function listingIdsForStructure(value) {
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).map(([key, item]) => String(item?.externalListingId || item?.listingId || key));
  }

  function pruningPolicyForKey(key) {
    if (SENSITIVE_KEY_PATTERN.test(key) || key === "dashboardUrl") return "preserve configuration";
    if (key.startsWith("listing:")) return "remove legacy full-result cache";
    if (/activeRun/.test(key)) return "compact; prune payload after upload";
    if (key === "runtimeProgress") return "replace aggregate status";
    return "unrelated/preserved";
  }

  function measureStorageData(storageData = {}) {
    const rows = [];
    const nestedCollections = [];
    const allListingOccurrences = new Map();
    let totalBytes = 0;
    let pendingUploadBytes = 0;
    let largestRecordBytes = 0;
    let listingRecordBytes = [];

    for (const [key, value] of Object.entries(storageData)) {
      const bytes = approximateStorageItemBytes(key, value);
      const nested = nestedRecordSizes(value);
      const largest = nested.reduce((maximum, item) => Math.max(maximum, item.bytes), 0);
      totalBytes += bytes;
      largestRecordBytes = Math.max(largestRecordBytes, largest);
      const activeRun = /activeRun/.test(key);
      const activeListingIds = activeRun
        ? new Set(["ledger", "results", "pendingUploads"].flatMap(structure =>
            listingIdsForStructure(value?.[structure])
          ))
        : null;
      rows.push({
        key: SENSITIVE_KEY_PATTERN.test(key) ? "[sensitive configuration]" : key,
        records: activeRun ? activeListingIds.size : recordCount(value),
        bytes,
        largestRecordBytes: largest,
        pruningPolicy: pruningPolicyForKey(key)
      });

      if (activeRun) {
        for (const structure of ["ledger", "results", "pendingUploads"]) {
          const records = value?.[structure];
          const sizes = nestedRecordSizes(records);
          nestedCollections.push({
            path: `${key}.${structure}`,
            records: sizes.length,
            bytes: utf8Bytes(records || {}),
            largestRecordBytes: sizes.reduce((maximum, item) => Math.max(maximum, item.bytes), 0)
          });
          for (const id of listingIdsForStructure(records)) {
            if (!allListingOccurrences.has(id)) allListingOccurrences.set(id, new Set());
            allListingOccurrences.get(id).add(`${key}.${structure}`);
          }
          listingRecordBytes.push(...nestedRecordSizes(records).map(item => item.bytes));
        }
        pendingUploadBytes += utf8Bytes(value?.pendingUploads || {});
      } else if (key.startsWith("listing:")) {
        const id = key.slice("listing:".length);
        if (!allListingOccurrences.has(id)) allListingOccurrences.set(id, new Set());
        allListingOccurrences.get(id).add("listing cache");
        listingRecordBytes.push(utf8Bytes(value));
      }
    }

    const metrics = collectMetrics(storageData);
    const duplicateListingIds = [...allListingOccurrences.values()]
      .filter(locations => locations.size > 1).length;
    rows.sort((left, right) => right.bytes - left.bytes);
    nestedCollections.sort((left, right) => right.bytes - left.bytes);

    return {
      totalBytes,
      softLimitBytes: SOFT_LIMIT_BYTES,
      rows,
      largestCollections: nestedCollections.slice(0, 10),
      largestRecordBytes,
      averageListingBytes: listingRecordBytes.length
        ? Math.round(listingRecordBytes.reduce((sum, bytes) => sum + bytes, 0) / listingRecordBytes.length)
        : 0,
      maximumListingBytes: Math.max(0, ...listingRecordBytes),
      duplicateListingIds,
      pendingUploadBytes,
      ...metrics
    };
  }

  function redactForDiagnostics(value, key = "") {
    if (SENSITIVE_KEY_PATTERN.test(key)) return "[redacted]";
    if (typeof value === "string") {
      if (DESCRIPTION_KEY_PATTERN.test(key)) return `[redacted ${utf8Bytes(value)} bytes]`;
      if (/url/i.test(key)) return `[redacted URL ${utf8Bytes(value)} bytes]`;
      return value.slice(0, 120);
    }
    if (Array.isArray(value)) return value.map(item => redactForDiagnostics(item, key));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      redactForDiagnostics(child, childKey)
    ]));
  }

  return {
    MAX_COMPLETED_MARKERS,
    MAX_IMAGE_URLS,
    MAX_LIFECYCLE_DIAGNOSTICS,
    SCHEMA_VERSION,
    SOFT_LIMIT_BYTES,
    approximateStorageItemBytes,
    buildCompactState,
    compactLedger,
    compactPendingUploads,
    isQuotaError,
    measureStorageData,
    migrateActiveState,
    migrationPlan,
    normaliseImageUrls,
    redactForDiagnostics,
    sanitisePendingUpload,
    utf8Bytes,
    writeWithQuotaRecovery
  };
});
