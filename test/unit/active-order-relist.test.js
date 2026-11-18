import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

globalThis.GM_getValue = () => null;
globalThis.GM_setValue = () => {};
globalThis.window = { g_sessionID: "mock-session" };
const nodes = new Map();
let confirmAction;
let preview;
function element() {
  const children = [];
  return {
    children, style: {}, classList: { toggle() {} },
    append(...values) { children.push(...values); },
    appendChild(value) { children.push(value); },
    replaceChildren() { children.length = 0; },
    querySelector(selector) {
      if (selector === ".stch-order-list") return preview = element();
      if (selector === `[data-action="${confirmAction}"]`) {
        return { addEventListener(event, listener) { queueMicrotask(listener); } };
      }
      return element();
    },
    addEventListener() {}, remove() {},
  };
}
globalThis.document = {
  cookie: "", body: element(), getElementById: id => nodes.get(id), createElement: element,
};
const { state } = await import("../../src/state.js");
const { aggregateActiveBuyOrders, parseActiveBuyOrdersResponse } = await import("../../src/services/active-buy-orders.js");
const { relistSelectedBuyOrders } = await import("../../src/features/active-orders.js");
const { updateActiveOrdersActionState } = await import("../../src/ui/action-state.js");
const { setActiveCurrencyContext, getCurrencyContextById } = await import("../../src/services/currency.js");
const fixture = JSON.parse(await readFile(new URL("../fixtures-public/market/mylistings-buy-orders.json", import.meta.url)));
const orders = parseActiveBuyOrdersResponse(fixture).orders;

async function runRelist(options = {}) {
  setActiveCurrencyContext(getCurrencyContextById(23));
  window.g_rgWalletInfo = { wallet_currency: 23 };
  preview = null;
  confirmAction = options.confirm === false ? "cancel" : "confirm";
  const status = element();
  nodes.set("stch-active-orders-status", status);
  nodes.set("stch-active-orders-log", element());
  state.activeBuyOrderGroups = aggregateActiveBuyOrders(orders);
  state.selectedActiveBuyOrderGroups = new Set(state.activeBuyOrderGroups.map(group => group.key));
  for (const group of state.activeBuyOrderGroups) {
    if (options.unquotedApps?.includes(group.appid)) {
      group.suggestedMinor = null;
      group.quoteCurrencyId = null;
      continue;
    }
    group.suggestedMinor = group.appid === "753" ? 25 : 103;
    group.quoteCurrencyId = options.currencyId ?? 23;
  }
  const relist = element();
  nodes.set("stch-active-orders-relist", relist);
  updateActiveOrdersActionState();
  const buttonDisabled = relist.disabled;
  const cancelled = [];
  const created = [];
  let snapshots = 0;
  window.fetch = async (input, init) => {
    const url = new URL(input);
    const params = new URLSearchParams(init?.body);
    let data;
    if (url.pathname === "/market/mylistings") {
      snapshots++;
      if (options.walletAfterConfirmation) window.g_rgWalletInfo.wallet_currency = options.walletAfterConfirmation;
      data = snapshots > 1 ? { success: true, results_html: "" } : options.snapshot || fixture;
    } else if (url.pathname === "/market/cancelbuyorder/") {
      cancelled.push(params.get("buy_orderid"));
      data = options.cancelResponse || { success: 1 };
    } else if (url.pathname === "/market/getbuyorderstatus/") {
      const id = url.searchParams.get("buy_orderid");
      data = options.statusResponse || { success: 1, active: 0, quantity_remaining: id === "10003" ? "3" : 1 };
    } else if (url.pathname === "/market/createbuyorder/") {
      created.push(Object.fromEntries(params));
      data = options.createResponses?.[created.length - 1] || options.createResponse || { success: 1, buy_orderid: "50000" };
    } else throw new Error(`Unexpected mock URL: ${url}`);
    const status = url.pathname === "/market/createbuyorder/"
      ? options.createStatuses?.[created.length - 1] ?? options.createStatus ?? 200
      : 200;
    return new Response(JSON.stringify(data), { status });
  };
  await relistSelectedBuyOrders();
  return { cancelled, created, snapshots, buttonDisabled, status: status.textContent || "", log: nodes.get("stch-active-orders-log").children };
}

