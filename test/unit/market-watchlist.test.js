import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKET_WATCHLIST_SCHEMA_VERSION,
  MARKET_WATCHLIST_STORAGE_KEY,
  decodeMarketWatchlist,
  getMarketWatchlistKey,
  normalizeMarketWatchItem,
  normalizeMarketWatchlist,
  removeMarketWatchlistItem,
  removeStoredMarketWatchItem,
  upsertMarketWatchlist,
  upsertStoredMarketWatchItem,
} from "../../src/services/market-watchlist.js";

const BASE_AT = 1_720_000_000_000;
const SACK_HASH_NAME = "753-Sack of Gems";

function makeItem(overrides = {}) {
  return {
    appid: "753",
    marketHashName: SACK_HASH_NAME,
    currencyId: 23,
    displayName: "宝石袋",
    imageUrl: "https://community.fastly.steamstatic.com/economy/image/synthetic-sack",
    addedAt: BASE_AT,
    sellOrderCount: 1200,
    metadataObservedAt: BASE_AT + 1000,
    ...overrides,
  };
}

function createMemoryStore(entries = []) {
  const values = new Map(entries);
  const reads = [];
  const writes = [];
  return {
    values,
    reads,
    writes,
    getValue(key, fallback) {
      reads.push(key);
      return values.has(key) ? values.get(key) : fallback;
    },
    setValue(key, value) {
      writes.push({ key, value });
      values.set(key, value);
    },
  };
}

test("watchlist identity is appid plus market hash name and is independent of currency", () => {
  const cnyKey = getMarketWatchlistKey(makeItem({ currencyId: 23 }));
  const usdKey = getMarketWatchlistKey(makeItem({ currencyId: 1 }));
  const currencylessKey = getMarketWatchlistKey({
    appid: 753,
    market_hash_name: SACK_HASH_NAME,
  });

  assert.equal(cnyKey, usdKey);
  assert.equal(cnyKey, currencylessKey);
  assert.equal(cnyKey, JSON.stringify(["753", SACK_HASH_NAME]));
  assert.equal(getMarketWatchlistKey({ appid: "753", marketHashName: "" }), null);
});

test("an identity-only item normalizes with derived display metadata", () => {
  const normalized = normalizeMarketWatchItem({
    appid: 753,
    market_hash_name: SACK_HASH_NAME,
    currencyId: 23,
  }, BASE_AT);

  assert.ok(normalized);
  assert.equal(normalized.appid, "753");
  assert.equal(normalized.marketHashName, SACK_HASH_NAME);
  assert.equal(normalized.displayName, "Sack of Gems");
  assert.equal(normalized.imageUrl, "");
  assert.equal(normalized.addedAt, BASE_AT);
  assert.equal(normalized.sellOrderCount, null);
  assert.equal(normalized.metadataObservedAt, null);
});

test("sell-order metadata is normalized to bounded integer values", () => {
  const normalized = normalizeMarketWatchItem(makeItem({
    sellOrderCount: "1,234",
    metadataObservedAt: String(BASE_AT + 1234),
  }));

  assert.equal(normalized.sellOrderCount, 1234);
  assert.equal(normalized.metadataObservedAt, BASE_AT + 1234);

  const zero = normalizeMarketWatchItem(makeItem({
    sellOrderCount: "0",
    metadataObservedAt: 0,
  }));
  assert.equal(zero.sellOrderCount, 0);
  assert.equal(zero.metadataObservedAt, 0);

  for (const sellOrderCount of [-1, "-1", 1.5, "not-a-count"]) {
    assert.equal(
      normalizeMarketWatchItem(makeItem({ sellOrderCount })).sellOrderCount,
      null
    );
  }
  for (const metadataObservedAt of [-1, "not-a-time", Infinity]) {
    assert.equal(
      normalizeMarketWatchItem(makeItem({ metadataObservedAt })).metadataObservedAt,
      null
    );
  }
});

test("normalization de-duplicates an item across currencies without losing richer metadata", () => {
  const normalized = normalizeMarketWatchlist({
    schemaVersion: MARKET_WATCHLIST_SCHEMA_VERSION,
    items: [
      makeItem({ currencyId: 23, addedAt: BASE_AT }),
      {
        appid: "753",
        marketHashName: SACK_HASH_NAME,
        currencyId: 1,
        addedAt: BASE_AT + 5000,
      },
    ],
  }, { now: BASE_AT + 10_000 });

  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.items[0].displayName, "宝石袋");
  assert.equal(
    normalized.items[0].imageUrl,
    "https://community.fastly.steamstatic.com/economy/image/synthetic-sack"
  );
  assert.equal(normalized.items[0].addedAt, BASE_AT);
  assert.equal(normalized.items[0].sellOrderCount, 1200);
  assert.equal(normalized.items[0].metadataObservedAt, BASE_AT + 1000);
});

