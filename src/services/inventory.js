import { state } from "../state.js";

import { readInventoryPages } from "./inventory-pages.js";

import { addInventoryCard, getAssetAmount, getDescriptionKey } from "../parsers/inventory.js";

import { surplusStatus } from "../status-controllers.js";

const { setStatus: setSurplusStatus, log: surplusLog } = surplusStatus;

  export async function fetchItemTypeGemValue(params, queue, cache) {
    if (!params) return 0;
    const { appid, itemType, borderColor } = params;
    const url = `https://steamcommunity.com/auction/ajaxgetgoovalueforitemtype/?appid=${appid}&item_type=${itemType}&border_color=${borderColor}`;
    if (!cache.has(url)) {
      cache.set(url, (async () => {
        try {
          const response = await queue.fetch(url);
          const data = response?.data;
          const value = Number(data?.success) === 1 ? Number(data.goo_value) : 0;
          return Number.isSafeInteger(value) && value > 0 ? value : 0;
        } catch {
          return 0;
        }
      })());
    }
    return cache.get(url);
  }

  export async function loadCommunityInventoryCards(steamId, queue, snapshot) {
    const groupMap = new Map();
    let page = 0;
    let totalInventoryCount = 0;
    let totalAssetsSeen = 0;
    let totalCards = 0;

    for await (const inventoryPage of readInventoryPages(steamId, queue, {
      snapshot,
      shouldStop: () => state.surplusStopRequested,
      onPage: number => setSurplusStatus(`读取库存第 ${number} 页`),
    })) {
      page++;
      totalInventoryCount = inventoryPage.totalInventoryCount || totalInventoryCount;
      const { assets, descriptions } = inventoryPage;
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
    }

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
