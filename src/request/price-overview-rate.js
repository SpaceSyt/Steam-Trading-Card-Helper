export const PRICE_OVERVIEW_LIMIT = 20;
export const PRICE_OVERVIEW_WINDOW_MS = 60000;

let windowStartedAt = null;
let requestCount = 0;

function refreshWindow(now) {
  if (
    windowStartedAt === null
    || now < windowStartedAt
    || now - windowStartedAt >= PRICE_OVERVIEW_WINDOW_MS
  ) {
    windowStartedAt = now;
    requestCount = 0;
  }
}

export function reservePriceOverviewRequest(now = Date.now()) {
  refreshWindow(now);
  if (requestCount < PRICE_OVERVIEW_LIMIT) {
    requestCount++;
    return 0;
  }
  return Math.max(0, PRICE_OVERVIEW_WINDOW_MS - (now - windowStartedAt));
}

export function getPriceOverviewRateState(now = Date.now()) {
  refreshWindow(now);
  return {
    count: requestCount,
    limit: PRICE_OVERVIEW_LIMIT,
    resetInMs: Math.max(0, PRICE_OVERVIEW_WINDOW_MS - (now - windowStartedAt)),
  };
}

export function resetPriceOverviewRateState() {
  windowStartedAt = null;
  requestCount = 0;
}
