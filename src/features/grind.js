import { state } from "../state.js";

import { RequestQueue } from "../request/queue.js";

import { readInventoryPages } from "../services/inventory-pages.js";

import { formatInt, formatMoney } from "../utils/format.js";

import { getSteamId } from "../utils/steam.js";

import { loadSidebarGemPrice } from "../sidebar/gems.js";

import {
  isPriceCardError,
  isPriceCardNoPrice,
  isPriceCardPriced,
  priceCard,
} from "../parsers/price.js";
import { persistMarketObservations } from "../services/market-observations.js";

import { isGemSackDescription, isLooseGemDescription, getCardGameAppid, getCardGameName, getCommunityItemType, getCommunityItemCategory, getDescriptionImageUrl, getDescriptionColor, getAssetAmount, parseGemValueFromDescription, parseGooValueParams, getDescriptionKey, isPointsShopCommunityItemDescription } from "../parsers/inventory.js";

import { getGemBreakEvenBuyerPrice, getGemSackSellerNetCents } from "../utils/market-fees.js";

import { applyItemRecommendation } from "../services/item-recommendation.js";
import { isItemCollected } from "../services/item-collection.js";

import { summarizeAssetIds } from "../parsers/inventory.js";

import {
  isPriceOverviewProbeBlocked,
  updateAllActionStates,
  updateSurplusActionState,
} from "../ui/action-state.js";

import { grindStatus } from "../status-controllers.js";
import { enableTileDragSelection } from "../ui/checkbox-drag.js";
import { appendInventoryTileText, createInventoryTile, renderInventoryTiles, createFrameScheduler } from "../utils/dom.js";
import { countSelected, pruneSelection, setItemsSelected } from "../utils/selection.js";
import { getProcessingDecorationCategories } from "../services/processing-mode.js";
import { syncProcessingView } from "../ui/processing-view.js";
import {
  createRequestQueuePool,
  getHtmlRequestConcurrency,
  getOtherRequestConcurrency,
  runWithConcurrency,
} from "../utils/concurrency.js";

