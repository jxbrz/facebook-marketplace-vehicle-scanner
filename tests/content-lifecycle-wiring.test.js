const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("content.js", "utf8");

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const asyncStart = source.indexOf(`async function ${name}`);
  const actualStart = start >= 0 ? start : asyncStart;
  assert.notEqual(actualStart, -1, `${name} was not found`);
  const nextFunction = nextName ? source.indexOf(nextName, actualStart + 1) : source.length;
  return source.slice(actualStart, nextFunction >= 0 ? nextFunction : source.length);
}

test("startup restores state without connecting discovery or auto-resuming", () => {
  const startup = functionSource("initialiseScanner", "initialiseScanner().catch");
  assert.doesNotMatch(startup, /observer\.observe/);
  assert.doesNotMatch(startup, /autoLoadListings\(/);
  assert.match(startup, /if \(!scanIsRunning\(\) \|\| isListingRoute\(\)\) return/);
  assert.match(startup, /if \(scanIsRunning\(\) && sourceSearchRouteKey === currentRouteKey\)/);

  const restore = functionSource("restoreActiveRun", "async function clearLocalScannerState");
  assert.doesNotMatch(restore, /activateRunningScan\(/);
  assert.doesNotMatch(restore, /scheduleScan\(/);
  assert.doesNotMatch(restore, /autoLoadListings\(/);
  assert.match(restore, /scanningActive = false/);
});

test("Start and Resume are the only handlers that activate scanning", () => {
  const activations = [...source.matchAll(/activateRunningScan\((?:true|false)\)/g)].map(match => match[0]);
  assert.deepEqual(activations.sort(), ["activateRunningScan(false)", "activateRunningScan(true)"]);
  assert.match(source, /type === "START_SCAN"[\s\S]{0,100}startNewScan/);
  assert.match(source, /type === "RESUME_SCAN"[\s\S]{0,100}resumeInterruptedScan/);
});

test("terminal cleanup disconnects discovery and cancels run-scoped inspections", () => {
  const cleanup = functionSource("stopScanningActivity", "function clearDeadlineTimer");
  for (const expected of [
    "clearTimeout(scanTimer)",
    "clearTimeout(observerTimer)",
    "clearTimeout(scrollTimer)",
    "cancelScanDelays()",
    "disconnectDiscoveryObserver()",
    "processingQueue?.stop()",
    "cancelOutstandingLedgerWork()",
    "CANCEL_SCAN_INSPECTIONS"
  ]) {
    assert.ok(cleanup.includes(expected), `${expected} cleanup was missing`);
  }
  const finalise = functionSource("finaliseScan", "function rebuildPendingUploadsFromLedger");
  assert.match(finalise, /stopScanningActivity\(reason\)/);
});

test("Retry sync and results opening contain no discovery activation", () => {
  const retry = functionSource("retryRemoteSync", "async function openResults");
  assert.doesNotMatch(retry, /activateRunningScan|scheduleScan|autoLoadListings|connectDiscoveryObserver/);
  const open = functionSource("openResults", "function buildScanCreatePayload");
  assert.doesNotMatch(open, /activateRunningScan|scheduleScan|autoLoadListings|connectDiscoveryObserver/);
});

test("fresh scan metadata snapshots the canonical versioned filter config", () => {
  const payload = functionSource("buildScanCreatePayload", "function resetRunMemory");
  assert.match(payload, /filters: settings\.activeFilterConfig/);
  assert.match(source, /FilterDomain\.normaliseFilterConfig/);
});

test("only freshly inspected Facebook UK mileage receives the label correction", () => {
  const normaliser = functionSource("normaliseFreshFacebookUkMileage", "function buildRemoteListing");
  assert.match(normaliser, /source: "facebook_marketplace"/);
  assert.match(normaliser, /market: "GB"/);

  const processing = functionSource("processListing", "async function scanPage");
  assert.match(processing, /normaliseFreshFacebookUkMileage\([\s\S]*await inspectListing/);

  const restore = functionSource("restoreActiveRun", "async function clearLocalScannerState");
  assert.doesNotMatch(restore, /normaliseFreshFacebookUkMileage/);
});

test("performance diagnostics are opt-in and expose aggregates without listing text", () => {
  assert.match(source, /scannerDebugDiagnostics: false/);
  assert.match(source, /performanceDiagnostics\.snapshot\(\)/);
  assert.doesNotMatch(source, /recordListing\([^\n]*description/i);
  assert.doesNotMatch(source, /recordListing\([^\n]*token/i);
});

test("image diagnostics expose only bounded ownership aggregates and a hashed listing ID", () => {
  const diagnostics = functionSource("maybeLogImageExtractionDiagnostics", "function recordLifecycleDiagnostic");
  for (const field of [
    "listingIdHash",
    "selectedExtractionSource",
    "imageExtractionStatus",
    "declaredPhotoCount",
    "galleryCandidateCount",
    "acceptedCount",
    "rejectionReasonCounts",
    "carouselControlsDetected",
    "cardFallbackUsed"
  ]) assert.match(diagnostics, new RegExp(field));
  assert.doesNotMatch(diagnostics, /\blistingId:/);
  assert.doesNotMatch(diagnostics, /\.\.\.result\.imageDiagnostics|imageUrls:/);
  assert.match(diagnostics, /imageDiagnosticsLogged\.size >= 25/);
});

test("card thumbnail fallback is tied to the exact canonical listing anchor", () => {
  const extraction = functionSource("extractCardMetadata", "function getViewportPriority");
  assert.match(extraction, /normaliseListingUrl\(anchor\.href\)\?\.id === listingId/);
  assert.match(extraction, /imageOwnerListingId: imageUrl \? listingId : null/);
  const payload = functionSource("buildRemoteListing", "async function postJson");
  assert.match(payload, /sourceListingId: metadata\.imageOwnerListingId/);
  assert.doesNotMatch(payload, /sourceListingId: entry\.listingId/);
});

test("Pause cancels run-scoped activity without finalising and Resume uses a fresh token", () => {
  const pause = functionSource("pauseScanByUser", "async function resumeInterruptedScan");
  assert.match(pause, /transition\(lifecycleState, "PAUSE"\)/);
  assert.match(pause, /stopScanningActivity\("user_paused"\)/);
  assert.doesNotMatch(pause, /finaliseScan/);

  const resume = functionSource("resumeInterruptedScan", "async function discardInterruptedScan");
  assert.match(resume, /\["interrupted", "paused"\]/);
  assert.match(resume, /runToken = crypto\.randomUUID\(\)/);
  assert.match(source, /type === "PAUSE_SCAN"[\s\S]{0,100}pauseScanByUser/);
});

test("auto-scroll never waits for detail work to drain", () => {
  const autoLoad = functionSource("autoLoadListings", "function cancelOutstandingLedgerWork");
  assert.doesNotMatch(autoLoad, /waitForActiveWork|hasUnprocessedVisible/);
  assert.match(autoLoad, /await scanPage\(\)[\s\S]*setScrollTop\(container, nextTop\)/);
  assert.match(autoLoad, /nextEndDetectionState/);
  for (const state of ["discovering", "scrolling", "waiting_for_growth", "processing"]) {
    assert.ok(autoLoad.includes(`scrollState = "${state}"`), `${state} scroll state missing`);
  }
});

test("cheap filters and cached results run before bounded detail queueing", () => {
  const scan = functionSource("scanPage", "function scheduleScan");
  assert.ok(scan.indexOf("cachedResult") < scan.indexOf("localEvaluation"));
  assert.ok(scan.indexOf("localEvaluation.decision") < scan.indexOf("ensureProcessingQueue().enqueue"));
  assert.match(scan, /localEvaluation\.provenReject === true/);
  assert.match(scan, /localEvaluation\.detailRequired === false/);
  assert.doesNotMatch(scan, /processListing\(entry/);
  assert.match(source, /listingProcessingConcurrency: 3/);
});

test("filter diagnostics are opt-in, bounded and contain no listing content", () => {
  const diagnostics = functionSource("recordFilterDiagnostic", "function recordLifecycleDiagnostic");
  assert.match(diagnostics, /scannerDebugDiagnostics/);
  assert.match(diagnostics, /size >= 40/);
  assert.match(diagnostics, /shortPathHash/);
  assert.match(diagnostics, /filterFingerprintHash/);
  assert.doesNotMatch(diagnostics, /fullDescription|listingUrl|imageUrl|sellerName|extensionApiToken/);
  const process = functionSource("processListing", "async function scanPage");
  assert.match(process, /detailExtractionAttempted: true/);
  assert.match(process, /detailExtractionOutcome: "completed"/);
});

test("sanitized diagnostic lifecycle is bounded and exposes no listing content", () => {
  const recorder = functionSource("recordDiagnosticStage", "function getScannerDiagnosticReport");
  assert.match(recorder, /size >= 8/);
  assert.match(recorder, /stages\.length >= 24/);
  assert.match(recorder, /shortPathHash/);
  const report = functionSource("getScannerDiagnosticReport", "function recordLifecycleDiagnostic");
  assert.match(report, /uploadEnabled: true/);
  assert.match(report, /readyToCopy/);
  assert.match(report, /elapsedMs/);
  assert.doesNotMatch(report, /description|title|listingUrl|imageUrl|seller|token|cookie|credential/i);
  for (const stage of [
    "discovered", "card_metadata_extracted", "card_facts_normalized", "prefilter_evaluated",
    "queued_for_detail", "static_extraction_started", "static_extraction_completed",
    "rendered_extraction_completed", "facts_merged", "final_evaluation", "unrestricted_core_evaluation", "payload_built", "terminal"
  ]) assert.match(source, new RegExp(stage));
});

test("runtime state identifies persisted filter snapshots", () => {
  const progress = functionSource("getRuntimeProgress", "function updateProgress");
  assert.match(progress, /usingPersistedSettingsSnapshot/);
  assert.match(progress, /activeFilterSource/);
  const restore = functionSource("restoreActiveRun", "async function clearLocalScannerState");
  assert.match(restore, /usingPersistedSettingsSnapshot = true/);
});

test("progressive uploads are ID-deduplicated, bounded, and independent of discovery", () => {
  const queueUpload = functionSource("queueRemoteListing", "async function pruneUploadedListings");
  assert.match(queueUpload, /pendingUploadsByListingId\.set/);
  assert.match(queueUpload, /scheduleUpload\(\)/);
  assert.doesNotMatch(queueUpload, /await|scanPage/);

  const flush = functionSource("flushPendingUploads", "function scheduleRemoteProgressSync");
  assert.match(flush, /slice\(0, CONFIG\.uploadBatchSize\)/);
  assert.match(flush, /pruneUploadedListings\(uploadedListingIds\)/);
  assert.match(flush, /reserveUploadRetry\(\)/);
  assert.match(source, /uploadMaxRetries: 3/);
  const retry = functionSource("reserveUploadRetry", "async function flushPendingUploads");
  assert.match(retry, /uploadRetryCount >= CONFIG\.uploadMaxRetries/);

  const scan = functionSource("scanPage", "function scheduleScan");
  assert.doesNotMatch(scan, /flushPendingUploads|REMOTE_UPLOAD_LISTINGS/);
});

test("persisted recovery state contains no successful full-result copy", () => {
  const persistence = functionSource("getActiveRunSource", "function buildPersistedActiveRun");
  assert.match(persistence, /pendingUploads: serialiseMap\(pendingUploadsByListingId\)/);
  assert.doesNotMatch(persistence, /results:|resultByListingId/);

  const pruning = functionSource("pruneUploadedListings", "function scheduleUpload");
  assert.match(pruning, /resultByListingId\.delete\(listingId\)/);
  assert.match(pruning, /pending failures are deliberately outside this list/);

  const retry = functionSource("retryRemoteSync", "async function openResults");
  assert.doesNotMatch(retry, /rebuildPendingUploadsFromLedger/);
  assert.doesNotMatch(source, /function rebuildPendingUploadsFromLedger/);
});

test("legacy full-result caches are migration-only and new details remain memory-only", () => {
  const save = functionSource("saveCachedResult", "function sendBackground");
  assert.match(save, /resultByListingId\.set/);
  assert.doesNotMatch(save, /storage\.local\.set/);

  const migration = functionSource("migrateExistingStorage", "async function restoreActiveRun");
  assert.match(migration, /ScannerStorage\.migrationPlan/);
  assert.match(source, /key\.startsWith\("listing:"\)/);
});

test("storage pressure pauses only after compact pending state is saved", () => {
  const persist = functionSource("persistActiveRun", "async function migrateExistingStorage");
  assert.ok(persist.indexOf("writeWithQuotaRecovery") < persist.indexOf("pauseAtStorageSoftLimit"));
  assert.match(persist, /estimatedBytes >= storageHealth\.softLimitBytes/);

  const pause = functionSource("pauseAtStorageSoftLimit", "function schedulePersist");
  assert.match(pause, /transition\(lifecycleState, "PAUSE"\)/);
  assert.match(pause, /stopScanningActivity\("storage_soft_limit"\)/);
  assert.match(pause, /schedulePersist\(0\)/);
});

test("listing ledger persists every explicit processing lifecycle state", () => {
  for (const state of [
    "unseen",
    "queued",
    "processing",
    "processed",
    "failed_retryable",
    "failed_final"
  ]) {
    assert.ok(source.includes(`workState: "${state}"`) || source.includes(`? "${state}"`), `${state} missing`);
  }
});

test("DOM mutations trigger immediate discovery and final IDs never requeue", () => {
  assert.match(source, /const observer = new MutationObserver[\s\S]*domMutationVersion \+= 1[\s\S]*scheduleScan\(0\)/);
  const growth = functionSource("waitForListingGrowth", "function waitForAnimationFrame");
  assert.match(growth, /collectCards\(\)/);
  assert.match(growth, /currentCount > previousCount \|\| currentHeight > previousHeight/);

  const scan = functionSource("scanPage", "function scheduleScan");
  assert.match(scan, /existing && isFinalStatus\(existing\.status\)\) continue/);
  assert.match(scan, /queuedListingIds\.has\(listing\.id\)/);
});
