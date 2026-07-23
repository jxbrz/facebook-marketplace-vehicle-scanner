const test = require("node:test");
const assert = require("node:assert/strict");
const Facts = require("../listing-facts.js");
const Filters = require("../filter-domain.js");
const Policy = require("../scanner-decision-policy.js");

function cardFacts(overrides = {}) {
  return Facts.normaliseListingFacts({
    title: "2018 Volkswagen Polo",
    cardText: "2018 Volkswagen Polo £6,500",
    description: null,
    price: 6500,
    mileage: null,
    year: 2018,
    transmission: null,
    fuelType: null,
    categoryStatus: null,
    sources: {
      price: "search_card",
      mileage: "unknown",
      year: "search_card",
      make: "card_title",
      model: "card_title",
      transmission: "unknown",
      fuelType: "unknown",
      categoryStatus: "search_card",
      textCorpus: "search_card"
    },
    ...overrides
  });
}

function detailFacts(overrides = {}) {
  return cardFacts({
    description: "Full service history",
    mileage: 62000,
    transmission: "manual",
    fuelType: "petrol",
    sources: {
      price: "listing_detail",
      mileage: "listing_detail",
      year: "listing_detail",
      make: "listing_detail",
      model: "listing_detail",
      transmission: "listing_detail",
      fuelType: "listing_detail",
      categoryStatus: "trusted_listing_evidence",
      textCorpus: "listing_detail"
    },
    ...overrides
  });
}

test("normal unrestricted Core sends three incomplete cards through detail before matching", () => {
  const config = Filters.normaliseFilterConfig({
    advancedFiltersEnabled: false,
    includeUnavailableOptional: true,
    category: { mode: "any" },
    scan: { maximumProcessed: 3, targetMatches: 3, autoLoadEnabled: false }
  });
  for (const price of [4500, 6500, 8200]) {
    const prefilter = Filters.evaluateFilters(cardFacts({ price }), config, { phase: "prefilter" });
    assert.equal(Policy.cardFinalizationDecision(prefilter).action, "inspect_detail");
    const final = Filters.evaluateFilters(detailFacts({ price }), config, { phase: "final" });
    assert.equal(final.decision, "match");
  }
});

test("unknown category and missing card mileage can never prove a card rejection", () => {
  const config = Filters.normaliseFilterConfig({
    priceMileage: { maxMileage: 70000 },
    category: { mode: "clean_only" }
  });
  const evaluation = Filters.evaluateFilters(cardFacts(), config, { phase: "prefilter" });
  assert.equal(evaluation.decision, "unresolved");
  assert.equal(Policy.cardFinalizationDecision(evaluation).mayFinalize, false);
});

test("only a reliable known over-price card may reject before detail", () => {
  const config = Filters.normaliseFilterConfig({ priceMileage: { maxPrice: 6000 } });
  const evaluation = Filters.evaluateFilters(cardFacts(), config, { phase: "prefilter" });
  assert.deepEqual(evaluation.rejectionReasonCodes, ["price_above_maximum"]);
  assert.equal(Policy.cardFinalizationDecision(evaluation).mayFinalize, true);
});

test("unknown, optional and non-allow-listed reasons cannot bypass detail", () => {
  for (const evaluation of [
    {
      decision: "reject", provenReject: true, detailRequired: false,
      rejectionReasons: ["Mileage unavailable"], rejectionReasonCodes: ["mileage_unavailable"],
      rejectionEvidence: [{ code: "mileage_unavailable", field: "mileage", source: "unknown", confidence: "unknown", valueKnown: false }]
    },
    {
      decision: "reject", provenReject: true, detailRequired: false,
      rejectionReasons: ["Transmission manual is not selected"], rejectionReasonCodes: ["transmission_not_selected"],
      rejectionEvidence: [{ code: "transmission_not_selected", field: "transmission", source: "search_card", confidence: "moderate", valueKnown: true }]
    }
  ]) assert.equal(Policy.cardFinalizationDecision(evaluation).mayFinalize, false);
});

test("structured reason codes and provenance must cover every rejection", () => {
  const incomplete = {
    decision: "reject", provenReject: true, detailRequired: false,
    rejectionReasons: ["Price too high", "Unknown category"],
    rejectionReasonCodes: ["price_above_maximum"],
    rejectionEvidence: [{ code: "price_above_maximum", field: "price", source: "search_card", confidence: "moderate", valueKnown: true }]
  };
  assert.equal(Policy.cardFinalizationDecision(incomplete).mayFinalize, false);
});

test("reliable static detail rejection skips rendered extraction", () => {
  const config = Filters.normaliseFilterConfig({ priceMileage: { maxMileage: 50000 } });
  const evaluation = Filters.evaluateFilters(detailFacts({ mileage: 62000 }), config, { phase: "final" });
  assert.equal(evaluation.decision, "reject");
  assert.deepEqual(
    Policy.staticDetailFinalizationDecision(evaluation),
    {
      mayFinalize: true,
      action: "finalize_static_reject",
      reasonCodes: ["mileage_above_maximum"]
    }
  );
});

test("rendered extraction remains required for unresolved active facts and potential matches", () => {
  for (const evaluation of [
    {
      decision: "unresolved",
      provenReject: false,
      detailRequired: true,
      rejectionReasons: [],
      rejectionReasonCodes: [],
      rejectionEvidence: []
    },
    {
      decision: "match",
      provenReject: false,
      detailRequired: false,
      rejectionReasons: [],
      rejectionReasonCodes: [],
      rejectionEvidence: []
    },
    {
      decision: "reject",
      provenReject: true,
      detailRequired: false,
      rejectionReasons: ["Required description keyword missing"],
      rejectionReasonCodes: ["required_keyword_missing"],
      rejectionEvidence: [{
        code: "required_keyword_missing",
        source: "listing_detail",
        confidence: "moderate",
        valueKnown: true
      }]
    }
  ]) {
    assert.equal(Policy.staticDetailFinalizationDecision(evaluation).action, "inspect_rendered");
  }
});
