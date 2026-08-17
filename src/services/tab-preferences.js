import { DEFAULT_TAB_ORDER, TAB_DEFINITIONS } from "../constants.js";

export function normalizeTabOrder(value) {
  const known = new Set(DEFAULT_TAB_ORDER);
  const seen = new Set();
  const order = [];
  if (Array.isArray(value)) {
    for (const id of value) {
      if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of DEFAULT_TAB_ORDER) {
    if (!seen.has(id)) order.push(id);
  }
  return order;
}

export function getOrderedTabDefinitions(value) {
  const byId = new Map(TAB_DEFINITIONS.map(tab => [tab.id, tab]));
  return normalizeTabOrder(value).map(id => byId.get(id));
}

export function normalizeHexColor(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const match = text.match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : "";
}

export function normalizeTabColors(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const colors = {};
  for (const id of DEFAULT_TAB_ORDER) {
    const color = normalizeHexColor(source[id]);
    if (color) colors[id] = color;
  }
  return colors;
}