test("identity-only upsert preserves richer metadata and original added time", () => {
  const initial = upsertMarketWatchlist(
    normalizeMarketWatchlist([]),
    makeItem(),
    { now: BASE_AT }
  );
  const updated = upsertMarketWatchlist(initial, {
    appid: "753",
    marketHashName: SACK_HASH_NAME,
    currencyId: 1,
  }, { now: BASE_AT + 20_000 });

  assert.equal(updated.items.length, 1);
  assert.equal(updated.items[0].displayName, "宝石袋");
  assert.equal(
    updated.items[0].imageUrl,
    "https://community.fastly.steamstatic.com/economy/image/synthetic-sack"
  );
  assert.equal(updated.items[0].addedAt, BASE_AT);
  assert.equal(updated.items[0].sellOrderCount, 1200);
  assert.equal(updated.items[0].metadataObservedAt, BASE_AT + 1000);
});

test("newer sell-order metadata wins while stale metadata is ignored", () => {
  let watchlist = upsertMarketWatchlist(
    normalizeMarketWatchlist([]),
    makeItem({ sellOrderCount: 1200, metadataObservedAt: BASE_AT + 2000 })
  );
  watchlist = upsertMarketWatchlist(watchlist, makeItem({
    currencyId: 1,
    sellOrderCount: 900,
    metadataObservedAt: BASE_AT + 1000,
  }));
  assert.equal(watchlist.items[0].sellOrderCount, 1200);
  assert.equal(watchlist.items[0].metadataObservedAt, BASE_AT + 2000);

  watchlist = upsertMarketWatchlist(watchlist, makeItem({
    sellOrderCount: 1300,
    metadataObservedAt: BASE_AT + 3000,
  }));
  assert.equal(watchlist.items[0].sellOrderCount, 1300);
  assert.equal(watchlist.items[0].metadataObservedAt, BASE_AT + 3000);

  watchlist = upsertMarketWatchlist(watchlist, makeItem({
    sellOrderCount: null,
    metadataObservedAt: BASE_AT + 4000,
  }));
  assert.equal(watchlist.items[0].sellOrderCount, 1300);
  assert.equal(watchlist.items[0].metadataObservedAt, BASE_AT + 3000);
});

test("empty storage decodes to a valid empty watchlist", () => {
  for (const raw of [null, undefined, "", "   "]) {
    const decoded = decodeMarketWatchlist(raw, { now: BASE_AT });
    assert.equal(decoded.ok, true);
    assert.deepEqual(decoded.envelope, {
      schemaVersion: MARKET_WATCHLIST_SCHEMA_VERSION,
      items: [],
    });
    assert.deepEqual(decoded.diagnostics, []);
  }
});

test("damaged or unsupported storage is diagnosed without manufacturing an envelope", () => {
  const cases = [
    ["{not-json", "invalid-json"],
    [JSON.stringify({ schemaVersion: MARKET_WATCHLIST_SCHEMA_VERSION }), "invalid-envelope"],
    [JSON.stringify({ schemaVersion: 999, items: [] }), "unsupported-schema-version"],
  ];

  for (const [raw, expectedCode] of cases) {
    const decoded = decodeMarketWatchlist(raw);
    assert.equal(decoded.ok, false);
    assert.equal(decoded.envelope, null);
    assert.equal(decoded.diagnostics[0].code, expectedCode);
  }
});

test("a mixed valid and invalid envelope is not safe to mutate", () => {
  const raw = JSON.stringify({
    schemaVersion: MARKET_WATCHLIST_SCHEMA_VERSION,
    items: [makeItem(), { appid: "753", marketHashName: "" }],
  });
  const decoded = decodeMarketWatchlist(raw);
  assert.equal(decoded.ok, false);
  assert.equal(decoded.envelope.items.length, 1);
  assert.equal(decoded.diagnostics[0].code, "invalid-items");

  const store = createMemoryStore([[MARKET_WATCHLIST_STORAGE_KEY, raw]]);
  const result = upsertStoredMarketWatchItem(makeItem({ displayName: "Updated" }), {
    getValue: store.getValue,
    setValue: store.setValue,
  });
  assert.equal(result.ok, false);
  assert.equal(result.saved, false);
  assert.equal(store.writes.length, 0);
  assert.equal(store.values.get(MARKET_WATCHLIST_STORAGE_KEY), raw);
});

