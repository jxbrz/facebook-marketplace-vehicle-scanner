const test = require("node:test");
const assert = require("node:assert/strict");

function loadStorage(initial = {}) {
  const values = { ...initial };
  global.FilterDomain = require("../filter-domain.js");
  global.chrome = {
    storage: {
      local: {
        async get(defaults) { return { ...defaults, ...values }; },
        async set(patch) { Object.assign(values, patch); }
      }
    }
  };
  delete require.cache[require.resolve("../settings-storage.js")];
  return { storage: require("../settings-storage.js"), values };
}

test("dashboard activation and local activation select one canonical source", async () => {
  const { storage, values } = loadStorage({ localFilterDraft: null });
  await storage.activateDashboardSearch({ id: "search-1", filters: { vehicle: { makes: ["VW"] } } });
  assert.equal(values.activeSavedSearchId, "search-1");
  assert.deepEqual(values.activeFilterConfig.vehicle.makes, ["Volkswagen"]);
  await storage.saveLocalDraft({ priceMileage: { maxPrice: 7000 } });
  assert.equal(values.activeSavedSearchId, null);
  assert.equal(values.activeFilterConfig.priceMileage.maxPrice, 7000);
  assert.equal(values.localFilterDraft.priceMileage.maxPrice, 7000);
});

test("local drafts preserve disabled Advanced values", async () => {
  const { storage, values } = loadStorage();
  await storage.saveLocalDraft({
    advancedFiltersEnabled: false,
    specification: { fuelTypes: { exclude: ["diesel"] } },
    text: { requiredKeywords: ["history"] }
  });
  assert.equal(values.localFilterDraft.advancedFiltersEnabled, false);
  assert.deepEqual(values.localFilterDraft.specification.fuelTypes.exclude, ["diesel"]);
  assert.deepEqual(values.localFilterDraft.text.requiredKeywords, ["history"]);
});

test("one-time compatibility migration restores legacy category exclusion semantics for local drafts", async () => {
  const cleanOnly = { category: { mode: "clean_only" } };
  const { storage, values } = loadStorage({
    activeSavedSearchId: null,
    activeFilterConfig: cleanOnly,
    localFilterDraft: cleanOnly,
    filterCompatibilityVersion: 0,
    extensionApiToken: "preserved-token",
    dashboardUrl: "https://review.example.test"
  });

  const loaded = await storage.load();
  assert.equal(loaded.filterCompatibilityVersion, storage.FILTER_COMPATIBILITY_VERSION);
  assert.equal(loaded.activeFilterConfig.category.mode, "selected");
  assert.deepEqual(loaded.activeFilterConfig.category.statuses, ["clean", "other", "unknown"]);
  assert.equal(values.localFilterDraft.category.mode, "selected");
  assert.equal(values.extensionApiToken, "preserved-token");
  assert.equal(values.dashboardUrl, "https://review.example.test");
});

test("completed compatibility migration preserves an explicitly selected clean-only local draft", async () => {
  const { storage } = loadStorage({
    activeSavedSearchId: null,
    activeFilterConfig: { category: { mode: "clean_only" } },
    localFilterDraft: { category: { mode: "clean_only" } },
    filterCompatibilityVersion: 1
  });
  const loaded = await storage.load();
  assert.equal(loaded.activeFilterConfig.category.mode, "clean_only");
  assert.equal(loaded.localFilterDraft.category.mode, "clean_only");
});

test("compatibility migration never changes the active dashboard-managed search", async () => {
  const { storage } = loadStorage({
    activeSavedSearchId: "search-1",
    activeFilterConfig: { category: { mode: "clean_only" } },
    localFilterDraft: { category: { mode: "clean_only" } },
    filterCompatibilityVersion: 0
  });
  const loaded = await storage.load();
  assert.equal(loaded.activeFilterConfig.category.mode, "clean_only");
  assert.equal(loaded.localFilterDraft.category.mode, "selected");
});
