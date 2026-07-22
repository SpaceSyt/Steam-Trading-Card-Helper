import { unsafeWindow } from "../globals.js";
import { state } from "../state.js";

import { SIDEBAR_GEM_SACK_HASH, GEM_SACK_SIZE } from "../constants.js";

import { isGemSackDescription, isLooseGemDescription, getDescriptionKey, getAssetAmount } from "../parsers/inventory.js";

import { stchRequestJson } from "../request/http.js";
import { RequestQueue } from "../request/queue.js";

import { isPriceCardPriced, priceCard } from "../parsers/price.js";

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

  export async function loadSidebarGemPrice(queue = null) {
    const ownedQueue = queue ? null : new RequestQueue(
      state.cfg.requestInterval,
      state.cfg.batchSize,
      state.cfg.batchPause,
      state,
      null,
      null,
      { stopPredicate: () => false }
    );
    const requestQueue = queue || ownedQueue;
    try {
      const price = await priceCard(SIDEBAR_GEM_SACK_HASH, requestQueue);
      const priced = isPriceCardPriced(price);
      const priceCents = priced ? price.lowestSellCents || 0 : 0;
      return {
        priceCents,
        medianCents: priced ? price.medianCents || 0 : 0,
        source: priced && price.priceSource === "lowest"
          ? "在售最低"
          : priced && price.priceSource === "median"
            ? "平均价格"
            : "暂无价格",
        volume: priced ? price.volume || 0 : 0,
        currencyId: price?.currencyId || state.currencyContext?.currencyId || state.cfg.currencyId,
        observedAt: price?.observedAt || Date.now(),
        record: price?.record || null,
      };
    } finally {
      ownedQueue?.stop();
    }
  }
