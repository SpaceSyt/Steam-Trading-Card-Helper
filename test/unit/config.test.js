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

  const optedOut = normalizeConfig({
    minimumPriceFallback: false,
    sidebarDisabled: true,
    showAdvancedSettings: true,
    blacklistExpiryDays: 3.9,
    showScanCompletionColumn: false,
    showScanSellSetColumn: false,
  });
  assert.equal(optedOut.minimumPriceFallback, false);
  assert.equal(optedOut.sidebarDisabled, true);
  assert.equal(optedOut.showAdvancedSettings, true);
  assert.equal(optedOut.blacklistExpiryDays, 3);
  assert.equal(optedOut.showScanCompletionColumn, false);
  assert.equal(optedOut.showScanSellSetColumn, false);

  assert.equal(normalizeConfig({ blacklistExpiryDays: 0 }).blacklistExpiryDays, 1);
  assert.equal(normalizeConfig({ blacklistExpiryDays: "invalid" }).blacklistExpiryDays, 7);
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
  });

  assert.equal(migrated.currencyId, DEFAULT_CONFIG.currencyId);
  assert.equal("removedSetting" in migrated, false);
  assert.equal("grindIncludeSurplusCards" in migrated, false);
  assert.equal("seasonalTargetLevel" in migrated, false);
  assert.equal("seasonalInterval" in migrated, false);
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
