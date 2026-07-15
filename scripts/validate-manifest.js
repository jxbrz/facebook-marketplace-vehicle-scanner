const fs = require("node:fs");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const expectedId = "aipljeeiecdcnkbbakphcddacbbgkpmf";
const expectedPermissions = ["storage", "tabs"];
const expectedHostPermissions = [
  "https://www.facebook.com/*",
  "https://facebook.com/*",
  "https://*/*",
  "http://localhost/*",
  "http://127.0.0.1/*"
];

assert.equal(manifest.manifest_version, 3);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.version, "23.0.1");
assert.ok(typeof manifest.key === "string" && manifest.key.length > 100);
assert.deepEqual(manifest.permissions, expectedPermissions);
assert.deepEqual(manifest.host_permissions, expectedHostPermissions);
assert.deepEqual(manifest.content_scripts[0].js, [
  "category-detector.js",
  "mileage-utils.js",
  "content.js"
]);
assert.equal(manifest.content_scripts[0].exclude_matches, undefined);
assert.deepEqual(manifest.content_scripts[1], {
  matches: [
    "https://www.facebook.com/marketplace/item/*",
    "https://facebook.com/marketplace/item/*"
  ],
  js: ["listing-details-extractor.js"],
  run_at: "document_idle"
});

const digest = crypto
  .createHash("sha256")
  .update(Buffer.from(manifest.key, "base64"))
  .digest()
  .subarray(0, 16);
const extensionId = [...digest]
  .map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
  .join("");

assert.equal(extensionId, expectedId);
assert.equal(JSON.stringify(manifest).includes("extensionApiToken"), false);
console.log(`Manifest valid: v${manifest.version}, extension ID ${extensionId}`);
