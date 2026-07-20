const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chooseScrollCandidate,
  createBoundedQueue,
  mergeScannableEntries,
  nextEndDetectionState,
  normaliseListingUrl
} = require("../scanner-runtime.js");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function turn() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function eventually(predicate, turns = 20) {
  for (let index = 0; index < turns; index += 1) {
    if (predicate()) return;
    await turn();
  }
  assert.fail("Condition was not reached");
}

test("listing identity canonicalises Facebook URL variants and rejects malformed or external URLs", () => {
  assert.deepEqual(
    normaliseListingUrl("/marketplace/item/123456/?ref=search", "https://www.facebook.com"),
    { id: "123456", url: "https://www.facebook.com/marketplace/item/123456/" }
  );
  assert.deepEqual(
    normaliseListingUrl("https://facebook.com/item/123456?tracking=1"),
    { id: "123456", url: "https://facebook.com/marketplace/item/123456/" }
  );
  assert.equal(normaliseListingUrl("/marketplace/item/not-a-number/"), null);
  assert.equal(normaliseListingUrl("https://example.com/marketplace/item/123456/"), null);
  assert.equal(normaliseListingUrl("ftp://facebook.com/marketplace/item/123456/"), null);
  assert.equal(normaliseListingUrl("https://facebook.com/unrelated/item/123456/"), null);
});

test("recycled DOM cards remain scannable from the canonical-ID ledger", () => {
  const visible = [{ listing: { id: "1", url: "one" }, metadata: { title: "one" }, priority: 1 }];
  const ledger = [
    { listingId: "1", status: "discovered", url: "one", metadata: { title: "old one" } },
    { listingId: "2", status: "discovered", url: "two", metadata: { title: "two" } },
    { listingId: "3", status: "matched", url: "three", metadata: { title: "three" } }
  ];
  const merged = mergeScannableEntries(visible, ledger, 10);
  assert.deepEqual(merged.map(entry => entry.listing.id), ["1", "2"]);
  assert.equal(merged[1].card, null);
  assert.equal(merged[1].priority, -1);
});

test("scroll selection uses window when it is the only card-bearing scroll target", () => {
  const windowCandidate = { id: "window", cardCount: 8, totalDepth: 80, range: 3000 };
  assert.equal(chooseScrollCandidate([windowCandidate]).id, "window");
});

test("scroll selection prefers the closest card-bearing nested container", () => {
  const windowCandidate = { id: "window", cardCount: 8, totalDepth: 80, range: 9000 };
  const nestedCandidate = { id: "results", cardCount: 8, totalDepth: 16, range: 2400 };
  assert.equal(chooseScrollCandidate([windowCandidate, nestedCandidate]).id, "results");
});

test("scroll selection ignores a replaced disconnected container", () => {
  const replaced = { id: "old", cardCount: 8, totalDepth: 8, range: 2400, connected: false };
  const current = { id: "current", cardCount: 8, totalDepth: 16, range: 2200 };
  assert.equal(chooseScrollCandidate([replaced, current]).id, "current");
});

test("end detection continues after growth and one empty scroll", () => {
  let state = nextEndDetectionState(null, { grew: false, moved: true, atBottom: true });
  assert.equal(state.complete, false);
  state = nextEndDetectionState(state, { grew: true, moved: true, atBottom: false });
  assert.deepEqual(state, { stalls: 0, endConfirmations: 0, complete: false });
  for (let index = 0; index < 3; index += 1) {
    state = nextEndDetectionState(state, { grew: false, moved: true, atBottom: true });
    assert.equal(state.complete, false);
  }
  state = nextEndDetectionState(state, { grew: false, moved: true, atBottom: true });
  assert.equal(state.complete, true);
});

test("target replacement and failed movement do not confirm end of results", () => {
  let state = { stalls: 2, endConfirmations: 2 };
  state = nextEndDetectionState(state, { targetReplaced: true, atBottom: true });
  assert.deepEqual(state, { stalls: 2, endConfirmations: 0, complete: false });
  state = nextEndDetectionState(state, { moved: false, atBottom: true });
  assert.deepEqual(state, { stalls: 2, endConfirmations: 0, complete: false });
});

test("bounded queue lets other work progress while one listing is slow", async () => {
  const work = new Map();
  const started = [];
  const queue = createBoundedQueue({
    concurrency: 2,
    getId: item => item.id,
    worker(item) {
      started.push(item.id);
      const gate = deferred();
      work.set(item.id, gate);
      return gate.promise;
    }
  });

  assert.equal(queue.enqueue({ id: "slow" }), true);
  assert.equal(queue.enqueue({ id: "fast" }), true);
  assert.equal(queue.enqueue({ id: "third" }), true);
  assert.equal(queue.enqueue({ id: "slow" }), false);
  await eventually(() => started.length === 2);
  assert.deepEqual(started, ["slow", "fast"]);
  assert.deepEqual(queue.snapshot().active, 2);

  work.get("fast").resolve();
  await eventually(() => started.includes("third"));
  assert.equal(queue.stateOf("slow"), "processing");
  assert.equal(queue.stateOf("third"), "processing");

  work.get("slow").resolve();
  work.get("third").resolve();
  await eventually(() => queue.snapshot().active === 0);
  assert.equal(queue.stateOf("slow"), "processed");
  assert.equal(queue.stateOf("fast"), "processed");
  assert.equal(queue.stateOf("third"), "processed");
});

test("retryable failures release the slot and retry only to the maximum", async () => {
  const attempts = [];
  const states = [];
  const queue = createBoundedQueue({
    concurrency: 1,
    maxRetries: 1,
    retryDelayMs: 0,
    getId: item => item.id,
    shouldRetry: () => true,
    onState: (item, state) => states.push(`${item.id}:${state}`),
    async worker(item, context) {
      attempts.push(`${item.id}:${context.attempt}`);
      if (item.id === "bad") throw new Error("transient");
    }
  });

  queue.enqueue({ id: "bad" });
  queue.enqueue({ id: "good" });
  await eventually(() => queue.stateOf("bad") === "failed_final");
  assert.deepEqual(attempts, ["bad:0", "good:0", "bad:1"]);
  assert.equal(states.filter(state => state === "bad:failed_retryable").length, 1);
  assert.equal(queue.stateOf("good"), "processed");
});

test("stopping cancels queued jobs and prevents new work", async () => {
  const gate = deferred();
  const queue = createBoundedQueue({
    concurrency: 1,
    getId: item => item.id,
    worker: () => gate.promise
  });
  queue.enqueue({ id: "active" });
  queue.enqueue({ id: "queued" });
  await eventually(() => queue.stateOf("active") === "processing");
  queue.stop();
  assert.equal(queue.stateOf("queued"), "unseen");
  assert.equal(queue.enqueue({ id: "later" }), false);
  gate.resolve();
  await eventually(() => queue.snapshot().active === 0);
});
