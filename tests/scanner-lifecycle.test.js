const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyPersistedRun,
  permitsScanningActivity,
  transition
} = require("../scanner-lifecycle.js");

function persisted(overrides = {}) {
  return {
    version: 19,
    remoteRun: { scanId: "scan-1" },
    scanStatus: "running",
    scanningActive: true,
    scanFinalised: false,
    remoteCompleted: false,
    remoteSyncState: "synced",
    ...overrides
  };
}

test("opening Facebook without active state or with settings only stays idle", () => {
  assert.equal(classifyPersistedRun(null).lifecycleState, "idle");
  assert.equal(classifyPersistedRun({ acceptedMakes: ["Volkswagen"] }).lifecycleState, "idle");
  assert.equal(permitsScanningActivity("idle"), false);
});

test("completed, stopped, and failed runs remain terminal and idle after reload", () => {
  for (const scanStatus of ["completed", "stopped", "failed"]) {
    const result = classifyPersistedRun(persisted({
      scanStatus,
      scanningActive: false,
      scanFinalised: true,
      remoteCompleted: true,
      remoteSyncState: "synced"
    }));
    assert.equal(result.lifecycleState, "idle");
    assert.equal(result.historicalStatus, scanStatus);
    assert.equal(result.allowSyncRecovery, false);
  }
});

test("interrupted execution never auto-resumes and requires explicit Resume", () => {
  const startup = classifyPersistedRun(persisted());
  assert.equal(startup.lifecycleState, "interrupted");
  assert.equal(permitsScanningActivity(startup.lifecycleState), false);
  assert.equal(transition("interrupted", "START"), "interrupted");
  assert.equal(transition("interrupted", "RESUME"), "running");
});

test("Discard clears execution state without implying a settings reset", () => {
  assert.equal(transition("interrupted", "DISCARD"), "idle");
  assert.equal(permitsScanningActivity("idle"), false);
});

test("sync recovery and Retry sync can upload but cannot discover", () => {
  const startup = classifyPersistedRun(persisted({
    scanStatus: "completed",
    scanningActive: false,
    scanFinalised: true,
    remoteSyncState: "pending"
  }));
  assert.equal(startup.lifecycleState, "syncing");
  assert.equal(startup.allowSyncRecovery, true);
  assert.equal(permitsScanningActivity(startup.lifecycleState), false);
  assert.equal(transition("completed", "SYNC"), "syncing");
  assert.equal(permitsScanningActivity(transition("completed", "SYNC")), false);
  const failed = classifyPersistedRun(persisted({
    scanStatus: "failed",
    scanningActive: false,
    scanFinalised: true,
    remoteSyncState: "pending"
  }));
  assert.equal(failed.lifecycleState, "idle");
  assert.equal(failed.allowSyncRecovery, false);
});

test("only explicit Start or Resume enters running and terminal events leave it", () => {
  assert.equal(transition("idle", "START"), "running");
  assert.equal(transition("completed", "AUTO_OPEN_RESULTS"), "completed");
  assert.equal(transition("running", "COMPLETE"), "completed");
  assert.equal(transition("running", "STOPPED"), "stopped");
  assert.equal(transition("running", "FAIL"), "failed");
  for (const state of ["completed", "stopped", "failed", "syncing", "idle"]) {
    assert.equal(permitsScanningActivity(state), false);
  }
});

test("Pause is non-terminal, persists safely, and requires explicit Resume", () => {
  assert.equal(transition("running", "PAUSE"), "paused");
  assert.equal(permitsScanningActivity("paused"), false);
  assert.equal(transition("paused", "RESUME"), "running");
  assert.equal(transition("paused", "STOP"), "stopping");

  const startup = classifyPersistedRun(persisted({
    scanStatus: "paused",
    lifecycleState: "paused",
    scanningActive: false,
    scanFinalised: false
  }));
  assert.equal(startup.lifecycleState, "paused");
  assert.equal(startup.allowSyncRecovery, false);
});
