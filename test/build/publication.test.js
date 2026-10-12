import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const namespace = "https://github.com/SpaceSyt/Steam-Trading-Card-Helper";
const releaseBase = "https://raw.githubusercontent.com/SpaceSyt/Steam-Trading-Card-Helper/master/";
const version = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version;
const read = path => readFileSync(new URL(path, root), "utf8");
const metadata = (source, field) => [...source.matchAll(new RegExp(`^// @${field}\\s+(.+)$`, "gm"))].map(match => match[1].trim());

function assertIdentity(source, name) {
  assert.deepEqual(metadata(source, "name"), [name]);
  assert.deepEqual(metadata(source, "namespace"), [namespace]);
  assert.deepEqual(metadata(source, "version"), [version]);
  assert.doesNotMatch(source, /__VERSION__|__FILENAME__/);
}

const defaults = [
  ["steam-trading-card-helper.user.js", "steam-trading-card-helper-standard.user.js", "Steam Trading Card Helper"],
  ["build/steam-trading-card-helper-en.user.js", "steam-trading-card-helper-en.user.js", "Steam Trading Card Helper (English)"],
  ["steam-trading-card-helper-plus.user.js", "steam-trading-card-helper-plus.user.js", "Steam Trading Card Helper Plus"],
  ["steam-trading-card-helper-plus-en.user.js", "steam-trading-card-helper-plus-en.user.js", "Steam Trading Card Helper Plus (English)"],
];

for (const [output, published, name] of defaults) {
  test(`${published}: update and download URLs stay on the same edition and language`, () => {
    const source = read(output);
    assertIdentity(source, name);
    assert.deepEqual(metadata(source, "updateURL"), [releaseBase + published]);
    assert.deepEqual(metadata(source, "downloadURL"), [releaseBase + published]);
  });
}

test("legacy master entry preserves Chinese Plus identity and code with self update URLs", () => {
  const legacy = read("build/steam-trading-card-helper.user.js");
  const plus = read("steam-trading-card-helper-plus.user.js");
  assertIdentity(legacy, "Steam Trading Card Helper Plus");
  assert.deepEqual(metadata(legacy, "name:zh-CN"), ["Steam 卡牌助手 Plus"]);
  assert.deepEqual(metadata(legacy, "updateURL"), [releaseBase + "steam-trading-card-helper.user.js"]);
  assert.deepEqual(metadata(legacy, "downloadURL"), [releaseBase + "steam-trading-card-helper.user.js"]);
  const withoutUpdateUrls = source => source.replace(/^\/\/ @(?:downloadURL|updateURL)[^\n]*\n/gm, "");
  assert.equal(withoutUpdateUrls(legacy), withoutUpdateUrls(plus));
});

test("standalone builds retain their identity without default compatibility update URLs", () => {
  for (const english of [false, true]) {
    const source = read(`build/steam-trading-card-helper-plus-standalone${english ? "-en" : ""}.user.js`);
    assertIdentity(source, `Steam Trading Card Helper Plus${english ? " (English)" : ""} (Standalone)`);
    assert.deepEqual(metadata(source, "updateURL"), []);
    assert.deepEqual(metadata(source, "downloadURL"), []);
  }
});

test("both installation guides expose four default entries and a separate legacy Plus link", () => {
  for (const [path, legacyLabel] of [["README.md", "历史安装入口"], ["README-en.md", "legacy installation link"]]) {
    const source = read(path);
    for (const [, published] of defaults) assert.ok(source.includes(`](${releaseBase}${published})`), `${path}: ${published}`);
    assert.ok(source.includes(`[${legacyLabel}](${releaseBase}steam-trading-card-helper.user.js)`));
  }
});
