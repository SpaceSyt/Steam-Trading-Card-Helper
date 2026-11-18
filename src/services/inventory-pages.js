import { unsafeWindow } from "../globals.js";
import { parseCommunityInventoryPage } from "../parsers/inventory.js";

// Snapshots belong to one processing batch; partial scans are never reused.
export async function* readInventoryPages(steamId, queue, options = {}) {
  const { snapshot, onPage, shouldStop = () => false } = options;
  if (snapshot?.complete && snapshot.steamId === steamId) {
    for (const page of snapshot.pages) {
      if (shouldStop()) return;
      yield page;
    }
    return;
  }
  if (snapshot) Object.assign(snapshot, { steamId, pages: [], complete: false });
  let nextAssetId = "";
  let page = 0;
  do {
    if (shouldStop()) return;
    onPage?.(++page);
    const params = new URLSearchParams({
      l: unsafeWindow.g_strLanguage || "schinese",
      count: "2000",
    });
    if (nextAssetId) params.set("start_assetid", nextAssetId);
    const response = await queue.fetch(`https://steamcommunity.com/inventory/${steamId}/753/6?${params}`);
    const data = response?.data;
    if (data?.success !== 1 && data?.success !== true) {
      throw new Error(data?.Error || data?.error || "Steam 未返回可用库存数据");
    }
    const parsed = parseCommunityInventoryPage(data);
    snapshot?.pages.push(parsed);
    yield parsed;
    nextAssetId = parsed.nextAssetId;
  } while (nextAssetId);
  if (snapshot && !shouldStop()) snapshot.complete = true;
}
