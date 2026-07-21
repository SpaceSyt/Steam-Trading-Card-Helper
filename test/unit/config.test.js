import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CONFIG_SCHEMA_VERSION,
  DEFAULT_CONFIG,
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

test("automatic pricing keeps an independent strategy and adjustment profile", () => {
  const cfg = normalizeConfig({
    orderPriceSource: "median",
    priceAdjustment: -0.02,
    automaticPricingEnabled: true,
    automaticPriceStrategy: "aggressive",
    automaticPriceAdjustment: 0.03,
  });

  assert.deepEqual(getActiveOrderPricingProfile(cfg), {
    automatic: true,
    priceSource: "aggressive",
    adjustment: 0.03,
  });
  cfg.automaticPricingEnabled = false;
  assert.deepEqual(getActiveOrderPricingProfile(cfg), {
    automatic: false,
    priceSource: "median",
    adjustment: -0.02,
  });
});

test("new ordering and sidebar settings use safe defaults and preserve explicit opt-outs", () => {
  const defaults = normalizeConfig({});
  assert.equal(defaults.noBuyOrderMinimumFallback, true);
  assert.equal(defaults.sidebarDisabled, false);

  const optedOut = normalizeConfig({
    noBuyOrderMinimumFallback: false,
    sidebarDisabled: true,
  });
  assert.equal(optedOut.noBuyOrderMinimumFallback, false);
  assert.equal(optedOut.sidebarDisabled, true);
});

test("config normalization removes obsolete keys and rejects invalid currency ids", () => {
  const migrated = normalizeConfig({
    configVersion: 1,
    currencyId: "not-a-currency",
    removedSetting: true,
    seasonalTargetLevel: 40,
    seasonalInterval: 200,
  });

  assert.equal(migrated.currencyId, DEFAULT_CONFIG.currencyId);
  assert.equal("removedSetting" in migrated, false);
  assert.equal("seasonalTargetLevel" in migrated, false);
  assert.equal("seasonalInterval" in migrated, false);
});
