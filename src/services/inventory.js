import { state } from "../state.js";

import { unsafeWindow } from "../globals.js";

import { addInventoryCard, getAssetAmount, getDescriptionKey } from "../parsers/inventory.js";

import { surplusStatus } from "../status-controllers.js";

const { setStatus: setSurplusStatus, log: surplusLog } = surplusStatus;

  export async function loadCommunityInventoryCards(steamId, queue) {
    const groupMap = new Map();
    const language = unsafeWindow.g_strLanguage || "schinese";
    let startAssetId = "";
    let page = 0;
    let totalInventoryCount = 0;
    let totalAssetsSeen = 0;
    let totalCards = 0;

    do {
      page++;
      const params = new URLSearchParams({
        l: language,
        count: "2000",
      });
      if (startAssetId) params.set("start_assetid", startAssetId);
      const url = `https://steamcommunity.com/inventory/${steamId}/753/6?${params.toString()}`;
      setSurplusStatus(`读取库存第 ${page} 页`);
      const response = await queue.fetch(url);
      const data = response?.data || {};
      if (data?.success !== 1 && data?.success !== true) {
        throw new Error(data?.Error || data?.error || "Steam 未返回可用库存数据");
      }

      totalInventoryCount = Number(data.total_inventory_count || totalInventoryCount) || totalInventoryCount;
      const descriptions = new Map();
      (Array.isArray(data.descriptions) ? data.descriptions : []).forEach(description => {
        descriptions.set(getDescriptionKey(description), description);
      });

      const assets = Array.isArray(data.assets) ? data.assets : [];
      totalAssetsSeen += assets.length;
      for (const asset of assets) {
        const description = descriptions.get(getDescriptionKey(asset));
        if (addInventoryCard(groupMap, asset, description)) {
          totalCards += getAssetAmount(asset);
        }
      }

      surplusLog(
        `库存第 ${page} 页：读取 ${assets.length} 件，累计卡牌 ${totalCards} 张`,
        "info"
      );
      startAssetId = data.more_items && data.last_assetid
        ? String(data.last_assetid)
        : "";
    } while (startAssetId && !state.surplusStopRequested);

    const groups = [...groupMap.values()].sort((left, right) => {
      const nameCompare = (left.gameName || "").localeCompare(right.gameName || "", "zh-CN");
      if (nameCompare) return nameCompare;
      if (left.appid !== right.appid) return Number(left.appid) - Number(right.appid);
      return Number(left.isFoil) - Number(right.isFoil);
    });

    return {
      groups,
      totalInventoryCount,
      totalAssetsSeen,
      totalCards,
      cardTypeCount: groups.reduce((sum, group) => sum + group.cardsByHash.size, 0),
    };
  }
