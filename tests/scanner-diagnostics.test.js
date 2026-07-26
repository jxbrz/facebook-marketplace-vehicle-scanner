const test = require("node:test");
const assert = require("node:assert/strict");
const { create, median } = require("../scanner-diagnostics.js");

test("diagnostics stay inert unless the local debug flag enables them", () => {
  const diagnostics = create();
  diagnostics.recordListing("1", "discovered", 100);
  diagnostics.increment("duplicateSkipped");
  assert.equal(diagnostics.snapshot(), null);
});

test("diagnostics aggregate bounded stage, worker, target and scroll measurements", () => {
  const diagnostics = create({ enabled: true, maxListings: 2, maxScrolls: 2, workerCapacity: 2 });

  for (const [id, offset] of [["1", 0], ["2", 100]]) {
    diagnostics.recordListing(id, "idExtracted", 1000 + offset);
    diagnostics.recordListing(id, "cardMetadataStart", 1002 + offset);
    diagnostics.recordListing(id, "cardMetadataEnd", 1008 + offset);
    diagnostics.recordListing(id, "discovered", 1010 + offset);
    diagnostics.recordListing(id, "cheapFilterComplete", 1020 + offset);
    diagnostics.recordListing(id, "queued", 1030 + offset);
    diagnostics.recordListing(id, "processingStart", 1050 + offset);
    diagnostics.recordListing(id, "detailFetchStart", 1060 + offset);
    diagnostics.recordListing(id, "staticStart", 1060 + offset);
    diagnostics.recordListing(id, "staticEnd", 1090 + offset);
    diagnostics.recordListing(id, "renderedStart", 1090 + offset);
    diagnostics.recordListing(id, "renderedEnd", 1160 + offset);
    diagnostics.recordListing(id, "detailFetchEnd", 1160 + offset);
    diagnostics.recordListing(id, "processingComplete", 1170 + offset);
    diagnostics.increment("discovered");
  }
  diagnostics.recordListing("3", "discovered", 5000);
  diagnostics.increment("duplicateSkipped");
  diagnostics.increment("retries", 2);
  diagnostics.increment("timeouts");
  diagnostics.increment("renderedAttempts", 2);
  diagnostics.increment("renderedTimeouts");
  diagnostics.increment("renderedSkippedStaticReject", 3);
  diagnostics.increment("renderedSkippedDecisionComplete", 4);
  diagnostics.increment("renderedRequiredDecisionIncomplete", 5);
  diagnostics.increment("renderedRequiredCanonicalEnrichment", 6);
  diagnostics.setGauges({ queueSize: 4, activeWorkers: 3, processed: 2 });
  diagnostics.recordScroll({ at: 2000, target: "window", beforeTop: 0, afterTop: 500, beforeHeight: 2000, afterHeight: 2500, newCards: 4 });
  diagnostics.recordScroll({ at: 3000, target: "window", beforeTop: 500, afterTop: 1000, beforeHeight: 2500, afterHeight: 3000, newCards: 2 });
  diagnostics.recordUpload(4000, 4120, 2, true);
  diagnostics.markTargetReached(2500);
  diagnostics.markCompleted(2520);

  assert.deepEqual(diagnostics.snapshot(), {
    enabled: true,
    listingSamples: 2,
    scrollSamples: 2,
    uploadSamples: 1,
    medianDiscoveryToQueueMs: 20,
    medianCardDiscoveryMs: 10,
    medianCardMetadataExtractionMs: 6,
    medianQueueWaitMs: 20,
    medianStaticExtractionMs: 30,
    medianRenderedExtractionMs: 70,
    medianDetailProcessingMs: 100,
    medianInspectedListingMs: 120,
    medianUploadMs: 120,
    medianSuccessfulScrollIntervalMs: 1000,
    duplicateRatio: 0.3333,
    cardsPerScroll: 3,
    workerUtilization: 0.5455,
    targetCompletionLatencyMs: 20,
    postTargetScrollCount: 1,
    counters: {
      discovered: 2,
      duplicateSkipped: 1,
      retries: 2,
      timeouts: 1,
      renderedAttempts: 2,
      renderedTimeouts: 1,
      renderedSkippedStaticReject: 3,
      renderedSkippedDecisionComplete: 4,
      renderedRequiredDecisionIncomplete: 5,
      renderedRequiredCanonicalEnrichment: 6
    },
    gauges: { queueSize: 4, activeWorkers: 3, processed: 2 },
    lastScroll: {
      at: 3000,
      target: "window",
      beforeTop: 500,
      afterTop: 1000,
      beforeHeight: 2500,
      afterHeight: 3000,
      newCards: 2
    }
  });
  assert.equal(median([5, 1, 3, 9]), 4);
});
