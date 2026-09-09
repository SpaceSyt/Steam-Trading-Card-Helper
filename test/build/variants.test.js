import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const selectors = ["trade_offer_your_sum", "trade_offer_their_sum", "your_slots_count", "their_slots_count"];
const names = new Set();
for (const plus of [false, true]) {
  for (const compatibility of plus ? [false, true] : [false]) {
    for (const english of [false, true]) {
      const standalone = plus && !compatibility;
      const filename = `steam-trading-card-helper${plus ? "-plus" : ""}${standalone ? "-standalone" : ""}${english ? "-en" : ""}.user.js`;
      const directory = standalone || (!plus && english) ? "build/" : "";
      test(`${filename}: language, feature scope, and compatibility exclusion`, () => {
        const source = readFileSync(new URL(`../../${directory}${filename}`, import.meta.url), "utf8");
        const name = source.match(/^\/\/ @name\s+(.+)$/m)?.[1];
        assert.ok(name);
        assert.equal(names.has(name), false, "Variant metadata name must be distinct");
        names.add(name);
        assert.equal(name.includes("Plus"), plus);
        assert.equal(name.includes("English"), english);
        assert.equal(name.includes("Standalone"), standalone);
        assert.equal(/^\/\/ @name:zh-CN/m.test(source), !english);
        assert.equal(source.includes("https://steamcommunity.com/tradeoffer/*"), plus);
        assert.equal(source.includes("stch-trade-comparison"), plus);
        for (const selector of selectors) assert.equal(source.includes(selector), compatibility, selector);
        if (plus) {
          assert.equal(source.includes("对方物品价值比你高"), !english);
          assert.equal(source.includes("you_cantready"), true, "Positioning belongs to both Plus variants");
        }
      });
    }
  }
}

test("unsupported standalone and misspelled flags fail without silently building another variant", () => {
  for (const flags of [["--standalone"], ["--en", "--standalone"], ["--compat"], ["--plsu"]]) {
    const result = spawnSync(process.execPath, ["scripts/build.mjs", ...flags], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Standalone requires --plus|Unknown build option/);
  }
});
