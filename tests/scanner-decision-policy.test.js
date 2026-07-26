const test = require("node:test");
const assert = require("node:assert/strict");
const Policy = require("../scanner-decision-policy.js");
const Filters = require("../filter-domain.js");
const Facts = require("../listing-facts.js");

function evidence(code, field, source = "search_card", confidence = "moderate") {
  return { code, field, source, confidence, valueKnown: true };
}

test("reliable out-of-range card price finalizes even when another rejection is not card-finalizable", () => {
  const evaluation = {
    decision: "reject",
    provenReject: true,
    detailRequired: false,
    rejectionReasons: [
      "Price 12,000 GBP exceeds maximum 9,000 GBP",
      "Transmission manual is not selected"
    ],
    rejectionReasonCodes: [
      "price_above_maximum",
      "transmission_not_selected"
    ],
    rejectionEvidence: [
      evidence("price_above_maximum", "price"),
      evidence("transmission_not_selected", "transmission")
    ]
  };

  assert.deepEqual(Policy.cardFinalizationDecision(evaluation), {
    mayFinalize: true,
    action: "finalize_reject",
    reasonCodes: ["price_above_maximum"]
  });
});

test("reliable out-of-range card year finalizes despite unresolved detail-only fields", () => {
  const evaluation = {
    decision: "reject",
    provenReject: true,
    detailRequired: false,
    rejectionReasons: ["Year 2012 is below minimum 2016"],
    rejectionReasonCodes: ["year_below_minimum"],
    rejectionEvidence: [
      evidence("year_below_minimum", "year", "search_card", "moderate")
    ],
    unresolvedReasons: [
      "Mileage unavailable on the card; detail inspection required",
      "Category status unavailable on the card; detail inspection required"
    ]
  };

  assert.equal(Policy.cardFinalizationDecision(evaluation).mayFinalize, true);
});

test("unknown or unreliable card values still require detail inspection", () => {
  const evaluation = {
    decision: "reject",
    provenReject: true,
    detailRequired: false,
    rejectionReasons: ["Price exceeds maximum"],
    rejectionReasonCodes: ["price_above_maximum"],
    rejectionEvidence: [{
      code: "price_above_maximum",
      field: "price",
      source: "unknown",
      confidence: "unknown",
      valueKnown: false
    }]
  };

  assert.deepEqual(Policy.cardFinalizationDecision(evaluation), {
    mayFinalize: false,
    action: "inspect_detail",
    reasonCodes: []
  });
});

test("non-card-finalizable rejection alone cannot finalize from the card", () => {
  const evaluation = {
    decision: "reject",
    provenReject: true,
    detailRequired: false,
    rejectionReasons: ["Transmission manual is not selected"],
    rejectionReasonCodes: ["transmission_not_selected"],
    rejectionEvidence: [
      evidence("transmission_not_selected", "transmission")
    ]
  };

  assert.equal(Policy.cardFinalizationDecision(evaluation).mayFinalize, false);
});

test("trusted static price rejection finalizes despite unavailable mileage and category", () => {
  const evaluation = Filters.evaluateFilters(
    Facts.normaliseListingFacts({
      title: "2018 Volkswagen Polo",
      price: 12000,
      mileage: null,
      year: 2018,
      categoryStatus: null,
      sources: {
        price: "listing_detail",
        mileage: "unknown",
        categoryStatus: "trusted_listing_evidence"
      },
      confidence: {
        price: "high",
        mileage: "unknown",
        categoryStatus: "unknown"
      }
    }),
    {
      priceMileage: { maxPrice: 9000, maxMileage: 80000 },
      category: { mode: "category_only", includeRepairedVehicles: true }
    },
    { phase: "final" }
  );

  assert.deepEqual(evaluation.rejectionReasonCodes, [
    "price_above_maximum",
    "mileage_unavailable",
    "categoryStatus_unavailable"
  ]);
  assert.deepEqual(Policy.staticDetailFinalizationDecision(evaluation), {
    mayFinalize: true,
    action: "finalize_static_reject",
    reasonCodes: ["price_above_maximum"]
  });
});

