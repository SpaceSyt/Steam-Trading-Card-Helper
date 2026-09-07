import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = globalThis;
const { readInventoryPages } = await import("../../src/services/inventory-pages.js");

async function collect(pages) {
  const result = [];
  for await (const page of pages) result.push(page);
  return result;
}

function inventoryQueue() {
  const urls = [];
  return {
    urls,
    async fetch(url) {
      urls.push(url);
      const second = new URL(url).searchParams.has("start_assetid");
      return { data: {
        success: 1,
        assets: [{ assetid: second ? "2" : "1" }],
        descriptions: [],
        more_items: !second,
        last_assetid: "1",
        total_inventory_count: 2,
      } };
    },
  };
}

test("one batch shares complete inventory pages without a second pagination request", async () => {
  const queue = inventoryQueue();
  const snapshot = {};
  const first = await collect(readInventoryPages("123", queue, { snapshot }));
  const second = await collect(readInventoryPages("123", queue, { snapshot }));
  assert.equal(queue.urls.length, 2);
  assert.equal(new URL(queue.urls[1]).searchParams.get("start_assetid"), "1");
  assert.deepEqual(second, first);
  assert.equal(second[0], first[0]);
  assert.equal(snapshot.complete, true);
});

test("partial inventories and another account never reuse a complete snapshot", async () => {
  const queue = inventoryQueue();
  const snapshot = {};
  let stopped = false;
  for await (const _page of readInventoryPages("123", queue, { snapshot, shouldStop: () => stopped })) {
    stopped = true;
  }
  assert.equal(snapshot.complete, false);
  assert.equal(queue.urls.length, 1);
  await collect(readInventoryPages("123", queue, { snapshot }));
  assert.equal(queue.urls.length, 3);
  await collect(readInventoryPages("456", queue, { snapshot }));
  assert.equal(queue.urls.length, 5);
  assert.match(queue.urls[3], /inventory\/456\//);
});

test("failed inventory responses cannot become reusable snapshots", async () => {
  const snapshot = {};
  await assert.rejects(collect(readInventoryPages("123", {
    fetch: async () => ({ data: { success: 0, error: "inventory unavailable" } }),
  }, { snapshot })), /inventory unavailable/);
  assert.equal(snapshot.complete, false);
});
