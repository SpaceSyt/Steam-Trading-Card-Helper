import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { calculateAutomaticSellPrice, detectBuyOrderWalls, parseCompactBuyOrderLevels } from "../../src/services/order-wall.js";
import { normalizeConfig, getActiveOrderPricingProfile, createAutomaticPricingDraft } from "../../src/config.js";
import { parseMarketOrderDepthFromListingHtml } from "../../src/parsers/market-listing.js";

globalThis.GM_getValue = () => null;
const writes = [];
globalThis.GM_setValue = (key, value) => writes.push([key, value]);
globalThis.window = { location: { href: "https://steamcommunity.com/id/test/badges" } };
globalThis.document = { cookie: "", documentElement: { innerHTML: "" }, getElementById: () => null, querySelector: () => null };
globalThis.unsafeWindow = { g_rgWalletInfo: { wallet_currency: 23, wallet_market_minimum: 1 } };

const { state } = await import("../../src/state.js");
const { setActiveCurrencyContext, getCurrencyContextById } = await import("../../src/services/currency.js");
const { buildSellPlan } = await import("../../src/features/item-actions.js");
const { fetchMarketOrderDepth } = await import("../../src/features/orders.js");
const { getSurplusResultKey } = await import("../../src/features/surplus.js");
const { getBuyerPriceForSellerReceive } = await import("../../src/utils/market-fees.js");
const hash = "123-Test Card";
const wall = [100, 10, 101, 10, 102, 40, 103, 60, 104, 10, 110, 1000];
function html(data, name = hash) {
  const ctx = { queryData: JSON.stringify({ queries: [{ queryKey: ["market", "orderbook", 753, name], state: { data } }] }) };
  return `<script>window.SSR.renderContext=JSON.parse(${JSON.stringify(JSON.stringify(ctx))});</script>`;
}
const book = (overrides = {}) => ({ eCurrency: 23, amtMinSellOrder: 100, amtMaxBuyOrder: 90, cSellOrders: 1130, rgCompactSellOrders: wall, rgCompactBuyOrders: [90, 5], cBuyOrders: 5, ...overrides });
const ui = { log() {}, setStatus() {} };
function queue(data, calls = []) {
  return { async fetch(url) { calls.push(url); return { text: html(data), status: 200 }; } };
}

beforeEach(() => {
  state.cfg = normalizeConfig({ sellAutomaticPricingEnabled: true });
  state.sellAutomaticPricingDraft = null;
  state.marketOrderDepths.clear();
  state.highestBuyPrices.clear();
  state.itemCollectionItems = [];
  setActiveCurrencyContext(getCurrencyContextById(23));
  state.surplusResults = [1, 2].map(id => ({ appid: "123", category: "card", marketHashName: hash, cardName: "Test Card", assets: [{ assetid: String(id), amount: 2, selectedAmount: 2, marketable: true }] }));
  state.selectedSurplusResults = new Set(state.surplusResults.map(getSurplusResultKey));
  writes.length = 0;
});

test("sell modes use the raw bid, effective lowest ask, or nearest sell wall", () => {
  const detection = detectBuyOrderWalls(wall, { sell: true });
  assert.equal(detection.nearestCluster.topPriceMinor, 103);
  assert.equal(detection.nearestCluster.bottomPriceMinor, 102);
  assert.deepEqual(detection.walls.map(level => level.priceMinor), [102, 103]);
  const depth = { lowestSellMinor: 100, highestBuyMinor: 90, sellLevels: wall };
  assert.equal(calculateAutomaticSellPrice(depth, { strategy: "conservative" }).finalPriceMinor, 102);
  assert.equal(calculateAutomaticSellPrice(depth, { strategy: "follow" }).finalPriceMinor, 99);
  assert.equal(calculateAutomaticSellPrice(depth, { strategy: "instant" }).finalPriceMinor, 90);
  assert.equal(calculateAutomaticSellPrice(depth, { strategy: "conservative", strategyRule: { wallAnchor: "previous", noWallOffsetMinor: 0 } }).finalPriceMinor, 101);
});

test("sell isolation, no-wall offsets, minimum and opposite-book guard apply in order", () => {
  const quote = calculateAutomaticSellPrice({ lowestSellMinor: 80, sellLevels: [80, 1, 100, 10, 101, 12, 102, 15] });
  assert.equal(quote.detection.isolation.classification, "isolated-low");
  assert.equal(quote.effectiveLowestSellMinor, 100);
  assert.equal(quote.finalPriceMinor, 99);
  const guarded = calculateAutomaticSellPrice({ lowestSellMinor: 100, highestBuyMinor: 99, sellLevels: [100, 2] }, { strategyRule: { noWallOffsetMinor: -5 } });
  assert.equal(guarded.finalPriceMinor, 100);
  assert.equal(calculateAutomaticSellPrice({ lowestSellMinor: 3, sellLevels: [3, 2] }, { strategy: "follow", minimumPriceMinor: 3 }).finalPriceMinor, 3);
  assert.equal(calculateAutomaticSellPrice({ highestBuyMinor: 90 }), null);
});