test("trusted static category rejection finalizes before rendered gallery extraction", () => {
  const evaluation = Filters.evaluateFilters(
    Facts.normaliseListingFacts({
      title: "2018 Volkswagen Polo",
      categoryStatus: "cat_s",
      categoryDetected: true,
      sources: { categoryStatus: "trusted_listing_evidence" },
      confidence: { categoryStatus: "high" }
    }),
    {
      category: { mode: "clean_only", includeRepairedVehicles: true }
    },
    { phase: "final" }
  );

  assert.deepEqual(Policy.staticDetailFinalizationDecision(evaluation), {
    mayFinalize: true,
    action: "finalize_static_reject",
    reasonCodes: ["category_not_clean"]
  });
});

test("trusted static mileage and structured identity failures are terminal", () => {
  for (const [code, field, source, confidence] of [
    ["mileage_above_maximum", "mileage", "listing_detail", "high"],
    ["make_not_selected", "make", "structured_fields", "high"],
    ["model_not_selected", "model", "vehicle_attributes", "high"]
  ]) {
    const evaluation = {
      decision: "reject",
      provenReject: true,
      detailRequired: false,
      rejectionReasons: [`Trusted ${field} rejection`],
      rejectionReasonCodes: [code],
      rejectionEvidence: [evidence(code, field, source, confidence)]
    };

    assert.deepEqual(Policy.staticDetailFinalizationDecision(evaluation), {
      mayFinalize: true,
      action: "finalize_static_reject",
      reasonCodes: [code]
    });
  }
});

test("decision-complete static match remains provisional until rendered enrichment", () => {
  const evaluation = Filters.evaluateFilters(
    Facts.normaliseListingFacts({
      title: "2018 Volkswagen Polo",
      price: 6500,
      mileage: 70000,
      year: 2018,
      make: "Volkswagen",
      model: "Polo",
      categoryStatus: "clean",
      categoryDetected: true,
      colour: null,
      sources: {
        price: "listing_detail",
        mileage: "listing_detail",
        year: "listing_detail",
        make: "structured_fields",
        model: "structured_fields",
        categoryStatus: "trusted_listing_evidence"
      }
    }),
    {
      vehicle: {
        makes: ["Volkswagen"],
        models: ["Polo"],
        minYear: 2016,
        maxYear: 2020
      },
      priceMileage: { maxPrice: 9000, maxMileage: 80000 },
      category: { mode: "clean_only", includeRepairedVehicles: true }
    },
    { phase: "final" }
  );

  assert.equal(evaluation.decision, "match");
  assert.deepEqual(Policy.staticDetailFinalizationDecision(evaluation), {
    mayFinalize: false,
    action: "inspect_rendered",
    reasonCodes: []
  });
});

test("missing decision-critical static field still requires rendered extraction", () => {
  const evaluation = Filters.evaluateFilters(
    Facts.normaliseListingFacts({
      title: "2018 Volkswagen Polo",
      mileage: null,
      sources: { mileage: "unknown" },
      confidence: { mileage: "unknown" }
    }),
    {
      priceMileage: { maxMileage: 80000 },
      category: { mode: "any", includeRepairedVehicles: true }
    },
    { phase: "final" }
  );

  assert.equal(evaluation.decision, "reject");
  assert.equal(evaluation.rejectionReasonCodes[0], "mileage_unavailable");
  assert.deepEqual(Policy.staticDetailFinalizationDecision(evaluation), {
    mayFinalize: false,
    action: "inspect_rendered",
    reasonCodes: []
  });
});

test("unknown optional static fields follow saved-search policy without false rejection", () => {
  const evaluation = Filters.evaluateFilters(
    Facts.normaliseListingFacts({
      title: "2018 Volkswagen Polo",
      colour: null
    }),
    {
      advancedFiltersEnabled: true,
      specification: { colours: { include: ["black"] } },
      unknownPolicies: { colour: "include_with_warning" },
      category: { mode: "any", includeRepairedVehicles: true }
    },
    { phase: "final" }
  );

  assert.equal(evaluation.decision, "match");
  assert.match(evaluation.warnings[0], /Colour unavailable/);
  assert.equal(Policy.staticDetailFinalizationDecision(evaluation).action, "inspect_rendered");
});
