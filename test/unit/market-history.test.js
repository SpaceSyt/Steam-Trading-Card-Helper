import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKET_HISTORY_SCHEMA_VERSION,
  aggregateMarketHistoryRecords,
  createMarketHistoryEnvelope,
  decodeMarketHistory,
  getMarketHistoryStatistics,
  getMarketOverviewMetrics,
  getMarketSparklinePoints,
  groupMarketHistoryRecordsByItem,
  pruneMarketHistory,
  selectMarketHistoryRecords,
  upsertManyMarketHistory,
  upsertManyStoredMarketHistory,
  upsertMarketHistory,
} from "../../src/services/market-history.js";

const BASE_AT = 1_720_000_000_000;
const HOUR_MS = 60 * 60 * 1000;
const HOUR_START_AT = Math.floor(BASE_AT / HOUR_MS) * HOUR_MS;

function makeRecord(overrides = {}) {
  return {
    appid: "753",
    marketHashName: "570-Synthetic Card",
    currencyId: 23,
    currencyCode: "CNY",
    lowestSellMinor: 32,
    medianMinor: 35,
    highestBuyMinor: null,
    volume: 12,
    observedAt: BASE_AT,
    source: "priceoverview",
    ...overrides,
  };
}

test("history samples remain isolated by currency and source", () => {
  const history = upsertManyMarketHistory(createMarketHistoryEnvelope(), [
    makeRecord(),
    makeRecord({ currencyId: 1, currencyCode: "USD" }),
    makeRecord({
      source: "listing-orderbook",
      lowestSellMinor: 31,
      medianMinor: null,
      highestBuyMinor: 29,
      volume: null,
    }),
  ], { ttlMs: Infinity });

  assert.equal(history.records.length, 3);
  assert.equal(selectMarketHistoryRecords(history, {
    appid: 753,
    marketHashName: "570-Synthetic Card",
    currencyId: 23,
  }, { ttlMs: Infinity }).length, 2);
  assert.equal(selectMarketHistoryRecords(history, {
    appid: 753,
    marketHashName: "570-Synthetic Card",
    currencyId: 1,
  }, { ttlMs: Infinity }).length, 1);
});

test("the newest observation replaces the same source sample within one hour", () => {
  const initial = upsertMarketHistory(createMarketHistoryEnvelope(), makeRecord({
    observedAt: HOUR_START_AT + 10 * 60 * 1000,
    lowestSellMinor: 30,
  }), { ttlMs: Infinity });
  const replaced = upsertMarketHistory(initial, makeRecord({
    observedAt: HOUR_START_AT + 50 * 60 * 1000,
    lowestSellMinor: 40,
  }), { ttlMs: Infinity });
  const unchanged = upsertMarketHistory(replaced, makeRecord({
    observedAt: HOUR_START_AT + 20 * 60 * 1000,
    lowestSellMinor: 35,
  }), { ttlMs: Infinity });

  assert.equal(replaced.records.length, 1);
  assert.equal(replaced.records[0].lowestSellMinor, 40);
  assert.equal(replaced.records[0].observedAt, HOUR_START_AT + 50 * 60 * 1000);
  assert.deepEqual(unchanged, replaced);
});

test("pruning applies TTL before retaining the newest global entries", () => {
  const history = createMarketHistoryEnvelope([
    makeRecord({ observedAt: BASE_AT + 1_000, marketHashName: "A" }),
    makeRecord({ observedAt: BASE_AT + 5_000, marketHashName: "B" }),
    makeRecord({ observedAt: BASE_AT + 7_000, marketHashName: "C" }),
    makeRecord({ observedAt: BASE_AT + 9_000, marketHashName: "D" }),
  ], { sampleIntervalMs: 1 });

  const pruned = pruneMarketHistory(history, {
    now: BASE_AT + 10_000,
    ttlMs: 6_000,
    maxEntries: 2,
    sampleIntervalMs: 1,
  });

  assert.deepEqual(pruned.records.map(record => record.marketHashName), ["C", "D"]);
});

test("global pruning preserves a recent sample for each item before deeper history", () => {
  const history = createMarketHistoryEnvelope([
    makeRecord({ observedAt: BASE_AT + 8_000, marketHashName: "A" }),
    makeRecord({ observedAt: BASE_AT + 9_000, marketHashName: "A", source: "listing-orderbook" }),
    makeRecord({ observedAt: BASE_AT + 10_000, marketHashName: "A", source: "legacy-source" }),
    makeRecord({ observedAt: BASE_AT + 1_000, marketHashName: "B" }),
  ], { sampleIntervalMs: 1 });

  const pruned = pruneMarketHistory(history, {
    now: BASE_AT + 10_000,
    ttlMs: Infinity,
    maxEntries: 2,
    sampleIntervalMs: 1,
  });

  assert.deepEqual(pruned.records.map(record => record.marketHashName), ["A", "B"]);
  assert.equal(pruned.records.find(record => record.marketHashName === "A").observedAt, BASE_AT + 10_000);
});

