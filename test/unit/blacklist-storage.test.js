import assert from "node:assert/strict";
import test from "node:test";

import {
  describeBlacklistStorageError,
  mutateBlacklistStorage,
  readBlacklistStorage,
} from "../../src/services/blacklist-storage.js";

function createConfig() {
  return {
    blacklist: "10,20",
    blacklistNames: JSON.stringify({ 10: "Ten", 20: "Twenty" }),
    blacklistSources: JSON.stringify({ 10: 0, 20: 1 }),
    blacklistDates: JSON.stringify({ 10: 1000, 20: 2000 }),
    blacklistFixed: JSON.stringify({ 20: 1 }),
    blacklistPriceData: JSON.stringify({
      10: {
        priceMinor: 99,
        currencyId: 23,
        accuracy: "exact",
        reason: "complete",
        observedAt: 1000,
      },
    }),
  };
}

test("blacklist storage reads every metadata field in one snapshot", () => {
  const storage = readBlacklistStorage(createConfig());
  assert.equal(storage.ok, true);
  assert.deepEqual(storage.appids, ["10", "20"]);
  assert.equal(storage.names["10"], "Ten");
  assert.equal(storage.sources["20"], 1);
  assert.equal(storage.dates["10"], 1000);
  assert.equal(storage.fixed["20"], 1);
  assert.equal(storage.priceData["10"].priceMinor, 99);
});

test("all blacklist mutations fail closed when any metadata JSON is corrupt", () => {
  for (const field of [
    "blacklistNames",
    "blacklistSources",
    "blacklistDates",
    "blacklistFixed",
    "blacklistPriceData",
  ]) {
    const cfg = createConfig();
    cfg[field] = "{broken";
    const before = structuredClone(cfg);
    let called = false;
    const result = mutateBlacklistStorage(cfg, storage => {
      called = true;
      storage.appids.push("30");
    });

    assert.equal(result.ok, false, field);
    assert.equal(result.changed, false, field);
    assert.equal(called, false, field);
    assert.deepEqual(cfg, before, field);
    assert.match(describeBlacklistStorageError(result), /数据损坏/);
  }
});

test("invalid blacklist price entries remain diagnosable and block rewrites", () => {
  const cfg = createConfig();
  cfg.blacklistPriceData = JSON.stringify({
    10: {
      priceMinor: 99,
      currencyId: 23,
      accuracy: "exact",
    },
    20: {
      priceMinor: -1,
      currencyId: 23,
      accuracy: "estimated",
    },
  });
  const before = structuredClone(cfg);
  const storage = readBlacklistStorage(cfg);

  assert.equal(storage.ok, false);
  assert.equal(storage.priceData["10"].priceMinor, 99);
  assert.equal(storage.priceData["20"], undefined);
  assert.deepEqual(storage.diagnostics.map(item => item.appid), ["20"]);

  const result = mutateBlacklistStorage(cfg, snapshot => {
    delete snapshot.priceData["20"];
  });
  assert.equal(result.ok, false);
  assert.deepEqual(cfg, before);
});

test("valid blacklist mutations serialize every metadata map together", () => {
  const cfg = createConfig();
  const result = mutateBlacklistStorage(cfg, storage => {
    storage.appids = storage.appids.filter(appid => appid !== "10");
    delete storage.names["10"];
    delete storage.sources["10"];
    delete storage.dates["10"];
    delete storage.fixed["10"];
    delete storage.priceData["10"];
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(cfg.blacklist, "20");
  assert.deepEqual(JSON.parse(cfg.blacklistNames), { 20: "Twenty" });
  assert.deepEqual(JSON.parse(cfg.blacklistSources), { 20: 1 });
  assert.deepEqual(JSON.parse(cfg.blacklistDates), { 20: 2000 });
  assert.deepEqual(JSON.parse(cfg.blacklistFixed), { 20: 1 });
  assert.deepEqual(JSON.parse(cfg.blacklistPriceData), {});
});
