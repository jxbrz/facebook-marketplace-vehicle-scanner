const test = require("node:test");
const assert = require("node:assert/strict");
const Policy = require("../scanner-decision-policy.js");

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