test("sell depth rejects malformed, unsorted, wrong-item and inconsistent totals without requiring bids", () => {
  assert.equal(parseCompactBuyOrderLevels([101, 1, 100, 2], { sell: true }), null);
  const valid = book({ amtMaxBuyOrder: 0, cBuyOrders: 0, rgCompactBuyOrders: [] });
  assert.equal(parseMarketOrderDepthFromListingHtml(html(valid), hash, { sell: true }).sellLevels.length, 6);
  for (const data of [book({ rgCompactSellOrders: [100, 1, 101] }), book({ amtMinSellOrder: 101 }), book({ cSellOrders: 999 }), book({ rgCompactSellOrders: [100, 1, 99, 2] }), book({ rgCompactSellOrders: [100, -1] }), book({ eCurrency: 0 })]) {
    assert.equal(parseMarketOrderDepthFromListingHtml(html(data), hash, { sell: true }), null);
  }
  assert.equal(parseMarketOrderDepthFromListingHtml(html(valid, "456-Other"), hash, { sell: true }), null);
});

test("sell config is independent, defaults off and preserves manual pricing and temporary drafts", () => {
  const defaults = normalizeConfig({ automaticPricingEnabled: true, automaticBalancedWallAnchor: "top" });
  assert.equal(defaults.sellAutomaticPricingEnabled, false);
  assert.equal(defaults.sellConservativeAnchor, "bottom");
  const cfg = normalizeConfig({ sellAutomaticPricingEnabled: true, sellFollowOffset: 0.03, surplusSellPriceSource: "median", surplusSellPriceAdjustment: -0.04 });
  const draft = createAutomaticPricingDraft(cfg, "follow", true);
  draft.noWallOffsetMinor = 8;
  assert.equal(getActiveOrderPricingProfile(cfg, draft, true).strategyRule.noWallOffsetMinor, 8);
  assert.equal(cfg.sellFollowOffset, 0.03);
  assert.equal(cfg.automaticBalancedWallOffset, 0);
  cfg.sellAutomaticPricingEnabled = false;
  assert.deepEqual(getActiveOrderPricingProfile(cfg, draft, true), { automatic: false, priceSource: "median", adjustment: -0.04 });
  assert.equal(normalizeConfig({ sellFollowOffset: "invalid" }).sellFollowOffset, -0.01);
});

test("sell plans deduplicate listing requests, preserve quantities and compute fee-consistent totals", async () => {
  const calls = [];
  const result = await buildSellPlan("card", ui, queue(book(), calls));
  assert.equal(calls.length, 1);
  assert.equal(result.plan.length, 2);
  assert.equal(result.automatic, true);
  for (const item of result.plan) {
    assert.equal(item.basePriceCents, 99);
    assert.equal(item.quantity, 2);
    assert.equal(item.unitBuyerCents, getBuyerPriceForSellerReceive(item.sellerReceiveCents));
    assert.equal(item.totalBuyerCents, item.unitBuyerCents * 2);
    assert.equal(item.totalReceiveCents, item.sellerReceiveCents * 2);
  }
  assert.equal(new Set(writes.map(([key]) => key)).size, writes.length);
});

test("sell plans allow empty bids, skip invalid depth/currency and never fall back to manual price", async () => {
  const noBid = await buildSellPlan("card", ui, queue(book({ amtMaxBuyOrder: 0, cBuyOrders: 0, rgCompactBuyOrders: [] })));
  assert.equal(noBid.plan.length, 2);
  for (const invalid of [book({ eCurrency: 1 }), book({ rgCompactSellOrders: [] }), book({ cSellOrders: 999 })]) {
    state.marketOrderDepths.clear();
    const result = await buildSellPlan("card", ui, queue(invalid));
    assert.equal(result.plan.length, 0);
    assert.ok(result.skipped.failedPrice > 0);
  }
});

test("buy and sell depth caches stay separate for the same item", async () => {
  const calls = [];
  const q = queue(book(), calls);
  assert.ok((await fetchMarketOrderDepth(hash, q)).buyLevels);
  assert.ok((await fetchMarketOrderDepth(hash, q, { sell: true })).sellLevels);
  await fetchMarketOrderDepth(hash, q, { sell: true });
  assert.equal(calls.length, 2);
});

