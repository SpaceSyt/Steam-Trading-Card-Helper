import { state } from "../state.js";

export const ITEM_COLLECTION_STORAGE_KEY = "stch_item_collection";
export const ITEM_COLLECTION_SCHEMA_VERSION = 1;

const ITEM_CATEGORIES = new Set(["card", "background", "emoticon"]);

function cleanText(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

export function getItemCollectionKey(item, category = item?.category) {
  const normalizedCategory = ITEM_CATEGORIES.has(category) ? category : "";
  const appid = cleanText(item?.appid, 20) || "0";
  const marketHashName = cleanText(item?.marketHashName);
  const descriptionKey = cleanText(item?.descriptionKey, 100);
  if (!normalizedCategory || (!marketHashName && !descriptionKey)) return "";
  return JSON.stringify([
    normalizedCategory,
    appid,
    marketHashName ? "market" : "class",
    marketHashName || descriptionKey,
  ]);
}

export function normalizeItemCollectionEntry(item, now = Date.now()) {
  const category = ITEM_CATEGORIES.has(item?.category) ? item.category : "";
  const entry = {
    category,
    appid: cleanText(item?.appid, 20),
    marketHashName: cleanText(item?.marketHashName),
    descriptionKey: cleanText(item?.descriptionKey, 100),
    itemName: cleanText(item?.itemName || item?.cardName || item?.name),
    gameName: cleanText(item?.gameName),
    imageUrl: cleanText(item?.imageUrl, 1000),
    addedAt: Number.isFinite(Number(item?.addedAt)) && Number(item.addedAt) > 0
      ? Math.floor(Number(item.addedAt))
      : now,
  };
  entry.key = getItemCollectionKey(entry);
  return entry.key ? entry : null;
}

export function decodeItemCollection(raw) {
  if (raw == null || raw === "") {
    return { ok: true, items: [], migrated: false };
  }
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (
      !value
      || typeof value !== "object"
      || value.schemaVersion !== ITEM_COLLECTION_SCHEMA_VERSION
      || !Array.isArray(value.items)
    ) {
      return { ok: false, items: [], error: "收藏数据格式不受支持" };
    }
    const items = [];
    const seen = new Set();
    for (const source of value.items) {
      const item = normalizeItemCollectionEntry(source);
      if (!item || seen.has(item.key)) continue;
      seen.add(item.key);
      items.push(item);
    }
    return { ok: true, items, migrated: items.length !== value.items.length };
  } catch (_) {
    return { ok: false, items: [], error: "收藏数据已损坏" };
  }
}

function createEnvelope(items) {
  return {
    schemaVersion: ITEM_COLLECTION_SCHEMA_VERSION,
    items: items.map(({ key: _key, ...item }) => item),
  };
}

function persistItemCollection(items) {
  GM_setValue(ITEM_COLLECTION_STORAGE_KEY, JSON.stringify(createEnvelope(items)));
}

export function loadItemCollection() {
  const decoded = decodeItemCollection(GM_getValue(ITEM_COLLECTION_STORAGE_KEY, null));
  state.itemCollectionHealthy = decoded.ok;
  state.itemCollectionItems = decoded.items;
  if (decoded.ok && decoded.migrated) {
    try { persistItemCollection(decoded.items); } catch (_) {}
  }
  return decoded.items;
}

export function isItemCollectionHealthy() {
  return state.itemCollectionHealthy !== false;
}

let indexedItems;
let collectedKeys = new Set();

export function isItemCollected(item, category = item?.category) {
  if (indexedItems !== state.itemCollectionItems) {
    indexedItems = state.itemCollectionItems;
    collectedKeys = new Set((indexedItems || []).map(entry => entry.key));
  }
  const key = getItemCollectionKey(item, category);
  return !!key && collectedKeys.has(key);
}

export function addItemCollectionEntries(entries) {
  if (!isItemCollectionHealthy()) {
    return { ok: false, added: 0, error: "收藏数据已损坏，未写入新数据" };
  }
  const current = state.itemCollectionItems || [];
  const byKey = new Map(current.map(item => [item.key, item]));
  let added = 0;
  for (const source of entries || []) {
    const item = normalizeItemCollectionEntry(source);
    if (!item) continue;
    const existing = byKey.get(item.key);
    if (!existing) added++;
    byKey.set(item.key, existing
      ? { ...existing, ...item, addedAt: existing.addedAt }
      : item);
  }
  const items = [...byKey.values()];
  try {
    persistItemCollection(items);
    state.itemCollectionItems = items;
    return { ok: true, added, total: items.length };
  } catch (error) {
    return { ok: false, added: 0, error: error?.message || "收藏保存失败" };
  }
}

export function removeItemCollectionEntries(keys) {
  if (!isItemCollectionHealthy()) {
    return { ok: false, removed: 0, error: "收藏数据已损坏，未执行删除" };
  }
  const removeKeys = new Set(keys || []);
  const current = state.itemCollectionItems || [];
  const items = current.filter(item => !removeKeys.has(item.key));
  const removed = current.length - items.length;
  try {
    persistItemCollection(items);
    state.itemCollectionItems = items;
    return { ok: true, removed, total: items.length };
  } catch (error) {
    return { ok: false, removed: 0, error: error?.message || "收藏保存失败" };
  }
}
