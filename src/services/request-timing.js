function toNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

export function calculatePriceOverviewCycleTiming(
  requestIntervalMs,
  batchSize,
  pauseMs
) {
  const interval = toNonNegativeInteger(requestIntervalMs, 0);
  const requests = Math.max(1, toNonNegativeInteger(batchSize, 1));
  const pause = toNonNegativeInteger(pauseMs, 0);
  const requestDurationMs = interval * requests;
  return {
    requestIntervalMs: interval,
    batchSize: requests,
    pauseMs: pause,
    requestDurationMs,
    cycleDurationMs: requestDurationMs + pause,
  };
}

export function formatTimingSeconds(milliseconds) {
  return String(Number((milliseconds / 1000).toFixed(2)));
}
