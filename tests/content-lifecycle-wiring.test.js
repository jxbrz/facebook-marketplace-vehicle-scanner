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

test("fresh scan metadata snapshots accepted makes and models", () => {
  const payload = functionSource("buildScanCreatePayload", "function resetRunMemory");
  assert.match(payload, /acceptedMakes: settings\.acceptedMakes/);
  assert.match(payload, /acceptedModels: settings\.acceptedModels/);
});
