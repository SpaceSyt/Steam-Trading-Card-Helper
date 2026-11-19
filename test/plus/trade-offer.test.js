import assert from "node:assert/strict";
import test from "node:test";
import { tradeAssetKey, readTradeSide, summarizeTradeSide, compareTradeSides } from "../../src/plus/trade-model.js";
import { createTradePrices, TRADE_PRICE_TTL } from "../../src/plus/trade-prices.js";
import { clearActiveCurrencyContext, getCurrencyContextById, initializeCurrencyContext } from "../../src/services/currency.js";

const asset = (id, amount = 1, appid = "753") => ({ assetid: String(id), appid, contextid: "6", amount });
const description = (name, other = {}) => ({ market_hash_name: name, marketable: 1, ...other });
function side(entries) {
  return readTradeSide({ assets: entries.map(([a]) => a), currency: [] }, new Map(entries.map(([a, d]) => [tradeAssetKey(a), d])));
}
const priced = priceMinor => ({ state: "priced", priceMinor, observedAt: Date.now() });
const settle = () => new Promise(resolve => setImmediate(resolve));

test("unique market types merge repeated assets, while totals count offer stack quantities", () => {
  const yours = side([[asset(1, 2), description("Card", { amount: 999 })], [asset(2), description("Card")], [asset(3), description("Other")]]);
  const total = summarizeTradeSide(yours, item => priced(item.marketHashName === "Card" ? 30 : 50));
  assert.equal(total.uniqueCount, 2);
  assert.equal(total.quantity, 4);
  assert.equal(total.totalMinor, 140);
});

test("identical names in different apps are separate types and prices", () => {
  const yours = side([[asset(1), description("Same")], [asset(2, 1, "730"), description("Same")]]);
  assert.equal(yours.uniqueCount, 2);
  assert.equal(summarizeTradeSide(yours, item => priced(item.appid === "753" ? 10 : 200)).totalMinor, 210);
});

test("unloaded, unmarketable and invalid quantities cannot become a zero valuation", () => {
  for (const entries of [
    [[asset(1), undefined]],
    [[asset(1), description("Card", { marketable: 0 })]],
    [[asset(1, 0), description("Card")]],
    [[asset(1, -1), description("Card")]],
    [[asset(1, 1.5), description("Card")]],
    [[asset(1), description("Card", { unknown: true })]],
  ]) {
    const total = summarizeTradeSide(side(entries), () => priced(123));
    assert.equal(total.totalMinor, null);
    assert.equal(compareTradeSides(total, { totalMinor: 300 }), null);
  }
});

test("unknown trade state, duplicate assets and overflowing sums fail closed", () => {
  assert.equal(readTradeSide(undefined, new Map()), null);
  assert.equal(side([[asset(1), description("Card")], [asset(1), description("Card")]]), null);
  assert.equal(summarizeTradeSide(side([[asset(1, 2), description("Card")]]), () => priced(Number.MAX_SAFE_INTEGER)).totalMinor, null);
});

test("native currency slots count quantities but unsupported valuation stays missing", () => {
  const summary = summarizeTradeSide(readTradeSide({ assets: [], currency: [{ appid: 753, contextid: 6, currencyid: 1, amount: 100 }] }, new Map()), () => priced(123));
  assert.equal(summary.quantity, 100);
  assert.equal(summary.totalMinor, null);
});

test("comparison is from the user's perspective and one-sided offers are supported", () => {
  const empty = summarizeTradeSide(side([]), () => { throw new Error("No price request for empty offer"); });
  assert.equal(empty.totalMinor, 0);
  assert.equal(compareTradeSides({ totalMinor: 184 }, { totalMinor: 57 }), -127);
  assert.equal(compareTradeSides({ totalMinor: 57 }, { totalMinor: 184 }), 127);
  assert.equal(compareTradeSides(empty, { totalMinor: 57 }), 57);
  assert.equal(compareTradeSides(empty, empty), 0);
  assert.equal(compareTradeSides({ totalMinor: null }, empty), null);
});

function listingResponse(url, ask = 123) {
  const [, , , appid, name] = new URL(url).pathname.split("/");
  const queries = [{
    queryKey: ["market", "orderbook", Number(appid), decodeURIComponent(name)],
    state: { data: { eCurrency: 23, amtMinSellOrder: ask } },
  }];
  const payload = { renderContext: { queryData: JSON.stringify({ queries }) } };
  return { status: 200, text: `<script type="application/json" id="valve-ssr-data">${JSON.stringify(payload)}</script>` };
}

function harness({ records = [], fetch, now = Date.now, cacheOK = true } = {}) {
  const calls = [];
  const writes = [];
  let changes = 0;
  const prices = createTradePrices({
    currencyContext: getCurrencyContextById(23), now,
    cache: { ok: cacheOK, envelope: { records } },
    queue: { stop() {}, async fetch(url, options) {
      calls.push({ url, options });
      return fetch ? fetch(url) : listingResponse(url);
    } },
    persist(records) { writes.push(records); return { ok: true }; },
    onChange() { changes++; },
  });
  return { prices, calls, writes, changes: () => changes };
}
const card = { appid: "753", marketHashName: "123-Card" };
const record = overrides => ({ ...card, source: "priceoverview", currencyId: 23, currencyCode: "CNY", lowestSellMinor: 88, observedAt: Date.now(), ...overrides });

