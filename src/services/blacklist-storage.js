import { normalizeBlacklistPriceEntry } from "./blacklist-price.js";

const METADATA_FIELDS = Object.freeze([
  Object.freeze({ configKey: "blacklistNames", dataKey: "names", label: "名称" }),
  Object.freeze({ configKey: "blacklistSources", dataKey: "sources", label: "来源" }),
  Object.freeze({ configKey: "blacklistDates", dataKey: "dates", label: "日期" }),
  Object.freeze({ configKey: "blacklistFixed", dataKey: "fixed", label: "固定状态" }),
  Object.freeze({ configKey: "blacklistPriceData", dataKey: "priceData", label: "价格" }),
]);

function parseObjectField(raw, field, diagnostics) {
  let source = raw;
  if (source == null || source === "") return {};
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch (_) {
      diagnostics.push({
        field: field.configKey,
        label: field.label,
        reason: "invalid-json",
      });
      return {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    diagnostics.push({
      field: field.configKey,
      label: field.label,
      reason: "invalid-shape",
    });
    return {};
  }
  return { ...source };
}

function normalizePriceData(source, diagnostics) {
  const result = {};
  for (const [appid, entry] of Object.entries(source)) {
    const normalized = normalizeBlacklistPriceEntry(entry);
    if (!/^\d+$/.test(appid) || !normalized) {
      diagnostics.push({
        field: "blacklistPriceData",
        label: "价格",
        reason: "invalid-entry",
        appid,
      });
      continue;
    }
    result[appid] = normalized;
  }
  return result;
}

export function readBlacklistStorage(cfg = {}) {
  const diagnostics = [];
  const storage = {
    appids: String(cfg.blacklist || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean),
  };

  for (const field of METADATA_FIELDS) {
    const parsed = parseObjectField(cfg[field.configKey], field, diagnostics);
    storage[field.dataKey] = field.dataKey === "priceData"
      ? normalizePriceData(parsed, diagnostics)
      : parsed;
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    ...storage,
  };
}

export function writeBlacklistStorage(cfg, storage) {
  cfg.blacklist = storage.appids.join(",");
  for (const field of METADATA_FIELDS) {
    cfg[field.configKey] = JSON.stringify(storage[field.dataKey]);
  }
}

export function mutateBlacklistStorage(cfg, mutate) {
  const storage = readBlacklistStorage(cfg);
  if (!storage.ok) {
    return {
      ok: false,
      changed: false,
      diagnostics: storage.diagnostics,
      storage,
    };
  }

  const changed = mutate(storage) !== false;
  if (changed) writeBlacklistStorage(cfg, storage);
  return {
    ok: true,
    changed,
    diagnostics: [],
    storage,
  };
}

export function describeBlacklistStorageError(result) {
  const diagnostics = result?.diagnostics || [];
  if (diagnostics.length === 0) return "";
  const fields = [...new Set(diagnostics.map(item => item.label).filter(Boolean))];
  return `黑名单${fields.join("、")}数据损坏，已禁止修改；原始数据未被覆盖`;
}
