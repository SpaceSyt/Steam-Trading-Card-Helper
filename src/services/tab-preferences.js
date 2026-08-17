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