test("same item across sides and repeated renders share one request and cached result", async () => {
  const h = harness();
  const first = h.prices.get(card);
  assert.strictEqual(h.prices.get({ ...card }), first);
  assert.equal(first.state, "pending");
  await settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.prices.get(card).priceMinor, 123);
  const url = new URL(h.calls[0].url);
  assert.equal(url.pathname, "/market/listings/753/123-Card");
  assert.equal(h.writes[0][0].source, "listing-page");
  assert.equal(h.writes.length, 1);
});

test("separate app identities request independently and persist a batch once", async () => {
  const h = harness();
  h.prices.get(card);
  h.prices.get({ ...card, appid: "730" });
  await settle();
  assert.equal(h.calls.length, 2);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0].map(record => record.appid).sort(), ["730", "753"]);
});

test("only fresh same-currency lowest asks can be reused from the common cache", async () => {
  const h = harness({ records: [record({})] });
  assert.equal(h.prices.get(card).priceMinor, 88);
  assert.equal(h.calls.length, 0);
  for (const invalid of [
    { currencyId: 1, currencyCode: "USD" }, { currencyCode: "USD" },
    { observedAt: Date.now() - TRADE_PRICE_TTL - 1 }, { observedAt: Date.now() + 10000 },
    { lowestSellMinor: null, medianMinor: 88 },
  ]) {
    const other = harness({ records: [record(invalid)] });
    assert.equal(other.prices.get(card).state, "pending");
    await settle();
    assert.equal(other.calls.length, 1);
  }
});

test("median-only and failed responses stay missing until explicit retry", async () => {
  for (const response of [
    { status: 200, data: { success: true, median_price: "¥ 1.23" } },
    { status: 200, data: { success: false } },
    { status: 429, data: {} },
  ]) {
    let recover = false;
    const h = harness({ fetch: url => {
      if (recover) return listingResponse(url, 200);
      if (response.status === 429 || !url.includes("/listings/")) return response;
      return { status: 200, text: "" };
    } });
    h.prices.get(card);
    await settle();
    assert.equal(h.prices.get(card).state, "missing");
    assert.equal(h.calls.length, response.status === 429 ? 1 : 2);
    if (h.calls.length === 2) assert.equal(h.calls[1].options.requestPolicy.retry429, false);
    recover = true;
    h.prices.retry();
    h.prices.get(card);
    await settle();
    assert.equal(h.prices.get(card).priceMinor, 200);
  }
});

test("cache expiry replaces stale prices with pending instead of displaying an old complete total", async () => {
  let time = Date.now();
  const h = harness({ records: [record({ observedAt: time })], now: () => time });
  assert.equal(h.prices.get(card).priceMinor, 88);
  time += TRADE_PRICE_TTL;
  assert.equal(h.prices.get(card).state, "pending");
  await settle();
  assert.equal(h.calls.length, 1);
});

test("stopping prevents late response callbacks and writes", async () => {
  let finish;
  const h = harness({ fetch: () => new Promise(resolve => { finish = resolve; }) });
  h.prices.get(card);
  h.prices.stop();
  finish(listingResponse(h.calls[0].url));
  await settle();
  assert.equal(h.changes(), 0);
  assert.equal(h.writes.length, 0);
});

test("a trade with only a dollar sign loads its owner's wallet once before reusing cached prices", async () => {
  const account = "76561198000000000";
  const previousAccount = globalThis.g_steamID;
  globalThis.g_steamID = account;
  const requests = [];
  const item = { appid: "753", marketHashName: "Test Card" };
  const record = { ...item, currencyId: 21, currencyCode: "AUD", lowestSellMinor: 133, observedAt: Date.now() };
  let prices;
  try {
    prices = createTradePrices({
      currencyContext: initializeCurrencyContext({ pageText: "$1.23" }),
      cache: { ok: true, envelope: { records: [record, { ...record, currencyId: 1, currencyCode: "USD", lowestSellMinor: 99 }] } },
      queue: { stop() {}, async fetch(url) {
        requests.push(url);
        return { text: `<script>var g_steamID='${account}';var g_rgWalletInfo={"wallet_currency":21,"wallet_market_minimum":1};</script>` };
      } },
    });
    assert.deepEqual(requests, []);
    assert.equal(prices.get(item).state, "pending");
    assert.equal(prices.get(item).state, "pending");
    await settle();
    assert.equal(prices.currencyContext.code, "AUD");
    assert.equal(prices.get(item).priceMinor, 133);
    assert.deepEqual(requests, ["https://steamcommunity.com/market/"]);
  } finally {
    prices?.stop();
    if (previousAccount == null) delete globalThis.g_steamID;
    else globalThis.g_steamID = previousAccount;
    clearActiveCurrencyContext();
  }
});
