import { unsafeWindow } from "../globals.js";

import { SIDEBAR_GEM_SACK_HASH, GEM_SACK_SIZE } from "../constants.js";

import { isGemSackDescription, isLooseGemDescription, getDescriptionKey, getAssetAmount } from "../parsers/inventory.js";

import { stchRequestJson } from "../request/http.js";

import { parsePrice } from "../parsers/price.js";

  export async function loadSidebarGemInfo(steamId) {
    if (!steamId) throw new Error("未找到 SteamID，无法读取库存");

    const language = unsafeWindow.g_strLanguage || "schinese";
    let startAssetId = "";
    let looseGems = 0;
    let sackCount = 0;
    let totalInventoryCount = 0;

    do {
      const params = new URLSearchParams({
        l: language,
        count: "2000",
      });
      if (startAssetId) params.set("start_assetid", startAssetId);
      const data = await stchRequestJson(
        `https://steamcommunity.com/inventory/${steamId}/753/6?${params.toString()}`
      );
      if (data?.success !== 1 && data?.success !== true) {
        throw new Error(data?.Error || data?.error || "Steam 未返回库存数据");
      }
      totalInventoryCount = Number(data.total_inventory_count || totalInventoryCount) || totalInventoryCount;

      const descriptions = new Map();
      (Array.isArray(data.descriptions) ? data.descriptions : []).forEach(description => {
        descriptions.set(getDescriptionKey(description), description);
      });

      for (const asset of Array.isArray(data.assets) ? data.assets : []) {
        const description = descriptions.get(getDescriptionKey(asset));
        const amount = getAssetAmount(asset);
        if (isGemSackDescription(description)) {
          sackCount += amount;
        } else if (isLooseGemDescription(description)) {
          looseGems += amount;
        }
      }

      startAssetId = data.more_items && data.last_assetid
        ? String(data.last_assetid)
        : "";
    } while (startAssetId);

    return {
      looseGems,
      sackCount,
      totalGems: looseGems + sackCount * GEM_SACK_SIZE,
      totalInventoryCount,
    };
  }

  export async function loadSidebarGemPrice() {
    const params = new URLSearchParams({
      appid: "753",
      currency: "23",
      market_hash_name: SIDEBAR_GEM_SACK_HASH,
    });
    const data = await stchRequestJson(
      `https://steamcommunity.com/market/priceoverview/?${params.toString()}`
    );
    const lowestCents = parsePrice(data?.lowest_price);
    const medianCents = parsePrice(data?.median_price);
    const priceCents = lowestCents || medianCents;
    return {
      priceCents,
      source: lowestCents ? "在售最低" : medianCents ? "平均价格" : "暂无价格",
      volume: parseInt(data?.volume, 10) || 0,
    };
  }
