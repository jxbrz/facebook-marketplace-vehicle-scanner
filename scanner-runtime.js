(function initialiseScannerRuntime(root, factory) {
  const runtime = factory();
  if (typeof module === "object" && module.exports) module.exports = runtime;
  root.ScannerRuntime = runtime;
})(typeof globalThis === "object" ? globalThis : this, function createScannerRuntimeModule() {
  "use strict";

  const WORK_STATES = new Set([
    "unseen",
    "queued",
    "processing",
    "processed",
    "failed_retryable",
    "failed_final"
  ]);

  function normaliseListingUrl(href, baseOrigin = "https://www.facebook.com") {
    try {
      const url = new URL(href, baseOrigin);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      if (!["facebook.com", "www.facebook.com"].includes(url.hostname.toLowerCase())) return null;
      const match = url.pathname.match(/^\/(?:marketplace\/)?item\/(\d+)(?:\/|$)/);
      if (!match) return null;
      return {
        id: match[1],
        url: `${url.origin}/marketplace/item/${match[1]}/`
      };
    } catch {
      return null;
    }
  }

  function mergeScannableEntries(visibleEntries, ledgerEntries, limit = 160) {
    const cappedLimit = Math.max(1, Math.trunc(Number(limit) || 160));
    const entriesById = new Map();
    for (const entry of Array.isArray(visibleEntries) ? visibleEntries : []) {
      const id = entry?.listing?.id;
      if (!id || entriesById.has(id) || entriesById.size >= cappedLimit) continue;
      entriesById.set(id, entry);
    }
    for (const entry of ledgerEntries || []) {
      if (entriesById.size >= cappedLimit) break;
      if (entry?.status !== "discovered" || !entry.url || !entry.metadata) continue;
      if (!entry.listingId || entriesById.has(entry.listingId)) continue;
      entriesById.set(entry.listingId, {
        listing: { id: entry.listingId, url: entry.url },
        card: null,
        metadata: entry.metadata,
        priority: -1
      });
    }
    return [...entriesById.values()];
  }

  function chooseScrollCandidate(candidates) {
    const eligible = (Array.isArray(candidates) ? candidates : [])
      .filter(candidate =>
        candidate &&
        candidate.connected !== false &&
        Number(candidate.range) > 0 &&
        Number(candidate.cardCount) > 0
      );
    if (!eligible.length) return null;

    eligible.sort((left, right) => {
      const coverageDifference = Number(right.cardCount) - Number(left.cardCount);
      if (coverageDifference) return coverageDifference;
      const leftDepth = Number(left.totalDepth) / Math.max(1, Number(left.cardCount));
      const rightDepth = Number(right.totalDepth) / Math.max(1, Number(right.cardCount));
      if (leftDepth !== rightDepth) return leftDepth - rightDepth;
      return Number(right.range) - Number(left.range);
    });
    return eligible[0];
  }

  function nextEndDetectionState(current, observation, limits = {}) {
    const state = {
      stalls: Math.max(0, Number(current?.stalls) || 0),
      endConfirmations: Math.max(0, Number(current?.endConfirmations) || 0),
      complete: false
    };
    const maxStalls = Math.max(1, Number(limits.maxStalls) || 10);
    const requiredEndConfirmations = Math.max(2, Number(limits.endConfirmations) || 4);

    if (observation?.grew) {
      state.stalls = 0;
      state.endConfirmations = 0;
    } else if (observation?.targetReplaced || observation?.moved === false) {
      state.endConfirmations = 0;
    } else {
      state.stalls += 1;
      state.endConfirmations = observation?.atBottom ? state.endConfirmations + 1 : 0;
    }
    state.complete = state.stalls >= maxStalls || state.endConfirmations >= requiredEndConfirmations;
    return state;
  }

  function createBoundedQueue(options = {}) {
    const concurrency = Math.max(1, Math.trunc(Number(options.concurrency) || 1));
    const maxRetries = Math.max(0, Math.trunc(Number(options.maxRetries) || 0));
    const getId = typeof options.getId === "function" ? options.getId : item => item?.id;
    const worker = options.worker;
    if (typeof worker !== "function") throw new Error("A queue worker is required.");

    const jobs = [];
    const states = new Map();
    const retryTimers = new Set();
    let active = 0;
    let stopped = false;

    function snapshot() {
      return {
        queued: jobs.length,
        active,
        stopped,
        states: new Map(states)
      };
    }

    function notify(item, state, details = {}) {
      if (!WORK_STATES.has(state)) throw new Error(`Invalid work state: ${state}`);
      const id = String(getId(item) || "");
      if (id) states.set(id, state);
      options.onState?.(item, state, details);
      options.onChange?.(snapshot());
    }

    function retryDelay(attempt) {
      if (typeof options.retryDelayMs === "function") {
        return Math.max(0, Number(options.retryDelayMs(attempt)) || 0);
      }
      return Math.max(0, Number(options.retryDelayMs) || 0);
    }

    function pump() {
      if (stopped) return;
      while (active < concurrency && jobs.length) {
        const job = jobs.shift();
        active += 1;
        notify(job.item, "processing", { attempt: job.attempt });

        Promise.resolve()
          .then(() => worker(job.item, { attempt: job.attempt }))
          .then(result => notify(job.item, "processed", { attempt: job.attempt, result }))
          .catch(error => {
            const retryable =
              !stopped &&
              job.attempt < maxRetries &&
              options.shouldRetry?.(error, job.item, job.attempt) === true;
            if (!retryable) {
              notify(job.item, "failed_final", { attempt: job.attempt, error });
              return;
            }

            notify(job.item, "failed_retryable", { attempt: job.attempt, error });
            const timer = setTimeout(() => {
              retryTimers.delete(timer);
              if (stopped) return;
              const nextJob = { item: job.item, attempt: job.attempt + 1 };
              jobs.push(nextJob);
              notify(job.item, "queued", { attempt: nextJob.attempt, retry: true });
              pump();
            }, retryDelay(job.attempt + 1));
            retryTimers.add(timer);
          })
          .finally(() => {
            active -= 1;
            options.onChange?.(snapshot());
            pump();
          });
      }
    }

    function enqueue(item) {
      if (stopped) return false;
      const id = String(getId(item) || "");
      if (!id || (states.get(id) && states.get(id) !== "unseen")) return false;
      const job = { item, attempt: 0 };
      jobs.push(job);
      notify(item, "queued", { attempt: 0, retry: false });
      pump();
      return true;
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear();
      for (const job of jobs.splice(0)) notify(job.item, "unseen", { cancelled: true });
      options.onChange?.(snapshot());
    }

    function stateOf(id) {
      return states.get(String(id || "")) || "unseen";
    }

    return { enqueue, pump, snapshot, stateOf, stop };
  }

  return {
    WORK_STATES,
    chooseScrollCandidate,
    createBoundedQueue,
    mergeScannableEntries,
    nextEndDetectionState,
    normaliseListingUrl
  };
});
