import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CONFIG_SCHEMA_VERSION,
  DEFAULT_CONFIG,
  createAutomaticPricingDraft,
  getActiveOrderPricingProfile,
  normalizeConfig,
} from "../../src/config.js";
import { DEFAULT_TAB_ORDER } from "../../src/constants.js";
import {
  getOrderedTabDefinitions,
  normalizeHexColor,
  normalizeTabColors,
  normalizeTabOrder,
} from "../../src/services/tab-preferences.js";

const legacyStorage = JSON.parse(readFileSync(
  new URL("../fixtures-public/cache/v2.0.5-storage.json", import.meta.url),
  "utf8"
));

test("v2.0 config migration preserves every blacklist field", () => {
  const legacy = legacyStorage.config;

  const migrated = normalizeConfig(legacy);

  assert.equal(migrated.configVersion, CONFIG_SCHEMA_VERSION);
  assert.equal(migrated.currencyId, 23);
  assert.equal(migrated.threshold, 7.5);
  assert.equal(migrated.blacklist, legacy.blacklist);
  assert.equal(migrated.blacklistNames, legacy.blacklistNames);
  assert.equal(migrated.blacklistSources, legacy.blacklistSources);
  assert.equal(migrated.blacklistDates, legacy.blacklistDates);
  assert.equal(migrated.blacklistFixed, legacy.blacklistFixed);
  assert.equal(migrated.blacklistPriceData, "{}");
});

test("automatic pricing uses strategy offsets without a second persisted adjustment", () => {
  const cfg = normalizeConfig({
    orderPriceSource: "median",
    priceAdjustment: -0.02,
    automaticPricingEnabled: true,
    automaticPriceStrategy: "aggressive",
  });

  assert.deepEqual(getActiveOrderPricingProfile(cfg), {
    automatic: true,
    priceSource: "aggressive",
    adjustment: 0,
    strategyRule: {
      wallAnchor: "top",
      wallOffsetMinor: 1,
      noWallOffsetMinor: 1,
    },
  });
  cfg.automaticPricingEnabled = false;
  assert.deepEqual(getActiveOrderPricingProfile(cfg), {
    automatic: false,
    priceSource: "median",
    adjustment: -0.02,
  });
});

test("new ordering, sidebar, advanced, and blacklist settings normalize safely", () => {
  const defaults = normalizeConfig({});
  assert.equal(defaults.minimumPriceFallback, true);
  assert.equal(defaults.sidebarDisabled, false);
  assert.equal(defaults.showAdvancedSettings, false);
  assert.equal(defaults.blacklistExpiryDays, 7);
  assert.equal(defaults.showScanCompletionColumn, true);
  assert.equal(defaults.showScanSellSetColumn, true);
  assert.equal(defaults.parallelOrderPricingEnabled, false);
  assert.equal(defaults.parallelOrderPricingConcurrency, 4);
  assert.equal(defaults.parallelOtherRequestsEnabled, true);
  assert.equal(defaults.parallelOtherRequestsConcurrency, 8);

  const optedOut = normalizeConfig({
    minimumPriceFallback: false,
    sidebarDisabled: true,
    showAdvancedSettings: true,
    blacklistExpiryDays: 3.9,
    showScanCompletionColumn: false,
    showScanSellSetColumn: false,
    parallelOrderPricingEnabled: true,
    parallelOrderPricingConcurrency: 8.9,
    parallelOtherRequestsEnabled: false,
    parallelOtherRequestsConcurrency: 12.9,
  });
  assert.equal(optedOut.minimumPriceFallback, false);
  assert.equal(optedOut.sidebarDisabled, true);
  assert.equal(optedOut.showAdvancedSettings, true);
  assert.equal(optedOut.blacklistExpiryDays, 3);
  assert.equal(optedOut.showScanCompletionColumn, false);
  assert.equal(optedOut.showScanSellSetColumn, false);
  assert.equal(optedOut.parallelOrderPricingEnabled, true);
  assert.equal(optedOut.parallelOrderPricingConcurrency, 8);
  assert.equal(optedOut.parallelOtherRequestsEnabled, false);
  assert.equal(optedOut.parallelOtherRequestsConcurrency, 12);

  assert.equal(normalizeConfig({ blacklistExpiryDays: 0 }).blacklistExpiryDays, 1);
  assert.equal(normalizeConfig({ blacklistExpiryDays: "invalid" }).blacklistExpiryDays, 7);
  assert.equal(normalizeConfig({ parallelOrderPricingConcurrency: 0 }).parallelOrderPricingConcurrency, 1);
  assert.equal(normalizeConfig({ parallelOrderPricingConcurrency: 99 }).parallelOrderPricingConcurrency, 20);
  assert.equal(normalizeConfig({ parallelOrderPricingConcurrency: "invalid" }).parallelOrderPricingConcurrency, 4);
  assert.equal(normalizeConfig({ parallelOtherRequestsConcurrency: 0 }).parallelOtherRequestsConcurrency, 1);
  assert.equal(normalizeConfig({ parallelOtherRequestsConcurrency: 99 }).parallelOtherRequestsConcurrency, 20);
  assert.equal(normalizeConfig({ parallelOtherRequestsConcurrency: "invalid" }).parallelOtherRequestsConcurrency, 8);
});

