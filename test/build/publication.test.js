import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const namespace = "https://github.com/SpaceSyt/Steam-Trading-Card-Helper";
const releaseUrl = "https://raw.githubusercontent.com/SpaceSyt/Steam-Trading-Card-Helper/master/steam-trading-card-helper.user.js";
const version = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version;
const metadata = (source, field) => [...source.matchAll(new RegExp(`^// @${field}\\s+(.+)$`, "gm"))].map(match => match[1].trim());

for (const plus of [false, true]) {
  for (const standalone of plus ? [false, true] : [false]) {
    for (const english of [false, true]) {
      const filename = `steam-trading-card-helper${plus && (english || standalone) ? "-plus" : ""}${standalone ? "-standalone" : ""}${english ? "-en" : ""}.user.js`;
      const directory = plus && !standalone ? "" : "build/";
      const published = plus && !standalone && !english;
      test(`${filename}: only the published Chinese Plus build uses the existing master update entry`, () => {
        const source = readFileSync(new URL(directory + filename, root), "utf8");
        assert.deepEqual(metadata(source, "namespace"), [namespace]);
        assert.deepEqual(metadata(source, "version"), [version]);
        assert.deepEqual(metadata(source, "downloadURL"), published ? [releaseUrl] : []);
        assert.deepEqual(metadata(source, "updateURL"), published ? [releaseUrl] : []);
        if (published) {
          assert.deepEqual(metadata(source, "name"), ["Steam Trading Card Helper Plus"]);
          assert.deepEqual(metadata(source, "name:zh-CN"), ["Steam 卡牌助手 Plus"]);
        }
      });
    }
  }
}
