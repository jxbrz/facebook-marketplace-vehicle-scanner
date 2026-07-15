const test = require("node:test");
const assert = require("node:assert/strict");
const { LIMITS, normaliseRemoteListing } = require("../payload-normalizer.js");

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

test("preserves source mileage units only when value and unit form a valid pair", () => {
  const result = normaliseRemoteListing(listing({
    mileage: null,
    mileageValue: 68600,
    mileageUnit: "km",
    mileageOriginalText: "68,600 km"
  }));
  assert.equal(result.mileage, null);
  assert.equal(result.mileageValue, 68600);
  assert.equal(result.mileageUnit, "km");
  assert.equal(result.mileageOriginalText, "68,600 km");
  assert.equal(result.mileageUnitSource, null);

  const incomplete = normaliseRemoteListing(listing({ mileageValue: 68600 }));
  assert.equal(incomplete.mileageValue, null);
  assert.equal(incomplete.mileageUnit, null);
  assert.equal(incomplete.mileageOriginalText, null);
  assert.equal(incomplete.mileageUnitSource, null);
});

test("preserves explicit Facebook UK mileage correction provenance", () => {
  const result = normaliseRemoteListing(listing({
    mileage: 68600,
    mileageValue: 68600,
    mileageUnit: "mi",
    mileageOriginalText: "68,600 km",
    mileageUnitSource: "facebook_uk_label_correction"
  }));
  assert.equal(result.mileage, 68600);
  assert.equal(result.mileageValue, 68600);
  assert.equal(result.mileageUnit, "mi");
  assert.equal(result.mileageOriginalText, "68,600 km");
  assert.equal(result.mileageUnitSource, "facebook_uk_label_correction");
});

test("historical mileage without correction provenance remains unchanged", () => {
  const result = normaliseRemoteListing(listing({
    mileage: null,
    mileageValue: 68600,
    mileageUnit: "km",
    mileageOriginalText: "68,600 km"
  }));
  assert.equal(result.mileage, null);
  assert.equal(result.mileageValue, 68600);
  assert.equal(result.mileageUnit, "km");
  assert.equal(result.mileageUnitSource, null);
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

test("preserves full-description line breaks and remains backward compatible", () => {
  const oldResult = normaliseRemoteListing(listing());
  assert.equal(oldResult.fullDescription, null);
  assert.deepEqual(oldResult.imageUrls, []);
  assert.deepEqual({ ...oldResult.vehicleAttributes }, {});

  const result = normaliseRemoteListing(listing({
    fullDescription: "  First line\r\n\r\nSecond line  "
  }));
  assert.equal(result.fullDescription, "First line\n\nSecond line");
});

test("deduplicates, caps, and safely omits malformed image URLs", () => {
  const urls = [
    "https://example.com/one.jpg",
    "https://example.com/one.jpg",
    "javascript:alert(1)",
    ...Array.from({ length: LIMITS.imageCount + 5 }, (_, index) => `https://example.com/${index}.jpg`)
  ];
  const result = normaliseRemoteListing(listing({ imageUrls: urls }));
  assert.equal(result.imageUrls.length, LIMITS.imageCount);
  assert.equal(result.imageUrls[0], "https://example.com/one.jpg");
  assert.equal(result.imageUrls.some(url => url.startsWith("javascript:")), false);
});

test("normalises attributes to a bounded deterministic plain JSON-safe map", () => {
  const value = Object.create(null);
  value.Transmission = "Manual";
  value.Mileage = 72000;
  value.AuthorizationToken = "must not upload";
  value.Nested = { unsafe: true };
  const result = normaliseRemoteListing(listing({ vehicleAttributes: value }));
  assert.deepEqual(Object.keys(result.vehicleAttributes), ["Mileage", "Transmission"]);
  assert.equal(result.vehicleAttributes.Mileage, "72000");
  assert.equal(Object.getPrototypeOf(result.vehicleAttributes), null);
});

test("carries detected advert make and model through existing optional attributes", () => {
  const result = normaliseRemoteListing(listing({
    vehicleAttributes: {
      "Advert make": "Volkswagen",
      "Advert model": "Polo",
      "Advert make/model source": "listing_title"
    },
    rawMetadata: {
      vehicleIdentity: {
        detectedMake: "Volkswagen",
        detectedModel: "Polo",
        matchingRule: "explicit_alias_and_token_match_v1"
      }
    }
  }));
  assert.equal(result.vehicleAttributes["Advert make"], "Volkswagen");
  assert.equal(result.vehicleAttributes["Advert model"], "Polo");
  assert.equal(result.rawMetadata.vehicleIdentity.detectedModel, "Polo");
  assert.equal(normaliseRemoteListing(listing()).vehicleAttributes["Advert make"], undefined);
});

test("bounds seller names and accepts only Facebook profile URLs", () => {
  const result = normaliseRemoteListing(listing({
    sellerName: "x".repeat(LIMITS.sellerNameCharacters + 50),
    sellerProfileUrl: "https://evil.example/profile/123",
    listedAtText: "Listed 2 days ago"
  }));
  assert.equal(result.sellerName.length, LIMITS.sellerNameCharacters);
  assert.equal(result.sellerProfileUrl, null);
  assert.equal(result.listedAtText, "Listed 2 days ago");
});
