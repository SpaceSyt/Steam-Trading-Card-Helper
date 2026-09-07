import { mkdir, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseCompactBuyOrderLevels, detectBuyOrderWalls } from "../src/services/order-wall.js";
import { getMarketListingUrl } from "../src/parsers/market-listing.js";

// Offline research data only; this script is not imported by the userscript.
// Example: node scripts/collect-market-samples.mjs --item-url https://steamcommunity.com/market/listings/753/1657630-Batty%20Slime
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
const profile = args.profile ? new URL(args.profile) : null;
if (profile && (profile.origin !== "https://steamcommunity.com" || !/^\/(id|profiles)\/[^/]+\/?$/.test(profile.pathname))) {
  throw new Error("Expected a public Steam profile URL");
}
const positive = (key, fallback) => {
  const value = Number(args[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid --${key}`);
  return value;
};
const apps = (args.apps || "1657630,570,440,730,8870,620").split(",");
if (apps.some(id => !/^\d+$/.test(id))) throw new Error("Invalid app IDs");
const rounds = positive("rounds", 2);
const perSet = positive("per-set", 3);
const intervalMs = positive("interval", 120) * 1000;
const delayMs = Math.max(1000, positive("delay", 1500));
const startedAt = new Date().toISOString();
const output = resolve(args.output || `test/fixtures-public/market/snapshots/${startedAt.replace(/[:.]/g, "-")}`);
await mkdir(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const manifest = { schemaVersion: 1, startedAt, authentication: "none", delayMs, rounds, intervalMs, catalog: [], samples: [], errors: [] };
const save = (name, value) => writeFile(resolve(output, name), JSON.stringify(value, null, 2) + "\n");
let lastRequest = 0;
async function fetchHtml(url) {
  await sleep(Math.max(0, lastRequest + delayMs - Date.now()));
  lastRequest = Date.now();
  const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    if (response.status === 429) { await save("manifest.json", manifest); throw new Error("Steam rate limit: collection stopped"); }
    throw new Error(`HTTP ${response.status}`);
  }
  return { html: await response.text(), fetchedAt: new Date().toISOString(), responseUrl: response.url, serverDate: response.headers.get("date") };
}
const targets = new Map([["753-Sack of Gems", { gameAppid: "753", isFoil: false, marketHashName: "753-Sack of Gems" }]]);
if (args["item-url"]) {
  const itemUrl = new URL(args["item-url"]);
  const match = itemUrl.pathname.match(/^\/market\/listings\/753\/(.+)$/);
  if (itemUrl.origin !== "https://steamcommunity.com" || !match) throw new Error("Expected a Steam 753 listing URL");
  const marketHashName = decodeURIComponent(match[1]);
  targets.set(marketHashName, { gameAppid: marketHashName.split("-")[0], isFoil: /\(Foil\)/.test(marketHashName), marketHashName });
}
for (const appid of apps) {
  for (const isFoil of [false, true]) {
    const params = new URLSearchParams({ appid: "753", start: "0", count: "100", norender: "1", sort_column: "popular", sort_dir: "desc", "category_753_Game[]": `tag_app_${appid}`, "category_753_item_class[]": "tag_item_class_2", "category_753_cardborder[]": `tag_cardborder_${isFoil ? 1 : 0}` });
    const url = profile
      ? `${profile.origin}${profile.pathname.replace(/\/$/, "")}/gamecards/${appid}/?l=english${isFoil ? "&border=1" : ""}`
      : `https://steamcommunity.com/market/search/render/?${params}`;
    try {
      const { html, fetchedAt } = await fetchHtml(url);
      const multibuy = profile && html.match(/href="([^"]*\/market\/multibuy[^"<>]*)"/i)?.[1];
      const hashes = new Set(profile
        ? (multibuy ? new URL(multibuy.replace(/&amp;/g, "&"), profile.origin).searchParams.getAll("items[]") : [])
        : (JSON.parse(html).results || []).map(item => item.hash_name));
      if (profile && !hashes.size) {
        for (const match of html.matchAll(/href="[^"<>]*\/market\/listings\/753\/([^"?<>]+)[^"]*"/g)) {
          hashes.add(decodeURIComponent(match[1]).replace(/&amp;/g, "&"));
        }
      }
      const cards = [...hashes].filter(hash => hash.startsWith(`${appid}-`));
      if (!cards.length) throw new Error("No public cards returned");
      manifest.catalog.push({ gameAppid: appid, isFoil, sourceUrl: url, fetchedAt, marketHashNames: cards });
      // Evenly spread across each set instead of collecting only its first cards.
      const count = Math.min(cards.length, perSet);
      for (let i = 0; i < count; i++) {
        const marketHashName = cards[Math.floor(i * cards.length / count)];
        targets.set(marketHashName, { gameAppid: appid, isFoil, marketHashName });
      }
      console.log(`catalog ${appid} ${isFoil ? "foil" : "normal"}: ${cards.length} cards`);
    } catch (error) {
      manifest.errors.push({ phase: "catalog", appid, isFoil, message: error.message });
      console.log(`catalog ${appid}: ${error.message}`);
      if (error.message.includes("rate limit")) { await save("manifest.json", manifest); throw error; }
    }
  }
}
await save("manifest.json", manifest);
const fields = ["amtMaxBuyOrder", "amtMinSellOrder", "eCurrency", "cBuyOrders", "cSellOrders", "rgCompactBuyOrders", "rgCompactSellOrders"];
for (let round = 0; round < rounds; round++) {
  const roundStart = Date.now();
  let index = 0;
  for (const target of targets.values()) {
    const url = getMarketListingUrl(target.marketHashName);
    try {
      const response = await fetchHtml(url);
      const match = response.html.match(/window\.SSR\.renderContext=JSON\.parse\(("(?:\\.|[^"\\])*")\);/);
      if (!match) throw new Error("No SSR query data");
      const context = JSON.parse(JSON.parse(match[1]));
      const queries = JSON.parse(context.queryData).queries;
      const find = type => queries.find(query => query.queryKey?.[0] === "market" && query.queryKey[1] === type && String(query.queryKey[2]) === "753" && query.queryKey[3] === target.marketHashName);
      const query = find("orderbook");
      if (!query?.state?.data) throw new Error("No matching orderbook");
      const orderbook = Object.fromEntries(fields.filter(key => Object.hasOwn(query.state.data, key)).map(key => [key, query.state.data[key]]));
      const validation = {};
      for (const sell of [false, true]) {
        const levels = parseCompactBuyOrderLevels(orderbook[sell ? "rgCompactSellOrders" : "rgCompactBuyOrders"], { sell, expectedBestPriceMinor: orderbook[sell ? "amtMinSellOrder" : "amtMaxBuyOrder"] });
        const expectedCount = orderbook[sell ? "cSellOrders" : "cBuyOrders"];
        const side = sell ? "sell" : "buy";
        const quantity = levels?.reduce((sum, level) => sum + level.quantity, 0) ?? 0;
        const bestPrice = orderbook[sell ? "amtMinSellOrder" : "amtMaxBuyOrder"];
        const empty = expectedCount === 0 && (bestPrice === null || bestPrice === 0) && orderbook[sell ? "rgCompactSellOrders" : "rgCompactBuyOrders"]?.length === 0;
        validation[side] = { valid: empty || (!!levels && quantity === expectedCount), empty, levelCount: levels?.length || 0, quantity, declaredQuantity: expectedCount };
      }
      const historyQuery = find("pricehistory");
      const history = historyQuery?.state?.data;
      const historyData = history && Array.isArray(history.prices) ? {
        ecurrency: history.ecurrency,
        prices: history.prices.map(point => ({ time: point.time, price_median: point.price_median, purchases: point.purchases })),
      } : null;
      let historyFile = null;
      if (historyData) {
        historyFile = `history-${createHash("sha256").update(JSON.stringify(historyData)).digest("hex").slice(0, 20)}.json`;
        await save(historyFile, historyData);
      }
      const sample = {
        ...target, fetchedAt: response.fetchedAt, sourceUrl: url, serverDate: response.serverDate,
        orderbookUpdatedAt: query.state.dataUpdatedAt ?? null, orderbook, validation,
        historyUpdatedAt: historyQuery?.state?.dataUpdatedAt ?? null, historyFile, historyPointCount: historyData?.prices.length ?? 0,
        sellDetection: validation.sell.valid ? detectBuyOrderWalls(orderbook.rgCompactSellOrders, { sell: true }) : null,
      };
      // Store raw public depth and a compact interpretation, without account/session fields.
      if (sample.sellDetection) {
        const d = sample.sellDetection;
        sample.sellDetection = { effectiveLowestSellMinor: d.bestPriceMinor, isolatedPrices: d.isolation.isolatedLevels.map(level => level.priceMinor), wallBottomMinor: d.nearestCluster?.bottomPriceMinor ?? null, wallTopMinor: d.nearestCluster?.topPriceMinor ?? null };
      }
      const file = `round-${round + 1}-${String(++index).padStart(3, "0")}.json`;
      await save(file, sample);
      manifest.samples.push({ file, round: round + 1, marketHashName: target.marketHashName, fetchedAt: sample.fetchedAt, currencyId: orderbook.eCurrency, bytes: (await stat(resolve(output, file))).size });
      console.log(`round ${round + 1}: ${target.marketHashName}; buy=${validation.buy.levelCount}, sell=${validation.sell.levelCount}, history=${historyData?.prices.length ?? 0}`);
    } catch (error) {
      manifest.errors.push({ phase: "market", round: round + 1, ...target, message: error.message });
      console.log(`market ${target.marketHashName}: ${error.message}`);
      if (error.message.includes("rate limit")) { await save("manifest.json", manifest); throw error; }
    }
    await save("manifest.json", manifest);
  }
  if (round + 1 < rounds) await sleep(Math.max(0, roundStart + intervalMs - Date.now()));
}
manifest.completedAt = new Date().toISOString();
await save("manifest.json", manifest);
console.log(`Saved ${manifest.samples.length} samples to ${output}; errors=${manifest.errors.length}`);
