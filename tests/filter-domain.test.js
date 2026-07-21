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
  assert.equal(config.category.mode, "clean_only");
  assert.equal(config.unknownPolicies.mileage, "inspect_then_reject");
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