test("fee rounding cannot cross the automatic sell buy-order guard", async () => {
  // 22 is not representable: seller 19 costs 21 and seller 20 costs 23.
  setActiveCurrencyContext(getCurrencyContextById(1));
  state.cfg.sellFollowOffset = -1;
  const result = await buildSellPlan("card", ui, queue(book({ eCurrency: 1, amtMinSellOrder: 23, amtMaxBuyOrder: 21, rgCompactSellOrders: [23, 1], cSellOrders: 1 })));
  assert.equal(result.plan[0].targetBuyerCents, 22);
  assert.equal(result.plan[0].unitBuyerCents, 23);
  assert.equal(result.plan[0].sellerReceiveCents, 20);
});

test("manual sell pricing remains available after automatic pricing is disabled", async () => {
  state.cfg.sellAutomaticPricingEnabled = false;
  state.cfg.surplusSellPriceSource = "highest";
  state.cfg.surplusSellPriceAdjustment = 0.02;
  const result = await buildSellPlan("card", ui, queue(book()));
  assert.equal(result.automatic, false);
  assert.equal(result.plan[0].basePriceCents, 90);
  assert.equal(result.plan[0].targetBuyerCents, 92);
});

test("new sale settings migrate old modes without opting into instant sale", () => {
  for (const strategy of ["balanced", "aggressive"]) {
    const cfg = normalizeConfig({ configVersion: 34, sellAutomaticPricingEnabled: true, sellAutomaticPriceStrategy: strategy, sellAutomaticBalancedNoWallOffset: 0.01, automaticAggressiveWallAnchor: "bottom" });
    assert.equal(cfg.sellAutomaticPriceStrategy, "follow");
    assert.equal(cfg.sellFollowOffset, -0.01);
    assert.equal(cfg.sellInstantOffset, 0);
    assert.equal(cfg.sellConservativeOffset, 0);
    assert.equal(Object.hasOwn(cfg, "sellAutomaticBalancedNoWallOffset"), false);
    assert.equal(Object.hasOwn(cfg, "automaticAggressiveWallAnchor"), false);
  }
  const cfg = normalizeConfig({ sellAutomaticPriceStrategy: "conservative", sellConservativeAnchor: "previous" });
  assert.equal(cfg.sellConservativeAnchor, "previous");
  assert.equal(normalizeConfig({ sellConservativeAnchor: "top" }).sellConservativeAnchor, "bottom");
});

test("instant sale keeps an isolated high bid and works without asks", async () => {
  state.cfg.sellAutomaticPriceStrategy = "instant";
  const calls = [];
  const data = book({ amtMinSellOrder: 0, cSellOrders: 0, rgCompactSellOrders: [], amtMaxBuyOrder: 130, cBuyOrders: 31, rgCompactBuyOrders: [130, 1, 100, 10, 99, 10, 98, 10] });
  const result = await buildSellPlan("card", ui, queue(data, calls));
  assert.equal(calls.length, 1);
  assert.equal(result.plan.length, 2);
  for (const item of result.plan) {
    assert.equal(item.basePriceCents, 130);
    assert.ok(item.unitBuyerCents <= 130);
  }
  assert.equal(calculateAutomaticSellPrice({ highestBuyMinor: 20 }, { strategy: "instant", minimumPriceMinor: 21 }), null);
  state.marketOrderDepths.clear();
  const noBid = await buildSellPlan("card", ui, queue(book({ amtMaxBuyOrder: 0, cBuyOrders: 0, rgCompactBuyOrders: [] })));
  assert.equal(noBid.plan.length, 0);
});

test("conservative previous step respects CNY fee gaps and falls back to the effective ask without a wall", async () => {
  state.cfg.sellAutomaticPriceStrategy = "conservative";
  state.cfg.sellConservativeAnchor = "previous";
  // CNY: seller 79 => buyer 93; seller 80 => buyer 95. There is no 94 tier.
  const data = book({ amtMinSellOrder: 93, amtMaxBuyOrder: 80, rgCompactSellOrders: [93, 10, 94, 10, 95, 80], cSellOrders: 100 });
  const previous = await buildSellPlan("card", ui, queue(data));
  assert.equal(previous.plan[0].basePriceCents, 94);
  assert.equal(previous.plan[0].unitBuyerCents, 93);
  state.cfg.sellConservativeAnchor = "bottom";
  const bottom = await buildSellPlan("card", ui, queue(data));
  assert.equal(bottom.plan[0].unitBuyerCents, 95);
  const noWall = calculateAutomaticSellPrice({ lowestSellMinor: 80, sellLevels: [80, 1, 100, 10, 101, 12, 102, 15] }, { strategy: "conservative", strategyRule: { wallAnchor: "previous" } });
  assert.equal(noWall.finalPriceMinor, 100);
});
