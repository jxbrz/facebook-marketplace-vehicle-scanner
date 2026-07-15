const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  extractListingDetails,
  extractRenderedSnapshotDetails,
  mergeListingDetails,
  needsRenderedFallback,
  rankImageCandidates
} = require("../listing-details-extractor.js");

function fixture(listing) {
  return `<!doctype html>
    <meta property="og:image" content="https://scontent-lhr8-1.xx.fbcdn.net/og.jpg">
    <script type="application/json" data-sjs>${JSON.stringify({
      viewer: { id: "999", name: "Signed-in account", profile_picture: { uri: "https://scontent-lhr8-1.xx.fbcdn.net/avatar.jpg" } },
      recommendations: [{ id: "456", listing_photos: [{ image: { uri: "https://scontent-lhr8-1.xx.fbcdn.net/recommendation.jpg" } }] }],
      marketplace_listing: listing
    })}</script>`;
}

test("extracts named structured listing details and preserves description lines", () => {
  const html = fixture({
    id: "123",
    redacted_description: { text: "First line\n\nSecond line" },
    listing_photos: [
      { image: { uri: "https://scontent-lhr8-1.xx.fbcdn.net/car-1.jpg" } },
      { image: { uri: "https://scontent-lhr8-1.xx.fbcdn.net/car-2.jpg" } },
      { image: { uri: "https://scontent-lhr8-1.xx.fbcdn.net/car-1.jpg" } }
    ],
    vehicle_specs: [
      { label: "Mileage", value: "72,000 miles" },
      { label: "Transmission", value: "Manual" }
    ],
    marketplace_listing_seller: {
      name: "Alex",
      url: "https://www.facebook.com/profile.php?id=42"
    },
    creation_time_text: "Listed 3 days ago"
  });
  const result = extractListingDetails(html, { listingId: "123" });
  assert.equal(result.fullDescription, "First line\n\nSecond line");
  assert.deepEqual(result.imageUrls, [
    "https://scontent-lhr8-1.xx.fbcdn.net/car-1.jpg",
    "https://scontent-lhr8-1.xx.fbcdn.net/car-2.jpg",
    "https://scontent-lhr8-1.xx.fbcdn.net/og.jpg"
  ]);
  assert.deepEqual({ ...result.vehicleAttributes }, { Mileage: "72,000 miles", Transmission: "Manual" });
  assert.equal(result.sellerName, "Alex");
  assert.equal(result.sellerProfileUrl, "https://www.facebook.com/profile.php?id=42");
  assert.equal(result.listedAtText, "Listed 3 days ago");
  assert.deepEqual(result.mileageDetail, { value: 72000, unit: "mi", originalText: "72,000 miles" });
  assert.equal(result.transmission, "Manual");
});

test("does not include avatars, recommendations, ads, or non-Facebook image hosts", () => {
  const html = fixture({
    id: "123",
    listing_photos: [
      { image: { uri: "https://scontent-lhr8-1.xx.fbcdn.net/car.jpg" } },
      { image: { uri: "https://tracking.example/ad.jpg" } }
    ]
  });
  const result = extractListingDetails(html, { listingId: "123" });
  assert.equal(result.imageUrls.includes("https://scontent-lhr8-1.xx.fbcdn.net/avatar.jpg"), false);
  assert.equal(result.imageUrls.includes("https://scontent-lhr8-1.xx.fbcdn.net/recommendation.jpg"), false);
  assert.equal(result.imageUrls.includes("https://tracking.example/ad.jpg"), false);
});

test("returns empty optional details when no trustworthy listing object exists", () => {
  const result = extractListingDetails(fixture({ id: "456", description: { text: "Wrong listing" } }), { listingId: "123" });
  assert.equal(result.fullDescription, null);
  assert.equal(result.sellerName, null);
  assert.deepEqual({ ...result.vehicleAttributes }, {});
  assert.deepEqual(result.imageUrls, ["https://scontent-lhr8-1.xx.fbcdn.net/og.jpg"]);
});

