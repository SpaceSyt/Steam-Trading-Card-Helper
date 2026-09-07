import { parseCompactBuyOrderLevels } from "../services/order-wall.js";

  const RECENT_HISTORY_SECONDS = 24 * 60 * 60;
  const HISTORY_LAG_TOLERANCE_SECONDS = 2 * 60 * 60;

  export function getMarketListingUrl(marketHashName, appid = 753) {
    return `https://steamcommunity.com/market/listings/${appid}/${encodeURIComponent(marketHashName)}?l=english`;
  }

  function parseCount(value) {
    if (value === null || value === undefined || value === "") return null;
    const count = Number(String(value).replace(/[\s,.'’]/g, ""));
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  }

  function parseNonnegativeNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function getRenderQueries(listingHtml) {
    const renderContextMatch = String(listingHtml || "").match(
      /window\.SSR\.renderContext=JSON\.parse\(("(?:\\.|[^"\\])*")\);/
    );
    if (!renderContextMatch) return [];

    try {
      const renderContext = JSON.parse(JSON.parse(renderContextMatch[1]));
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

  function findTargetQuery(queries, marketHashName, queryType, hasExpectedData) {
    const exact = queries.find(query => {
      const key = query?.queryKey;
      return Array.isArray(key)
        && key[0] === "market"
        && key[1] === queryType
        && String(key[2]) === "753"
        && key[3] === marketHashName;
    });
    if (exact) return exact;

    // Compatibility is limited to a single truly unkeyed payload. Never use a
    // query that identifies another market item as a fallback for this item.
    const unkeyed = queries.filter(query => {
      const key = query?.queryKey;
      return (!Array.isArray(key) || key.length === 0) && hasExpectedData(query?.state?.data);
    });
    return unkeyed.length === 1 ? unkeyed[0] : null;
  }

  function parseRecentPriceHistory(queries, marketHashName, now = Date.now()) {
    const historyQuery = findTargetQuery(
      queries,
      marketHashName,
      "pricehistory",
      data => data && Array.isArray(data.prices)
    );
    const history = historyQuery?.state?.data;
    if (!history) return null;

    const points = [];
    let latestTime = 0;
    for (const rawPoint of history.prices) {
      const point = {
        time: parseCount(rawPoint?.time),
        price: parseNonnegativeNumber(rawPoint?.price_median),
        purchases: parseCount(rawPoint?.purchases),
      };
      if (
        point.time === null
        || point.price === null
        || point.price <= 0
        || point.purchases === null
        || point.purchases <= 0
      ) continue;
      points.push(point);
      latestTime = Math.max(latestTime, point.time);
    }
    const currentTime = Math.floor(Number(now) / 1000);
    const cutoff = Math.max(
      latestTime - RECENT_HISTORY_SECONDS,
      currentTime - RECENT_HISTORY_SECONDS - HISTORY_LAG_TOLERANCE_SECONDS
    );
    const recent = points.filter(point => point.time > cutoff);
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

  function parseMarketListingSnapshot(queries, marketHashName, includeHistory = true) {
    try {
      const orderbookQuery = findTargetQuery(
        queries,
        marketHashName,
        "orderbook",
        data => data && Object.prototype.hasOwnProperty.call(data, "amtMaxBuyOrder")
      );
      const orderbook = orderbookQuery?.state?.data;
      const highestBuyCents = parseNonnegativeNumber(orderbook?.amtMaxBuyOrder);
      const lowestSellCents = parseNonnegativeNumber(orderbook?.amtMinSellOrder);
      const currency = parseNonnegativeNumber(orderbook?.eCurrency);
      const descriptionQuery = findTargetQuery(
        queries,
        marketHashName,
        "description",
        data => data && (data.icon_url || data.icon_url_large) && data.name
      );
      const description = descriptionQuery?.state?.data;
      if (!orderbook && !description) return null;
      const recentHistory = includeHistory
        ? parseRecentPriceHistory(queries, marketHashName)
        : null;
      return {
        highestBuyCents,
        lowestSellCents,
        currency,
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
      options.includeHistory !== false
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

  function parseMarketOrderDepth(queries, marketHashName, sell = false) {
    const levelsKey = sell ? "rgCompactSellOrders" : "rgCompactBuyOrders";
    const orderbookQuery = findTargetQuery(
      queries,
      marketHashName,
      "orderbook",
      data => data && Array.isArray(data[levelsKey])
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
    return parseMarketOrderDepth(getRenderQueries(listingHtml), marketHashName, options.sell);
  }

  export function parseMarketListingWithDepthFromHtml(listingHtml, marketHashName, options = {}) {
    const queries = getRenderQueries(listingHtml);
    return {
      snapshot: parseMarketListingSnapshot(
        queries,
        marketHashName,
        options.includeHistory !== false
      ),
      depth: parseMarketOrderDepth(queries, marketHashName, options.sell),
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
