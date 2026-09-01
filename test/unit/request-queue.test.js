import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { RequestQueue } from "../../src/request/queue.js";
import {
  getPriceOverviewRateState,
  reservePriceOverviewRequest,
  resetPriceOverviewRateState,
} from "../../src/request/price-overview-rate.js";

const PRICE_URL = "https://steamcommunity.com/market/priceoverview/?fixture=1";
const ORDINARY_URL = "https://steamcommunity.com/profiles/1/badges/?p=1";

class ManualTimers {
  constructor() {
    this.time = 0;
    this.nextId = 1;
    this.tasks = new Map();
  }

  now() {
    return this.time;
  }

  setTimeout(callback, delay = 0) {
    const id = this.nextId++;
    this.tasks.set(id, {
      callback,
      dueAt: this.time + Math.max(0, Number(delay) || 0),
    });
    return id;
  }

  clearTimeout(id) {
    this.tasks.delete(id);
  }

  advanceBy(ms) {
    const target = this.time + Math.max(0, Number(ms) || 0);
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.time = task.dueAt;
      task.callback();
    }
    this.time = target;
  }

  get pendingCount() {
    return this.tasks.size;
  }
}

function response(status, body = { success: status >= 200 && status < 300 }) {
  const text = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
  };
}

function capture(promise) {
  return promise.then(
    value => ({ status: "fulfilled", value }),
    reason => ({ status: "rejected", reason })
  );
}

async function flushUntil(predicate, description) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(`Timed out waiting for ${description}`);
}

function createQueue({
  fetchImpl,
  timers,
  interval = 0,
  state = null,
  onStatus = null,
  stopPredicate = () => false,
}) {
  return new RequestQueue(
    interval,
    state,
    onStatus,
    null,
    {
      fetch: fetchImpl,
      timer: timers,
      stopPredicate,
    }
  );
}

function assertStoppedAndClean(queue) {
  assert.equal(queue.stopped, true);
  assert.equal(queue.running, false);
  assert.equal(queue.cooling, false);
  assert.equal(queue._consecutive429, 0);
  assert.equal(queue._currentJob, null);
  assert.equal(queue._currentController, null);
  assert.equal(queue._waiters.size, 0);
  assert.equal(queue.queue.length, 0);
}

afterEach(resetPriceOverviewRateState);

test("a scoped stop predicate ignores another feature's stop flag", async () => {
  const state = {
    stopRequested: false,
    craftStopRequested: true,
    cfg: {},
  };
  const queue = createQueue({
    state,
    fetchImpl: async () => response(200),
    stopPredicate: currentState => currentState.stopRequested,
  });

  const result = await queue.fetch(ORDINARY_URL);
  assert.equal(result.status, 200);
  queue.stop();
});

test("stop interrupts the shared priceoverview cooldown without later status writes", async () => {
  const timers = new ManualTimers();
  const statuses = [];
  for (let index = 0; index < 20; index++) reservePriceOverviewRequest(timers.now());
  const queue = createQueue({
    timers,
    fetchImpl: async () => response(200),
    onStatus: text => statuses.push(text),
  });

  const result = capture(queue.fetch(PRICE_URL));
  await flushUntil(() => queue.cooling, "proactive cooldown to begin");
  assert.match(statuses.at(-1), /^主动冷却中/);
  assert.equal(timers.pendingCount, 1);

  const statusCountAtStop = statuses.length;
  queue.stop();
  await result;
  await flushUntil(() => !queue.running, "the stopped queue to become idle");
  timers.advanceBy(120000);
  await Promise.resolve();

  assert.equal(statuses.length, statusCountAtStop);
  assert.equal(timers.pendingCount, 0);
  assertStoppedAndClean(queue);
});

test("stop interrupts a 429 wait and rejects the active and queued jobs", async () => {
  const timers = new ManualTimers();
  const statuses = [];
  let fetchCalls = 0;
  const queue = createQueue({
    timers,
    fetchImpl: async () => {
      fetchCalls++;
      return response(429);
    },
    onStatus: text => statuses.push(text),
  });

  const active = capture(queue.fetch(PRICE_URL));
  const queued = capture(queue.fetch(ORDINARY_URL));
  await flushUntil(() => queue.cooling, "429 cooldown to begin");
  assert.match(statuses.at(-1), /^429 限流冷却中/);

  const statusCountAtStop = statuses.length;
  queue.stop();
  const [activeResult, queuedResult] = await Promise.all([active, queued]);
  await flushUntil(() => !queue.running, "the 429 queue to become idle");
  timers.advanceBy(120000);
  await Promise.resolve();

  assert.deepEqual(activeResult, {
    status: "rejected",
    reason: { status: 0, error: "stopped" },
  });
  assert.deepEqual(queuedResult, {
    status: "rejected",
    reason: { status: 0, error: "stopped" },
  });
  assert.equal(fetchCalls, 1);
  assert.equal(statuses.length, statusCountAtStop);
  assert.equal(timers.pendingCount, 0);
  assertStoppedAndClean(queue);
});

