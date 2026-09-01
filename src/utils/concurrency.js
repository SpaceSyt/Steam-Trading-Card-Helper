export function getHtmlRequestConcurrency(cfg) {
  if (cfg?.parallelOrderPricingEnabled !== true) return 1;
  const value = Math.floor(Number(cfg.parallelOrderPricingConcurrency));
  return Number.isFinite(value) ? Math.min(20, Math.max(1, value)) : 4;
}

export function getOtherRequestConcurrency(cfg) {
  if (cfg?.parallelOtherRequestsEnabled === false) return 1;
  const value = Math.floor(Number(cfg?.parallelOtherRequestsConcurrency));
  return Number.isFinite(value) ? Math.min(20, Math.max(1, value)) : 8;
}

export function createRequestQueuePool(concurrency, createQueue) {
  const size = Math.max(1, Math.floor(Number(concurrency)) || 1);
  const entries = Array.from({ length: size }, (_, index) => ({
    index,
    queue: null,
    pending: 0,
  }));
  let stopped = false;
  return {
    get stopped() {
      return stopped;
    },
    fetch(url, options) {
      if (stopped) return Promise.reject({ status: 0, error: "stopped" });
      let target = null;
      for (const entry of entries) {
        if (entry.queue?.stopped) continue;
        if (!target || entry.pending < target.pending) target = entry;
      }
      if (!target) {
        stopped = true;
        return Promise.reject({ status: 0, error: "stopped" });
      }
      if (!target.queue) target.queue = createQueue(target.index);
      target.pending++;
      try {
        return Promise.resolve(target.queue.fetch(url, options)).finally(() => { target.pending--; });
      } catch (error) {
        target.pending--;
        return Promise.reject(error);
      }
    },
    stop() {
      stopped = true;
      entries.forEach(entry => entry.queue?.stop());
    },
  };
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