test("range selection is inclusive, identity-scoped, and chronological", () => {
  const history = createMarketHistoryEnvelope([
    makeRecord({ observedAt: BASE_AT + 3_000, lowestSellMinor: 33 }),
    makeRecord({ observedAt: BASE_AT + 1_000, lowestSellMinor: 31 }),
    makeRecord({ observedAt: BASE_AT + 2_000, lowestSellMinor: 32 }),
    makeRecord({
      observedAt: BASE_AT + 2_500,
      marketHashName: "Different Card",
      lowestSellMinor: 99,
    }),
  ], { sampleIntervalMs: 1 });

  const selected = selectMarketHistoryRecords(history, {
    appid: 753,
    market_hash_name: "570-Synthetic Card",
    currency: 23,
  }, {
    from: BASE_AT + 2_000,
    to: BASE_AT + 3_000,
    now: BASE_AT + 3_000,
    sampleIntervalMs: 1,
  });

  assert.deepEqual(selected.map(record => record.lowestSellMinor), [32, 33]);
  assert.deepEqual(selected.map(record => record.observedAt), [
    BASE_AT + 2_000,
    BASE_AT + 3_000,
  ]);
});

test("aggregation merges endpoint fields in bounded chronological buckets", () => {
  const points = aggregateMarketHistoryRecords([
    makeRecord({
      observedAt: BASE_AT,
      lowestSellMinor: 30,
      medianMinor: 32,
      volume: 10,
    }),
    makeRecord({
      observedAt: BASE_AT + 20,
      source: "listing-orderbook",
      lowestSellMinor: null,
      medianMinor: null,
      highestBuyMinor: 28,
      volume: null,
    }),
    makeRecord({
      observedAt: BASE_AT + 100,
      lowestSellMinor: 35,
      medianMinor: 36,
      volume: 20,
    }),
  ], { maxPoints: 2 });

  assert.deepEqual(points, [
    {
      observedAt: BASE_AT + 20,
      lowestSellMinor: 30,
      medianMinor: 32,
      highestBuyMinor: 28,
      volume: 10,
    },
    {
      observedAt: BASE_AT + 100,
      lowestSellMinor: 35,
      medianMinor: 36,
      highestBuyMinor: null,
      volume: 20,
    },
  ]);
});

test("statistics report current, extrema, absolute change, and percentage change", () => {
  const statistics = getMarketHistoryStatistics([
    { lowestSellMinor: 20 },
    { lowestSellMinor: 15 },
    { lowestSellMinor: 30 },
    { lowestSellMinor: 25 },
  ], "lowestSellMinor");

  assert.deepEqual(statistics, {
    first: 20,
    current: 25,
    low: 15,
    high: 30,
    change: 5,
    percentChange: 25,
    sampleCount: 4,
  });
  assert.equal(getMarketHistoryStatistics([], "lowestSellMinor"), null);
  assert.equal(getMarketHistoryStatistics([
    { lowestSellMinor: null },
    { lowestSellMinor: undefined },
  ], "lowestSellMinor"), null);
  assert.equal(getMarketHistoryStatistics([{ lowestSellMinor: 20 }], "unknown"), null);
});

test("selection and pruning exclude expired and far-future observations", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = BASE_AT + 400 * day;
  const current = makeRecord({ observedAt: now - day, lowestSellMinor: 31 });
  const expired = makeRecord({ observedAt: now - 366 * day, lowestSellMinor: 30 });
  const future = makeRecord({ observedAt: now + 10 * 60 * 1000, lowestSellMinor: 99 });
  const history = createMarketHistoryEnvelope([expired, current, future]);

  assert.deepEqual(
    selectMarketHistoryRecords(history, current, { now }).map(record => record.lowestSellMinor),
    [31]
  );
  assert.deepEqual(
    pruneMarketHistory(history, { now }).records.map(record => record.lowestSellMinor),
    [31]
  );
});

test("invalid JSON is diagnosed without manufacturing an empty history", () => {
  const decoded = decodeMarketHistory("{not-json");

  assert.equal(decoded.ok, false);
  assert.equal(decoded.envelope, null);
  assert.equal(decoded.history, null);
  assert.equal(decoded.diagnostics[0].code, "invalid-json");
});

