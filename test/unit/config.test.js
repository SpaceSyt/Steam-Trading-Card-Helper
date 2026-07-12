import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CONFIG_SCHEMA_VERSION,
  DEFAULT_CONFIG,
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
