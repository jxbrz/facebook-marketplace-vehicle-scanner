const test = require("node:test");
const assert = require("node:assert/strict");
const CategoryDetector = require("../category-detector.js");
const {
  categoryUploadFields,
  categoryOutcome,
  classifyFinalCategory,
  countFinalOutcomes
} = require("../listing-category-pipeline.js");
const { normaliseRemoteListing } = require("../payload-normalizer.js");

function finalClassification(fullDescription, extra = {}) {
  return classifyFinalCategory(
    { title: "2018 Volkswagen Polo", cardText: "2018 Volkswagen Polo £6,495" },
    { fullDescription, ...extra }
  );
}

test("final descriptions replace provisional acceptance before persistence", () => {
  for (const [description, category] of [
    ["Cat s", "S"],
    ["Cat S", "S"],
    ["Cat N", "N"],
    ["Cat N Many Years Ago", "N"],
    ["S category", "S"],
    ["Category S", "S"],
    ["Previously Cat S", "S"],
    ["Recorded Cat N", "N"]
  ]) {
    const classification = finalClassification(description);
    const outcome = categoryOutcome(classification);
    assert.equal(classification.category, category, description);
    assert.equal(classification.categoryClassificationDiagnostics.provisionalStatus, "matched", description);
    assert.equal(classification.categoryClassificationDiagnostics.finalStatus, "rejected", description);
    assert.deepEqual(outcome, {
      rejected: true,
      status: "rejected",
      reason: `CAT ${category} detected`,
      code: "category"
    });
  }
});

test("rendered description and trusted vehicle attributes participate in final evidence", () => {
  const rendered = CategoryDetector.detectTrustedEvidence([
    { text: "Cat N Many Years Ago", source: "facebook-rendered-description" }
  ]);
  rendered.categoryClassificationDiagnostics = {
    reclassifiedAfterRenderedExtraction: true
  };
  rendered.fullDescription = "Cat N Many Years Ago";
  const finalRendered = classifyFinalCategory({ cardText: "Clean card" }, rendered);
  assert.equal(finalRendered.detected, true);
  assert.equal(finalRendered.categoryClassificationDiagnostics.finalCategoryEvidenceSource, "facebook-rendered-description");
  assert.equal(finalRendered.categoryClassificationDiagnostics.reclassifiedAfterRenderedExtraction, true);
  assert.equal(finalRendered.evidence.some(item => item.source === "facebook-rendered-description"), true);

  const attributes = finalClassification("Well maintained", {
    vehicleAttributes: { "Insurance category": "Recorded Cat S" }
  });
  assert.equal(attributes.category, "S");
  assert.equal(attributes.evidence.some(item => item.source === "facebook-structured-attributes"), true);
});

test("controlled negation remains allowed while mixed positive evidence rejects", () => {
  for (const description of ["not Cat S", "never Cat S", "no Cat S", "HPI clear, no category"]) {
    const classification = finalClassification(description);
    assert.equal(classification.detected, false, description);
    assert.equal(categoryOutcome(classification).status, "matched", description);
  }

  for (const description of [
    "Seller says not Cat S, but HPI shows Cat S",
    "Not only Cat S but also repaired"
  ]) {
    const classification = finalClassification(description);
    assert.equal(classification.detected, true, description);
    assert.equal(categoryOutcome(classification).status, "rejected", description);
  }
});

test("timeout fallback safely classifies available static and card evidence", () => {
  const staticDetection = CategoryDetector.detectTrustedEvidence([
    { text: "Recorded Category N", source: "facebook-structured-description" }
  ]);
  assert.equal(categoryOutcome(classifyFinalCategory({ cardText: "Clean card" }, staticDetection)).status, "rejected");
  assert.equal(categoryOutcome(classifyFinalCategory({ cardText: "Previously Cat S" }, null)).status, "rejected");
});

test("category rejection increments only rejected and cannot reach the match target", () => {
  const counts = countFinalOutcomes([
    { status: categoryOutcome(finalClassification("Cat S")).status }
  ], 1);
  assert.deepEqual(counts, {
    processed: 1,
    matched: 0,
    rejected: 1,
    unavailable: 0,
    targetReached: false
  });
});

test("final upload payload is rejected and preserves bounded category evidence", () => {
  const classification = finalClassification("Cat S");
  const outcome = categoryOutcome(classification);
  const uploadCategory = categoryUploadFields(classification);
  const payload = normaliseRemoteListing({
    externalListingId: "123",
    sourceUrl: "https://www.facebook.com/marketplace/item/123/",
    currency: "GBP",
    status: outcome.status,
    rejectionCode: outcome.code,
    rejectionReason: outcome.reason,
    ...uploadCategory,
    rawMetadata: {
      finalCategoryResult: classification.categoryClassificationDiagnostics.finalCategoryResult
    }
  });
  assert.equal(payload.status, "rejected");
  assert.equal(payload.rejectionCode, "category");
  assert.equal(payload.categoryType, "S");
  assert.equal(payload.rawMetadata.finalCategoryResult.evidence[0].matchedPhrase, "Cat S");
});

test("generic write-off evidence is retained without leaking OTHER into categoryType", () => {
  const classification = finalClassification("Recorded insurance write-off");
  const uploadCategory = categoryUploadFields(classification);

  assert.equal(classification.detected, true);
  assert.equal(classification.category, "OTHER");
  assert.deepEqual(uploadCategory, { categoryDetected: true, categoryType: null });

  const payload = normaliseRemoteListing({
    externalListingId: "123",
    sourceUrl: "https://www.facebook.com/marketplace/item/123/",
    status: "matched",
    ...uploadCategory,
    rawMetadata: {
      finalCategoryResult: classification.categoryClassificationDiagnostics.finalCategoryResult
    }
  });
  assert.equal(payload.categoryDetected, true);
  assert.equal(payload.categoryType, null);
  assert.equal(payload.rawMetadata.finalCategoryResult.category, "OTHER");
});

test("unexpected upload categories remain visible to strict payload validation", () => {
  for (const classification of [
    { detected: true, category: "UNEXPECTED", detectorRule: "future_rule" },
    { detected: true, category: "OTHER", detectorRule: "unknown_rule" },
    { detected: true, category: "OTHER", detectorRule: "generic_insurance_write_off" }
  ]) {
    const uploadCategory = categoryUploadFields(classification);
    assert.equal(uploadCategory.categoryType, classification.category);
    assert.throws(
      () => normaliseRemoteListing({
        externalListingId: "123",
        sourceUrl: "https://www.facebook.com/marketplace/item/123/",
        status: "matched",
        ...uploadCategory
      }),
      new RegExp(`categoryType "${classification.category}" is invalid`)
    );
  }
});
