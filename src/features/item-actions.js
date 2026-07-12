import { state } from "../state.js";

import { RequestQueue } from "../request/queue.js";

import { priceCard } from "../parsers/price.js";

import { getBuyerPriceForSellerReceive, getSellerReceiveForBuyerPrice } from "../utils/market-fees.js";

import { formatInt, formatMoney } from "../utils/format.js";

import { getMarketMinimumPriceCents, getProfileUrl, getSessionId, getSteamId } from "../utils/steam.js";

import { createTextSpan } from "../utils/dom.js";

import { updateAllActionStates, isSharedActionBusy } from "../ui/action-state.js";

import { surplusStatus, grindStatus } from "../status-controllers.js";

import { fetchHighestBuyPrice, getOrderPriceSourceLabel } from "./orders.js";

import { getSelectedSurplusResults, renderSurplusResults } from "./surplus.js";

import { getSelectedGrindResults, renderGrindResults } from "./grind.js";

  function getProcessingMode() {
    const value = document.getElementById("stch-surplus-item-mode")?.value
      || state.cfg.surplusItemMode
      || "card";
    return ["card", "background", "emoticon"].includes(value) ? value : "card";
  }

  function getProcessingUi(mode = getProcessingMode()) {
    return mode === "card"
      ? {
        log: surplusStatus.log,
        setStatus: surplusStatus.setStatus,
        emptySell: "请先选择要出售的卡牌",
        emptyGem: "请先选择要转化宝石的卡牌",
      }
      : {
        log: grindStatus.log,
        setStatus: grindStatus.setStatus,
        emptySell: "请先选择要出售的物品",
        emptyGem: "请先选择要转化宝石的物品",
      };
  }

  function getSellPriceControls() {
    const configuredPriceSource =
      document.getElementById("stch-surplus-sell-price-source")?.value
      || state.cfg.surplusSellPriceSource
      || "lowest";
    const priceSource = ["lowest", "median", "highest"].includes(configuredPriceSource)
      ? configuredPriceSource
      : "lowest";
    const adjustmentInput = document.getElementById("stch-surplus-sell-adjustment");
    const adjustmentValue = adjustmentInput
      ? parseFloat(adjustmentInput.value)
      : state.cfg.surplusSellPriceAdjustment;
    const adjustmentCents = Math.round(
      (Number.isFinite(adjustmentValue) ? adjustmentValue : 0) * 100
    );
    return { priceSource, adjustmentCents };
  }

  function getActionQueue(ui) {
    const cfg = state.cfg;
    return new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      ui.setStatus,
      ui.log
    );
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getAssetQuantity(asset, field = "amount") {
    return Math.max(1, parseInt(asset?.[field], 10) || 1);
  }

  function getSelectedGroups(mode) {
    return mode === "card" ? getSelectedSurplusResults() : getSelectedGrindResults();
  }

  function clearSelection(mode) {
    if (mode === "card") {
      state.selectedSurplusResults = new Set();
      renderSurplusResults();
    } else {
      state.selectedGrindResults = new Set();
      renderGrindResults();
    }
  }

  function makeSellGroups(mode) {
    const selected = getSelectedGroups(mode);
    if (mode === "card") {
      return selected.map(result => {
        const assets = (result.assets || [])
          .filter(asset => asset.assetid && asset.marketable)
          .map(asset => ({
            assetid: String(asset.assetid || ""),
            contextid: String(asset.contextid || "6"),
            amount: getAssetQuantity(asset, "selectedAmount"),
          }));
        return {
          gameName: result.gameName || "",
          itemName: result.cardName || result.marketHashName || "未知卡牌",
          marketHashName: result.marketHashName || "",
          quantity: assets.reduce((sum, asset) => sum + asset.amount, 0),
          assets,
        };
      });
    }

    return selected.map(item => {
      const assets = (item.assets || [])
        .filter(asset => asset.assetid && asset.marketable)
        .map(asset => ({
          assetid: String(asset.assetid || ""),
          contextid: String(asset.contextid || "6"),
          amount: getAssetQuantity(asset, "amount"),
        }));
      return {
        gameName: item.gameName || "",
        itemName: item.itemName || item.marketHashName || "未知物品",
        marketHashName: item.marketHashName || "",
        quantity: assets.reduce((sum, asset) => sum + asset.amount, 0),
        assets,
      };
    });
  }

  function makeGemAssets(mode) {
    const selected = getSelectedGroups(mode);
    if (mode === "card") {
      return selected.flatMap(result =>
        (result.assets || []).map(asset => ({
          gameName: result.gameName || "",
          itemName: result.cardName || result.marketHashName || "未知卡牌",
          assetid: String(asset.assetid || ""),
          contextid: String(asset.contextid || "6"),
          selectedAmount: getAssetQuantity(asset, "selectedAmount"),
          assetAmount: getAssetQuantity(asset, "amount"),
          estimatedGems: (asset.gemValue || result.gemValue || 0) * getAssetQuantity(asset, "selectedAmount"),
        }))
      );
    }

    return selected.flatMap(item =>
      (item.assets || []).map(asset => ({
        gameName: item.gameName || "",
        itemName: item.itemName || item.marketHashName || "未知物品",
        assetid: String(asset.assetid || ""),
        contextid: String(asset.contextid || "6"),
        selectedAmount: getAssetQuantity(asset, "amount"),
        assetAmount: getAssetQuantity(asset, "originalAmount"),
        estimatedGems: (item.gemValue || 0) * getAssetQuantity(asset, "amount"),
      }))
    );
  }

  async function getSellBasePrice(group, priceSource, queue, ui, index, total, cache) {
    if (cache.has(group.marketHashName)) return cache.get(group.marketHashName);

    let basePriceCents = null;
    if (priceSource === "highest") {
      ui.setStatus(`读取求购最高 ${index + 1}/${total}: ${group.itemName}`);
      basePriceCents = await fetchHighestBuyPrice(group.marketHashName, queue);
    } else {
      ui.setStatus(`读取出售参考价 ${index + 1}/${total}: ${group.itemName}`);
      const price = await priceCard(group.marketHashName, queue);
      if (priceSource === "lowest") {
        basePriceCents = price?.priceSource === "lowest" ? price.lowestSellCents : null;
      } else {
        basePriceCents = Number.isFinite(price?.medianCents) && price.medianCents > 0
          ? price.medianCents
          : null;
      }
    }

    const value = Number.isFinite(basePriceCents) && basePriceCents > 0
      ? basePriceCents
      : null;
    cache.set(group.marketHashName, value);
    return value;
  }

  async function buildSellPlan(mode, ui, queue) {
    const { priceSource, adjustmentCents } = getSellPriceControls();
    const minimumBuyerCents = getMarketMinimumPriceCents();
    const priceCache = new Map();
    const plan = [];
    const skipped = {
      missingHash: 0,
      unmarketable: 0,
      missingPrice: 0,
      clamped: 0,
      failedPrice: 0,
    };
    const candidates = makeSellGroups(mode).filter(group => {
      if (!group.marketHashName) {
        skipped.missingHash++;
        return false;
      }
      if (!group.assets.length || group.quantity <= 0) {
        skipped.unmarketable++;
        return false;
      }
      return true;
    });

    for (let index = 0; index < candidates.length; index++) {
      const group = candidates[index];
      let basePriceCents = null;
      try {
        basePriceCents = await getSellBasePrice(
          group,
          priceSource,
          queue,
          ui,
          index,
          candidates.length,
          priceCache
        );
      } catch (error) {
        skipped.failedPrice++;
        ui.log(`  ${group.itemName}: ${error?.message || error}，已跳过`, "warn");
      }
      if (!basePriceCents) {
        skipped.missingPrice++;
        continue;
      }

      const targetBuyerCents = basePriceCents + adjustmentCents;
      const clampedBuyerCents = Math.max(minimumBuyerCents, targetBuyerCents);
      if (clampedBuyerCents !== targetBuyerCents) skipped.clamped++;
      const sellerReceiveCents = getSellerReceiveForBuyerPrice(clampedBuyerCents);
      if (sellerReceiveCents <= 0) {
        skipped.missingPrice++;
        continue;
      }
      const unitBuyerCents = getBuyerPriceForSellerReceive(sellerReceiveCents);
      plan.push({
        ...group,
        priceSource,
        basePriceCents,
        targetBuyerCents,
        unitBuyerCents,
        sellerReceiveCents,
        totalBuyerCents: unitBuyerCents * group.quantity,
        totalReceiveCents: sellerReceiveCents * group.quantity,
      });
    }

    return { plan, skipped, priceSource, adjustmentCents, minimumBuyerCents };
  }

  function getProfileActionBaseUrl() {
    const profileUrl = getProfileUrl();
    if (profileUrl) return profileUrl.replace(/\/$/, "");
    const steamId = getSteamId();
    return steamId ? `https://steamcommunity.com/profiles/${steamId}` : "";
  }

  async function fetchAssetGooValue(asset, queue, ui, index, total) {
    const baseUrl = getProfileActionBaseUrl();
    const sessionId = getSessionId();
    if (!baseUrl) throw new Error("未找到 Steam 个人资料地址");
    if (!sessionId) throw new Error("未找到 Steam sessionid");
    ui.setStatus(`读取宝石值 ${index + 1}/${total}: ${asset.itemName}`);
    const params = new URLSearchParams({
      sessionid: sessionId,
      appid: "753",
      assetid: asset.assetid,
      contextid: asset.contextid || "6",
    });
    const response = await queue.fetch(`${baseUrl}/ajaxgetgoovalue/?${params.toString()}`);
    const data = response?.data || {};
    const gooValue = Math.max(0, parseInt(data.goo_value, 10) || 0);
    if (gooValue <= 0) {
      throw new Error(data?.message || "Steam 未返回可分解宝石值");
    }
    return gooValue;
  }

  async function buildGemPlan(mode, ui, queue) {
    const candidates = makeGemAssets(mode);
    const plan = [];
    const skipped = {
      missingAsset: 0,
      partialStack: 0,
      noGooValue: 0,
    };

    for (let index = 0; index < candidates.length; index++) {
      const asset = candidates[index];
      if (!asset.assetid) {
        skipped.missingAsset++;
        continue;
      }
      if (asset.selectedAmount < asset.assetAmount) {
        skipped.partialStack++;
        continue;
      }
      try {
        const gooValueExpected = await fetchAssetGooValue(asset, queue, ui, index, candidates.length);
        plan.push({ ...asset, gooValueExpected });
      } catch (error) {
        skipped.noGooValue++;
        ui.log(`  ${asset.itemName}: ${error?.message || error}，已跳过`, "warn");
      }
    }
    return { plan, skipped };
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    try {
      return { data: JSON.parse(text), text };
    } catch (_) {
      return { data: null, text };
    }
  }

  function getSteamResponseError(data, response, fallback) {
    return data?.message
      || data?.strError
      || data?.error
      || data?.strHTML
      || `${fallback} (${response.status})`;
  }

  async function sellAsset(asset, sellerReceiveCents) {
    const sessionId = getSessionId();
    if (!sessionId) throw new Error("未找到 Steam sessionid");
    const body = new URLSearchParams({
      sessionid: sessionId,
      appid: "753",
      contextid: asset.contextid || "6",
      assetid: asset.assetid,
      amount: String(asset.amount || 1),
      price: String(sellerReceiveCents),
    });
    const response = await window.fetch("https://steamcommunity.com/market/sellitem/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: body.toString(),
    });
    const { data } = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(getSteamResponseError(data, response, "出售失败"));
    }
    if (data?.success === true || data?.success === 1) return data;
    throw new Error(getSteamResponseError(data, response, "出售失败"));
  }

  async function grindAsset(asset) {
    const baseUrl = getProfileActionBaseUrl();
    const sessionId = getSessionId();
    if (!baseUrl) throw new Error("未找到 Steam 个人资料地址");
    if (!sessionId) throw new Error("未找到 Steam sessionid");
    const body = new URLSearchParams({
      sessionid: sessionId,
      appid: "753",
      assetid: asset.assetid,
      contextid: asset.contextid || "6",
      goo_value_expected: String(asset.gooValueExpected),
    });
    const response = await window.fetch(`${baseUrl}/ajaxgrindintogoo/`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: body.toString(),
    });
    const { data } = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(getSteamResponseError(data, response, "转化宝石失败"));
    }
    if (data?.success === true || Number(data?.success) === 1) return data;
    throw new Error(getSteamResponseError(data, response, "转化宝石失败"));
  }

  function showProcessingConfirmation(options) {
    return new Promise(resolve => {
      const backdrop = document.createElement("div");
      backdrop.id = "stch-order-dialog-backdrop";
      backdrop.innerHTML = `
        <div class="stch-order-dialog">
          <h3>${options.title}</h3>
          <div class="stch-order-summary"></div>
          <div class="stch-order-list"></div>
          <div class="stch-order-note"></div>
          <div class="stch-order-dialog-actions">
            <div class="stch-btn alt" data-action="cancel">取消</div>
            <div class="stch-btn ${options.danger ? "stch-btn-danger" : ""}" data-action="confirm">${options.confirmLabel}</div>
          </div>
        </div>
      `;

      backdrop.querySelector(".stch-order-summary").innerHTML = options.summaryHtml;
      const list = backdrop.querySelector(".stch-order-list");
      options.rows.forEach(rowInfo => {
        const row = document.createElement("div");
        row.className = `stch-order-item stch-processing-dialog-item ${options.rowClass || ""}`.trim();
        rowInfo.forEach(text => row.appendChild(createTextSpan("", text)));
        list.appendChild(row);
      });
      backdrop.querySelector(".stch-order-note").textContent = options.note;

      const finish = confirmed => {
        backdrop.remove();
        resolve(confirmed);
      };
      backdrop.querySelector('[data-action="cancel"]').addEventListener("click", () => finish(false));
      backdrop.querySelector('[data-action="confirm"]').addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", event => {
        if (event.target === backdrop) finish(false);
      });
      document.body.appendChild(backdrop);
    });
  }

  function showSellConfirmation(planData) {
    const { plan, skipped, priceSource, adjustmentCents, minimumBuyerCents } = planData;
    const totalQuantity = plan.reduce((sum, item) => sum + item.quantity, 0);
    const totalBuyerCents = plan.reduce((sum, item) => sum + item.totalBuyerCents, 0);
    const totalReceiveCents = plan.reduce((sum, item) => sum + item.totalReceiveCents, 0);
    const adjustmentText = adjustmentCents >= 0
      ? `+${formatMoney(adjustmentCents)}`
      : formatMoney(adjustmentCents);
    const notes = [];
    if (skipped.missingHash) notes.push(`${skipped.missingHash} 项缺少市场标识`);
    if (skipped.unmarketable) notes.push(`${skipped.unmarketable} 项不可出售`);
    if (skipped.missingPrice) notes.push(`${skipped.missingPrice} 项缺少所选价格`);
    if (skipped.failedPrice) notes.push(`${skipped.failedPrice} 项查价失败`);
    if (skipped.clamped) {
      notes.push(`${skipped.clamped} 项低于 Steam 最低售价，已调整到 ${formatMoney(minimumBuyerCents)}`);
    }

    return showProcessingConfirmation({
      title: "确认上架出售",
      rowClass: "sell",
      confirmLabel: "上架出售",
      summaryHtml:
        `项目 <b>${plan.length}</b> 项 · 数量 <b>${totalQuantity}</b> 件 · ` +
        `买家价格合计 <b>${formatMoney(totalBuyerCents)}</b> · ` +
        `税后到手约 <b>${formatMoney(totalReceiveCents)}</b><br>` +
        `价格基准 <b>${getOrderPriceSourceLabel(priceSource)}</b> · 售价调整 <b>${adjustmentText}</b>`,
      rows: plan.map(item => [
        `${item.gameName ? `${item.gameName} · ` : ""}${item.itemName}`,
        `${item.quantity} 件`,
        `买家 ${formatMoney(item.unitBuyerCents)}`,
        `到手 ${formatMoney(item.sellerReceiveCents)}`,
      ]),
      note:
        `${notes.join("；") || "未发现需跳过的项目"}。` +
        "将直接提交 Steam 市场上架请求；可能仍需要在 Steam 手机应用中确认。",
    });
  }

  function showGemConfirmation(planData) {
    const { plan, skipped } = planData;
    const totalGems = plan.reduce((sum, item) => sum + item.gooValueExpected, 0);
    const notes = [];
    if (skipped.missingAsset) notes.push(`${skipped.missingAsset} 项缺少资产 ID`);
    if (skipped.partialStack) notes.push(`${skipped.partialStack} 项是部分堆叠资产，Steam 原生接口不支持只销毁一部分，已跳过`);
    if (skipped.noGooValue) notes.push(`${skipped.noGooValue} 项未读取到可分解宝石值`);

    return showProcessingConfirmation({
      title: "确认转化宝石",
      rowClass: "gem",
      confirmLabel: "转化宝石",
      danger: true,
      summaryHtml:
        `资产 <b>${plan.length}</b> 个 · 预计获得 <b>${formatInt(totalGems)}</b> 宝石`,
      rows: plan.map(item => [
        `${item.gameName ? `${item.gameName} · ` : ""}${item.itemName}`,
        item.assetid,
        `${formatInt(item.gooValueExpected)} 宝石`,
      ]),
      note:
        `${notes.join("；") || "未发现需跳过的项目"}。` +
        "转化宝石会不可逆销毁物品，请确认选中项目和数量。",
    });
  }

  export async function submitSelectedProcessingSell() {
    const mode = getProcessingMode();
    const ui = getProcessingUi(mode);
    if (isSharedActionBusy()) return;
    if (getSelectedGroups(mode).length === 0) {
      ui.log(ui.emptySell, "warn");
      return;
    }

    state.surplusActionRunning = true;
    updateAllActionStates();
    const queue = getActionQueue(ui);
    let finalStatus = null;
    let submitted = 0;
    let failed = 0;
    try {
      ui.log("开始生成出售计划", "info");
      const planData = await buildSellPlan(mode, ui, queue);
      if (planData.plan.length === 0) {
        finalStatus = "没有可上架出售的选中项目";
        ui.log(finalStatus, "warn");
        return;
      }
      const confirmed = await showSellConfirmation(planData);
      if (!confirmed) {
        finalStatus = "已取消上架出售";
        return;
      }

      const assets = planData.plan.flatMap(item =>
        item.assets.map(asset => ({ ...asset, item }))
      );
      for (let index = 0; index < assets.length; index++) {
        const asset = assets[index];
        ui.setStatus(`上架出售 ${index + 1}/${assets.length}: ${asset.item.itemName}`);
        try {
          const result = await sellAsset(asset, asset.item.sellerReceiveCents);
          submitted++;
          const confirmationText = result?.requires_confirmation || result?.needs_mobile_confirmation
            ? "，等待手机确认"
            : "";
          ui.log(
            `  ✓ ${asset.item.itemName} x${asset.amount}: 买家 ${formatMoney(asset.item.unitBuyerCents)} / 到手 ${formatMoney(asset.item.sellerReceiveCents)}${confirmationText}`,
            "ok"
          );
        } catch (error) {
          failed++;
          ui.log(`  ✗ ${asset.item.itemName} x${asset.amount}: ${error?.message || error}`, "err");
        }
        await wait(500);
      }
      finalStatus = `上架出售结束: 成功 ${submitted}, 失败 ${failed}`;
      ui.log(`${finalStatus}；建议重新扫描刷新库存结果`, failed ? "warn" : "ok");
      if (submitted > 0) clearSelection(mode);
    } catch (error) {
      finalStatus = `无法上架出售: ${error?.message || error}`;
      ui.log(finalStatus, "err");
    } finally {
      queue.stop();
      state.surplusActionRunning = false;
      ui.setStatus(finalStatus && failed ? finalStatus : null, false);
      updateAllActionStates();
    }
  }

  export async function submitSelectedProcessingGems() {
    const mode = getProcessingMode();
    const ui = getProcessingUi(mode);
    if (isSharedActionBusy()) return;
    if (getSelectedGroups(mode).length === 0) {
      ui.log(ui.emptyGem, "warn");
      return;
    }

    state.surplusActionRunning = true;
    updateAllActionStates();
    const queue = getActionQueue(ui);
    let finalStatus = null;
    let submitted = 0;
    let failed = 0;
    try {
      ui.log("开始读取选中资产的可分解宝石值", "info");
      const planData = await buildGemPlan(mode, ui, queue);
      if (planData.plan.length === 0) {
        finalStatus = "没有可转化宝石的选中项目";
        ui.log(finalStatus, "warn");
        return;
      }
      const confirmed = await showGemConfirmation(planData);
      if (!confirmed) {
        finalStatus = "已取消转化宝石";
        return;
      }

      for (let index = 0; index < planData.plan.length; index++) {
        const asset = planData.plan[index];
        ui.setStatus(`转化宝石 ${index + 1}/${planData.plan.length}: ${asset.itemName}`);
        try {
          await grindAsset(asset);
          submitted++;
          ui.log(
            `  ✓ ${asset.itemName}: ${formatInt(asset.gooValueExpected)} 宝石`,
            "ok"
          );
        } catch (error) {
          failed++;
          ui.log(`  ✗ ${asset.itemName}: ${error?.message || error}`, "err");
        }
        await wait(500);
      }
      finalStatus = `转化宝石结束: 成功 ${submitted}, 失败 ${failed}`;
      ui.log(`${finalStatus}；建议重新扫描刷新库存结果`, failed ? "warn" : "ok");
      if (submitted > 0) clearSelection(mode);
    } catch (error) {
      finalStatus = `无法转化宝石: ${error?.message || error}`;
      ui.log(finalStatus, "err");
    } finally {
      queue.stop();
      state.surplusActionRunning = false;
      ui.setStatus(finalStatus && failed ? finalStatus : null, false);
      updateAllActionStates();
    }
  }
