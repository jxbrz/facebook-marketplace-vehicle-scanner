const test = require("node:test");
const assert = require("node:assert/strict");
const Facts = require("../listing-facts.js");

test("normalises core numeric facts without guessing invalid values", () => {
  const facts = Facts.normaliseListingFacts({ price: "£5,995", mileage: "73.2k miles", year: "2015 Volkswagen Polo" });
  assert.equal(facts.price, 5995);
  assert.equal(facts.mileage, 73200);
  assert.equal(facts.year, 2015);
  assert.equal(Facts.parsePrice("price on application"), null);
  assert.equal(Facts.parseMileage("mileage unknown"), null);
  assert.equal(Facts.parseYear("historic vehicle"), null);
});

test("canonicalises vehicle identity aliases and dependent models", () => {
  const facts = Facts.normaliseListingFacts({ title: "2018 VW Polo 1.0 TSI" });
  assert.equal(facts.make, "Volkswagen");
  assert.equal(facts.model, "Polo");
  assert.equal(facts.sources.make, "listing_title");
});

test("normalises specification fields and retains their raw values", () => {
  const facts = Facts.normaliseListingFacts({
    transmission: "7 speed DSG semi auto",
    fuelType: "Plug-in Hybrid (Petrol)",
    colour: "Metallic Black",
    bodyStyle: "Sport Utility Vehicle"
  });
  assert.equal(facts.transmission, "semiautomatic");
  assert.equal(facts.fuelType, "plug-in hybrid");
  assert.equal(facts.colour, "black");
  assert.equal(facts.bodyType, "suv");
  assert.equal(facts.rawValues.colour, "Metallic Black");
});

test("treats absent category evidence as unknown and only explicit clear evidence as clean", () => {
  const absent = Facts.normaliseListingFacts({ title: "Volkswagen Polo" });
  assert.equal(absent.categoryStatus, "unknown");
  assert.equal(absent.categoryEvidenceState, "no_category_evidence");
  const clear = Facts.normaliseListingFacts({ description: "HPI clear with report" });
  assert.equal(clear.categoryStatus, "clean");
  assert.equal(clear.categoryEvidenceState, "confirmed_clean");
  const category = Facts.normaliseListingFacts({ category: "N", categoryDetected: true, categoryEvidence: "Cat N repaired" });
  assert.equal(category.categoryStatus, "cat_n");
  assert.equal(category.categoryEvidenceState, "confirmed_category");
  assert.equal(category.categoryEvidence, "Cat N repaired");
  assert.equal(category.repairedVehicle, true);
  assert.equal(Facts.normaliseListingFacts({ description: "Requires a repair" }).repairedVehicle, false);
});

test("keeps explicit category uncertainty separate from missing evidence", () => {
  const facts = Facts.normaliseListingFacts({
    categoryEvidenceState: "explicitly_unknown",
    categoryExplicitlyUnknown: true
  });
  assert.equal(facts.categoryStatus, "unknown");
  assert.equal(facts.categoryEvidenceState, "explicitly_unknown");
});

test("reports unknown fields explicitly", () => {
  const facts = Facts.normaliseListingFacts({ listingId: "123", title: "Vehicle for sale" });
  for (const field of ["price", "mileage", "year", "make", "model", "transmission", "fuelType", "colour", "bodyType", "categoryStatus"]) {
    assert.equal(facts.unknownFields.includes(field), true, field);
  }
});
