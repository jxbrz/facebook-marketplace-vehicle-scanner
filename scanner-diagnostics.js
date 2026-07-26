(function initialiseScannerDiagnostics(root, factory) {
  const diagnostics = factory();
  if (typeof module === "object" && module.exports) module.exports = diagnostics;
  root.ScannerDiagnostics = diagnostics;
})(typeof globalThis === "object" ? globalThis : this, function createScannerDiagnosticsModule() {
  "use strict";

  const LISTING_EVENT_NAMES = new Set([
    "discovered",
    "idExtracted",
    "cardMetadataStart",
    "cardMetadataEnd",
    "cheapFilterComplete",
    "queued",
    "processingStart",
    "detailFetchStart",
    "staticStart",
    "staticEnd",
    "renderedStart",
    "renderedEnd",
    "detailFetchEnd",
    "processingComplete"
  ]);

  function median(values) {
    const sorted = values
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? Math.round(sorted[middle])
      : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }

  function durationBetween(records, startKey, endKey) {
    return records
      .map(record => Number(record[endKey]) - Number(record[startKey]))
      .filter(value => Number.isFinite(value) && value >= 0);
  }

  function create(options = {}) {
    const enabled = options.enabled === true;
    const maxListings = Math.max(1, Number(options.maxListings) || 520);
    const maxScrolls = Math.max(1, Number(options.maxScrolls) || 100);
    const workerCapacity = Math.max(1, Number(options.workerCapacity) || 1);
    const listings = new Map();
    const scrolls = [];
    const uploads = [];
    const counters = {
      discovered: 0,
      duplicateSkipped: 0,
      retries: 0,
      timeouts: 0,
      renderedAttempts: 0,
      renderedTimeouts: 0,
      renderedSkippedStaticReject: 0,
      renderedSkippedDecisionComplete: 0,
      renderedRequiredDecisionIncomplete: 0,
      renderedRequiredCanonicalEnrichment: 0
    };
    let targetReachedAt = null;
    let completedAt = null;
    const gauges = {
      queueSize: 0,
      activeWorkers: 0,
      processed: 0
    };

    function recordListing(listingId, event, at = Date.now()) {
      if (!enabled || !LISTING_EVENT_NAMES.has(event)) return;
      const id = String(listingId || "");
      if (!id) return;
      let record = listings.get(id);
      if (!record) {
        if (listings.size >= maxListings) return;
        record = { listingId: id };
        listings.set(id, record);
      }
      if (!Number.isFinite(record[event])) record[event] = Number(at);
    }

    function increment(name, amount = 1) {
      if (!enabled || !Object.hasOwn(counters, name)) return;
      counters[name] += Math.max(0, Number(amount) || 0);
    }

    function setGauges(next = {}) {
      if (!enabled) return;
      for (const name of Object.keys(gauges)) {
        if (Number.isFinite(Number(next[name]))) gauges[name] = Math.max(0, Number(next[name]));
      }
    }

    function recordScroll(attempt = {}) {
      if (!enabled) return;
      scrolls.push({
        at: Number(attempt.at) || Date.now(),
        target: String(attempt.target || "unknown").slice(0, 120),
        beforeTop: Number(attempt.beforeTop) || 0,
        afterTop: Number(attempt.afterTop) || 0,
        beforeHeight: Number(attempt.beforeHeight) || 0,
        afterHeight: Number(attempt.afterHeight) || 0,
        newCards: Math.max(0, Number(attempt.newCards) || 0)
      });
      if (scrolls.length > maxScrolls) scrolls.splice(0, scrolls.length - maxScrolls);
    }

    function recordUpload(startedAt, endedAt, count, succeeded) {
      if (!enabled) return;
      uploads.push({
        startedAt: Number(startedAt),
        endedAt: Number(endedAt),
        count: Math.max(0, Number(count) || 0),
        succeeded: succeeded === true
      });
      if (uploads.length > maxScrolls) uploads.splice(0, uploads.length - maxScrolls);
    }

    function markTargetReached(at = Date.now()) {
      if (!enabled || targetReachedAt !== null) return;
      targetReachedAt = Number(at) || Date.now();
    }

    function markCompleted(at = Date.now()) {
      if (!enabled || completedAt !== null) return;
      completedAt = Number(at) || Date.now();
    }

    function snapshot() {
      if (!enabled) return null;
      const records = [...listings.values()];
      const successfulScrolls = scrolls.filter(scroll => scroll.newCards > 0);
      const successfulIntervals = successfulScrolls.slice(1).map((scroll, index) =>
        scroll.at - successfulScrolls[index].at
      );
      const uploadDurations = uploads
        .filter(upload => upload.succeeded)
        .map(upload => upload.endedAt - upload.startedAt)
        .filter(value => Number.isFinite(value) && value >= 0);
      const duplicateDenominator = counters.discovered + counters.duplicateSkipped;
      const workerDurations = durationBetween(records, "processingStart", "processingComplete");
      const workerWindowStart = Math.min(...records.map(record => Number(record.processingStart)).filter(Number.isFinite));
      const workerWindowEnd = Math.max(...records.map(record => Number(record.processingComplete)).filter(Number.isFinite));
      const workerWindowMs = Number.isFinite(workerWindowStart) && Number.isFinite(workerWindowEnd)
        ? Math.max(0, workerWindowEnd - workerWindowStart)
        : 0;
      const workerBusyMs = workerDurations.reduce((total, value) => total + value, 0);

      return {
        enabled: true,
        listingSamples: records.length,
        scrollSamples: scrolls.length,
        uploadSamples: uploads.length,
        medianDiscoveryToQueueMs: median(durationBetween(records, "discovered", "queued")),
        medianCardDiscoveryMs: median(durationBetween(records, "idExtracted", "discovered")),
        medianCardMetadataExtractionMs: median(durationBetween(records, "cardMetadataStart", "cardMetadataEnd")),
        medianQueueWaitMs: median(durationBetween(records, "queued", "processingStart")),
        medianStaticExtractionMs: median(durationBetween(records, "staticStart", "staticEnd")),
        medianRenderedExtractionMs: median(durationBetween(records, "renderedStart", "renderedEnd")),
        medianDetailProcessingMs: median(durationBetween(records, "detailFetchStart", "detailFetchEnd")),
        medianInspectedListingMs: median(durationBetween(records, "processingStart", "processingComplete")),
        medianUploadMs: median(uploadDurations),
        medianSuccessfulScrollIntervalMs: median(successfulIntervals),
        duplicateRatio: duplicateDenominator
          ? Number((counters.duplicateSkipped / duplicateDenominator).toFixed(4))
          : 0,
        cardsPerScroll: scrolls.length
          ? Number((scrolls.reduce((total, scroll) => total + scroll.newCards, 0) / scrolls.length).toFixed(2))
          : 0,
        workerUtilization: workerWindowMs
          ? Number(Math.min(1, workerBusyMs / (workerWindowMs * workerCapacity)).toFixed(4))
          : null,
        targetCompletionLatencyMs: targetReachedAt === null || completedAt === null
          ? null
          : Math.max(0, completedAt - targetReachedAt),
        postTargetScrollCount: targetReachedAt === null
          ? 0
          : scrolls.filter(scroll => scroll.at > targetReachedAt).length,
        counters: { ...counters },
        gauges: { ...gauges },
        lastScroll: scrolls.at(-1) || null
      };
    }

    return {
      enabled,
      increment,
      markCompleted,
      markTargetReached,
      recordListing,
      recordScroll,
      recordUpload,
      setGauges,
      snapshot
    };
  }

  return { create, median };
});
