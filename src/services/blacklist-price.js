const PRICE_ACCURACY = new Set(["exact", "estimated"]);
const PRICE_REASONS = new Set(["complete", "prediction", "fallback"]);

export function normalizeBlacklistPriceEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const priceMinor = Number(entry.priceMinor);
  const currencyId = Number(entry.currencyId);
  const observedAt = Number(entry.observedAt);
  if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) return null;
  if (!Number.isInteger(currencyId) || currencyId <= 0) return null;
  if (!PRICE_ACCURACY.has(entry.accuracy)) return null;
  return {
    priceMinor,
    currencyId,
    accuracy: entry.accuracy,
    reason: PRICE_REASONS.has(entry.reason)
      ? entry.reason
      : entry.accuracy === "exact" ? "complete" : "fallback",
    observedAt: Number.isFinite(observedAt) && observedAt > 0
      ? Math.floor(observedAt)
      : 0,
  };
}

export function parseBlacklistPriceData(raw) {
  let source = raw;
  if (typeof source === "string") {
    try { source = JSON.parse(source || "{}"); } catch (_) { return {}; }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const result = {};
  for (const [appid, entry] of Object.entries(source)) {
    if (!/^\d+$/.test(appid)) continue;
    const normalized = normalizeBlacklistPriceEntry(entry);
    if (normalized) result[appid] = normalized;
  }
  return result;
}

export function setBlacklistPriceEntry(raw, appid, entry) {
  const data = parseBlacklistPriceData(raw);
  const normalized = normalizeBlacklistPriceEntry(entry);
  const key = String(appid || "");
  if (!/^\d+$/.test(key) || !normalized) return data;
  data[key] = normalized;
  return data;
}
