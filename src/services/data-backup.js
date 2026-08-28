export const DATA_BACKUP_FORMAT = "steam-trading-card-helper-backup";
export const DATA_BACKUP_VERSION = 1;

// Only durable data owned by this userscript is transferable. The short-lived
// multibuy bridge is intentionally excluded because it expires after minutes.
export const DATA_BACKUP_STORAGE_KEYS = Object.freeze([
  "stch_config",
  "stch_order_cache",
  "stch_market_cache",
  "stch_market_history",
  "stch_market_watchlist",
  "stch_item_collection",
  "stch_sidebar_gem_price",
  "stch_sidebar_pinned",
  "stch_onboarding_seen",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeBackup(value) {
  if (
    !isObject(value)
    || value.format !== DATA_BACKUP_FORMAT
    || Number(value.backupVersion) !== DATA_BACKUP_VERSION
    || !isObject(value.storage)
  ) {
    throw new Error("不是受支持的 Steam 卡牌助手备份");
  }

  const unknownKeys = Object.keys(value.storage)
    .filter(key => !DATA_BACKUP_STORAGE_KEYS.includes(key));
  if (unknownKeys.length) {
    throw new Error(`备份包含未知数据项：${unknownKeys.join(", ")}`);
  }

  const storage = {};
  for (const key of DATA_BACKUP_STORAGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value.storage, key)) {
      storage[key] = value.storage[key];
    }
  }
  if (!Object.keys(storage).length) throw new Error("备份中没有可导入的数据");

  return {
    format: DATA_BACKUP_FORMAT,
    backupVersion: DATA_BACKUP_VERSION,
    exportedAt: String(value.exportedAt || ""),
    storage,
  };
}

export function createDataBackup(getValue, now = Date.now()) {
  if (typeof getValue !== "function") throw new TypeError("缺少数据读取函数");
  const storage = {};
  for (const key of DATA_BACKUP_STORAGE_KEYS) {
    storage[key] = getValue(key, null);
  }
  return {
    format: DATA_BACKUP_FORMAT,
    backupVersion: DATA_BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    storage,
  };
}

export function serializeDataBackup(backup) {
  return JSON.stringify(normalizeBackup(backup), null, 2);
}

export function parseDataBackup(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (_) {
      throw new Error("备份文件不是有效 JSON");
    }
  }
  return normalizeBackup(value);
}

export function restoreDataBackup(backup, { getValue, setValue }) {
  if (typeof getValue !== "function" || typeof setValue !== "function") {
    throw new TypeError("缺少数据读写函数");
  }
  const normalized = normalizeBackup(backup);
  const keys = Object.keys(normalized.storage);
  const previous = new Map(keys.map(key => [key, getValue(key, null)]));
  const written = [];

  try {
    for (const key of keys) {
      setValue(key, normalized.storage[key]);
      written.push(key);
    }
  } catch (error) {
    for (const key of written.reverse()) {
      try { setValue(key, previous.get(key)); } catch (_) {}
    }
    throw new Error(`导入失败，已尝试恢复原数据：${error?.message || error}`);
  }
  return { restored: keys.length, keys };
}

export function getDataBackupFileName(now = Date.now()) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  return `steam-card-helper-backup-${stamp}.json`;
}

export function getUtf8ByteLength(text) {
  return new TextEncoder().encode(String(text)).byteLength;
}
