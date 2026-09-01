export function getHtmlRequestConcurrency(cfg) {
  if (cfg?.parallelOrderPricingEnabled !== true) return 1;
  const value = Math.floor(Number(cfg.parallelOrderPricingConcurrency));
  return Number.isFinite(value) ? Math.min(20, Math.max(1, value)) : 4;
}

export async function runWithConcurrency(items, concurrency, operation) {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await operation(items[index], index);
    }
  };
  const count = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: count }, () => worker()));
}
