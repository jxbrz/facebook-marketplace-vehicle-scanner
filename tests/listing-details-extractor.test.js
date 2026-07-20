const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  extractListingDetails,
  extractRenderedSnapshotDetails,
  filterOwnedImageCandidates,
  mergeListingDetails,
  needsRenderedFallback,
  nextGalleryIterationState,
  resolveListingImages,
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
    "https://scontent-lhr8-1.xx.fbcdn.net/car-2.jpg"
  ]);
  assert.equal(result.imageExtractionStatus, "complete");
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

test("does not cross a target listing object into a foreign recommendation subtree", () => {
  const html = `<!doctype html><script type="application/json" data-sjs>${JSON.stringify({
    marketplace_listing: {
      id: "123",
      payload: {
        recommendations: [{
          id: "456",
          listing_photos: [{ image: { uri: "https://scontent-lhr8-1.xx.fbcdn.net/foreign.jpg" } }]
        }]
      }
    }
  })}</script>`;
  const result = extractListingDetails(html, { listingId: "123" });
  assert.deepEqual(result.imageUrls, []);
  assert.equal(result.imageExtractionStatus, "unavailable");
});

test("returns empty optional details when no trustworthy listing object exists", () => {
  const result = extractListingDetails(fixture({ id: "456", description: { text: "Wrong listing" } }), { listingId: "123" });
  assert.equal(result.fullDescription, null);
  assert.equal(result.sellerName, null);
  assert.deepEqual({ ...result.vehicleAttributes }, {});
  assert.deepEqual(result.imageUrls, []);
  assert.equal(result.imageExtractionStatus, "unavailable");
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

test("accepts only the active listing gallery from a mixed Marketplace page fixture", () => {
  const snapshot = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "mixed-listing-gallery-candidates.json"),
    "utf8"
  ));
  const result = rankImageCandidates(snapshot.imageCandidates);

  assert.deepEqual(result.imageUrls, snapshot.expectedImageUrls);
  assert.equal(result.imageUrls.length, 8);
  assert.deepEqual(result.imageDiagnostics.rejectionReasons, {
    "seller avatar/profile": 1,
    "recommended listing": 2,
    "navigation/UI asset": 1,
    "outside active listing": 2,
    duplicate: 1
  });
});

test("rejects unsafe URL forms, icons, and external listing ownership with redacted diagnostics", () => {
  const result = rankImageCandidates([
    { url: "blob:https://facebook.com/temp", insideGallery: true },
    { url: "data:image/png;base64,AAAA", insideGallery: true },
    { url: "http://scontent-lhr8-1.xx.fbcdn.net/insecure.jpg", insideGallery: true },
    { url: "not a URL", insideGallery: true },
    { url: "https://example.com/external.jpg", insideGallery: true },
    { url: "https://scontent-lhr8-1.xx.fbcdn.net/icon.jpg", width: 32, height: 32, insideGallery: true },
    { url: "https://scontent-lhr8-1.xx.fbcdn.net/other-item.jpg", foreignListingId: "999", insideGallery: true }
  ]);
  assert.deepEqual(result.imageUrls, []);
  assert.deepEqual(result.imageDiagnostics.rejectionReasons, {
    "blob URL": 1,
    "data URL": 1,
    "insecure URL": 1,
    "malformed URL": 1,
    "unsupported source": 1,
    "tiny/icon-sized": 1,
    "outside active listing": 1
  });
  const diagnosticText = JSON.stringify(result.imageDiagnostics);
  assert.doesNotMatch(diagnosticText, /https?:\/\/|base64|other-item|insecure\.jpg/);
  assert.match(diagnosticText, /pathHash|candidateCount|rejectionReasons/);
});

test("deduplicates Facebook CDN query variants while preserving order and the best original URL", () => {
  const first = "https://scontent-lhr8-1.xx.fbcdn.net/asset-a.jpg?stp=small&oe=one";
  const firstLarge = "https://scontent-lhr8-1.xx.fbcdn.net/asset-a.jpg?stp=large&oe=two";
  const second = "https://scontent-lhr8-1.xx.fbcdn.net/asset-b.jpg?oe=three";
  const result = rankImageCandidates([
    { url: first, width: 320, height: 180, order: 0, insideGallery: true },
    { url: firstLarge, width: 1600, height: 900, order: 0, insideGallery: true },
    { url: second, width: 1280, height: 720, order: 1, insideGallery: true }
  ]);
  assert.deepEqual(result.imageUrls, [firstLarge, second]);
  assert.equal(result.imageDiagnostics.rejectionReasons.duplicate, 1);
  assert.equal(result.imageDiagnostics.rejectedCount, 1);
});

