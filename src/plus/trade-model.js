function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function tradeAssetKey(asset, currency = false) {
  return JSON.stringify([String(asset.appid), String(asset.contextid), String(currency ? asset.currencyid ?? asset.id : asset.assetid ?? asset.id), currency]);
}

export function tradePriceKey(item, currencyId) {
  return JSON.stringify([item.appid, item.marketHashName, currencyId]);
}

// Amounts come from the offer, never from the remaining inventory stack.
export function readTradeSide(side, descriptions) {
  if (!side || !Array.isArray(side.assets) || !Array.isArray(side.currency)) return null;
  const items = [];
  const types = new Set();
  const seen = new Set();
  let quantity = 0;
  let completeCount = true;
  let completeTypes = true;
  for (const [assets, currency] of [[side.assets, false], [side.currency, true]]) {
    for (const asset of assets) {
      if (!asset || typeof asset !== "object") return null;
      const key = tradeAssetKey(asset, currency);
      if (seen.has(key)) return null;
      seen.add(key);
      const amount = positiveInteger(asset.amount);
      quantity += amount || 0;
      completeCount &&= amount !== null && Number.isSafeInteger(quantity);
      const raw = descriptions.get(key);
      const description = raw?.description || raw;
      const known = description && !raw.unknown && !description.unknown;
      const appid = String(asset.appid);
      const marketHashName = known ? String(description.market_hash_name || "").trim() : "";
      const classid = known ? description.classid ?? raw.classid : null;
      const typeKey = marketHashName ? [appid, marketHashName]
        : classid ? [appid, String(classid), String(description.instanceid ?? raw.instanceid ?? "0")]
        : null;
      if (typeKey) types.add(JSON.stringify(typeKey));
      else completeTypes = false;
      items.push({
        appid, marketHashName, amount,
        priceable: !currency && !!known && !!marketHashName && !!positiveInteger(appid)
          && (description.marketable === true || Number(description.marketable) === 1),
      });
    }
  }
  return { items, uniqueCount: completeTypes ? types.size : null, quantity: completeCount ? quantity : null };
}

export function summarizeTradeSide(side, getPrice) {
  if (!side) return null;
  let totalMinor = 0;
  let missing = 0;
  let pending = 0;
  let retryable = false;
  let observedAt = Infinity;
  for (const item of side.items) {
    const quote = item.priceable && item.amount !== null ? getPrice(item) : null;
    if (quote?.state === "pending") pending += item.amount;
    else if (quote?.state === "priced" && positiveInteger(quote.priceMinor)) {
      totalMinor += quote.priceMinor * item.amount;
      observedAt = Math.min(observedAt, quote.observedAt);
    } else {
      missing += item.amount || 1;
      retryable ||= quote?.state === "missing";
    }
  }
  const complete = side.quantity !== null && !missing && !pending && Number.isSafeInteger(totalMinor);
  return { ...side, totalMinor: complete ? totalMinor : null, missing, pending, retryable, observedAt };
}

export function compareTradeSides(yours, theirs) {
  if (yours?.totalMinor == null || theirs?.totalMinor == null) return null;
  return theirs.totalMinor - yours.totalMinor;
}
