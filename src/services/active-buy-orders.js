import { parseMajorAmountToMinor } from "./market-data.js";

const ENTITY_MAP = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
});

function decodeHtmlEntities(value) {
  return String(value ?? "").replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi,
    (entity, body) => {
      if (body[0] !== "#") return ENTITY_MAP[body.toLowerCase()] ?? entity;
      const hexadecimal = body[1]?.toLowerCase() === "x";
      const number = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!Number.isSafeInteger(number) || number < 0 || number > 0x10ffff) return entity;
      try {
        return String.fromCodePoint(number);
      } catch {
        return entity;
      }
    }
  );
}

function textContent(fragment) {
  return decodeHtmlEntities(String(fragment ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function classFragment(rowHtml, className) {
  const pattern = new RegExp(
    `<([a-z][\\w:-]*)\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    "i"
  );
  return pattern.exec(rowHtml)?.[2] ?? "";
}

function attributeFromTag(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(tag);
  return match ? decodeHtmlEntities(match[2]) : "";
}

function parseListingHref(rowHtml) {
  const tags = rowHtml.match(/<a\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const href = attributeFromTag(tag, "href");
    if (/\/market\/listings\/\d+\//i.test(href)) return href;
  }
  return "";
}

function parseListingIdentity(href) {
  const match = /\/market\/listings\/(\d+)\/([^?#]+)/i.exec(href);
  if (!match) return null;
  let marketHashName;
  try {
    marketHashName = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  return marketHashName ? { appid: match[1], marketHashName } : null;
}

function parsePositiveInteger(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function parseOrderRow(rowHtml, orderId, options) {
  const href = parseListingHref(rowHtml);
  const identity = parseListingIdentity(href);
  if (!identity) return { error: "missing-listing-identity" };

  const quantity = parsePositiveInteger(textContent(classFragment(rowHtml, "market_listing_buyorder_qty")));
  if (!quantity) return { error: "invalid-remaining-quantity", identity };

  const inlineQuantity = classFragment(rowHtml, "market_listing_inline_buyorder_qty");
  const priceCell = classFragment(rowHtml, "market_listing_my_price");
  const priceText = textContent(priceCell.replace(inlineQuantity, ""));
  const unitPriceMinor = parseMajorAmountToMinor(priceText, options.minorDigits);
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor <= 0) {
    return { error: "invalid-unit-price", identity };
  }

  const nameHtml = classFragment(rowHtml, "market_listing_item_name");
  const displayName = textContent(nameHtml) || identity.marketHashName;
  const imageTag = /<img\b[^>]*class=["'][^"']*\bmarket_listing_item_img\b[^"']*["'][^>]*>/i.exec(rowHtml)?.[0] || "";

  return {
    order: {
      orderId,
      ...identity,
      displayName,
      gameName: textContent(classFragment(rowHtml, "market_listing_game_name")),
      imageUrl: attributeFromTag(imageTag, "src"),
      listingUrl: href,
      remainingQuantity: quantity,
      unitPriceMinor,
      frozenMinor: unitPriceMinor * quantity,
    },
  };
}

export function parseActiveBuyOrdersHtml(html, options = {}) {
  const source = String(html ?? "");
  const rowPattern = /<div\b[^>]*\bid=["']mybuyorder_(\d+)["'][^>]*>/gi;
  const starts = [];
  let match;
  while ((match = rowPattern.exec(source))) {
    starts.push({ index: match.index, orderId: match[1] });
  }

  const orders = [];
  const diagnostics = [];
  const seenOrderIds = new Set();
  for (let index = 0; index < starts.length; index += 1) {
    const current = starts[index];
    if (seenOrderIds.has(current.orderId)) {
      diagnostics.push({ code: "duplicate-order-id", orderId: current.orderId });
      continue;
    }
    seenOrderIds.add(current.orderId);
    const end = starts[index + 1]?.index ?? source.length;
    const parsed = parseOrderRow(source.slice(current.index, end), current.orderId, {
      minorDigits: Number.isInteger(options.minorDigits) ? options.minorDigits : 2,
    });
    if (parsed.order) orders.push(parsed.order);
    else diagnostics.push({
      code: parsed.error || "invalid-order-row",
      orderId: current.orderId,
      marketHashName: parsed.identity?.marketHashName || "",
    });
  }
  return { orders, diagnostics, detectedRowCount: starts.length };
}

export function parseActiveBuyOrdersResponse(data, options = {}) {
  if (data?.success !== true && data?.success !== 1) {
    throw new Error("Steam 未返回现有订购单");
  }
  const parsed = parseActiveBuyOrdersHtml(data.results_html, options);
  return {
    ...parsed,
    start: Number.isSafeInteger(Number(data.start)) ? Number(data.start) : null,
    pageSize: Number.isSafeInteger(Number(data.pagesize)) ? Number(data.pagesize) : null,
    sellListingCount: Number.isSafeInteger(Number(data.total_count)) ? Number(data.total_count) : null,
    observedAt: Number.isFinite(Number(options.observedAt)) ? Number(options.observedAt) : Date.now(),
  };
}

export function aggregateActiveBuyOrders(orders) {
  const groups = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    const key = JSON.stringify([String(order.appid || ""), String(order.marketHashName || "")]);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        appid: String(order.appid || ""),
        marketHashName: String(order.marketHashName || ""),
        displayName: order.displayName || order.marketHashName || "未知物品",
        gameName: order.gameName || "",
        imageUrl: order.imageUrl || "",
        listingUrl: order.listingUrl || "",
        orders: [],
        orderCount: 0,
        remainingQuantity: 0,
        frozenMinor: 0,
        minPriceMinor: null,
        maxPriceMinor: null,
      };
      groups.set(key, group);
    }
    group.orders.push(order);
    group.orderCount += 1;
    group.remainingQuantity += order.remainingQuantity;
    group.frozenMinor += order.frozenMinor;
    group.minPriceMinor = group.minPriceMinor == null
      ? order.unitPriceMinor
      : Math.min(group.minPriceMinor, order.unitPriceMinor);
    group.maxPriceMinor = group.maxPriceMinor == null
      ? order.unitPriceMinor
      : Math.max(group.maxPriceMinor, order.unitPriceMinor);
  }
  return [...groups.values()].sort((left, right) => (
    left.gameName.localeCompare(right.gameName, "zh-CN")
      || left.displayName.localeCompare(right.displayName, "zh-CN")
      || left.marketHashName.localeCompare(right.marketHashName)
  ));
}

export function isCancelBuyOrderResponseSuccessful(responseOk, data) {
  if (!responseOk || !data || typeof data !== "object" || Array.isArray(data)) return false;
  return data.success === 1;
}