test("stop aborts an active fetch and settles even if the transport is pending", async () => {
  const timers = new ManualTimers();
  let activeSignal = null;
  let abortEvents = 0;
  const queue = createQueue({
    timers,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      activeSignal = options.signal;
      activeSignal?.addEventListener("abort", () => {
        abortEvents++;
        reject(new Error("aborted by test transport"));
      }, { once: true });
    }),
  });

  const request = capture(queue.fetch(ORDINARY_URL));
  await flushUntil(() => activeSignal != null, "fetch to receive an AbortSignal");
  assert.equal(activeSignal.aborted, false);

  queue.stop();
  const result = await request;
  await flushUntil(() => !queue.running, "the active request to unwind");

  assert.deepEqual(result, {
    status: "rejected",
    reason: { status: 0, error: "stopped" },
  });
  assert.equal(activeSignal.aborted, true);
  assert.equal(abortEvents, 1);
  assertStoppedAndClean(queue);
});

test("ordinary requests do not count, cool down, or retry 429 responses", async () => {
  const timers = new ManualTimers();
  const statuses = [];
  const fetchCalls = [];
  const queue = createQueue({
    timers,
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return response(url.includes("ordinary-429") ? 429 : 200);
    },
    onStatus: text => statuses.push(text),
  });

  await queue.fetch(ORDINARY_URL, { headers: { Accept: "text/html" } });
  await flushUntil(() => !queue.running, "ordinary request to finish");

  await queue.fetch(PRICE_URL, {
    policy: "default",
    requestPolicy: "priceoverview",
    endpointPolicy: "priceoverview",
    credentials: "omit",
  });
  await flushUntil(() => !queue.running, "policy-overridden request to finish");

  const limited = await capture(queue.fetch(`${ORDINARY_URL}&ordinary-429=1`));
  await flushUntil(() => !queue.running, "ordinary 429 request to finish");

  assert.deepEqual(limited, {
    status: "rejected",
    reason: {
      status: 429,
      text: JSON.stringify({ success: false }),
      data: { success: false },
    },
  });
  assert.equal(fetchCalls.length, 3);
  assert.equal(fetchCalls[1].options.credentials, "omit");
  for (const { options } of fetchCalls) {
    assert.equal(Object.hasOwn(options, "policy"), false);
    assert.equal(Object.hasOwn(options, "requestPolicy"), false);
    assert.equal(Object.hasOwn(options, "endpointPolicy"), false);
  }
  assert.equal(queue._consecutive429, 0);
  assert.equal(getPriceOverviewRateState(timers.now()).count, 0);
  assert.equal(statuses.some(text => /冷却/.test(text)), false);
  assert.equal(timers.pendingCount, 0);
  queue.stop();
  assertStoppedAndClean(queue);
});

test("priceoverview retries 429 responses under its endpoint policy", async () => {
  const timers = new ManualTimers();
  let fetchCalls = 0;
  const queue = createQueue({
    timers,
    fetchImpl: async () => {
      fetchCalls++;
      return fetchCalls === 1
        ? response(429)
        : response(200, { success: true, retried: true });
    },
  });

  const pending = queue.fetch(PRICE_URL);
  await flushUntil(() => queue.cooling, "429 cooldown to begin");
  timers.advanceBy(60000);
  const result = await pending;
  await flushUntil(() => !queue.running, "retried request to finish");

  assert.equal(result.data.retried, true);
  assert.equal(fetchCalls, 2);
  assert.equal(queue._consecutive429, 0);
  assert.equal(getPriceOverviewRateState(timers.now()).count, 1);
  queue.stop();
  assertStoppedAndClean(queue);
});

test("a one-shot priceoverview request can disable 429 retries", async () => {
  const timers = new ManualTimers();
  let fetchCalls = 0;
  const queue = createQueue({
    timers,
    fetchImpl: async () => {
      fetchCalls++;
      return response(429);
    },
  });

  const result = await capture(queue.fetch(PRICE_URL, {
    requestPolicy: { base: "priceoverview", retry429: false },
  }));
  await flushUntil(() => !queue.running, "one-shot request to finish");

  assert.equal(result.status, "rejected");
  assert.equal(result.reason.status, 429);
  assert.equal(fetchCalls, 1);
  assert.equal(queue.cooling, false);
  assert.equal(getPriceOverviewRateState(timers.now()).count, 1);
  queue.stop();
});

test("new queues share the same priceoverview request count", async () => {
  const timers = new ManualTimers();
  const oldQueue = createQueue({
    timers,
    fetchImpl: async () => response(200),
  });

  await oldQueue.fetch(PRICE_URL);
  oldQueue.stop();
  await flushUntil(() => !oldQueue.running, "old queue to stop");
  assertStoppedAndClean(oldQueue);
  assert.equal(timers.pendingCount, 0);

  let newFetchCalls = 0;
  const newQueue = createQueue({
    timers,
    fetchImpl: async () => {
      newFetchCalls++;
      return response(200, { success: true, queue: "new" });
    },
  });
  const result = await newQueue.fetch(PRICE_URL);
  await flushUntil(() => !newQueue.running, "new queue request to finish");

  assert.equal(result.data.queue, "new");
  assert.equal(newFetchCalls, 1);
  assert.equal(newQueue.stopped, false);
  assert.equal(newQueue.cooling, false);
  assert.equal(getPriceOverviewRateState(timers.now()).count, 2);
  assert.equal(timers.pendingCount, 0);

  newQueue.stop();
  assertStoppedAndClean(newQueue);
});
