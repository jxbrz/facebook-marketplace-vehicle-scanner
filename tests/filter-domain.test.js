const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Catalogue = require("../vehicle-catalogue.js");
const Facts = require("../listing-facts.js");
const Filters = require("../filter-domain.js");

function facts(overrides = {}) {
  return Facts.normaliseListingFacts({
    title: "2018 Volkswagen Polo SE",
    description: "HPI clear. Full service history.",
    price: 6500,
    mileage: 70000,
    year: 2018,
    transmission: "manual",
    fuelType: "petrol",
    colour: "black",
    bodyType: "hatchback",
    ...overrides
  });
}

function evaluate(config, overrides = {}, phase = "final") {
  return Filters.evaluateFilters(facts(overrides), config, { phase });
}

test("legacy searches normalise safely into schema version 2", () => {
  const config = Filters.normaliseFilterConfig({ acceptedMakes: ["VW"], acceptedModels: ["Polo"], maxMileage: 75000, excludedCategories: ["S", "N", "C", "D"] });
  assert.equal(config.filterSchemaVersion, 2);
  assert.deepEqual(config.vehicle.makes, ["Volkswagen"]);
  assert.deepEqual(config.vehicle.models, ["Polo"]);
  assert.equal(config.priceMileage.maxMileage, 75000);
  assert.equal(config.category.mode, "selected");
  assert.deepEqual(config.category.statuses, ["clean", "other", "unknown"]);
  assert.equal(config.unknownPolicies.mileage, "inspect_then_reject");
  assert.equal(evaluate(config, { description: "No category statement", category: null }).decision, "match");
  assert.equal(evaluate(config, { description: "Cat S", category: "S", categoryDetected: true }).decision, "reject");
});

test("vehicle catalogue matches the dashboard mirror checksum", () => {
  assert.equal(Catalogue.CATALOGUE_VERSION, "uk-core-2026-07-v1");
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(Catalogue.CATALOGUE)).digest("hex"), "08a45ab07d9cb37ec894783725a0774cf6772407f95e848141e11ff7a4e0c627");
});

test("enforces every numeric boundary including minimum mileage", () => {
  const config = { vehicle: { minYear: 2018, maxYear: 2020 }, priceMileage: { minPrice: 6000, maxPrice: 7000, minMileage: 60000, maxMileage: 70000 }, category: { mode: "any" } };
  assert.equal(evaluate(config).decision, "match");
  assert.match(evaluate(config, { mileage: 70001 }).rejectionReasons[0], /exceeds maximum 70,000 miles/);
  assert.match(evaluate(config, { mileage: 59999 }).rejectionReasons[0], /below minimum 60,000 miles/);
  assert.equal(evaluate(config, { price: 7000, year: 2020 }).decision, "match");
  assert.equal(evaluate(config, { price: 7001 }).decision, "reject");
  assert.equal(evaluate(config, { year: 2017 }).decision, "reject");
});

test("multiple makes and models use canonical dependent selections", () => {
  const config = { vehicle: { makes: ["VW", "Audi"], models: ["Polo", "A3"] }, category: { mode: "any" } };
  assert.equal(evaluate(config).decision, "match");
  assert.match(evaluate(config, { title: "2018 Volkswagen Golf", make: null, model: null }).rejectionReasons.join(" "), /Model Golf is not selected/);
  assert.equal(Catalogue.isModelCompatible("Golf", ["Audi"]), false);
  assert.equal(Catalogue.isModelCompatible("A3", ["Audi"]), true);
});

test("Other / manual matches only makes outside the curated catalogue", () => {
  const config = { vehicle: { makes: [Catalogue.OTHER_MAKE] }, category: { mode: "any" } };
  assert.equal(evaluate(config, { make: "Saab", model: "9-3", title: "2010 Saab 9-3" }).decision, "match");
  assert.equal(evaluate(config, { make: "Volkswagen", model: "Polo" }).decision, "reject");
});

test("unknown mileage always requires detail inspection before policy is applied", () => {
  const strict = { priceMileage: { maxMileage: 70000 }, category: { mode: "any" } };
  const prefilter = evaluate(strict, { mileage: null }, "prefilter");
  assert.equal(prefilter.decision, "unresolved");
  assert.match(prefilter.unresolvedReasons[0], /detail inspection required/);
  const final = evaluate(strict, { mileage: null });
  assert.equal(final.decision, "reject");
  assert.match(final.rejectionReasons[0], /unavailable after detail inspection/);

  const warning = evaluate({ ...strict, unknownPolicies: { mileage: "include_with_warning" } }, { mileage: null });
  assert.equal(warning.decision, "match");
  assert.match(warning.warnings[0], /Mileage unavailable/);
  assert.equal(evaluate({ ...strict, unknownPolicies: { mileage: "exclude" } }, { mileage: null }).decision, "reject");
  const ignored = evaluate({ ...strict, unknownPolicies: { mileage: "ignore_filter_for_unknown" } }, { mileage: null });
  assert.equal(ignored.decision, "match");
  assert.match(ignored.warnings[0], /filter ignored by saved-search policy/);
});

