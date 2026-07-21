const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  extractListingDetails,
  extractRenderedSnapshotDetails,
  classifyRenderedGallery,
  filterOwnedImageCandidates,
  galleryCandidateConfidence,
  mergeListingDetails,
  mediaAssetDimensions,
  needsRenderedFallback,
  nextGalleryIterationState,
  parseBackgroundImageUrls,
  parseSrcset,
  resolveListingImages,
  rankImageCandidates,
  scoreGalleryCandidate,
  selectGalleryCandidate
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

test("treats Open Graph and unproven one-image results as partial", () => {
  const openGraph = extractListingDetails(fixture({ id: "123", description: { text: "No photo array" } }), { listingId: "123" });
  assert.deepEqual(openGraph.imageUrls, ["https://scontent-lhr8-1.xx.fbcdn.net/og.jpg"]);
  assert.equal(openGraph.imageExtractionStatus, "partial");
  assert.equal(openGraph.imageExtractionSource, "og_image");

  const rendered = extractRenderedSnapshotDetails({
    imageCandidates: [{
      url: "https://scontent-lhr8-1.xx.fbcdn.net/uncertain-one.jpg",
      width: 1600,
      height: 900,
      insideGallery: true,
      listingOwned: true
    }]
  });
  assert.equal(rendered.imageExtractionStatus, "partial");
});

test("allows a reliable authoritative count to prove a true one-photo listing", () => {
  const result = extractListingDetails(fixture({
    id: "123",
    listing_photos: [{ image: { uri: "https://scontent-lhr8-1.xx.fbcdn.net/only-photo.jpg" } }]
  }), { listingId: "123", debug: true });
  assert.equal(result.imageExtractionStatus, "complete");
  assert.equal(result.imageDiagnostics.declaredPhotoCount, 1);
  assert.deepEqual(classifyRenderedGallery({ galleryFound: true, imageCount: 1, declaredCount: 1 }), {
    status: "complete",
    evidence: "declared gallery count reached"
  });
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

test("selects the cohesive gallery ancestor from the sanitized live dialog layout", () => {
  const snapshot = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "live-dialog-gallery-2026-07.json"),
    "utf8"
  ));
  const selected = selectGalleryCandidate(snapshot.galleryCandidates);
  assert.equal(selected.identity, snapshot.expectedGalleryIdentity);
  const ranked = rankImageCandidates(snapshot.imageCandidates);
  assert.equal(ranked.imageUrls.length, 12);
  assert.equal(ranked.imageUrls.every(url => /live-car-\d+\.jpg/.test(url)), true);
  assert.deepEqual(classifyRenderedGallery({
    galleryFound: true,
    imageCount: ranked.imageUrls.length,
    stableDom: true,
    galleryConfidence: "high"
  }), { status: "complete", evidence: "stable owned gallery DOM" });
});

test("selects and accepts the 11-photo cohesive ancestor despite foreign links elsewhere in marketplace-main", () => {
  const snapshot = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "live-main-gallery-11-photos.json"),
    "utf8"
  ));
  assert.equal(snapshot.legacyCandidateCount, 12);
  assert.equal(snapshot.galleryCandidates[0].ownedMediaCount, 1);
  const legacySelection = selectGalleryCandidate(snapshot.galleryCandidates.slice(0, snapshot.legacyCandidateCount));
  assert.equal(legacySelection.ownedMediaCount, 1);

  const selected = selectGalleryCandidate(snapshot.galleryCandidates);
  assert.equal(selected.identity, snapshot.expectedGalleryIdentity);
  assert.equal(selected.ownedMediaCount, 11);
  assert.equal(selected.score < 48, true);
  assert.equal(galleryCandidateConfidence(selected), "moderate");

  const ranked = rankImageCandidates(snapshot.imageCandidates);
  assert.deepEqual(ranked.imageUrls, snapshot.expectedImageUrls);
  assert.equal(ranked.imageDiagnostics.acceptedCount, 11);
  assert.equal(ranked.imageDiagnostics.rejectionReasons["seller avatar/profile"], 1);
  assert.equal(ranked.imageDiagnostics.rejectionReasons["outside active listing"], 1);
  assert.deepEqual(classifyRenderedGallery({
    galleryFound: true,
    imageCount: ranked.imageUrls.length,
    stableDom: true,
    galleryConfidence: galleryCandidateConfidence(selected),
    additionalMediaEvidence: false
  }), { status: "partial", evidence: null });

  const highConfidenceBoundary = {
    ...selected,
    foreignListingLinkCount: 0,
    excludedMediaCount: 0
  };
  highConfidenceBoundary.score = scoreGalleryCandidate(highConfidenceBoundary);
  assert.equal(galleryCandidateConfidence(highConfidenceBoundary), "high");
  assert.deepEqual(classifyRenderedGallery({
    galleryFound: true,
    imageCount: ranked.imageUrls.length,
    stableDom: true,
    galleryConfidence: galleryCandidateConfidence(highConfidenceBoundary),
    additionalMediaEvidence: false
  }), { status: "complete", evidence: "stable owned gallery DOM" });
});