test("preserves natural gallery count and treats 20 only as an upper safety limit", () => {
  const candidates = count => Array.from({ length: count }, (_, index) => ({
    url: `https://scontent-lhr8-1.xx.fbcdn.net/genuine-${index}.jpg`,
    width: 1600,
    height: 900,
    order: index,
    insideGallery: true
  }));
  assert.equal(rankImageCandidates(candidates(8)).imageUrls.length, 8);
  assert.equal(rankImageCandidates(candidates(23)).imageUrls.length, 20);
});

test("carousel iteration stops on wrap, declared count, and bounded no-change", () => {
  let state = nextGalleryIterationState({}, "asset-1", 8);
  for (let index = 2; index <= 8; index += 1) state = nextGalleryIterationState(state, `asset-${index}`, 8);
  assert.equal(state.stopReason, "declared gallery count reached");

  state = nextGalleryIterationState({}, "asset-1");
  state = nextGalleryIterationState(state, "asset-2");
  state = nextGalleryIterationState(state, "asset-1");
  assert.equal(state.stopReason, "wrapped gallery repeat");

  state = nextGalleryIterationState({}, "asset-1");
  state = nextGalleryIterationState(state, "asset-1");
  state = nextGalleryIterationState(state, "asset-1");
  assert.equal(state.stopReason, "carousel no change");
});

test("fallback accepts one same-listing Facebook thumbnail or returns empty", () => {
  const unavailable = { imageUrls: [], imageExtractionStatus: "unavailable" };
  const owned = resolveListingImages(unavailable, {
    listingId: "123",
    sourceListingId: "123",
    imageUrl: "https://scontent-lhr8-1.xx.fbcdn.net/card.jpg"
  });
  assert.deepEqual(owned, {
    imageUrl: "https://scontent-lhr8-1.xx.fbcdn.net/card.jpg",
    imageUrls: ["https://scontent-lhr8-1.xx.fbcdn.net/card.jpg"],
    imageExtractionStatus: "partial"
  });
  assert.deepEqual(resolveListingImages(unavailable, {
    listingId: "123",
    sourceListingId: "999",
    imageUrl: "https://scontent-lhr8-1.xx.fbcdn.net/card.jpg"
  }).imageUrls, []);
  assert.deepEqual(resolveListingImages(unavailable, {
    listingId: "123",
    sourceListingId: "123",
    imageUrl: "https://example.com/card.jpg"
  }).imageUrls, []);
});

test("DOM recycling and source merging never combine galleries", () => {
  const embedded = {
    imageUrls: ["https://scontent-lhr8-1.xx.fbcdn.net/static-1.jpg"],
    primaryImageUrl: "https://scontent-lhr8-1.xx.fbcdn.net/static-1.jpg",
    imageExtractionStatus: "complete",
    vehicleAttributes: {}
  };
  const rendered = {
    imageUrls: ["https://scontent-lhr8-1.xx.fbcdn.net/rendered-1.jpg"],
    primaryImageUrl: "https://scontent-lhr8-1.xx.fbcdn.net/rendered-1.jpg",
    imageExtractionStatus: "complete",
    vehicleAttributes: {},
    extractionSource: "rendered-semantic-dom"
  };
  assert.deepEqual(mergeListingDetails(embedded, rendered).imageUrls, embedded.imageUrls);

  const filtered = filterOwnedImageCandidates([
    { url: embedded.imageUrls[0], insideGallery: true, listingOwned: true },
    { url: rendered.imageUrls[0], insideGallery: true, listingOwned: false }
  ]);
  assert.equal(filtered.accepted.length, 1);
  assert.equal(filtered.rejectionReasons["outside active listing"], 1);
});

test("lets final rendered details replace static fallbacks and degrades safely", () => {
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
  assert.equal(merged.fullDescription, "Rendered replacement");
  assert.deepEqual(merged.mileageDetail, { value: 68600, unit: "km", originalText: "68,600 km" });
});