test("supports clean-only, category-only and selected category combinations", () => {
  assert.equal(evaluate({ category: { mode: "clean_only" } }).decision, "match");
  assert.equal(evaluate({ category: { mode: "clean_only" } }, { description: "Cat N repaired", category: "N", categoryDetected: true }).decision, "reject");
  assert.equal(evaluate({ category: { mode: "category_only", includeRepairedVehicles: true } }, { description: "Cat S repaired", category: "S", categoryDetected: true }).decision, "match");
  assert.equal(evaluate({ category: { mode: "selected", statuses: ["clean", "cat_n"], includeRepairedVehicles: true } }, { description: "Cat N repaired", category: "N", categoryDetected: true }).decision, "match");
  assert.equal(evaluate({ category: { mode: "selected", statuses: ["cat_s"] } }, { description: "Cat N repaired", category: "N", categoryDetected: true }).decision, "reject");
  assert.equal(evaluate({ category: { mode: "selected", statuses: ["unknown"] } }, { description: "No category statement", category: null }).decision, "match");
});

test("keeps repaired-description handling distinct from confirmed category status", () => {
  const repaired = { description: "HPI clear and professionally repaired", categoryStatus: "clean" };
  const excluded = evaluate({ category: { mode: "any", includeRepairedVehicles: false } }, repaired);
  assert.equal(excluded.decision, "reject");
  assert.match(excluded.rejectionReasons[0], /repaired vehicles are not included/);
  assert.equal(evaluate({ category: { mode: "any", includeRepairedVehicles: true } }, repaired).decision, "match");
});

test("evaluates specification inclusion and exclusion with explicit reasons", () => {
  const config = { category: { mode: "any" }, specification: {
    transmissions: { include: ["manual"] }, fuelTypes: { include: ["petrol"], exclude: ["diesel"] },
    colours: { include: ["black", "blue"] }, bodyTypes: { exclude: ["suv"] }
  } };
  assert.equal(evaluate(config).decision, "match");
  assert.match(evaluate(config, { fuelType: "diesel" }).rejectionReasons.join(" "), /Fuel type diesel/);
  assert.match(evaluate(config, { colour: "red" }).rejectionReasons.join(" "), /Colour red is not selected/);
  assert.match(evaluate(config, { bodyType: "SUV" }).rejectionReasons.join(" "), /Body type suv is excluded/);
});

test("normalizes multiple three-state values and applies explicit Unknown choices", () => {
  const config = Filters.normaliseFilterConfig({ specification: {
    transmissions: { include: ["manual", "automatic", "unknown"], exclude: ["manual", "other"] },
    fuelTypes: { exclude: ["unknown"] }
  } });
  assert.deepEqual(config.specification.transmissions.include, ["manual", "automatic", "unknown"]);
  assert.deepEqual(config.specification.transmissions.exclude, ["other"]);
  assert.equal(Filters.evaluateFilters({ ...facts(), transmission: "unknown" }, config).decision, "match");
  assert.equal(Filters.evaluateFilters({ ...facts(), fuelType: "unknown" }, config).decision, "reject");
});

test("explicit Unknown exclusion is phase-safe", () => {
  const config = Filters.normaliseFilterConfig({
    advancedFiltersEnabled: true,
    specification: { fuelTypes: { exclude: ["unknown"] } }
  });
  const card = Filters.evaluateFilters({ ...facts(), fuelType: "unknown" }, config, { phase: "prefilter" });
  assert.equal(card.decision, "unresolved");
  assert.equal(card.detailRequired, true);
  assert.equal(card.provenReject, false);
  assert.equal(Filters.evaluateFilters({ ...facts(), fuelType: "unknown" }, config, { phase: "final" }).decision, "reject");
});

test("Advanced activation preserves stored values but controls their effect", () => {
  const enabled = Filters.normaliseFilterConfig({
    specification: { fuelTypes: { exclude: ["diesel"] }, colours: { exclude: ["unknown"] } },
    text: { requiredKeywords: ["service history"] }
  });
  assert.equal(enabled.advancedFiltersEnabled, true);
  const disabled = Filters.normaliseFilterConfig({ ...enabled, advancedFiltersEnabled: false });
  assert.deepEqual(disabled.specification.fuelTypes.exclude, ["diesel"]);
  assert.deepEqual(disabled.text.requiredKeywords, ["service history"]);
  assert.equal(evaluate(disabled, { fuelType: "diesel", colour: null, description: "No history" }).decision, "match");
  assert.equal(evaluate({ ...disabled, advancedFiltersEnabled: true }, { fuelType: "diesel", description: "No history" }).decision, "reject");
});

test("new defaults disable Advanced and include unavailable optional information", () => {
  const config = Filters.normaliseFilterConfig({});
  assert.equal(config.advancedFiltersEnabled, false);
  assert.equal(config.includeUnavailableOptional, true);
  assert.deepEqual(config.specification.transmissions, { mode: "any", include: [], exclude: [] });
  assert.equal(config.category.mode, "any");
});

