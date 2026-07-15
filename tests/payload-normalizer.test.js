const test = require("node:test");
const assert = require("node:assert/strict");
const { normaliseRemoteListing } = require("../payload-normalizer.js");

function listing(overrides = {}) {
  return {
    externalListingId: "123",
    sourceUrl: "https://www.facebook.com/marketplace/item/123/",
    status: "matched",
    currency: "GBP",
    rawMetadata: {},
    ...overrides
  };
}

test("normalises decimal values restored from older saved scans", () => {
  const result = normaliseRemoteListing(listing({
    price: "6495.4",
    mileage: 75000.8,
    year: "2018.2",
    discoveredAt: 1_700_000_000_000,
    processedAt: "2026-07-15T10:00:00+01:00"
  }));
  assert.equal(result.price, 6495);
  assert.equal(result.mileage, 75001);
  assert.equal(result.year, 2018);
  assert.match(result.discoveredAt, /^2023-/);
  assert.equal(result.processedAt, "2026-07-15T09:00:00.000Z");
});

test("uses null for unknown or out-of-range optional numeric values", () => {
  const result = normaliseRemoteListing(listing({
    price: "unknown",
    mileage: -1,
    year: 2200,
    imageUrl: "",
    title: "  "
  }));
  assert.equal(result.price, null);
  assert.equal(result.mileage, null);
  assert.equal(result.year, null);
  assert.equal(result.imageUrl, null);
  assert.equal(result.title, null);
});

test("validates required URLs, statuses, categories, and metadata shape", () => {
  assert.throws(() => normaliseRemoteListing(listing({ sourceUrl: "javascript:alert(1)" })), /HTTP or HTTPS/);
  assert.throws(() => normaliseRemoteListing(listing({ status: "pending" })), /status/);
  assert.throws(() => normaliseRemoteListing(listing({ categoryDetected: true })), /categoryType/);
  assert.throws(() => normaliseRemoteListing(listing({ categoryType: "X" })), /categoryType/);
  assert.throws(() => normaliseRemoteListing(listing({ rawMetadata: [] })), /rawMetadata/);
});

test("normalises valid category, currency, URLs, and nullable text", () => {
  const result = normaliseRemoteListing(listing({
    categoryDetected: true,
    categoryType: "s",
    currency: "gbp",
    imageUrl: "https://example.com/car.jpg",
    location: "  Leeds  "
  }));
  assert.equal(result.categoryType, "S");
  assert.equal(result.categoryDetected, true);
  assert.equal(result.currency, "GBP");
  assert.equal(result.imageUrl, "https://example.com/car.jpg");
  assert.equal(result.location, "Leeds");
});