test("stored upsert refuses to overwrite corrupt persisted data", () => {
  let writes = 0;
  const result = upsertManyStoredMarketHistory([makeRecord()], {
    getValue: () => "{corrupt",
    setValue: () => { writes += 1; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.saved, false);
  assert.equal(result.diagnostics[0].code, "invalid-json");
  assert.equal(writes, 0);
});

test("stored batch upsert performs one GM read and one GM write", () => {
  let reads = 0;
  let writes = 0;
  let storedKey = null;
  let storedRaw = null;
  const result = upsertManyStoredMarketHistory([
    makeRecord(),
    makeRecord({
      source: "listing-orderbook",
      lowestSellMinor: 31,
      medianMinor: null,
      highestBuyMinor: 29,
      volume: null,
    }),
  ], {
    getValue: () => {
      reads += 1;
      return null;
    },
    setValue: (key, raw) => {
      writes += 1;
      storedKey = key;
      storedRaw = raw;
    },
    now: BASE_AT,
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  assert.equal(storedKey, "stch_market_history");
  const stored = JSON.parse(storedRaw);
  assert.equal(stored.schemaVersion, MARKET_HISTORY_SCHEMA_VERSION);
  assert.equal(stored.records.length, 2);
});

test("records with every history metric missing are rejected", () => {
  const emptyMetrics = makeRecord({
    lowestSellMinor: null,
    medianMinor: null,
    highestBuyMinor: null,
    volume: null,
  });

  assert.throws(
    () => upsertMarketHistory(createMarketHistoryEnvelope(), emptyMetrics),
    TypeError
  );

  const decoded = decodeMarketHistory(JSON.stringify({
    schemaVersion: MARKET_HISTORY_SCHEMA_VERSION,
    records: [emptyMetrics],
  }));
  assert.equal(decoded.ok, false);
  assert.equal(decoded.envelope.records.length, 0);
  assert.equal(decoded.diagnostics[0].code, "invalid-records-dropped");
});

test("overview metrics use only the latest priceoverview rolling snapshot", () => {
  const records = [
    makeRecord({ observedAt: BASE_AT + 2000, lowestSellMinor: 34, volume: 1500 }),
    makeRecord({ observedAt: BASE_AT, lowestSellMinor: 32, volume: 1200 }),
    makeRecord({
      observedAt: BASE_AT + 2500,
      source: "listing-orderbook",
      lowestSellMinor: 34,
      medianMinor: null,
      highestBuyMinor: 30,
      volume: 9999,
    }),
    makeRecord({ observedAt: BASE_AT + 1000, lowestSellMinor: null, volume: 1400 }),
    makeRecord({ observedAt: BASE_AT + 3000, lowestSellMinor: 36, volume: null }),
  ];

  assert.deepEqual(getMarketOverviewMetrics(records), {
    currentMinor: 36,
    previousMinor: 34,
    changeMinor: 2,
    percentChange: (2 / 34) * 100,
    volume24h: 1500,
    observedAt: BASE_AT + 3000,
    priceSampleCount: 3,
  });
});

test("a latest no-price snapshot does not expose an older sample as current", () => {
  const records = [
    makeRecord({ observedAt: BASE_AT, lowestSellMinor: 32, volume: 1200 }),
    makeRecord({ observedAt: BASE_AT + 1000, lowestSellMinor: null, volume: 1400 }),
  ];

  assert.deepEqual(getMarketOverviewMetrics(records), {
    currentMinor: null,
    previousMinor: null,
    changeMinor: null,
    percentChange: null,
    volume24h: 1400,
    observedAt: BASE_AT + 1000,
    priceSampleCount: 1,
  });
});

test("sparkline points are chronological, range-filtered, and bounded", () => {
  const records = Array.from({ length: 150 }, (_, index) => makeRecord({
    observedAt: BASE_AT + index,
    lowestSellMinor: 20 + index,
  }));
  records.push(makeRecord({
    observedAt: BASE_AT + 200,
    source: "listing-orderbook",
    lowestSellMinor: 999,
  }));

  const points = getMarketSparklinePoints(records.reverse(), {
    from: BASE_AT + 10,
    maxPoints: 96,
  });
  assert.equal(points.length, 96);
  assert.deepEqual(points[0], { observedAt: BASE_AT + 10, value: 30 });
  assert.deepEqual(points.at(-1), { observedAt: BASE_AT + 149, value: 169 });
  assert.ok(points.every((point, index) => (
    index === 0 || point.observedAt >= points[index - 1].observedAt
  )));
});

test("multi-item overview grouping isolates one currency in a single index", () => {
  const otherName = "570-Other Card";
  const history = createMarketHistoryEnvelope([
    makeRecord({ observedAt: BASE_AT + HOUR_MS * 2 }),
    makeRecord({ observedAt: BASE_AT + HOUR_MS }),
    makeRecord({ marketHashName: otherName, observedAt: BASE_AT + HOUR_MS * 3 }),
    makeRecord({ marketHashName: otherName, currencyId: 1, observedAt: BASE_AT + HOUR_MS * 4 }),
  ]);
  const groups = groupMarketHistoryRecordsByItem(history, {
    appid: "753",
    currencyId: 23,
  }, { ttlMs: Infinity, now: BASE_AT + HOUR_MS * 5 });

  assert.equal(groups.size, 2);
  assert.deepEqual(
    groups.get("570-Synthetic Card").map(record => record.observedAt),
    [BASE_AT + HOUR_MS, BASE_AT + HOUR_MS * 2]
  );
  assert.equal(groups.get(otherName).length, 1);
});