test("card-only fixture proceeds to detail and reaches a final match", () => {
  const config = Filters.normaliseFilterConfig({
    vehicle: { makes: ["Volkswagen"], models: ["Polo"] },
    priceMileage: { maxMileage: 80000 },
    advancedFiltersEnabled: true,
    text: { requiredKeywords: ["service history"] }
  });
  const cardFacts = facts({ description: null, mileage: null });
  const prefilter = Filters.evaluateFilters(cardFacts, config, { phase: "prefilter" });
  assert.equal(prefilter.decision, "unresolved");
  assert.equal(prefilter.detailRequired, true);
  const detailFacts = facts({ description: "Full service history", mileage: 70000 });
  assert.equal(Filters.evaluateFilters(detailFacts, config, { phase: "final" }).decision, "match");
});

test("category-only and selected category wait for detail evidence", () => {
  const categoryOnly = evaluate({ category: { mode: "category_only", includeRepairedVehicles: true } }, { categoryStatus: null, description: null }, "prefilter");
  assert.equal(categoryOnly.decision, "unresolved");
  assert.equal(categoryOnly.provenReject, false);
  const selected = evaluate({ category: { mode: "selected", statuses: ["cat_n"], includeRepairedVehicles: true } }, { categoryStatus: null, description: null }, "prefilter");
  assert.equal(selected.decision, "unresolved");
  assert.equal(evaluate({ category: { mode: "selected", statuses: ["cat_n"], includeRepairedVehicles: true } }, { categoryStatus: "cat_n" }).decision, "match");
});

test("required keyword absence waits for detail but positive exclusions remain proven", () => {
  const required = { advancedFiltersEnabled: true, text: { requiredKeywords: ["service history"] } };
  const card = evaluate(required, { description: null, cardText: "2018 Volkswagen Polo" }, "prefilter");
  assert.equal(card.decision, "unresolved");
  assert.equal(card.detailRequired, true);
  assert.equal(evaluate(required, { description: "Full service history" }).decision, "match");
  assert.equal(evaluate(required, { description: "One owner" }).decision, "reject");
  const excluded = evaluate({ text: { excludedKeywords: ["spares or repair"] } }, { cardText: "Spares or repair" }, "prefilter");
  assert.equal(excluded.decision, "reject");
  assert.equal(excluded.provenReject, true);
  assert.equal(excluded.detailRequired, false);
});

test("definite numeric failures remain eligible for early rejection", () => {
  const result = evaluate({ priceMileage: { maxPrice: 6000 } }, { price: 6500, mileage: null }, "prefilter");
  assert.equal(result.decision, "reject");
  assert.equal(result.provenReject, true);
  assert.equal(result.detailRequired, false);
});

test("ambiguous card model waits for detail while reliable identity can reject", () => {
  const config = { vehicle: { makes: ["Volkswagen"], models: ["Polo"] } };
  const ambiguous = facts({
    title: "2018 Volkswagen car",
    make: "Volkswagen",
    model: "car",
    sources: { make: "card_title", model: "card_title" },
    confidence: { make: "moderate", model: "low" }
  });
  const deferred = Filters.evaluateFilters(ambiguous, config, { phase: "prefilter" });
  assert.equal(deferred.decision, "unresolved");
  assert.match(deferred.unresolvedReasons.join(" "), /Model evidence is uncertain/);
  const reliable = facts({
    title: "2018 Volkswagen Golf",
    make: "Volkswagen",
    model: "Golf",
    sources: { make: "search_card_reliable", model: "search_card_reliable" },
    confidence: { make: "high", model: "high" }
  });
  assert.equal(Filters.evaluateFilters(reliable, config, { phase: "prefilter" }).decision, "reject");
});

test("Transmission remains Core and missing card transmission is phase-safe", () => {
  const config = { specification: { transmissions: { include: ["automatic"] } } };
  const card = evaluate(config, { transmission: null }, "prefilter");
  assert.equal(card.decision, "unresolved");
  assert.equal(evaluate(config, { transmission: "automatic" }).decision, "match");
  assert.equal(evaluate(config, { transmission: "manual" }).decision, "reject");
});

test("required and excluded keywords are combined deterministically", () => {
  const config = { category: { mode: "any" }, text: { requiredKeywords: ["service history"], excludedKeywords: ["spares or repair"] } };
  assert.equal(evaluate(config).decision, "match");
  const rejected = evaluate(config, { description: "Spares or repair only" });
  assert.equal(rejected.decision, "reject");
  assert.deepEqual(rejected.rejectionReasons, ["Required keyword “service history” was not found", "Excluded keyword “spares or repair” found"]);
});

test("invalid ranges and incompatible legacy models are normalized predictably", () => {
  const validation = Filters.validateFilterConfig({ vehicle: { minYear: 2020, maxYear: 2010 }, category: { mode: "selected", statuses: [] } });
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.length, 2);
  const config = Filters.normaliseFilterConfig({ vehicle: { makes: ["Audi"], models: ["Golf", "A3"] } });
  assert.deepEqual(config.vehicle.models, ["A3"]);
});
