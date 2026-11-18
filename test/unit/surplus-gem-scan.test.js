import assert from "node:assert/strict";
import test from "node:test";

import { RequestQueue } from "../../src/request/queue.js";
import { getCurrencyContextById, setActiveCurrencyContext } from "../../src/services/currency.js";

globalThis.window = { g_steamID: "76561198000000000", g_strLanguage: "schinese" };
globalThis.location = new URL("https://steamcommunity.com/my/inventory/");
globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  createElement: () => ({
    set innerHTML(text) { this.textContent = this.value = text; },
  }),
};
globalThis.GM_getValue = (_key, fallback) => fallback;
globalThis.GM_setValue = () => {};

const { state } = await import("../../src/state.js");
const { startSurplusScan } = await import("../../src/features/surplus.js");

function card(itemType, name, value = "") {
  return {
    appid: 753, classid: String(itemType), instanceid: "0", marketable: 1, tradable: 1,
    name, market_hash_name: `730-${name}`, market_fee_app: 730,
    market_bucket_id: `B730-${itemType}`, descriptions: [{ value }],
    tags: [
      { category: "item_class", internal_name: "item_class_2" },
      { category: "cardborder", internal_name: "cardborder_0" },
    ],
  };
}

test("surplus scan compares per-card gem proceeds and leaves unavailable yields unknown", async t => {
  const cards = [card(2, "Anarchist"), card(3, "Balkan"), card(4, "FBI", "可分解为 40 宝石")];
  const lookups = [];
  const unexpected = [];
  t.mock.method(RequestQueue.prototype, "fetch", async rawUrl => {
    const url = new URL(rawUrl);
    if (url.pathname.startsWith("/inventory/")) {
      return { data: { success: 1, descriptions: cards, assets: cards.map(({ classid, instanceid }) => ({
        classid, instanceid, amount: "2", assetid: classid,
      })) } };
    }
    if (url.pathname === "/auction/ajaxgetgoovalueforitemtype/") {
      const params = Object.fromEntries(url.searchParams);
      lookups.push(params);
      if (params.item_type === "3") throw new Error("unavailable");
      return { data: { success: 1, goo_value: "40" } };
    }
    if (url.pathname.startsWith("/market/listings/")) return { text: "" };
    if (url.pathname === "/market/priceoverview/" && url.searchParams.get("currency") === "23") {
      const sack = url.searchParams.get("market_hash_name") === "753-Sack of Gems";
      return { data: { success: true, lowest_price: sack ? "¥4.54" : "¥0.29" } };
    }
    unexpected.push(rawUrl);
    throw new Error("Unexpected request");
  });
  state.cfg.surplusKeepMaxLevelCards = false;
  setActiveCurrencyContext(getCurrencyContextById(23));

  await startSurplusScan();

  assert.deepEqual(unexpected, []);
  assert.deepEqual(lookups.sort((a, b) => a.item_type.localeCompare(b.item_type)), [
    { appid: "730", item_type: "2", border_color: "0" },
    { appid: "730", item_type: "3", border_color: "0" },
  ]);
  const byName = new Map(state.surplusResults.map(row => [row.cardName, row]));
  for (const name of ["Anarchist", "FBI"]) {
    const row = byName.get(name);
    assert.equal(row.marketNetCents, 15);
    assert.equal(row.gemValue, 40);
    assert.equal(row.totalGems, 80);
    assert.equal(row.unitGemValueNetCents, 15.84);
    assert.equal(row.recommendationLabel, "分解");
    assert.match(row.recommendationReason, /¥0\.1584/);
  }
  assert.equal(byName.get("Balkan").recommendationKey, "unknown");
  assert.equal(byName.get("Balkan").recommendationLabel, "缺宝石数");
});
