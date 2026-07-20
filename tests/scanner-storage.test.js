const test = require("node:test");
const assert = require("node:assert/strict");

const ScannerStorage = require("../scanner-storage");

function pendingPayload(id, overrides = {}) {
  return {
    externalListingId: id,
    sourceUrl: `https://www.facebook.com/marketplace/item/${id}`,
    imageUrl: "https://scontent.example/first.jpg?tracking=one",
    imageUrls: [
      "https://scontent.example/first.jpg?tracking=one",
      "https://scontent.example/first.jpg?tracking=one",
      "https://scontent.example/second.jpg?tracking=two"
    ],
    fullDescription: "A detailed advert description 🚗",
    ...overrides
  };
}

function oldState() {
  return {
    version: 19,
    remoteRun: { scanId: "scan-1", resultsUrl: "https://dashboard.example/scans/scan-1" },
    scanStatus: "running",
    ledger: {
      uploaded: {
        listingId: "uploaded",
        status: "matched",
        metadata: {
          cardText: "heavy completed card text",
          imageUrl: "https://scontent.example/uploaded.jpg"
        }
      },
      pending: {
        listingId: "pending",
        status: "matched",
        metadata: {
          cardText: "pending card text",
          imageUrl: "https://scontent.example/pending.jpg"
        }
      },
      active: {
        listingId: "active",
        status: "queued",
        url: "https://www.facebook.com/marketplace/item/active",
        metadata: { title: "Active", cardText: "minimum resume metadata" }
      }
    },
    results: {
      uploaded: pendingPayload("uploaded"),
      pending: pendingPayload("pending")
    },
    pendingUploads: {
      pending: pendingPayload("pending")
    },
    lifecycleDiagnostics: Array.from({ length: 45 }, (_, index) => ({
      at: new Date(index * 1000).toISOString(),
      event: `event-${index}`,
      details: "not persisted"
    })),
    savedAt: 1000
  };
}

test("UTF-8 byte measurement counts multibyte text", () => {
  assert.equal(ScannerStorage.utf8Bytes("plain"), 5);
  assert.equal(ScannerStorage.utf8Bytes("🚗"), 4);
  assert.equal(
    ScannerStorage.approximateStorageItemBytes("key", { value: "é" }),
    3 + Buffer.byteLength(JSON.stringify({ value: "é" }), "utf8")
  );
});

test("storage report measures keys and nested listing payloads without values", () => {
  const data = {
    extensionApiToken: "do-not-print-this-token",
    "scannerV19:activeRun": oldState(),
    "listing:pending": { savedAt: 1, result: pendingPayload("pending") }
  };
  const report = ScannerStorage.measureStorageData(data);

  assert.ok(report.totalBytes > 0);
  assert.ok(report.maximumListingBytes > 0);
  assert.ok(report.averageListingBytes > 0);
  assert.equal(report.largestCollections[0].path.includes("scannerV19:activeRun"), true);
  assert.equal(report.duplicateListingIds, 2);
  assert.ok(report.imageUrlCount >= 3);
  assert.ok(report.imageUrlBytes > 0);
  assert.ok(report.descriptionBytes > 0);
  assert.ok(report.pendingUploadBytes > 0);
  assert.equal(report.rows.some(row => row.key.includes("do-not-print")), false);
  assert.equal(report.rows.some(row => row.key === "[sensitive configuration]"), true);
});

test("diagnostic redaction hides secrets, descriptions, and full URLs", () => {
  const redacted = ScannerStorage.redactForDiagnostics({
    extensionApiToken: "secret-token",
    fullDescription: "private description",
    sourceUrl: "https://facebook.example/item/1?secret=value"
  });
  const output = JSON.stringify(redacted);
  assert.doesNotMatch(output, /secret-token|private description|secret=value/);
  assert.match(output, /\[redacted\]/);
  assert.match(output, /redacted URL/);
});

test("pending images remain HTTPS, ordered, deduplicated, and capped", () => {
  const urls = [
    "blob:https://facebook.example/temporary",
    "data:image/png;base64,AAAA",
    "http://insecure.example/image.jpg",
    ...Array.from({ length: 25 }, (_, index) => `https://scontent.example/${index}.jpg`),
    "https://scontent.example/0.jpg"
  ];
  const payload = ScannerStorage.sanitisePendingUpload(pendingPayload("pending", {
    imageUrl: "blob:https://facebook.example/temporary",
    imageUrls: urls
  }));

  assert.equal(payload.imageUrls.length, ScannerStorage.MAX_IMAGE_URLS);
  assert.equal(payload.imageUrls[0], "https://scontent.example/0.jpg");
  assert.equal(payload.imageUrls[19], "https://scontent.example/19.jpg");
  assert.equal(payload.imageUrl, payload.imageUrls[0]);
  assert.equal(payload.imageUrls.some(url => /^(?:blob:|data:|http:)/.test(url)), false);
});

