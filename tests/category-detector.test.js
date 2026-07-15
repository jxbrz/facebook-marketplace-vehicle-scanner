const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CATEGORY_TERMS,
  combineDetections,
  detectCategory,
  detectTrustedEvidence,
  summariseCategoryResult,
  normaliseCategoryText
} = require("../category-detector.js");

const positives = [
  ["Cat S", "S"],
  ["CAT-S", "S"],
  ["cat. s", "S"],
  ["cat/s", "S"],
  ["Category S", "S"],
  ["S category", "S"],
  ["S cat", "S"],
  ["S-cat", "S"],
  ["Catagory S", "S"],
  ["S catagory", "S"],
  ["S catergory", "S"],
  ["insurance category N", "N"],
  ["N category repaired", "N"],
  ["category C write-off", "C"],
  ["previously Cat D", "D"],
  ["recorded as cat.s", "S"],
  ["CAT / S", "S"],
  ["CAT—N", "N"],
  ["write off catogory D", "D"],
  ["listed as Category C", "C"],
  ["Category-N", "N"],
  ["D/category", "D"],
  ["Insurance catagory C", "C"],
  ["C categoty", "C"],
  ["S\u00a0category", "S"],
  ["c\u200ba\u200bt s", "S"],
  ["C A T / D", "D"]
];

test("detects controlled category wording in both directions", () => {
  for (const [text, category] of positives) {
    const result = detectCategory(text, { source: "facebook-card" });
    assert.equal(result.detected, true, text);
    assert.equal(result.category, category, text);
    assert.equal(result.evidence[0].source, "facebook-card", text);
    assert.equal(result.evidence[0].negationEvaluated, true, text);
  }
});

test("supports every controlled category-term spelling without fuzzy matching", () => {
  for (const term of CATEGORY_TERMS) {
    assert.equal(detectCategory(`${term} S`).category, "S", term);
    assert.equal(detectCategory(`N ${term}`).category, "N", term);
  }
});

const negatives = [
  "not Cat S",
  "never Cat S",
  "no Cat S",
  "no Cat S or N",
  "HPI clear, no category recorded",
  "S line",
  "S model",
  "model S",
  "category SUV",
  "service category",
  "tax category D band",
  "category M1",
  "repaired vehicle",
  "accident damaged",
  "insurance repaired",
  "standalone S",
  "The category is broad and an unrelated letter S appears later.",
  "emissions category N",
  "vehicle category C",
  "licence category D"
];

test("does not turn negations, standalone letters, or non-insurance contexts into positives", () => {
  for (const text of negatives) {
    assert.equal(detectCategory(text).detected, false, text);
  }
});

test("keeps local negation limited so later positive assertions still win", () => {
  const cases = [
    ["Seller says not Cat S, but insurer records show Category S", "S"],
    ["Not Cat S according to advert. Recorded Cat N on HPI.", "N"],
    ["Never Cat S. No insurance category.", null],
    ["Not only Cat S but also repaired.", "S"],
    ["Not Cat S according to seller. HPI shows Cat S.", "S"]
  ];

  for (const [text, expected] of cases) {
    const result = detectCategory(text);
    assert.equal(result.category, expected, text);
    assert.equal(result.detected, expected !== null, text);
  }
});

test("normalises whitespace, punctuation, dashes, and zero-width characters", () => {
  assert.equal(normaliseCategoryText("\tCAT\u2014\u200bS\n").text, "cat s");
});

test("preserves conflicting evidence and chooses fetched-page evidence first", () => {
  const card = detectCategory("Cat N", { source: "facebook-card" });
  const page = detectCategory("Recorded Category S", {
    source: "facebook-listing-page"
  });
  const combined = combineDetections([card, page]);
  assert.equal(combined.category, "S");
  assert.deepEqual(combined.detectedCategories, ["S", "N"]);
  assert.equal(combined.conflictingCategories, true);
  assert.equal(combined.evidence.length, 2);
});

test("trusted evidence aggregation is source-prioritised and bounded", () => {
  const combined = detectTrustedEvidence([
    { text: "Cat N", source: "facebook-card" },
    { text: "Previously Cat S", source: "facebook-rendered-description" }
  ]);
  assert.equal(combined.category, "S");
  assert.equal(combined.source, "facebook-rendered-description");
  const diagnostic = summariseCategoryResult(combined);
  assert.equal(diagnostic.detected, true);
  assert.equal(diagnostic.evidence[0].matchedPhrase, "Cat S");
  assert.equal("normalizedText" in diagnostic, false);
});
