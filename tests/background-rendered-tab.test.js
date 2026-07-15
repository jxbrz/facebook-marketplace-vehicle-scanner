const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createHarness(sendMessage, overrides = {}) {
  const runtimeListeners = [];
  const created = [];
  const updated = [];
  const removed = [];
  const noOpEvent = { addListener() {}, removeListener() {} };
  const context = {
    AbortController,
    URL,
    clearTimeout,
    console,
    fetch: overrides.fetch || (async () => { throw new Error("Unexpected fetch"); }),
    importScripts() {},
    setTimeout(callback, delay) {
      if (delay < 1000) return queueMicrotask(callback);
      return setTimeout(callback, delay);
    },
    chrome: {
      runtime: { onMessage: { addListener(listener) { runtimeListeners.push(listener); } } },
      tabs: {
        async create(options) { created.push(options); return { id: 77 }; },
        async update(tabId, options) { updated.push({ tabId, options }); return { id: tabId }; },
        async get() { return { id: 77, status: "complete" }; },
        sendMessage,
        async remove(tabId) { removed.push(tabId); },
        onUpdated: noOpEvent,
        onRemoved: noOpEvent
      },
      storage: { local: {} }
    },
    CategoryDetector: overrides.CategoryDetector || {},
    ListingDetailsExtractor: overrides.ListingDetailsExtractor || {},
    PayloadNormalizer: {}
  };
  vm.runInNewContext(fs.readFileSync("background.js", "utf8"), context);
  return { context, created, updated, removed, runtimeListeners };
}

test("marks an inactive blank tab before navigation and always removes it after extraction", async () => {
  let resolveExtraction;
  const extractionResponse = new Promise(resolve => { resolveExtraction = resolve; });
  const harness = createHarness(() => extractionResponse);
  const inspection = harness.context.inspectRenderedListing(
    "https://www.facebook.com/marketplace/item/123/",
    "123"
  );
  await new Promise(resolve => setImmediate(resolve));

  let markerResponse;
  const returned = harness.runtimeListeners[0](
    { type: "IS_CONTROLLED_DETAIL_TAB" },
    { tab: { id: 77 } },
    response => { markerResponse = response; }
  );
  assert.equal(returned, false);
  assert.equal(markerResponse.ok, true);
  assert.equal(markerResponse.result, true);

  resolveExtraction({ ok: true, result: { fullDescription: "Rendered" } });
  assert.equal((await inspection).fullDescription, "Rendered");
  assert.equal(harness.created[0].url, "about:blank");
  assert.equal(harness.created[0].active, false);
  assert.equal(harness.updated[0].options.url, "https://www.facebook.com/marketplace/item/123/");
  assert.deepEqual(harness.removed, [77]);
});

test("removes the controlled tab when rendered messaging fails", async () => {
  const harness = createHarness(async () => ({ ok: false, error: "not ready" }));
  await assert.rejects(
    harness.context.inspectRenderedListing("https://www.facebook.com/marketplace/item/123/", "123"),
    /not ready/
  );
  assert.deepEqual(harness.removed, [77]);
});

test("run cancellation closes its controlled tab and prevents a rendered result", async () => {
  let resolveExtraction;
  const harness = createHarness(() => new Promise(resolve => { resolveExtraction = resolve; }));
  const inspection = harness.context.inspectRenderedListing(
    "https://www.facebook.com/marketplace/item/123/",
    "123",
    "run-1"
  );
  await new Promise(resolve => setImmediate(resolve));
  const cancelled = await harness.context.cancelScanInspections("run-1");
  assert.equal(cancelled.closedTabs, 1);
  resolveExtraction({ ok: true, result: { fullDescription: "Too late" } });
  await assert.rejects(inspection, /cancelled/);
  assert.ok(harness.removed.includes(77));
});

test("final background classification includes the rendered seller description", async () => {
  const realExtractor = require("../listing-details-extractor.js");
  const harness = createHarness(
    async () => ({
      ok: true,
      result: {
        fullDescription: "Cat S",
        listingTitle: "2018 Volkswagen Polo",
        vehicleAttributes: {},
        imageUrls: [],
        extractionSource: "rendered-semantic-dom"
      }
    }),
    {
      CategoryDetector: require("../category-detector.js"),
      ListingDetailsExtractor: {
        extractListingDetails() {
          return {
            fullDescription: "Well maintained",
            listingTitle: "2018 Volkswagen Polo",
            vehicleAttributes: {},
            imageUrls: [],
            extractionSource: "embedded-json",
            structuredDetailsFound: true
          };
        },
        mergeListingDetails: realExtractor.mergeListingDetails
      },
      fetch: async url => ({
        ok: true,
        url,
        async text() {
          return "<html><body>Marketplace listing 123 Volkswagen Polo</body></html>";
        }
      })
    }
  );

  const result = await harness.context.inspectListing(
    "https://www.facebook.com/marketplace/item/123/",
    "run-1"
  );
  assert.equal(result.fullDescription, "Cat S");
  assert.equal(result.detected, true);
  assert.equal(result.category, "S");
  assert.equal(result.source, "facebook-rendered-description");
  assert.equal(result.categoryClassificationDiagnostics.reclassifiedAfterRenderedExtraction, true);
});
