import { state } from "../state.js";

import { RequestQueue } from "../request/queue.js";

import { unsafeWindow } from "../globals.js";

import { formatInt, formatMoney } from "../utils/format.js";

import { getSteamId } from "../utils/steam.js";

import { loadSidebarGemPrice } from "../sidebar/gems.js";

import { priceCard } from "../parsers/price.js";
import { persistMarketObservations } from "../services/market-observations.js";

import { isGemSackDescription, isLooseGemDescription, getCardGameAppid, isTradingCardDescription, isFoilCardDescription, getCardGameName, getCommunityItemType, getCommunityItemCategory, getDescriptionImageUrl, getDescriptionColor, getAssetAmount, parseGemValueFromDescription, parseGooValueParams, normalizeInventoryText, addInventoryCard, getDescriptionKey, isPointsShopCommunityItemDescription } from "../parsers/inventory.js";

import { getGemBreakEvenBuyerPrice, getGemSackSellerNetCents } from "../utils/market-fees.js";

import { applyItemRecommendation } from "../services/item-recommendation.js";

import { summarizeAssetIds } from "../parsers/inventory.js";

import {
  isPriceOverviewProbeBlocked,
  isSharedActionBusy,
  updateAllActionStates,
  updateGrindActionState,
} from "../ui/action-state.js";

import { grindStatus } from "../status-controllers.js";
import { enableTileDragSelection } from "../ui/checkbox-drag.js";

const { log: grindLog, setStatus: setGrindStatus, setProgress: setGrindProgress, hideProgress: hideGrindProgress } = grindStatus;

