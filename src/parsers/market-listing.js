  export function parseMarketHashNameFromHref(href) {
    const match = String(href || "").match(/\/market\/listings\/753\/(.+?)(?:\?|#|$)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (_) {
      return match[1];
    }
  }

  export function parseMarketOrderbookFromListingHtml(listingHtml, marketHashName) {
    const renderContextMatch = String(listingHtml || "").match(
      /window\.SSR\.renderContext=JSON\.parse\(("(?:\\.|[^"\\])*")\);/
    );
    if (!renderContextMatch) return null;

    try {
      const renderContext = JSON.parse(JSON.parse(renderContextMatch[1]));
      const queryData = JSON.parse(renderContext?.queryData || "{}");
      const queries = Array.isArray(queryData?.queries) ? queryData.queries : [];
      const orderbookQuery = queries.find(query => {
        const key = query?.queryKey;
        return Array.isArray(key)
          && key[0] === "market"
          && key[1] === "orderbook"
          && String(key[2]) === "753"
          && key[3] === marketHashName;
      }) || queries.find(query => {
        const data = query?.state?.data;
        return data && Object.prototype.hasOwnProperty.call(data, "amtMaxBuyOrder");
      });
      const orderbook = orderbookQuery?.state?.data;
      const highestBuyCents = Number(orderbook?.amtMaxBuyOrder);
      const currency = Number(orderbook?.eCurrency);
      if (!Number.isFinite(highestBuyCents) || highestBuyCents < 0) return null;
      return {
        highestBuyCents,
        currency: Number.isFinite(currency) ? currency : null,
      };
    } catch (_) {
      return null;
    }
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