test("extracts the sanitized rendered vehicle fixture with units and ranked gallery images", () => {
  const snapshot = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "rendered-listing-1328662229386516.json"),
    "utf8"
  ));
  const result = extractRenderedSnapshotDetails(snapshot);

  assert.equal(result.fullDescription,
    "Well maintained family car with full service history.\nRecent tyres and brakes. Viewings welcome."
  );
  assert.deepEqual(result.mileageDetail, {
    value: 68600,
    unit: "km",
    originalText: "68,600 km"
  });
  assert.equal(result.transmission, "Automatic");
  assert.equal(result.fuelType, "Gasoline");
  assert.deepEqual({ ...result.vehicleAttributes }, {
    Mileage: "68,600 km",
    Transmission: "Automatic",
    "Fuel type": "Gasoline",
    "Exterior colour": "Brown",
    "Interior colour": "Black",
    "Detail 1": "ULEZ compliant"
  });
  assert.deepEqual(result.imageUrls, [
    "https://scontent-lhr8-1.xx.fbcdn.net/listing-photo-1-2048.jpg",
    "https://scontent-lhr8-1.xx.fbcdn.net/listing-photo-2-1600.jpg",
    "https://scontent-lhr8-1.xx.fbcdn.net/listing-photo-3-1280.jpg"
  ]);
  assert.equal(result.primaryImageUrl, result.imageUrls[0]);
  assert.equal(result.imageUrls.some(url => /avatar|recommended|tracking/.test(url)), false);
});

test("finds details below a listing-scoped canonical ancestor", () => {
  const html = fixture({
    canonical_url: "https://www.facebook.com/marketplace/item/123/",
    payload: {
      seller_description: { text: "Ancestor-scoped description" },
      listing_media: [
        { id: "one", image: { uri: "https://scontent-lhr8-1.xx.fbcdn.net/ancestor.jpg", width: 1600, height: 900 } }
      ],
      attribute_data: [{ label: "Mileage", value: "68,600 km" }]
    }
  });
  const result = extractListingDetails(html, { listingId: "123" });
  assert.equal(result.fullDescription, "Ancestor-scoped description");
  assert.deepEqual(result.mileageDetail, { value: 68600, unit: "km", originalText: "68,600 km" });
  assert.equal(result.imageUrls[0], "https://scontent-lhr8-1.xx.fbcdn.net/ancestor.jpg");
});

test("deduplicates repeated carousel URLs even when their rendered identities change", () => {
  const result = rankImageCandidates([
    { url: "https://scontent-lhr8-1.xx.fbcdn.net/repeated.jpg", mediaId: "first", order: 0, listingOwned: true },
    { url: "https://scontent-lhr8-1.xx.fbcdn.net/repeated.jpg", mediaId: "second", order: 1, listingOwned: true }
  ]);
  assert.deepEqual(result.imageUrls, ["https://scontent-lhr8-1.xx.fbcdn.net/repeated.jpg"]);
});

test("uses rendered details only to fill missing static fields and degrades safely", () => {
  const embedded = extractListingDetails(fixture({ id: "123", description: { text: "Embedded wins" } }), { listingId: "123" });
  const emptyRendered = extractRenderedSnapshotDetails(null);
  assert.equal(needsRenderedFallback(embedded), true);
  assert.equal(emptyRendered.fullDescription, null);
  assert.deepEqual(emptyRendered.imageUrls, []);

  const merged = mergeListingDetails(embedded, {
    ...emptyRendered,
    fullDescription: "Rendered replacement",
    mileageDetail: { value: 68600, unit: "km", originalText: "68,600 km" }
  });
  assert.equal(merged.fullDescription, "Embedded wins");
  assert.deepEqual(merged.mileageDetail, { value: 68600, unit: "km", originalText: "68,600 km" });
});