export { updateGrindActionState };

  let cachedBlacklistSource = null;
  let cachedBlacklistAppids = new Set();

  function readBlacklistAppids() {
    const source = state.cfg.blacklist || "";
    if (source !== cachedBlacklistSource) {
      cachedBlacklistSource = source;
      cachedBlacklistAppids = new Set(
        source.split(",").map(value => value.trim()).filter(Boolean)
      );
    }
    return cachedBlacklistAppids;
  }

  export function getBlacklistAppids() {
    return new Set(readBlacklistAppids());
  }

  export function isBlacklistedAppid(appid) {
    return !!appid && readBlacklistAppids().has(String(appid));
  }

  const grindGemValueCache = new Map();

  export async function getGrindGemValue(description, queue) {
    const parsedValue = parseGemValueFromDescription(description);
    if (parsedValue > 0) return parsedValue;

    const params = parseGooValueParams(description);
    if (!params) return 0;
    const key = `${params.appid}_${params.itemType}_${params.borderColor}`;
    if (grindGemValueCache.has(key)) return grindGemValueCache.get(key);

    try {
      const url = `https://steamcommunity.com/auction/ajaxgetgoovalueforitemtype/?appid=${encodeURIComponent(params.appid)}&item_type=${encodeURIComponent(params.itemType)}&border_color=${encodeURIComponent(params.borderColor)}`;
      const response = await queue.fetch(url);
      const value = Math.max(0, parseInt(response?.data?.goo_value, 10) || 0);
      grindGemValueCache.set(key, value);
      return value;
    } catch (_) {
      if (state.grindStopRequested || queue.stopped) return 0;
      grindGemValueCache.set(key, 0);
      return 0;
    }
  }

  export function getSurplusAssetAllowance() {
    const allowance = new Map();
    for (const result of state.surplusResults || []) {
      for (const asset of result.assets || []) {
        const assetid = String(asset.assetid || "");
        if (!assetid) continue;
        allowance.set(assetid, (allowance.get(assetid) || 0) + (asset.selectedAmount || 0));
      }
    }
    return allowance;
  }

  export function addGrindItem(groupMap, asset, description, amount, source, gemValue, pointsShop = false) {
    if (!description || amount <= 0) return "skipped";
    if (isGemSackDescription(description) || isLooseGemDescription(description)) return "gem";

    const unitGemValue = Math.max(0, parseInt(gemValue, 10) || 0);
    if (unitGemValue <= 0) return "noGemValue";

    const appid = getCardGameAppid(description);
    if (isBlacklistedAppid(appid)) return "blacklisted";

    const marketHashName = String(description.market_hash_name || "").trim();
    const key = [
      appid || "0",
      marketHashName || getDescriptionKey(description),
      unitGemValue,
      source,
    ].join("|");
    let item = groupMap.get(key);
    if (!item) {
      item = {
        appid,
        gameName: getCardGameName(description),
        type: getCommunityItemType(description),
        itemName: String(description.name || marketHashName || "未知物品").trim(),
        marketHashName,
        imageUrl: getDescriptionImageUrl(description),
        nameColor: getDescriptionColor(description, "name_color"),
        backgroundColor: getDescriptionColor(description, "background_color"),
        gemValue: unitGemValue,
        quantity: 0,
        totalGems: 0,
        marketableCount: 0,
        tradableCount: 0,
        pointsShopCount: 0,
        source,
        assets: [],
      };
      groupMap.set(key, item);
    }
    if (!item.gameName) item.gameName = getCardGameName(description);

    const marketable = Number(description.marketable) === 1;
    const tradable = Number(description.tradable) === 1;
    item.quantity += amount;
    item.totalGems += amount * unitGemValue;
    if (marketable) item.marketableCount += amount;
    if (tradable) item.tradableCount += amount;
    if (pointsShop) item.pointsShopCount += amount;
    item.assets.push({
      assetid: String(asset.assetid || ""),
      contextid: String(asset.contextid || "6"),
      amount,
      originalAmount: getAssetAmount(asset),
      marketable,
      tradable,
      pointsShop,
    });
    return "added";
  }

  export function selectDuplicateSurplusItem(item, reserveCopies) {
    const inventoryCount = (item.assets || []).reduce(
      (sum, asset) => sum + Math.max(0, Number(asset.amount) || 0),
      0
    );
    const reservedCount = Math.min(
      inventoryCount,
      Math.max(0, Math.floor(Number(reserveCopies) || 0))
    );
    let remaining = Math.max(0, inventoryCount - reservedCount);
    if (remaining <= 0) return null;

    const assets = [...(item.assets || [])]
      .sort((left, right) => {
        const marketCompare = Number(right.marketable) - Number(left.marketable);
        if (marketCompare) return marketCompare;
        const tradeCompare = Number(right.tradable) - Number(left.tradable);
        if (tradeCompare) return tradeCompare;
        const pointsCompare = Number(left.pointsShop) - Number(right.pointsShop);
        if (pointsCompare) return pointsCompare;
        return String(left.assetid || "").localeCompare(String(right.assetid || ""), "en");
      })
      .flatMap(asset => {
        if (remaining <= 0) return [];
        const amount = Math.min(Math.max(0, Number(asset.amount) || 0), remaining);
        remaining -= amount;
        return amount > 0 ? [{ ...asset, amount }] : [];
      });
    const quantity = assets.reduce((sum, asset) => sum + asset.amount, 0);

    return {
      ...item,
      inventoryCount,
      reservedCount,
      quantity,
      totalGems: quantity * item.gemValue,
      marketableCount: assets.reduce(
        (sum, asset) => sum + (asset.marketable ? asset.amount : 0),
        0
      ),
      tradableCount: assets.reduce(
        (sum, asset) => sum + (asset.tradable ? asset.amount : 0),
        0
      ),
      pointsShopCount: assets.reduce(
        (sum, asset) => sum + (asset.pointsShop ? asset.amount : 0),
        0
      ),
      assets,
    };
  }

  export async function loadGrindInventoryItems(steamId, queue) {
    const groupMap = new Map();
    const language = unsafeWindow.g_strLanguage || "schinese";
    const surplusAllowance = getSurplusAssetAllowance();
    const includeCards = !!state.cfg.grindIncludeSurplusCards;
    const reserveCopies = Math.max(0, Math.floor(Number(state.cfg.grindReserveCopies) || 0));
    const includePointsShopItems = !!state.cfg.grindIncludePointsShopItems;
    const itemMode = ["background", "emoticon"].includes(state.cfg.surplusItemMode)
      ? state.cfg.surplusItemMode
      : "background";
    let startAssetId = "";
    let page = 0;
    let totalInventoryCount = 0;
    let totalAssetsSeen = 0;
    const skipped = {
      cardsWithoutSurplus: 0,
      noGemValue: 0,
      blacklisted: 0,
      gems: 0,
      pointsShop: 0,
      reserved: 0,
    };

    do {
      page++;
      const params = new URLSearchParams({
        l: language,
        count: "2000",
      });
      if (startAssetId) params.set("start_assetid", startAssetId);
      const url = `https://steamcommunity.com/inventory/${steamId}/753/6?${params.toString()}`;
      setGrindStatus(`读取库存第 ${page} 页`);
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
        if (state.grindStopRequested) break;
        const description = descriptions.get(getDescriptionKey(asset));
        if (!description) continue;
        const assetAmount = getAssetAmount(asset);
        if (isGemSackDescription(description) || isLooseGemDescription(description)) {
          skipped.gems += assetAmount;
          continue;
        }
        if (isBlacklistedAppid(getCardGameAppid(description))) {
          skipped.blacklisted += assetAmount;
          continue;
        }
        if (getCommunityItemCategory(description) !== itemMode) {
          continue;
        }
        const pointsShop = isPointsShopCommunityItemDescription(description);
        if (pointsShop && !includePointsShopItems) {
          skipped.pointsShop += assetAmount;
          continue;
        }
        let amount = assetAmount;
        if (isTradingCardDescription(description)) {
          const allowed = surplusAllowance.get(String(asset.assetid || "")) || 0;
          amount = includeCards ? Math.min(assetAmount, allowed) : 0;
          if (amount <= 0) {
            skipped.cardsWithoutSurplus += assetAmount;
            continue;
          }
        }

        const gemValue = await getGrindGemValue(description, queue);
        const result = addGrindItem(
          groupMap,
          asset,
          description,
          amount,
          isTradingCardDescription(description) ? "card" : "item",
          gemValue,
          pointsShop
        );
        if (result === "noGemValue") skipped.noGemValue += amount;
        else if (result === "blacklisted") skipped.blacklisted += amount;
        else if (result === "gem") skipped.gems += amount;
      }

      grindLog(
        `库存第 ${page} 页：读取 ${assets.length} 件，累计候选 ${groupMap.size} 种`,
        "info"
      );
      startAssetId = data.more_items && data.last_assetid
        ? String(data.last_assetid)
        : "";
    } while (startAssetId && !state.grindStopRequested);

    const items = [...groupMap.values()].flatMap(item => {
      const surplus = selectDuplicateSurplusItem(item, reserveCopies);
      skipped.reserved += surplus ? surplus.reservedCount : item.quantity;
      return surplus ? [surplus] : [];
    }).sort((left, right) => {
      const adviceCompare = Number(right.totalGems) - Number(left.totalGems);
      if (adviceCompare) return adviceCompare;
      const gameCompare = (left.gameName || "").localeCompare(right.gameName || "", "zh-CN");
      if (gameCompare) return gameCompare;
      return (left.itemName || "").localeCompare(right.itemName || "", "zh-CN");
    });

    return {
      items,
      totalInventoryCount,
      totalAssetsSeen,
      skipped,
    };
  }

  export function applyGrindRecommendation(item, gemSackPriceCents) {
    return applyItemRecommendation(item, gemSackPriceCents);
  }

  export function getVisibleGrindResults() {
    return (state.grindResults || []).filter(item => {
      if (state.cfg.surplusOnlyRecommended && item.recommendationKey !== "grind") return false;
      if (state.cfg.surplusOnlyTradable && item.tradableCount <= 0) return false;
      return true;
    });
  }

  export function getGrindResultKey(item) {
    const assetKey = (item.assets || [])
      .map(asset => `${asset.assetid || ""}x${asset.amount || 1}`)
      .join(",");
    return [
      "item",
      item.appid || "",
      item.marketHashName || item.itemName || "",
      item.gemValue || 0,
      item.source || "",
      assetKey,
    ].join("|");
  }

  export function getSelectedGrindResults() {
    const selected = state.selectedGrindResults || new Set();
    return (state.grindResults || []).filter(item =>
      selected.has(getGrindResultKey(item))
    );
  }

  export function setAllVisibleGrindSelection(selected) {
    if (!state.selectedGrindResults) state.selectedGrindResults = new Set();
    const visible = getVisibleGrindResults();
    for (const item of visible) {
      const key = getGrindResultKey(item);
      if (selected) state.selectedGrindResults.add(key);
      else state.selectedGrindResults.delete(key);
    }
    renderGrindResults();
  }

  function pruneSelectedGrindResults(visible) {
    const selected = state.selectedGrindResults || new Set();
    const visibleKeys = new Set(visible.map(getGrindResultKey));
    for (const key of [...selected]) {
      if (!visibleKeys.has(key)) selected.delete(key);
    }
  }

  export function updateGrindSummary() {
    const row = document.getElementById("stch-grind-summary-row");
    const summary = document.getElementById("stch-grind-summary");
    if (!row || !summary) return;
    const visible = getVisibleGrindResults();
    if (visible.length === 0) {
      row.style.display = "none";
      summary.textContent = "";
      return;
    }

    const recommended = (state.grindResults || []).filter(item => item.recommendationKey === "grind");
    const visibleQuantity = visible.reduce((sum, item) => sum + item.quantity, 0);
    const recommendedQuantity = recommended.reduce((sum, item) => sum + item.quantity, 0);
    const recommendedGems = recommended.reduce((sum, item) => sum + item.totalGems, 0);
    const selected = state.selectedGrindResults || new Set();
    const selectedCount = visible.reduce(
      (count, item) => count + Number(selected.has(getGrindResultKey(item))),
      0
    );
    const gemPrice = state.grindGemPrice || {};
    const priceText = gemPrice.priceCents
      ? `宝石袋 ${formatMoney(gemPrice.priceCents)} / 税后 ${formatMoney(getGemSackSellerNetCents(gemPrice.priceCents))}`
      : "暂无宝石袋价格";
    summary.innerHTML =
      `显示 <b>${visible.length}</b> 种 / <b>${visibleQuantity}</b> 件 · ` +
      `建议分解 <b>${recommended.length}</b> 种 / <b>${recommendedQuantity}</b> 件 · ` +
      `预计 <b>${formatInt(recommendedGems)}</b> 宝石 · ` +
      `已选择 <b>${selectedCount}</b> 项 · ${priceText}`;
    row.style.display = "";
  }

  export function renderGrindResults() {
    const list = document.getElementById("stch-grind-list");
    if (!list) return;
    enableTileDragSelection(list, {
      isSelected: tile => state.selectedGrindResults?.has(tile.dataset.key),
      setSelected: (tile, selected) => {
        if (!state.selectedGrindResults) state.selectedGrindResults = new Set();
        if (selected) state.selectedGrindResults.add(tile.dataset.key);
        else state.selectedGrindResults.delete(tile.dataset.key);
      },
      onSelectionChange: () => {
        updateGrindSummary();
        updateGrindActionState();
      },
    });
    list.innerHTML = "";
    list.classList.add("stch-inventory-grid");

    const visible = getVisibleGrindResults();
    pruneSelectedGrindResults(visible);
    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "stch-inventory-empty";
      empty.textContent = state.grindScanning
        ? "正在扫描可分解物品..."
        : state.grindResults.length > 0
          ? "当前筛选下没有建议分解物品"
          : "尚未扫描可分解物品";
      list.appendChild(empty);
      updateGrindSummary();
      updateGrindActionState();
      return;
    }

    for (const item of visible) {
      const key = getGrindResultKey(item);
      const assetSummary = summarizeAssetIds(item.assets.map(asset => ({
        assetid: asset.assetid,
        selectedAmount: asset.amount,
      })));
      const marketText = item.priceCents
        ? formatMoney(item.priceCents)
        : item.marketHashName && item.marketableCount > 0
          ? "无价"
          : "不可售";
      const marketTitle = item.priceCents
        ? `${item.priceSource || "市场价"}；卖出税后约 ${formatMoney(item.marketNetCents)}`
        : item.recommendationReason || "";
      const breakEvenText = item.breakEvenPriceCents
        ? formatMoney(item.breakEvenPriceCents)
        : "—";

      const tile = document.createElement("div");
      tile.className = "stch-inv-tile";
      tile.classList.toggle("stch-volume-zero", item.volume === 0);
      tile.dataset.key = key;
      tile.classList.toggle("selected", state.selectedGrindResults?.has(key));
      tile.title = [
        `${item.gameName || "未知游戏"} · ${item.itemName || item.marketHashName || "未知物品"}`,
        `类型 ${item.type || "物品"}；库存 ${item.inventoryCount}，保留 ${item.reservedCount}，多余 ${item.quantity}`,
        item.pointsShopCount ? `多余数量中含点数商店类副本 ${item.pointsShopCount} 件` : "",
        `${item.gemValue} 宝石/件，共 ${formatInt(item.totalGems)} 宝石`,
        `市场 ${marketText}${marketTitle ? `；${marketTitle}` : ""}`,
        `分解临界 ${breakEvenText}`,
        item.recommendationReason ? `建议：${item.recommendationLabel || "—"}，${item.recommendationReason}` : "",
        "按住并拖动可连续选择或取消",
        assetSummary.title ? `资产ID:\n${assetSummary.title}` : "",
      ].filter(Boolean).join("\n");
      if (item.nameColor) tile.style.borderColor = item.nameColor;
      if (item.backgroundColor) tile.style.backgroundColor = item.backgroundColor;

      if (item.imageUrl) {
        const image = document.createElement("img");
        image.src = item.imageUrl;
        image.alt = item.itemName || item.marketHashName || "";
        tile.appendChild(image);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "stch-inv-placeholder";
        placeholder.textContent = item.itemName || "?";
        tile.appendChild(placeholder);
      }

      const price = document.createElement("span");
      price.className = "stch-inv-badge";
      price.textContent = item.priceCents ? formatMoney(item.priceCents) : `x${item.quantity}`;
      price.title = marketTitle || "数量";
      tile.appendChild(price);

      const action = document.createElement("span");
      action.className = `stch-inv-badge stch-inv-badge-left ${item.recommendationClass || ""}`.trim();
      action.textContent = item.recommendationLabel || "—";
      action.title = item.recommendationReason || "";
      tile.appendChild(action);

      const gems = document.createElement("span");
      gems.className = "stch-inv-gems";
      gems.textContent = `${formatInt(item.totalGems)} 宝石`;
      gems.title = `${item.gemValue} 宝石/件`;
      tile.appendChild(gems);

      const name = document.createElement("div");
      name.className = "stch-inv-name";
      name.textContent = item.itemName || item.marketHashName || "未知物品";
      tile.appendChild(name);

      list.appendChild(tile);
    }

    updateGrindSummary();
    updateGrindActionState();
  }

  export async function startGrindScan() {
    if (isPriceOverviewProbeBlocked(state.surplusScanning || state.grindScanning)) return;

    if (location.hostname !== "steamcommunity.com") {
      grindLog("请在 Steam 社区徽章页或库存页使用多余物品处理", "warn");
      return;
    }

    const steamId = getSteamId();
    if (!steamId) {
      grindLog("未找到 SteamID，无法读取库存", "err");
      return;
    }

    state.grindScanning = true;
    state.grindStopRequested = false;
    state.grindResults = [];
    state.selectedGrindResults = new Set();
    state.grindGemPrice = null;
    const logBox = document.getElementById("stch-grind-log");
    if (logBox) logBox.innerHTML = "";
    renderGrindResults();
    updateAllActionStates();

    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      setGrindStatus,
      grindLog,
      { stopPredicate: currentState => Boolean(currentState?.grindStopRequested) }
    );
    state.grindQueue = queue;
    const marketRecords = [];

    try {
      grindLog("【阶段 1/3】读取宝石袋市场价格");
      setGrindProgress(0, 1, "阶段1: 读取宝石价格");
      const gemPrice = await loadSidebarGemPrice(queue);
      if (!gemPrice.priceCents) {
        throw new Error("宝石袋暂无可用市场价格，无法计算分解临界点");
      }
      state.grindGemPrice = gemPrice;
      const sackNet = getGemSackSellerNetCents(gemPrice.priceCents);
      const breakEven10 = getGemBreakEvenBuyerPrice(10, gemPrice.priceCents);
      grindLog(
        `宝石袋 ${gemPrice.source} ${formatMoney(gemPrice.priceCents)}，税后到手约 ${formatMoney(sackNet)}；10宝石临界价 ${formatMoney(breakEven10)}`,
        "ok"
      );

      const itemModeLabel = state.cfg.surplusItemMode === "emoticon" ? "表情" : "背景";
      grindLog(`本次只分析${itemModeLabel}类社区物品`, "info");

      grindLog("【阶段 2/3】读取社区库存并识别可分解物品");
      setGrindProgress(0, 1, "阶段2: 读取库存");
      const inventory = await loadGrindInventoryItems(steamId, queue);
      if (state.grindStopRequested) {
        grindLog("已停止扫描", "warn");
        return;
      }

      grindLog(
        `库存读取完成：库存 ${inventory.totalInventoryCount || inventory.totalAssetsSeen} 件，` +
        `候选 ${inventory.items.length} 种；` +
        `跳过无宝石值 ${inventory.skipped.noGemValue} 件，` +
        `默认保留 ${inventory.skipped.reserved} 件，` +
        `点数商店类 ${inventory.skipped.pointsShop} 件，` +
        `游戏黑名单 ${inventory.skipped.blacklisted} 件`,
        "ok"
      );

      if (inventory.items.length === 0) {
        renderGrindResults();
        grindLog("没有找到可用于分解建议的物品", "warn");
        return;
      }

      grindLog("【阶段 3/3】查询市场价格并计算建议");
      const pricedCandidates = inventory.items.filter(item => item.marketHashName && item.marketableCount > 0);
      let priced = 0;
      let failed = 0;

      for (let index = 0; index < inventory.items.length; index++) {
        if (state.grindStopRequested) break;
        const item = inventory.items[index];
        setGrindProgress(
          index,
          inventory.items.length,
          `阶段3: ${index + 1}/${inventory.items.length} · ${item.itemName || item.marketHashName}`
        );
        setGrindStatus(`查询价格: ${item.itemName || item.marketHashName}`);

        if (item.marketHashName && item.marketableCount > 0) {
          const price = await priceCard(item.marketHashName, queue, { persistMarketCache: false });
          if (price?.record) marketRecords.push(price.record);
          if (price && !price.noPriceData) {
            item.priceCents = price.lowestSellCents;
            item.medianCents = price.medianCents;
            item.volume = price.volume;
            item.priceSource = price.priceSource === "lowest" ? "在售最低" : "平均价格";
            priced++;
          } else if (price?.noPriceData) {
            item.volume = 0;
            item.priceSource = "无可用价格";
          } else {
            failed++;
            item.priceSource = "查价失败";
          }
        }

        applyGrindRecommendation(item, gemPrice.priceCents);
        state.grindResults.push(item);
        renderGrindResults();
      }

      state.grindResults.sort((left, right) => {
        const recommendCompare = Number(right.recommendationKey === "grind") - Number(left.recommendationKey === "grind");
        if (recommendCompare) return recommendCompare;
        const gemCompare = right.totalGems - left.totalGems;
        if (gemCompare) return gemCompare;
        const gameCompare = (left.gameName || "").localeCompare(right.gameName || "", "zh-CN");
        if (gameCompare) return gameCompare;
        return (left.itemName || "").localeCompare(right.itemName || "", "zh-CN");
      });
      renderGrindResults();

      if (state.grindStopRequested) {
        grindLog("已停止扫描", "warn");
      } else {
        const recommended = state.grindResults.filter(item => item.recommendationKey === "grind");
        const recommendedQuantity = recommended.reduce((sum, item) => sum + item.quantity, 0);
        const recommendedGems = recommended.reduce((sum, item) => sum + item.totalGems, 0);
        grindLog(
          `扫描完成：查价 ${priced}/${pricedCandidates.length} 种，失败 ${failed} 种；` +
          `建议分解 ${recommended.length} 种 / ${recommendedQuantity} 件 / ${formatInt(recommendedGems)} 宝石`,
          failed ? "warn" : "ok"
        );
      }
    } catch (error) {
      if (!state.grindStopRequested) {
        grindLog(`扫描中断: ${error?.message || error?.status || error}`, "err");
      }
    } finally {
      queue.stop();
      persistMarketObservations(marketRecords);
      state.grindQueue = null;
      state.grindScanning = false;
      state.grindStopRequested = false;
      hideGrindProgress();
      setGrindStatus(null);
      renderGrindResults();
      updateAllActionStates();
    }
  }

  export function requestGrindStop() {
    if (!state.grindScanning) return;
    state.grindStopRequested = true;
    state.grindQueue?.stop();
    grindLog("已请求停止扫描", "warn");
    updateGrindActionState();
  }
