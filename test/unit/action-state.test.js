import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

globalThis.GM_getValue = (_key, fallback) => fallback;
globalThis.GM_setValue = () => {};

const { state } = await import("../../src/state.js");
const {
  isIndependentProbeBlocked,
  isPriceOverviewGroupBusy,
  isPriceOverviewProbeBlocked,
} = await import("../../src/ui/action-state.js");

const BUSY_FLAGS = [
  "scanning",
  "recalculationRunning",
  "orderSubmissionRunning",
  "orderActionRunning",
  "activeOrdersLoading",
  "activeOrderPriceQueryRunning",
  "activeOrdersCancelling",
  "historyRefreshing",
  "craftScanning",
  "craftActionRunning",
  "surplusActionRunning",
  "surplusScanning",
  "grindScanning",
];

function resetBusyFlags() {
  BUSY_FLAGS.forEach(key => { state[key] = false; });
}

afterEach(resetBusyFlags);

test("priceoverview operations share one mutual-exclusion group", () => {
  const priceOverviewFlags = [
    "scanning",
    "orderActionRunning",
    "historyRefreshing",
    "surplusScanning",
    "grindScanning",
    "activeOrderPriceQueryRunning",
    "recalculationRunning",
  ];

  priceOverviewFlags.forEach(key => {
    resetBusyFlags();
    state[key] = true;
    assert.equal(isPriceOverviewGroupBusy(), true, `${key} should hold the priceoverview lock`);
    assert.equal(isPriceOverviewProbeBlocked(), true, `${key} should block another priceoverview action`);
  });
});

test("order refresh, badge work, and order submission stay outside the priceoverview group", () => {
  ["activeOrdersLoading", "craftScanning", "craftActionRunning", "orderSubmissionRunning"].forEach(key => {
    resetBusyFlags();
    state[key] = true;
    assert.equal(isPriceOverviewGroupBusy(), false, `${key} should not hold the priceoverview lock`);
    assert.equal(isPriceOverviewProbeBlocked(), false, `${key} should not block a priceoverview action`);
  });
});

test("independent probes ignore priceoverview activity but still avoid conflicting write actions", () => {
  state.scanning = true;
  assert.equal(isIndependentProbeBlocked(), false);

  state.scanning = false;
  state.activeOrdersCancelling = true;
  assert.equal(isIndependentProbeBlocked(), true);
});

test("an action can always block itself explicitly", () => {
  assert.equal(isIndependentProbeBlocked(true), true);
  assert.equal(isPriceOverviewProbeBlocked(true), true);
});
