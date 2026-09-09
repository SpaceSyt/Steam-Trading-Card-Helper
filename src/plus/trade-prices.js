import { priceCard } from "../parsers/price.js";
import { loadMarketCache } from "../services/market-cache.js";
import { persistMarketObservations } from "../services/market-observations.js";
import { RequestQueue } from "../request/queue.js";
import { createRequestQueuePool, getOtherRequestConcurrency } from "../utils/concurrency.js";
import { tradePriceKey } from "./trade-model.js";

export const TRADE_PRICE_TTL = 5 * 60 * 1000;

export function createTradePrices({ currencyContext, cfg = {}, onChange = () => {},
  queue = createRequestQueuePool(Math.min(4, getOtherRequestConcurrency(cfg)), () => new RequestQueue(cfg.requestInterval, { cfg })),
  cache = loadMarketCache(), now = Date.now, persist = persistMarketObservations } = {}) {
  const prices = new Map();
  const observations = [];
  let active = 0;
  let stopped = false;
  let storageError = !cache.ok;
  for (const record of cache.envelope?.records || []) {
    if (record.currencyId !== currencyContext?.currencyId || record.currencyCode !== currencyContext?.code
      || !Number.isSafeInteger(record.lowestSellMinor) || record.lowestSellMinor <= 0
      || record.observedAt > now() || now() - record.observedAt >= TRADE_PRICE_TTL) continue;
    const key = tradePriceKey(record, currencyContext.currencyId);
    if ((prices.get(key)?.observedAt ?? -1) < record.observedAt) {
      prices.set(key, { state: "priced", priceMinor: record.lowestSellMinor, observedAt: record.observedAt });
    }
  }
  return {
    get storageError() { return storageError; },
    get(item) {
      if (stopped || !currencyContext?.currencyId) return { state: "missing" };
      const key = tradePriceKey(item, currencyContext.currencyId);
      const existing = prices.get(key);
      if (existing && (existing.state !== "priced" || now() - existing.observedAt < TRADE_PRICE_TTL)) return existing;
      const entry = { state: "pending" };
      prices.set(key, entry);
      active++;
      void priceCard(item.marketHashName, queue, {
        appid: item.appid, currencyContext, persistMarketCache: false,
        requestPolicy: { base: "priceoverview", retry429: false },
      }).then(result => {
        const record = result.record;
        const price = record?.lowestSellMinor;
        if (result.outcome === "priced" && record?.currencyId === currencyContext.currencyId
          && record.currencyCode === currencyContext.code && Number.isSafeInteger(price) && price > 0) {
          Object.assign(entry, { state: "priced", priceMinor: price, observedAt: record.observedAt });
          observations.push(record);
        } else entry.state = "missing";
      }).catch(() => { entry.state = "missing"; }).finally(() => {
        active--;
        if (stopped) return;
        if (!active && observations.length) {
          try { storageError = !persist(observations.splice(0)).ok; }
          catch (_) { storageError = true; }
        }
        onChange();
      });
      return entry;
    },
    retry() {
      for (const [key, entry] of prices) if (entry.state === "missing") prices.delete(key);
      onChange();
    },
    stop() { stopped = true; queue.stop(); },
  };
}
