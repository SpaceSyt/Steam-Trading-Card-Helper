import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { detectBuyOrderWalls } from "../src/services/order-wall.js";
import { getCurrencyContextById } from "../src/services/currency.js";
import { getSellerReceiveForBuyerPrice, getBuyerPriceForSellerReceive } from "../src/utils/market-fees.js";

// Compare the proposed sale references offline. This does not change runtime strategies.
const directory = resolve(process.argv[2] || "");
const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
const items = [];
const histories = new Map();
for (const entry of manifest.samples) {
  const sample = JSON.parse(await readFile(resolve(directory, entry.file), "utf8"));
  const book = sample.orderbook;
  const currency = getCurrencyContextById(book.eCurrency);
  if (!currency.verified) continue;
  const detection = sample.validation.sell.valid && !sample.validation.sell.empty
    ? detectBuyOrderWalls(book.rgCompactSellOrders, { sell: true }) : null;
  const quote = priceMinor => {
    if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) return null;
    const sellerNetMinor = getSellerReceiveForBuyerPrice(priceMinor, currency);
    const actualBuyerMinor = getBuyerPriceForSellerReceive(sellerNetMinor, currency);
    const queue = { below: 0, atPrice: 0 };
    for (let i = 0; i < (book.rgCompactSellOrders?.length || 0); i += 2) {
      if (book.rgCompactSellOrders[i] < actualBuyerMinor) queue.below += book.rgCompactSellOrders[i + 1];
      else if (book.rgCompactSellOrders[i] === actualBuyerMinor) queue.atPrice += book.rgCompactSellOrders[i + 1];
    }
    return { referenceMinor: priceMinor, actualBuyerMinor, sellerNetMinor, competingSellQuantity: queue };
  };
  const fast = quote(book.amtMaxBuyOrder);
  const follow = quote(detection?.bestPriceMinor);
  const wall = quote(detection?.nearestCluster?.bottomPriceMinor ?? detection?.bestPriceMinor);
  if (sample.historyFile && !histories.has(sample.historyFile)) {
    histories.set(sample.historyFile, JSON.parse(await readFile(resolve(directory, sample.historyFile), "utf8")));
  }
  const history = histories.get(sample.historyFile) || sample.history;
  const points = (history?.prices || []).filter(point => Number.isFinite(Number(point.time)) && Number.isFinite(Number(point.purchases)));
  const cutoff = Date.parse(sample.fetchedAt) / 1000 - 86400;
  const recent = points.filter(point => Number(point.time) > cutoff && Number(point.time) <= Date.parse(sample.fetchedAt) / 1000);
  items.push({
    sampleFile: entry.file, round: entry.round, marketHashName: sample.marketHashName, isFoil: sample.isFoil,
    fetchedAt: sample.fetchedAt, orderbookUpdatedAt: sample.orderbookUpdatedAt,
    currencyId: book.eCurrency, currency: currency.code,
    isolatedLowPrices: detection?.isolation.isolatedLevels.map(level => level.priceMinor) || [],
    hasWall: !!detection?.nearestCluster, fast, follow, wall,
    highestBuyQuantity: sample.validation.buy.valid ? book.rgCompactBuyOrders?.[1] ?? 0 : null,
    followNetUpliftPercent: fast?.sellerNetMinor > 0 && follow ? (follow.sellerNetMinor / fast.sellerNetMinor - 1) * 100 : null,
    wallNetGainOverFollowMinor: wall && follow ? wall.sellerNetMinor - follow.sellerNetMinor : null,
    followOffsets: follow ? [-2, -1, 0, 1, 2].map(offset => ({ offsetMinor: offset, ...quote(follow.referenceMinor + offset) })) : [],
    historyFile: sample.historyFile ?? null, historyPointCount: sample.historyPointCount ?? sample.history?.prices.length ?? 0,
    historyCurrencyId: history?.ecurrency ?? null,
    historyFirstTime: points.length ? Math.min(...points.map(point => Number(point.time))) : null,
    historyLastTime: points.length ? Math.max(...points.map(point => Number(point.time))) : null,
    recordedVolumeLast24Hours: recent.reduce((sum, point) => sum + Number(point.purchases), 0),
  });
}
const comparisons = [];
for (const hash of new Set(items.map(item => item.marketHashName))) {
  const observations = items.filter(item => item.marketHashName === hash);
  if (observations.length < 2) continue;
  const first = observations[0]; const last = observations.at(-1);
  const firstSample = JSON.parse(await readFile(resolve(directory, first.sampleFile), "utf8"));
  const lastSample = JSON.parse(await readFile(resolve(directory, last.sampleFile), "utf8"));
  comparisons.push({ marketHashName: hash, elapsedSeconds: (Date.parse(last.fetchedAt) - Date.parse(first.fetchedAt)) / 1000, sameOrderbook: JSON.stringify(firstSample.orderbook) === JSON.stringify(lastSample.orderbook), firstServerUpdatedAt: first.orderbookUpdatedAt, lastServerUpdatedAt: last.orderbookUpdatedAt });
}
const report = {
  createdAt: new Date().toISOString(),
  algorithmSha256: createHash("sha256").update(await readFile(new URL("../src/services/order-wall.js", import.meta.url))).digest("hex"),
  assumptions: ["All prices use the response currency and the project's default fee model for that currency.", "Proposed references: highest bid, effective lowest ask, nearest sell wall bottom (fallback to effective lowest ask).", "Low outliers remain included in competing quantities. They are not proven invalid orders.", "Queue counts are displayed-currency aggregates, not exact fill priority or estimated sale time.", "Short snapshots and aggregated historical prices cannot establish expected profit or fill probability."],
  summary: { samples: items.length, distinctItems: new Set(items.map(item => item.marketHashName)).size, currencies: [...new Set(items.map(item => item.currency))], wallSamples: items.filter(item => item.hasWall).length, isolatedLowSamples: items.filter(item => item.isolatedLowPrices.length).length, changedOrderbooks: comparisons.filter(item => !item.sameOrderbook).length },
  comparisons, items,
};
await writeFile(resolve(directory, "analysis.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.summary, null, 2));
console.log(JSON.stringify(items.filter(item => item.round === 1 && (item.marketHashName.includes("Batty Slime") || item.hasWall)).map(item => ({item: item.marketHashName, currency: item.currency, fast: item.fast?.sellerNetMinor, follow: item.follow?.sellerNetMinor, wall: item.wall?.sellerNetMinor, hasWall: item.hasWall, volume24h: item.recordedVolumeLast24Hours})), null, 2));
console.log("Userscript bytes:", (await stat(new URL("../steam-trading-card-helper.user.js", import.meta.url))).size);