test("counts small mounted thumbnails by intrinsic asset dimensions when scoring a cohesive gallery", () => {
  const dimensions = mediaAssetDimensions({
    rect: { width: 72, height: 96 },
    element: { naturalWidth: 720, naturalHeight: 960 },
    sources: [{ width: 720 }]
  });
  assert.deepEqual(dimensions, { width: 720, height: 960 });

  const srcsetDimensions = mediaAssetDimensions({
    rect: { width: 96, height: 72 },
    element: { naturalWidth: 0, naturalHeight: 0 },
    sources: [{ width: 960 }]
  });
  assert.deepEqual(srcsetDimensions, { width: 960, height: 720 });
});

test("extracts currentSrc alternatives and CSS background gallery assets without signed URL logging", () => {
  assert.deepEqual(parseSrcset("https://scontent-lhr8-1.xx.fbcdn.net/a.jpg 640w, https://scontent-lhr8-1.xx.fbcdn.net/b.jpg 1280w"), [
    { url: "https://scontent-lhr8-1.xx.fbcdn.net/a.jpg", width: 640 },
    { url: "https://scontent-lhr8-1.xx.fbcdn.net/b.jpg", width: 1280 }
  ]);
  assert.deepEqual(parseBackgroundImageUrls("linear-gradient(#000,#fff), url('https://scontent-lhr8-1.xx.fbcdn.net/background.jpg?variant=large')"), [
    "https://scontent-lhr8-1.xx.fbcdn.net/background.jpg?variant=large"
  ]);
});

test("rendered traversal remains listing-root scoped, waits for identity changes, and never supplements from the page", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "listing-details-extractor.js"), "utf8");
  assert.match(source, /element\.currentSrc \|\| element\.src/);
  assert.match(source, /function waitForGalleryChange[\s\S]*primaryIdentity/);
  assert.match(source, /next\.click\(\)[\s\S]*waitForGalleryChange/);
  assert.match(source, /visibleListingMedia\(context\.listingRoot\)/);
  assert.doesNotMatch(source, /visibleListingMedia\(document|querySelectorAll\("body img"\)/);
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
    imageExtractionStatus: "partial",
    imageExtractionSource: "card_thumbnail"
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

test("source selection rejects a contradicted one-image completion without downgrading stronger complete galleries", () => {
  const embeddedOne = {
    imageUrls: ["https://scontent-lhr8-1.xx.fbcdn.net/static-one.jpg"],
    primaryImageUrl: "https://scontent-lhr8-1.xx.fbcdn.net/static-one.jpg",
    imageExtractionStatus: "complete",
    imageExtractionSource: "embedded_listing_json",
    vehicleAttributes: {}
  };
  const renderedMany = {
    imageUrls: Array.from({ length: 12 }, (_, index) => `https://scontent-lhr8-1.xx.fbcdn.net/rendered-${index}.jpg`),
    primaryImageUrl: "https://scontent-lhr8-1.xx.fbcdn.net/rendered-0.jpg",
    imageExtractionStatus: "partial",
    imageExtractionSource: "rendered_gallery",
    vehicleAttributes: {},
    extractionSource: "rendered-semantic-dom"
  };
  assert.deepEqual(mergeListingDetails(embeddedOne, renderedMany).imageUrls, renderedMany.imageUrls);

  const embeddedComplete = {
    ...embeddedOne,
    imageUrls: Array.from({ length: 5 }, (_, index) => `https://scontent-lhr8-1.xx.fbcdn.net/static-${index}.jpg`),
    primaryImageUrl: "https://scontent-lhr8-1.xx.fbcdn.net/static-0.jpg"
  };
  assert.deepEqual(mergeListingDetails(embeddedComplete, renderedMany).imageUrls, embeddedComplete.imageUrls);
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
