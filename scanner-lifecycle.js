(function initialiseScannerLifecycle(root, factory) {
  const lifecycle = factory();
  if (typeof module === "object" && module.exports) module.exports = lifecycle;
  root.ScannerLifecycle = lifecycle;
})(typeof globalThis === "object" ? globalThis : this, function createScannerLifecycle() {
  "use strict";

  const TERMINAL_SCAN_STATUSES = new Set([
    "completed",
    "stopped",
    "failed",
    "limit_reached",
    "timed_out"
  ]);

  function classifyPersistedRun(state) {
    if (!state || state.version !== 19 || !state.remoteRun?.scanId) {
      return { lifecycleState: "idle", historicalStatus: null, allowSyncRecovery: false };
    }

    const status = String(state.scanStatus || "idle");
    if (!state.scanFinalised && status === "paused") {
      return { lifecycleState: "paused", historicalStatus: status, allowSyncRecovery: false };
    }
    const wasExecuting = Boolean(state.scanningActive) || ["creating", "running", "stopping", "interrupted"].includes(status);
    if (!state.scanFinalised && wasExecuting) {
      return { lifecycleState: "interrupted", historicalStatus: status, allowSyncRecovery: false };
    }

    if (status === "failed") {
      return { lifecycleState: "idle", historicalStatus: status, allowSyncRecovery: false };
    }

    const syncWasPending = !state.remoteCompleted && ["pending", "syncing"].includes(state.remoteSyncState);
    if (state.scanFinalised && syncWasPending) {
      return { lifecycleState: "syncing", historicalStatus: status, allowSyncRecovery: true };
    }

    return {
      lifecycleState: "idle",
      historicalStatus: TERMINAL_SCAN_STATUSES.has(status) ? status : null,
      allowSyncRecovery: false
    };
  }

  function transition(currentState, event) {
    if (event === "START" && currentState !== "interrupted") return "running";
    if (event === "RESUME" && ["interrupted", "paused"].includes(currentState)) return "running";
    if (event === "PAUSE" && currentState === "running") return "paused";
    if (event === "STOP" && ["running", "paused"].includes(currentState)) return "stopping";
    if (event === "SYNC" && currentState !== "running" && currentState !== "stopping") return "syncing";
    if (event === "COMPLETE") return "completed";
    if (event === "STOPPED") return "stopped";
    if (event === "FAIL") return "failed";
    if (event === "DISCARD") return "idle";
    return currentState;
  }

  function permitsScanningActivity(lifecycleState) {
    return lifecycleState === "running";
  }

  return { classifyPersistedRun, permitsScanningActivity, transition };
});