test("confirmed relist reuses the displayed unit price and combines only the verified unfilled units", async () => {
  const result = await runRelist();
  assert.deepEqual(result.cancelled, ["10001", "10002", "10003"]);
  assert.deepEqual(result.created.map(({ appid, currency, quantity, price_total }) => [appid, currency, quantity, price_total]), [
    ["753", "23", "2", "50"], ["440", "23", "3", "309"],
  ]);
  assert.match(preview.children[0].children[2].textContent, /0\.25/);
  assert.match(result.status, /重挂完成/);
});

test("declining confirmation, changed orders and mismatched currency never cancel orders", async () => {
  for (const options of [
    { confirm: false }, { snapshot: { success: true, results_html: "" } }, { currencyId: 1 }, { walletAfterConfirmation: 1 },
    { snapshot: { ...fixture, results_html: fixture.results_html + '<div id="mybuyorder_10001">' } },
    { snapshot: { ...fixture, results_html: fixture.results_html + '<div id="mybuyorder_99999"><a href="/market/listings/440/Second_Item">Second Item</a>' } },
  ]) {
    const result = await runRelist(options);
    assert.deepEqual(result.cancelled, []);
    assert.deepEqual(result.created, []);
  }
});

test("selecting all with mixed quotes previews and relists only quoted orders", async () => {
  const result = await runRelist({ unquotedApps: ["753"] });
  assert.equal(result.buttonDisabled, false);
  assert.deepEqual(preview.children.map(row => row.children[0].textContent), ["Second Item"]);
  assert.deepEqual(result.cancelled, ["10003"]);
  assert.deepEqual(result.created.map(({ market_hash_name, quantity, price_total }) => [market_hash_name, quantity, price_total]), [
    ["Second_Item", "3", "309"],
  ]);
});

test("selecting all without any quotes disables relisting and leaves the original orders untouched", async () => {
  const result = await runRelist({ unquotedApps: ["753", "440"] });
  assert.equal(result.buttonDisabled, true);
  assert.equal(preview, null);
  assert.deepEqual(result.cancelled, []);
  assert.deepEqual(result.created, []);
});

test("unconfirmed cancellation or status stops before the next order without creating a replacement", async () => {
  for (const options of [
    { cancelResponse: { success: 0 } },
    { statusResponse: { success: 1, active: 1, quantity_remaining: 2 } },
    { statusResponse: { success: 1, active: 0 } },
    { statusResponse: { success: 1, active: 0, quantity_remaining: 3 } },
  ]) {
    const result = await runRelist(options);
    assert.deepEqual(result.cancelled, ["10001"]);
    assert.deepEqual(result.created, []);
    assert.match(result.status, /重挂停止/);
  }
});

test("a fully filled order is never recreated and an ambiguous create response stops the batch", async () => {
  const filled = await runRelist({ statusResponse: { success: 1, active: false, quantity_remaining: 0 } });
  assert.deepEqual(filled.created, []);
  const failed = await runRelist({ createResponse: { success: 1 } });
  assert.deepEqual(failed.cancelled, ["10001", "10002"]);
  assert.equal(failed.created.length, 1);
  assert.match(failed.status, /原单已撤销，新单未确认/);
});

test("mobile confirmation polls only the same confirmation and never restarts an uncertain order", async () => {
  const wait = id => ({ need_confirmation: true, confirmation: { confirmation_id: id } });
  const result = await runRelist({ createResponses: [wait("54321"), wait("67890")] });
  assert.deepEqual(result.created.map(body => body.confirmation), ["0", "54321"]);
  assert.deepEqual(result.created.map(body => body.price_total), ["50", "50"]);
  assert.deepEqual(result.cancelled, ["10001", "10002"]);
  assert.match(result.status, /新单未确认/);
});

test("Steam's HTTP 406 confirmation challenge continues with the same order and confirmation ID", async () => {
  const result = await runRelist({
    unquotedApps: ["440"], createStatuses: [406, 200],
    createResponses: [{ need_confirmation: true, confirmation: { confirmation_id: "12345" } }],
  });
  assert.deepEqual(result.created.map(body => body.confirmation), ["0", "12345"]);
  assert.deepEqual(result.created.map(body => body.price_total), ["50", "50"]);
  assert.match(result.status, /重挂完成/);
});

test("a server error with a confirmation ID never polls or creates a second order", async () => {
  const result = await runRelist({
    createStatus: 503, createResponse: { need_confirmation: true, confirmation: { confirmation_id: "54321" } },
  });
  assert.deepEqual(result.created.map(body => body.confirmation), ["0"]);
  assert.deepEqual(result.cancelled, ["10001", "10002"]);
  assert.match(result.status, /新单未确认/);
});