test("an automatic pricing draft can temporarily override both strategy offsets", () => {
  const cfg = normalizeConfig({
    automaticPricingEnabled: true,
    automaticPriceStrategy: "conservative",
    automaticConservativeWallOffset: 0.01,
    automaticConservativeNoWallOffset: -0.03,
  });
  const draft = createAutomaticPricingDraft(cfg, "conservative");
  assert.deepEqual(draft, {
    strategy: "conservative",
    wallAnchor: "bottom",
    wallOffsetMinor: 1,
    noWallOffsetMinor: -3,
  });

  draft.wallOffsetMinor = 2;
  draft.noWallOffsetMinor = -4;
  assert.deepEqual(getActiveOrderPricingProfile(cfg, draft).strategyRule, {
    wallAnchor: "bottom",
    wallOffsetMinor: 2,
    noWallOffsetMinor: -4,
  });
  assert.equal(cfg.automaticConservativeWallOffset, 0.01);
  assert.equal(cfg.automaticConservativeNoWallOffset, -0.03);
});

test("automatic strategy rules normalize anchors and currency offsets", () => {
  const cfg = normalizeConfig({
    automaticPricingEnabled: true,
    automaticPriceStrategy: "balanced",
    automaticBalancedWallAnchor: "bottom",
    automaticBalancedWallOffset: -0.03,
    automaticBalancedNoWallOffset: 0.02,
  });

  assert.deepEqual(getActiveOrderPricingProfile(cfg).strategyRule, {
    wallAnchor: "bottom",
    wallOffsetMinor: -3,
    noWallOffsetMinor: 2,
  });
  assert.equal(
    normalizeConfig({ automaticBalancedWallAnchor: "invalid" }).automaticBalancedWallAnchor,
    "top"
  );
});

test("legacy no-buy fallback migrates to the general minimum-price fallback", () => {
  const migrated = normalizeConfig({ noBuyOrderMinimumFallback: false });
  assert.equal(migrated.minimumPriceFallback, false);
  assert.equal("noBuyOrderMinimumFallback" in migrated, false);
});

test("config normalization removes obsolete keys and rejects invalid currency ids", () => {
  const migrated = normalizeConfig({
    configVersion: 1,
    currencyId: "not-a-currency",
    removedSetting: true,
    grindIncludeSurplusCards: true,
    seasonalTargetLevel: 40,
    seasonalInterval: 200,
    batchSize: 20,
    batchPause: 53000,
  });

  assert.equal(migrated.currencyId, DEFAULT_CONFIG.currencyId);
  assert.equal("removedSetting" in migrated, false);
  assert.equal("grindIncludeSurplusCards" in migrated, false);
  assert.equal("seasonalTargetLevel" in migrated, false);
  assert.equal("seasonalInterval" in migrated, false);
  assert.equal("batchSize" in migrated, false);
  assert.equal("batchPause" in migrated, false);
});

test("surplus recommendation filter migrates from the former background setting", () => {
  const migrated = normalizeConfig({
    grindOnlyRecommended: false,
    surplusOnlyMaxed: true,
    surplusCompareGems: false,
  });

  assert.equal(migrated.surplusOnlyRecommended, false);
  assert.equal("grindOnlyRecommended" in migrated, false);
  assert.equal("surplusOnlyMaxed" in migrated, false);
  assert.equal("surplusCompareGems" in migrated, false);
});

test("tab order keeps valid user positions and appends every missing tab", () => {
  const order = normalizeTabOrder([
    "surplus",
    "scan",
    "surplus",
    "unknown",
    "settings",
  ]);
  assert.deepEqual(order.slice(0, 3), ["surplus", "scan", "settings"]);
  assert.equal(new Set(order).size, DEFAULT_TAB_ORDER.length);
  assert.deepEqual(new Set(order), new Set(DEFAULT_TAB_ORDER));
  assert.deepEqual(
    getOrderedTabDefinitions(order).map(tab => tab.id),
    order
  );
});

test("config normalizes malformed tab order without sharing the default array", () => {
  const first = normalizeConfig({ tabOrder: ["collection", "scan"] });
  const second = normalizeConfig({ tabOrder: "not-an-array" });
  assert.deepEqual(first.tabOrder.slice(0, 2), ["collection", "scan"]);
  assert.deepEqual(second.tabOrder, DEFAULT_TAB_ORDER);
  assert.notEqual(second.tabOrder, DEFAULT_CONFIG.tabOrder);
});

test("tab colors accept six-digit hex values and discard unknown or malformed entries", () => {
  assert.equal(normalizeHexColor("66c0f4"), "#66C0F4");
  assert.equal(normalizeHexColor("#aBc123"), "#ABC123");
  assert.equal(normalizeHexColor("#abc"), "");
  assert.deepEqual(normalizeTabColors({
    scan: "#112233",
    collection: "abcdef",
    settings: "invalid",
    unknown: "#445566",
  }), {
    scan: "#112233",
    collection: "#ABCDEF",
  });

  const cfg = normalizeConfig({ tabColors: { orders: "#123456", craft: "bad" } });
  assert.deepEqual(cfg.tabColors, { orders: "#123456" });
  assert.notEqual(cfg.tabColors, DEFAULT_CONFIG.tabColors);
});