test("removal is exact, cross-currency, and only changes the watchlist envelope", () => {
  const watchlist = normalizeMarketWatchlist([
    makeItem({ currencyId: 23 }),
    makeItem({
      marketHashName: "753-Sack of Gems Foil",
      displayName: "Sack of Gems Foil",
    }),
    makeItem({
      appid: "440",
      marketHashName: SACK_HASH_NAME,
      displayName: "Same hash, different app",
    }),
  ]);

  const removed = removeMarketWatchlistItem(watchlist, {
    appid: "753",
    marketHashName: SACK_HASH_NAME,
    currencyId: 1,
  });

  assert.deepEqual(
    removed.items.map(item => [item.appid, item.marketHashName]),
    [
      ["753", "753-Sack of Gems Foil"],
      ["440", SACK_HASH_NAME],
    ]
  );
});

test("stored upsert reads and writes the watchlist exactly once", () => {
  const store = createMemoryStore();
  const result = upsertStoredMarketWatchItem(makeItem(), {
    getValue: store.getValue,
    setValue: store.setValue,
    now: BASE_AT,
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  assert.deepEqual(store.reads, [MARKET_WATCHLIST_STORAGE_KEY]);
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].key, MARKET_WATCHLIST_STORAGE_KEY);
  assert.deepEqual(JSON.parse(store.writes[0].value), result.envelope);
});

test("stored identity-only upsert is a no-op when it would not change metadata", () => {
  const initial = normalizeMarketWatchlist([makeItem()]);
  const store = createMemoryStore([
    [MARKET_WATCHLIST_STORAGE_KEY, JSON.stringify(initial)],
  ]);
  const result = upsertStoredMarketWatchItem({
    appid: "753",
    marketHashName: SACK_HASH_NAME,
    currencyId: 23,
  }, {
    getValue: store.getValue,
    setValue: store.setValue,
    now: BASE_AT + 5000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved, false);
  assert.equal(store.writes.length, 0);
});

test("stored removal writes once for an existing item and leaves history storage untouched", () => {
  const initial = normalizeMarketWatchlist([makeItem()]);
  const historyRaw = JSON.stringify({ schemaVersion: 1, records: [{ synthetic: true }] });
  const store = createMemoryStore([
    [MARKET_WATCHLIST_STORAGE_KEY, JSON.stringify(initial)],
    ["stch_market_history", historyRaw],
  ]);
  const result = removeStoredMarketWatchItem({
    appid: "753",
    marketHashName: SACK_HASH_NAME,
    currencyId: 1,
  }, {
    getValue: store.getValue,
    setValue: store.setValue,
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  assert.equal(result.removed, true);
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].key, MARKET_WATCHLIST_STORAGE_KEY);
  assert.equal(store.values.get("stch_market_history"), historyRaw);
});

test("stored removal of a missing item is a successful no-op without a write", () => {
  const initial = normalizeMarketWatchlist([makeItem()]);
  const store = createMemoryStore([
    [MARKET_WATCHLIST_STORAGE_KEY, JSON.stringify(initial)],
  ]);
  const result = removeStoredMarketWatchItem({
    appid: "753",
    marketHashName: "753-Missing Item",
  }, {
    getValue: store.getValue,
    setValue: store.setValue,
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved, false);
  assert.equal(result.removed, false);
  assert.equal(store.writes.length, 0);
});

test("stored wrappers never overwrite damaged watchlist data", () => {
  for (const operation of [
    options => upsertStoredMarketWatchItem(makeItem(), options),
    options => removeStoredMarketWatchItem(makeItem(), options),
  ]) {
    const store = createMemoryStore([
      [MARKET_WATCHLIST_STORAGE_KEY, "{corrupt"],
    ]);
    const result = operation({
      getValue: store.getValue,
      setValue: store.setValue,
    });

    assert.equal(result.ok, false);
    assert.equal(result.saved, false);
    assert.equal(store.writes.length, 0);
    assert.equal(store.values.get(MARKET_WATCHLIST_STORAGE_KEY), "{corrupt");
  }
});
