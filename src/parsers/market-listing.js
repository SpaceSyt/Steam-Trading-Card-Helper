import { parseCompactBuyOrderLevels } from "../services/order-wall.js";

  export function parseMarketHashNameFromHref(href) {
    const match = String(href || "").match(/\/market\/listings\/753\/(.+?)(?:\?|#|$)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (_) {
      return match[1];
    }
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

  export function parseMarketListingSnapshotFromHtml(listingHtml, marketHashName) {
    try {
      const queries = getRenderQueries(listingHtml);
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
      return {
        highestBuyCents,
        lowestSellCents,
        currency,
        sellOrderCount: parseCount(
          orderbook?.cSellOrders ?? orderbook?.sell_order_count
        ),
        displayName: String(description?.name || "").trim(),
        imageUrl: getDescriptionImageUrl(description),
      };
    } catch (_) {
      return null;
    }
  }

  export function parseMarketOrderbookFromListingHtml(listingHtml, marketHashName) {
    const snapshot = parseMarketListingSnapshotFromHtml(listingHtml, marketHashName);
    if (!snapshot || snapshot.highestBuyCents === null) return null;
    return snapshot;
  }

  export function parseMarketOrderDepthFromListingHtml(listingHtml, marketHashName) {
    const queries = getRenderQueries(listingHtml);
    const orderbookQuery = findTargetQuery(
      queries,
      marketHashName,
      "orderbook",
      data => data && Array.isArray(data.rgCompactBuyOrders)
    );
    const orderbook = orderbookQuery?.state?.data;
    if (!orderbook) return null;
    const highestBuyMinor = parseCount(orderbook.amtMaxBuyOrder);
    const currencyId = parseCount(orderbook.eCurrency);
    if (!highestBuyMinor || !currencyId) return null;
    const buyLevels = parseCompactBuyOrderLevels(orderbook.rgCompactBuyOrders, {
      expectedBestPriceMinor: highestBuyMinor,
    });
    if (!buyLevels) return null;
    const buyOrderCount = parseCount(orderbook.cBuyOrders);
    if (
      buyOrderCount !== null
      && buyLevels.reduce((sum, level) => sum + level.quantity, 0) !== buyOrderCount
    ) return null;
    const lowestSellValue = parseCount(orderbook.amtMinSellOrder);
    return {
      currencyId,
      highestBuyMinor,
      lowestSellMinor: lowestSellValue && lowestSellValue > 0 ? lowestSellValue : null,
      buyOrderCount,
      sellOrderCount: parseCount(orderbook.cSellOrders),
      buyLevels,
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
