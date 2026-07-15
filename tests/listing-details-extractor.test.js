const test = require("node:test");
const assert = require("node:assert/strict");
const { extractListingDetails } = require("../listing-details-extractor.js");

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
