import { parseCompactBuyOrderLevels } from "../services/order-wall.js";

  const RECENT_HISTORY_SECONDS = 24 * 60 * 60;
  const HISTORY_LAG_TOLERANCE_SECONDS = 2 * 60 * 60;

  export function getMarketListingUrl(marketHashName, appid = 753) {
    return `https://steamcommunity.com/market/listings/${appid}/${encodeURIComponent(marketHashName)}?l=english`;
  }

  function parseCount(value) {
    if (value === null || value === undefined || value === "") return null;
    const count = typeof value === "number" ? value : Number(String(value).replace(/[\s,.'’]/g, ""));
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  }

  function parseNonnegativeNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function isExplicitZero(value) {
    return value === 0 || (typeof value === "string"
      && /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?$/i.test(value.trim()));
  }

  function getRenderQueries(listingHtml) {
    const html = String(listingHtml || "");
    const ssrDataMatch = html.match(
      /<script\b(?=[^>]*\sid\s*=\s*["']valve-ssr-data["'])(?=[^>]*\stype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/i
    );
    const renderContextMatch = !ssrDataMatch && html.match(
      /window\.SSR\.renderContext\s*=\s*JSON\.parse\(\s*("(?:\\.|[^"\\])*")\s*\)\s*;/
    );
    if (!ssrDataMatch && !renderContextMatch) return [];

    try {
      // Read only Steam's data envelope; never execute the hydration script.
      const renderContext = ssrDataMatch
        ? JSON.parse(ssrDataMatch[1])?.renderContext
        : JSON.parse(JSON.parse(renderContextMatch[1]));
      const queryData = JSON.parse(renderContext?.queryData || "{}");
      return Array.isArray(queryData?.queries) ? queryData.queries : [];
    } catch (_) {
      return [];
    }
  }

  function getDescriptionImageUrl(description) {
    const icon = String(description?.icon_url_large || description?.icon_url || "").trim();
    if (!icon) return "";
    if (/^https?:\/\//i.test(icon)) return icon;
    return `https://community.fastly.steamstatic.com/economy/image/${icon}`;
  }

  function findTargetQuery(queries, marketHashName, queryType, hasExpectedData, appid) {
    const exact = queries.find(query => {
      const key = query?.queryKey;
      return Array.isArray(key)
        && key[0] === "market"
        && key[1] === queryType
        && String(key[2]) === String(appid ?? 753)
        && key[3] === marketHashName;
    });
    if (exact || appid !== undefined) return exact;

    // Compatibility is limited to a single truly unkeyed payload. Never use a
    // query that identifies another market item as a fallback for this item.
    const unkeyed = queries.filter(query => {
      const key = query?.queryKey;
      return (!Array.isArray(key) || key.length === 0) && hasExpectedData(query?.state?.data);
    });
    return unkeyed.length === 1 ? unkeyed[0] : null;
  }

  function parseRecentPriceHistory(queries, marketHashName, appid) {
    const historyQuery = findTargetQuery(
      queries,
      marketHashName,
      "pricehistory",
      data => data && Array.isArray(data.prices),
      appid
    );
    const history = historyQuery?.state?.data;
    if (!Array.isArray(history?.prices)) return null;

    const points = [];
    let cutoff = Math.floor(Date.now() / 1000) - RECENT_HISTORY_SECONDS - HISTORY_LAG_TOLERANCE_SECONDS;
    for (const rawPoint of history.prices) {
      const time = parseCount(rawPoint?.time);
      if (!time) return null;
      if (time <= cutoff) continue;
      points.push({
        time,
        price: parseNonnegativeNumber(rawPoint?.price_median),
        purchases: parseCount(rawPoint?.purchases),
      });
      cutoff = Math.max(cutoff, time - RECENT_HISTORY_SECONDS);
    }
    const recent = points.filter(point => point.time > cutoff);
    if (recent.some(point => !point.price || !point.purchases)) return null;
    const volume = recent.reduce((sum, point) => sum + point.purchases, 0);
    let medianPriceMajor = null;
    if (volume > 0) {
      let cumulative = 0;
      const midpoint = volume / 2;
      for (const point of recent.sort((left, right) => left.price - right.price)) {
        cumulative += point.purchases;
        if (cumulative >= midpoint) {
          medianPriceMajor = point.price;
          break;
        }
      }
    }
    return {
      historyCurrency: parseCount(history.ecurrency),
      medianPriceMajor,
      volume,
    };
  }

  function parseMarketListingSnapshot(queries, marketHashName, options) {
    try {
      const orderbookQuery = findTargetQuery(
        queries,
        marketHashName,
        "orderbook",
        data => data && Object.prototype.hasOwnProperty.call(data, "amtMaxBuyOrder"),
        options.appid
      );
      const orderbook = orderbookQuery?.state?.data;
      const highestBuyCents = parseNonnegativeNumber(orderbook?.amtMaxBuyOrder);
      const lowestSellCents = parseNonnegativeNumber(orderbook?.amtMinSellOrder);
      const currency = parseNonnegativeNumber(orderbook?.eCurrency);
      const descriptionQuery = findTargetQuery(
        queries,
        marketHashName,
        "description",
        data => data && (data.icon_url || data.icon_url_large) && data.name,
        options.appid
      );
      const description = descriptionQuery?.state?.data;
      const recentHistory = options.includeHistory !== false
        ? parseRecentPriceHistory(queries, marketHashName, options.appid)
        : null;
      if (!orderbook && !description && !recentHistory) return null;
      return {
        highestBuyCents,
        lowestSellCents,
        currency,
        noBuyOrders: isExplicitZero(orderbook?.cBuyOrders)
          && (orderbook?.amtMaxBuyOrder == null || isExplicitZero(orderbook.amtMaxBuyOrder))
          && (orderbook?.rgCompactBuyOrders === undefined
            || (Array.isArray(orderbook.rgCompactBuyOrders) && orderbook.rgCompactBuyOrders.length === 0)),
        sellOrderCount: parseCount(
          orderbook?.cSellOrders ?? orderbook?.sell_order_count
        ),
        displayName: String(description?.name || "").trim(),
        imageUrl: getDescriptionImageUrl(description),
        ...(recentHistory || {}),
      };
    } catch (_) {
      return null;
    }
  }

  export function parseMarketListingSnapshotFromHtml(listingHtml, marketHashName, options = {}) {
    return parseMarketListingSnapshot(
      getRenderQueries(listingHtml),
      marketHashName,
      options
    );
  }

  export function parseMarketOrderbookFromListingHtml(listingHtml, marketHashName) {
    const snapshot = parseMarketListingSnapshotFromHtml(
      listingHtml,
      marketHashName,
      { includeHistory: false }
    );
    if (!snapshot || snapshot.highestBuyCents === null) return null;
    return snapshot;
  }

  function parseMarketOrderDepth(queries, marketHashName, { sell, appid }) {
    const levelsKey = sell ? "rgCompactSellOrders" : "rgCompactBuyOrders";
    const orderbookQuery = findTargetQuery(
      queries,
      marketHashName,
      "orderbook",
      data => data && Array.isArray(data[levelsKey]),
      appid
    );
    const orderbook = orderbookQuery?.state?.data;
    if (!orderbook) return null;
    const highestBuyMinor = parseCount(orderbook.amtMaxBuyOrder);
    const lowestSellValue = parseCount(orderbook.amtMinSellOrder);
    const bestPriceMinor = sell ? lowestSellValue : highestBuyMinor;
    const currencyId = parseCount(orderbook.eCurrency);
    if (!bestPriceMinor || !currencyId) return null;
    const levels = parseCompactBuyOrderLevels(orderbook[levelsKey], {
      sell,
      expectedBestPriceMinor: bestPriceMinor,
    });
    if (!levels) return null;
    const buyOrderCount = parseCount(orderbook.cBuyOrders);
    const sellOrderCount = parseCount(orderbook.cSellOrders);
    const count = sell ? sellOrderCount : buyOrderCount;
    if (
      count !== null
      && levels.reduce((sum, level) => sum + level.quantity, 0) !== count
    ) return null;
    return {
      currencyId,
      highestBuyMinor,
      lowestSellMinor: lowestSellValue && lowestSellValue > 0 ? lowestSellValue : null,
      buyOrderCount,
      sellOrderCount,
      [sell ? "sellLevels" : "buyLevels"]: levels,
    };
  }

  export function parseMarketOrderDepthFromListingHtml(listingHtml, marketHashName, options = {}) {
    return parseMarketOrderDepth(getRenderQueries(listingHtml), marketHashName, options);
  }

  export function parseMarketListingWithDepthFromHtml(listingHtml, marketHashName, options = {}) {
    const queries = getRenderQueries(listingHtml);
    return {
      snapshot: parseMarketListingSnapshot(
        queries,
        marketHashName,
        options
      ),
      depth: parseMarketOrderDepth(queries, marketHashName, options),
    };
  }

  export function getMarketHashNameFromLink(link) {
    const href = link?.getAttribute("href") || link?.href || "";
    const match = href.match(/\/market\/listings\/753\/(.+?)(?:\?|#|$)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (_) {
      return match[1];
    }
  }