const { log: grindLog, setStatus: setGrindStatus, setProgress: setGrindProgress, hideProgress: hideGrindProgress } = grindStatus;

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

    const request = (async () => {
      try {
        const url = `https://steamcommunity.com/auction/ajaxgetgoovalueforitemtype/?appid=${encodeURIComponent(params.appid)}&item_type=${encodeURIComponent(params.itemType)}&border_color=${encodeURIComponent(params.borderColor)}`;
        const response = await queue.fetch(url);
        return Math.max(0, parseInt(response?.data?.goo_value, 10) || 0);
      } catch (_) {
        return 0;
      }
    })();
    grindGemValueCache.set(key, request);
    const value = await request;
    grindGemValueCache.set(key, value);
    return value;
  }

  export function addGrindItem(groupMap, asset, description, amount, source, gemValue, pointsShop = false, category = "") {
    if (!description || amount <= 0) return "skipped";
    if (isGemSackDescription(description) || isLooseGemDescription(description)) return "gem";

    const unitGemValue = Math.max(0, parseInt(gemValue, 10) || 0);
    if (unitGemValue <= 0 && !pointsShop) return "noGemValue";

    const appid = getCardGameAppid(description);
    if (isBlacklistedAppid(appid)) return "blacklisted";

    const marketHashName = String(description.market_hash_name || "").trim();
    const key = [
      appid || "0",
      marketHashName || getDescriptionKey(description),
      source,
    ].join("|");
    let item = groupMap.get(key);
    if (!item) {
      item = {
        category,
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
        descriptionKey: getDescriptionKey(description),
        assets: [],
      };
      groupMap.set(key, item);
    }
    if (unitGemValue > item.gemValue) item.gemValue = unitGemValue;
    if (!item.category && category) item.category = category;
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

  export function selectDuplicateSurplusItem(item, reserveCopies, preferPointsShop = false) {
    const sourceAssets = item.assets || [];
    const inventoryCount = (item.assets || []).reduce(
      (sum, asset) => sum + Math.max(0, Number(asset.amount) || 0),
      0
    );
    const hasPointsShopCopy = sourceAssets.some(asset => asset.pointsShop);
    const reserveAtLeastOnePointsShop = preferPointsShop
      && inventoryCount > 1
      && hasPointsShopCopy;
    const reservedCount = Math.min(
      inventoryCount,
      Math.max(
        0,
        Math.floor(Number(reserveCopies) || 0),
        reserveAtLeastOnePointsShop ? 1 : 0
      )
    );
    let remaining = Math.max(0, inventoryCount - reservedCount);
    if (remaining <= 0) return null;

    const assets = [...(item.assets || [])]
      .sort((left, right) => {
        const marketCompare = Number(right.marketable) - Number(left.marketable);
        if (marketCompare) return marketCompare;
        const tradeCompare = Number(right.tradable) - Number(left.tradable);
        if (tradeCompare) return tradeCompare;
        if (preferPointsShop) {
          // Surplus assets are taken from the front; keep point-shop copies at the end.
          const pointsCompare = Number(left.pointsShop) - Number(right.pointsShop);
          if (pointsCompare) return pointsCompare;
        }
        return String(left.assetid || "").localeCompare(String(right.assetid || ""), "en");
      })
      .flatMap(asset => {
        if (remaining <= 0) return [];
        const amount = Math.min(Math.max(0, Number(asset.amount) || 0), remaining);
        remaining -= amount;
        return amount > 0 ? [{ ...asset, amount }] : [];
      });
    const usableAssets = preferPointsShop
      ? assets.filter(asset => !asset.pointsShop)
      : assets;
    const quantity = usableAssets.reduce((sum, asset) => sum + asset.amount, 0);
    if (quantity <= 0) return null;

    return {
      ...item,
      inventoryCount,
      reservedCount,
      quantity,
      totalGems: quantity * item.gemValue,
      marketableCount: usableAssets.reduce(
        (sum, asset) => sum + (asset.marketable ? asset.amount : 0),
        0
      ),
      tradableCount: usableAssets.reduce(
        (sum, asset) => sum + (asset.tradable ? asset.amount : 0),
        0
      ),
      pointsShopCount: usableAssets.reduce(
        (sum, asset) => sum + (asset.pointsShop ? asset.amount : 0),
        0
      ),
      assets: usableAssets,
    };
  }

  export async function loadGrindInventoryItems(steamId, queue, snapshot) {
    const groupMap = new Map();
    const reserveCopies = Math.max(0, Math.floor(Number(state.cfg.grindReserveCopies) || 0));
    const preferPointsShopItems = !!state.cfg.grindIncludePointsShopItems;
    const itemCategories = getProcessingDecorationCategories(state.cfg.surplusItemMode);
    let page = 0;
    let totalInventoryCount = 0;
    let totalAssetsSeen = 0;
    const skipped = {
      noGemValue: 0,
      blacklisted: 0,
      gems: 0,
      pointsShop: 0,
      reserved: 0,
    };

    for await (const inventoryPage of readInventoryPages(steamId, queue, {
      snapshot,
      shouldStop: () => state.grindStopRequested,
      onPage: number => setGrindStatus(`读取库存第 ${number} 页`),
    })) {
      page++;
      totalInventoryCount = inventoryPage.totalInventoryCount || totalInventoryCount;
      const { assets, descriptions } = inventoryPage;
      totalAssetsSeen += assets.length;
      const candidates = [];
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
        const category = getCommunityItemCategory(description);
        if (!itemCategories.includes(category)) {
          continue;
        }
        const pointsShop = isPointsShopCommunityItemDescription(description);
        if (pointsShop && !preferPointsShopItems) {
          skipped.pointsShop += assetAmount;
          continue;
        }
        candidates.push({ asset, description, assetAmount, pointsShop, category });
      }
      await runWithConcurrency(
        candidates,
        getOtherRequestConcurrency(state.cfg),
        async ({ asset, description, assetAmount, pointsShop, category }) => {
          if (state.grindStopRequested) return;
          const gemValue = pointsShop ? 0 : await getGrindGemValue(description, queue);
          const result = addGrindItem(
            groupMap,
            asset,
            description,
            assetAmount,
            "item",
            gemValue,
            pointsShop,
            category
          );
          if (result === "noGemValue") skipped.noGemValue += assetAmount;
          else if (result === "blacklisted") skipped.blacklisted += assetAmount;
          else if (result === "gem") skipped.gems += assetAmount;
        }
      );

      grindLog(
        `库存第 ${page} 页：读取 ${assets.length} 件，累计候选 ${groupMap.size} 种`,
        "info"
      );
    }

    const items = [...groupMap.values()].flatMap(item => {
      const surplus = selectDuplicateSurplusItem(item, reserveCopies, preferPointsShopItems);
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
    const categories = getProcessingDecorationCategories(state.cfg.surplusItemMode);
    return (state.grindResults || []).filter(item => {
      const category = item.category || "background";
      if (!categories.includes(category)) return false;
      if (isItemCollected(item, category)) return false;
      if (state.cfg.surplusOnlyRecommended && item.recommendationKey !== "grind") return false;
      if (state.cfg.surplusOnlyTradable && item.tradableCount <= 0) return false;
      return true;
    });
  }

  export function getGrindResultKey(item) {
    const assetKey = (item.assets || [])
      .map(asset => `${asset.assetid || ""}x${asset.amount ?? ""}`)
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
    return (state.grindResults || []).filter(item =>
      state.selectedGrindResults.has(getGrindResultKey(item))
      && !isItemCollected(item, item.category || "background")
    );
  }

  export function setAllVisibleGrindSelection(selected) {
    setItemsSelected(state.selectedGrindResults, getVisibleGrindResults(), getGrindResultKey, selected);
    renderGrindResults();
  }

  function pruneSelectedGrindResults(visible) {
    pruneSelection(state.selectedGrindResults, visible, getGrindResultKey);
  }

  export function updateGrindSummary(visible = getVisibleGrindResults()) {
    const row = document.getElementById("stch-surplus-summary-row");
    const summary = document.getElementById("stch-grind-summary");
    if (!row || !summary) return;
    if (visible.length === 0) {
      summary.textContent = "";
      syncProcessingView();
      return;
    }

    const recommended = (state.grindResults || []).filter(item => item.recommendationKey === "grind");
    const visibleQuantity = visible.reduce((sum, item) => sum + item.quantity, 0);
    const recommendedQuantity = recommended.reduce((sum, item) => sum + item.quantity, 0);
    const recommendedGems = recommended.reduce((sum, item) => sum + item.totalGems, 0);
    const selectedCount = countSelected(state.selectedGrindResults, visible, getGrindResultKey);
    const gemPrice = state.grindGemPrice || {};
    const priceText = gemPrice.priceCents
      ? `宝石袋 ${formatMoney(gemPrice.priceCents)} / 税后 ${formatMoney(getGemSackSellerNetCents(gemPrice.priceCents))}`
      : "暂无宝石袋价格";
    summary.innerHTML =
      `显示 <b>${visible.length}</b> 种 / <b>${visibleQuantity}</b> 件 · ` +
      `建议分解 <b>${recommended.length}</b> 种 / <b>${recommendedQuantity}</b> 件 · ` +
      `预计 <b>${formatInt(recommendedGems)}</b> 宝石 · ` +
      `已选择 <b>${selectedCount}</b> 项 · ${priceText}`;
    syncProcessingView();
  }

  const scheduleGrindSelection = createFrameScheduler(() => {
    updateGrindSummary();
    updateSurplusActionState();
  });

  export function renderGrindResults() {
    const list = document.getElementById("stch-grind-list");
    if (!list) return;
    enableTileDragSelection(list, {
      isSelected: tile => state.selectedGrindResults?.has(tile.dataset.key),
      setSelected: (tile, selected) => {
        if (selected) state.selectedGrindResults.add(tile.dataset.key);
        else state.selectedGrindResults.delete(tile.dataset.key);
      },
      onSelectionChange: scheduleGrindSelection,
    });

    const visible = getVisibleGrindResults();
    pruneSelectedGrindResults(visible);
    renderInventoryTiles(list, visible, state.selectedGrindResults, getGrindResultKey, (item, key) => {
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

      const title = [
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
      const label = item.itemName || item.marketHashName;
      const tile = createInventoryTile({
        key,
        selected: state.selectedGrindResults?.has(key),
        title,
        imageUrl: item.imageUrl,
        label,
        volumeZero: item.volume === 0,
        nameColor: item.nameColor,
        backgroundColor: item.backgroundColor,
      });
      appendInventoryTileText(tile, "span", "stch-inv-badge", item.priceCents ? formatMoney(item.priceCents) : `x${item.quantity}`, marketTitle || "数量");
      appendInventoryTileText(tile, "span", `stch-inv-badge stch-inv-badge-left ${item.recommendationClass || ""}`.trim(), item.recommendationLabel || "—", item.recommendationReason || "");
      appendInventoryTileText(tile, "span", "stch-inv-gems", `${formatInt(item.totalGems)} 宝石`, `${item.gemValue} 宝石/件`);
      appendInventoryTileText(tile, "div", "stch-inv-name", label || "未知物品");

      return tile;
    });

    updateGrindSummary(visible);
    updateSurplusActionState();
  }

  export async function startGrindScan(options = {}) {
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
    grindGemValueCache.clear();
    const logBox = document.getElementById("stch-surplus-log");
    if (logBox && !options.preserveLog) logBox.innerHTML = "";
    renderGrindResults();
    updateAllActionStates();

    const cfg = state.cfg;
    const createQueue = () => new RequestQueue(
      cfg.requestInterval,
      state,
      setGrindStatus,
      grindLog,
      { stopPredicate: currentState => Boolean(currentState?.grindStopRequested) }
    );
    const htmlQueue = createRequestQueuePool(getHtmlRequestConcurrency(cfg), createQueue);
    const otherQueue = createRequestQueuePool(getOtherRequestConcurrency(cfg), createQueue);
    const stopQueues = () => {
      htmlQueue.stop();
      otherQueue.stop();
    };
    state.grindQueue = { stop: stopQueues };
    const marketRecords = [];

    try {
      grindLog("【阶段 1/3】读取宝石袋市场价格");
      setGrindProgress(0, 1, "阶段1: 读取宝石价格");
      const gemPrice = await loadSidebarGemPrice(htmlQueue);
      state.grindGemPrice = gemPrice;
      if (gemPrice.priceCents) {
        const sackNet = getGemSackSellerNetCents(gemPrice.priceCents);
        const breakEven10 = getGemBreakEvenBuyerPrice(10, gemPrice.priceCents);
        grindLog(
          `宝石袋 ${gemPrice.source} ${formatMoney(gemPrice.priceCents)}，税后到手约 ${formatMoney(sackNet)}；10宝石临界价 ${formatMoney(breakEven10)}`,
          "ok"
        );
      } else {
        grindLog("宝石袋价格不可用；继续检测，但不会给出分解或出售建议", "warn");
      }

      const itemModeLabel = getProcessingDecorationCategories(state.cfg.surplusItemMode)
        .map(category => category === "emoticon" ? "表情" : "背景")
        .join("和");
      grindLog(`本次分析${itemModeLabel}类社区物品`, "info");

      grindLog("【阶段 2/3】读取社区库存并识别可分解物品");
      setGrindProgress(0, 1, "阶段2: 读取库存");
      const inventory = await loadGrindInventoryItems(steamId, otherQueue, options.inventorySnapshot);
      if (state.grindStopRequested) {
        grindLog("已停止扫描", "warn");
        return;
      }

      grindLog(
        `库存读取完成：库存 ${inventory.totalInventoryCount || inventory.totalAssetsSeen} 件，` +
        `候选 ${inventory.items.length} 种；` +
        `跳过无宝石值 ${inventory.skipped.noGemValue} 件，` +
        `默认保留 ${inventory.skipped.reserved} 件，` +
        (state.cfg.grindIncludePointsShopItems
          ? "优先保留点数商店副本，"
          : `跳过点数商店类 ${inventory.skipped.pointsShop} 件，`) +
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

      let completed = 0;
      await runWithConcurrency(
        inventory.items,
        getHtmlRequestConcurrency(cfg),
        async item => {
          if (state.grindStopRequested) return;
          setGrindProgress(
            completed,
            inventory.items.length,
            `阶段3: ${completed + 1}/${inventory.items.length} · ${item.itemName || item.marketHashName}`
          );
          setGrindStatus(`查询价格: ${item.itemName || item.marketHashName}`);

          if (item.marketHashName && item.marketableCount > 0) {
            const price = await priceCard(item.marketHashName, htmlQueue, {
              preferListing: true,
              requireVolume: true,
              persistMarketCache: false,
            });
            if (price?.record) marketRecords.push(price.record);
            if (isPriceCardPriced(price)) {
              item.priceCents = price.lowestSellCents;
              item.medianCents = price.medianCents;
              item.volume = price.volume;
              item.priceSource = price.priceSource === "lowest" ? "在售最低" : "平均价格";
              priced++;
            } else if (isPriceCardNoPrice(price)) {
              item.volume = 0;
              item.priceSource = "无可用价格";
              item.priceLookupFailed = false;
            } else if (isPriceCardError(price)) {
              failed++;
              item.priceSource = "查价失败";
              item.priceLookupFailed = true;
            }
          } else {
            item.priceSource = "缺少市场信息";
            item.priceLookupFailed = true;
          }

          applyGrindRecommendation(item, gemPrice.priceCents);
          state.grindResults.push(item);
          completed++;
          if (completed === 1 || completed % 5 === 0) renderGrindResults();
        }
      );

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
      stopQueues();
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
    updateSurplusActionState();
  }
