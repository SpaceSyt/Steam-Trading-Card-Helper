import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseMarketListingWithDepthFromHtml,
  parseMarketListingSnapshotFromHtml,
  parseMarketOrderDepthFromListingHtml,
} from "../../src/parsers/market-listing.js";

const MARKET_HASH_NAME = "753-Sack of Gems";
const fixture = readFileSync(new URL("../fixtures-public/market/listing-ssr-gems.html", import.meta.url), "utf8");
const source = JSON.parse(readFileSync(new URL("../fixtures-public/market/listing-ssr-gems.source.json", import.meta.url), "utf8"));
const queries = JSON.parse(JSON.parse(fixture.match(/>([\s\S]*)<\/script>/)[1]).renderContext.queryData).queries;

function makeHtml(data, modern = true) {
  const renderContext = { queryData: JSON.stringify({ queries: data }) };
  return modern
    ? `<script nonce="synthetic" id = 'valve-ssr-data' type = 'application/json'>${JSON.stringify({ renderContext })}</script>`
    : `<script>window.SSR.renderContext = JSON.parse( ${JSON.stringify(JSON.stringify(renderContext))} );</script>`;
}

test("public sanitized SSR fixture retains complete buy and sell depth", () => {
  for (const sell of [false, true]) {
    const { snapshot, depth } = parseMarketListingWithDepthFromHtml(fixture, MARKET_HASH_NAME, { sell, includeHistory: false });
    assert.equal(snapshot.displayName, "Sack of Gems");
    assert.equal(snapshot.currency, source.observed.currency);
    assert.equal(snapshot.highestBuyCents, source.observed.highestBuyMinor);
    assert.equal(snapshot.lowestSellCents, source.observed.lowestSellMinor);
    assert.equal(snapshot.noBuyOrders, false);
    const levels = depth[sell ? "sellLevels" : "buyLevels"];
    assert.equal(levels.length, source.observed[sell ? "sellLevels" : "buyLevels"]);
    assert.equal(levels.reduce((sum, level) => sum + level.quantity, 0), source.observed[sell ? "sellCount" : "buyCount"]);
  }
});

test("legacy and modern envelopes return identical snapshots and depth", () => {
  for (const sell of [false, true]) {
    const expected = parseMarketListingWithDepthFromHtml(fixture, MARKET_HASH_NAME, { sell });
    for (const modern of [false, true]) {
      assert.deepEqual(parseMarketListingWithDepthFromHtml(makeHtml(queries, modern), MARKET_HASH_NAME, { sell }), expected);
    }
  }
});

test("both envelopes preserve nested JSON escapes without executing page code", () => {
  const data = structuredClone(queries);
  const description = data.find(query => query.queryKey[1] === "description").state.data;
  description.name = 'Quoted "card" \\ path\n雪 &quot; <tag> \\"';
  for (const modern of [false, true]) {
    const html = makeHtml(data, modern).replaceAll("<tag>", "\\u003ctag>")
      + '<script>throw new Error("page code must not execute")</script>';
    assert.equal(parseMarketListingSnapshotFromHtml(html, MARKET_HASH_NAME).displayName, description.name);
  }
});

test("missing or malformed envelope and nested query JSON fail closed", () => {
  for (const content of ["{", "null", "[]", "{}", '{"renderContext":null}',
    '{"renderContext":{"queryData":"{"}}',
    '{"renderContext":{"queryData":"null"}}',
    '{"renderContext":{"queryData":"{\\"queries\\":{}}"}}',
  ]) {
    for (const html of [
      `<script type="application/json" id="valve-ssr-data">${content}</script>`,
      `<script>window.SSR.renderContext=JSON.parse(${JSON.stringify(content)});</script>`,
    ]) {
      assert.deepEqual(parseMarketListingWithDepthFromHtml(html, MARKET_HASH_NAME), { snapshot: null, depth: null });
    }
  }
  assert.equal(parseMarketListingSnapshotFromHtml('<script>window.SSR.renderContext=JSON.parse("bad\\q");</script>', MARKET_HASH_NAME), null);
  assert.equal(parseMarketListingSnapshotFromHtml(fixture.replace("</script>", ""), MARKET_HASH_NAME), null);
});

test("unrelated JSON or non-data elements are not SSR envelopes", () => {
  for (const html of [
    fixture.replace('id="valve-ssr-data"', 'id="other-data"'),
    fixture.replace('id="valve-ssr-data"', 'data-id="valve-ssr-data"'),
    fixture.replace('type="application/json"', 'type="text/javascript"'),
    fixture.replaceAll("script", "div"),
  ]) {
    assert.deepEqual(parseMarketListingWithDepthFromHtml(html, MARKET_HASH_NAME), { snapshot: null, depth: null });
  }
});

test("modern envelope is authoritative even when legacy markup contains usable data", () => {
  const legacy = makeHtml(queries, false);
  for (const modern of [makeHtml([]), fixture.replace('"renderContext":', '"unrelated":'),
    '<script type="application/json" id="valve-ssr-data">{</script>',
  ]) {
    assert.deepEqual(parseMarketListingWithDepthFromHtml(modern + legacy, MARKET_HASH_NAME), { snapshot: null, depth: null });
  }
});

test("both envelopes reject queries keyed to another item or app", () => {
  for (const modern of [false, true]) {
    for (const [index, value] of [[2, 730], [3, "753-Other Item"]]) {
      const data = structuredClone(queries);
      data.forEach(query => { query.queryKey[index] = value; });
      assert.deepEqual(parseMarketListingWithDepthFromHtml(makeHtml(data, modern), MARKET_HASH_NAME), { snapshot: null, depth: null });
    }
  }
});

test("both envelopes preserve rejection of truncated, contradictory and unordered depth", () => {
  for (const modern of [false, true]) {
    for (const sell of [false, true]) {
      for (const mutation of ["truncated", "odd", "total", "best", "order"]) {
        const data = structuredClone(queries);
        const book = data.find(query => query.queryKey[1] === "orderbook").state.data;
        const levels = book[sell ? "rgCompactSellOrders" : "rgCompactBuyOrders"];
        if (mutation === "truncated") levels.splice(-2);
        if (mutation === "odd") levels.pop();
        if (mutation === "total") book[sell ? "cSellOrders" : "cBuyOrders"]++;
        if (mutation === "best") book[sell ? "amtMinSellOrder" : "amtMaxBuyOrder"]++;
        if (mutation === "order") levels[2] = levels[0];
        assert.equal(parseMarketOrderDepthFromListingHtml(makeHtml(data, modern), MARKET_HASH_NAME, { sell }), null, `${modern}/${sell}/${mutation}`);
      }
    }
  }
});