test("compact state keeps pending payloads but drops full successful results", () => {
  const compact = ScannerStorage.migrateActiveState(oldState());
  const encoded = JSON.stringify(compact);

  assert.equal(compact.version, ScannerStorage.SCHEMA_VERSION);
  assert.equal(Object.hasOwn(compact, "results"), false);
  assert.equal(compact.pendingUploads.pending.fullDescription.includes("detailed"), true);
  assert.equal(compact.pendingUploads.pending.imageUrls.length, 2);
  assert.equal(Object.hasOwn(compact.ledger.uploaded, "metadata"), false);
  assert.equal(Object.hasOwn(compact.ledger.uploaded, "uploadedAt"), true);
  assert.equal(Object.hasOwn(compact.ledger.pending, "metadata"), false);
  assert.equal(compact.ledger.active.metadata.cardText, "minimum resume metadata");
  assert.equal(compact.lifecycleDiagnostics.length, ScannerStorage.MAX_LIFECYCLE_DIAGNOSTICS);
  assert.doesNotMatch(encoded, /heavy completed card text|uploaded\.jpg/);
  assert.match(encoded, /first\.jpg/);
});

test("completed ledger markers are explicitly bounded", () => {
  const ledger = Object.fromEntries(Array.from({ length: 550 }, (_, index) => [
    String(index),
    { listingId: String(index), status: "matched", metadata: { cardText: "heavy" } }
  ]));
  const compact = ScannerStorage.compactLedger(ledger);
  assert.equal(Object.keys(compact).length, ScannerStorage.MAX_COMPLETED_MARKERS);
  assert.equal(Object.hasOwn(compact, "0"), false);
  assert.equal(Object.hasOwn(compact, "549"), true);
  assert.equal(Object.values(compact).some(entry => entry.metadata), false);
});

test("old storage migration removes only scanner caches and preserves configuration", () => {
  const data = {
    extensionApiToken: "secret-token",
    dashboardUrl: "https://dashboard.example",
    maximumProcessed: 150,
    unrelatedKey: { keep: true },
    "listing:uploaded": { result: pendingPayload("uploaded") },
    "searchSession:old": { stale: true },
    "scannerV19:activeRun": oldState()
  };
  const plan = ScannerStorage.migrationPlan(data, "scannerV19:activeRun");

  assert.equal(plan.changed, true);
  assert.deepEqual(plan.keysToRemove.sort(), ["listing:uploaded", "searchSession:old"]);
  assert.equal(plan.migratedState.pendingUploads.pending.externalListingId, "pending");
  assert.equal(Object.hasOwn(plan.migratedState, "results"), false);
  assert.equal(data.extensionApiToken, "secret-token");
  assert.equal(data.unrelatedKey.keep, true);

  const migratedData = {
    ...data,
    "scannerV19:activeRun": plan.migratedState
  };
  for (const key of plan.keysToRemove) delete migratedData[key];
  const secondPlan = ScannerStorage.migrationPlan(migratedData, "scannerV19:activeRun");
  assert.equal(secondPlan.changed, false);
  assert.deepEqual(secondPlan.keysToRemove, []);
});

test("quota recovery prunes once and retries exactly once", async () => {
  let writes = 0;
  let prunes = 0;
  let degraded = 0;
  const pending = pendingPayload("pending");
  const outcome = await ScannerStorage.writeWithQuotaRecovery({
    buildValue: () => ({ pendingUploads: { pending } }),
    write: async value => {
      writes += 1;
      assert.equal(value.pendingUploads.pending.fullDescription, pending.fullDescription);
      if (writes === 1) throw new Error("Resource::kQuotaBytes quota exceeded");
    },
    prune: async () => { prunes += 1; },
    onDegraded: async () => { degraded += 1; }
  });

  assert.deepEqual({ writes, prunes, degraded }, { writes: 2, prunes: 1, degraded: 0 });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.retried, true);
});

test("a second quota failure enters degraded mode without losing pending data or looping", async () => {
  let writes = 0;
  let prunes = 0;
  let degraded = 0;
  const pending = pendingPayload("pending");
  const outcome = await ScannerStorage.writeWithQuotaRecovery({
    buildValue: () => ({ pendingUploads: { pending } }),
    write: async value => {
      writes += 1;
      assert.equal(value.pendingUploads.pending.imageUrls.length, 3);
      throw new Error("QUOTA_BYTES exceeded");
    },
    prune: async () => { prunes += 1; },
    onDegraded: async () => { degraded += 1; }
  });

  assert.deepEqual({ writes, prunes, degraded }, { writes: 2, prunes: 1, degraded: 1 });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.degraded, true);
  assert.equal(pending.imageUrls.length, 3);
});
