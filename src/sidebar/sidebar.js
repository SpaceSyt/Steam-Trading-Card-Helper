import { SIDEBAR_PINNED_KEY, SIDEBAR_GEM_PRICE_KEY, GEM_SACK_SIZE } from "../constants.js";
import { state } from "../state.js";

import { formatInt, formatMoney } from "../utils/format.js";

import { getGemSackSellerNetCents, getGemBreakEvenBuyerPrice } from "../utils/market-fees.js";

import { loadSidebarProfileInfo } from "./profile.js";

import { loadSidebarGemInfo, loadSidebarGemPrice } from "./gems.js";

  let sidebarLoading = false;

  let sidebarData = {
    profile: null,
    gems: null,
    gemPrice: null,
    error: "",
  };

  export function setSidebarText(id, text, title = "") {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.title = title || text;
  }

  export function renderSidebar() {
    const profile = sidebarData.profile || {};
    const gems = sidebarData.gems || {};
    const gemPrice = sidebarData.gemPrice || {};
    const avatar = document.getElementById("stch-sidebar-avatar");
    if (avatar && profile.avatar) avatar.src = profile.avatar;
    const hasRemainingXp = Number.isFinite(Number(profile.remainingXp))
      && Number.isFinite(Number(profile.stepXp))
      && Number(profile.stepXp) > 0;
    setSidebarText("stch-sidebar-name", profile.name || "Steam 用户");
    setSidebarText("stch-sidebar-level", profile.level ? `Lv ${formatInt(profile.level)}` : "—");
    setSidebarText("stch-sidebar-xp", profile.totalXp ? `${formatInt(profile.totalXp)} 点` : "—");
    setSidebarText(
      "stch-sidebar-next",
      hasRemainingXp
        ? `${formatInt(profile.remainingXp)} / ${formatInt(profile.stepXp)}`
        : "—"
    );

    const progress = document.getElementById("stch-sidebar-progress-bar");
    if (progress) {
      const pct = profile.stepXp
        ? Math.min(100, Math.max(0, (profile.earnedThisLevel / profile.stepXp) * 100))
        : 0;
      progress.style.width = `${pct}%`;
    }

    const gemText = Number.isFinite(gems.totalGems)
      ? `${formatInt(gems.totalGems)} 宝石${gems.sackCount ? `（${formatInt(gems.sackCount)} 宝石袋）` : ""}`
      : "—";
    setSidebarText("stch-sidebar-gems", gemText);

    const priceEl = document.getElementById("stch-sidebar-gem-price");
    if (priceEl) {
      priceEl.replaceChildren();
      if (gemPrice.priceCents) {
        const previousPriceCents = Number(gemPrice.previousPriceCents) || 0;
        if (previousPriceCents > 0) {
          const changeCents = gemPrice.priceCents - previousPriceCents;
          const change = document.createElement("span");
          change.className = changeCents > 0
            ? "stch-sidebar-price-rise"
            : changeCents < 0
              ? "stch-sidebar-price-fall"
              : "stch-sidebar-price-flat";
          change.textContent = changeCents === 0
            ? `(±${formatMoney(0)}) `
            : `(${changeCents > 0 ? "+" : ""}${formatMoney(changeCents)}) `;
          priceEl.appendChild(change);
        }
        priceEl.appendChild(
          document.createTextNode(`${GEM_SACK_SIZE}宝石/${formatMoney(gemPrice.priceCents)}`)
        );
      } else {
        priceEl.textContent = "—";
      }
    }
    const gemSackNetCents = gemPrice.priceCents
      ? getGemSackSellerNetCents(gemPrice.priceCents)
      : 0;
    const priceTitle = gemPrice.priceCents
      ? `${gemPrice.source}${gemPrice.volume ? `，成交量 ${formatInt(gemPrice.volume)}` : ""}，税后到手约 ${formatMoney(gemSackNetCents)}`
      : "暂无宝石袋市场价格";
    if (priceEl) priceEl.title = priceTitle;

    const breakEven10 = gemPrice.priceCents
      ? getGemBreakEvenBuyerPrice(10, gemPrice.priceCents)
      : 0;
    const breakEvenTitle = breakEven10
      ? `按宝石袋税后到手 ${formatMoney(gemSackNetCents)} 计算；物品卖出税后低于该值时，分解成宝石更值`
      : "暂无宝石袋市场价格";
    setSidebarText(
      "stch-sidebar-grind-threshold",
      breakEven10 ? `10宝石/${formatMoney(breakEven10)}` : "—",
      breakEvenTitle
    );

    const status = document.getElementById("stch-sidebar-status");
    if (status) {
      status.textContent = sidebarLoading
        ? "正在刷新账号信息、库存宝石和市场价格..."
        : sidebarData.error || (profile.name ? "已同步当前账号信息" : "鼠标移入侧栏后可查看信息");
    }
    const refresh = document.getElementById("stch-sidebar-refresh");
    if (refresh) refresh.disabled = sidebarLoading;
  }

  export async function refreshSidebarData() {
    if (sidebarLoading) return;
    sidebarLoading = true;
    sidebarData.error = "";
    renderSidebar();
    try {
      const profile = await loadSidebarProfileInfo();
      sidebarData.profile = profile;
      renderSidebar();

      const [gemsResult, priceResult] = await Promise.allSettled([
        loadSidebarGemInfo(profile.steamId),
        loadSidebarGemPrice(),
      ]);
      if (gemsResult.status === "fulfilled") {
        sidebarData.gems = gemsResult.value;
      } else {
        sidebarData.error = gemsResult.reason?.message || "库存宝石读取失败";
      }
      if (priceResult.status === "fulfilled") {
        const currentPriceCents = Number(priceResult.value?.priceCents) || 0;
        const currencyId = Number(
          priceResult.value?.currencyId
          || state?.currencyContext?.currencyId
          || state?.cfg?.currencyId
          || 23
        );
        const savedGemPrice = GM_getValue(SIDEBAR_GEM_PRICE_KEY, null);
        const savedCurrencyId = typeof savedGemPrice === "object"
          ? Number(savedGemPrice?.currencyId || 23)
          : 23;
        const previousPriceCents = Number(
          savedCurrencyId === currencyId && typeof savedGemPrice === "object"
            ? savedGemPrice?.priceCents
            : savedCurrencyId === currencyId
              ? savedGemPrice
              : 0
        ) || 0;
        sidebarData.gemPrice = {
          ...priceResult.value,
          previousPriceCents,
        };
        if (currentPriceCents > 0) {
          GM_setValue(SIDEBAR_GEM_PRICE_KEY, {
            schemaVersion: 2,
            currencyId,
            priceCents: currentPriceCents,
            observedAt: Date.now(),
          });
        }
      } else if (!sidebarData.error) {
        sidebarData.error = priceResult.reason?.message || "宝石价格读取失败";
      }
    } catch (error) {
      sidebarData.error = error?.message || "侧栏信息读取失败";
    } finally {
      sidebarLoading = false;
      renderSidebar();
    }
  }

  export function setSidebarPinned(pinned) {
    const sidebar = document.getElementById("stch-sidebar");
    if (!sidebar) return;
    sidebar.classList.toggle("pinned", pinned);
    GM_setValue(SIDEBAR_PINNED_KEY, !!pinned);
    const pin = document.getElementById("stch-sidebar-pin");
    if (pin) pin.textContent = pinned ? "收起" : "固定";
  }

  export function setSidebarEnabled(enabled) {
    if (!enabled) {
      document.getElementById("stch-sidebar")?.remove();
      return;
    }
    injectSidebar();
  }

  export function injectSidebar() {
    if (document.getElementById("stch-sidebar")) return;

    const sidebar = document.createElement("aside");
    sidebar.id = "stch-sidebar";
    sidebar.innerHTML = `
      <div class="stch-sidebar-panel">
        <div class="stch-sidebar-head">
          <img id="stch-sidebar-avatar" class="stch-sidebar-avatar" alt="">
          <div class="stch-sidebar-title">
            <div id="stch-sidebar-name" class="stch-sidebar-name">Steam 用户</div>
          </div>
          <button id="stch-sidebar-pin" class="stch-sidebar-pin" type="button">固定</button>
        </div>
        <div class="stch-sidebar-body">
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">当前等级</span><span id="stch-sidebar-level" class="stch-sidebar-value">—</span></div>
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">当前经验值</span><span id="stch-sidebar-xp" class="stch-sidebar-value">—</span></div>
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">距离下一级</span><span id="stch-sidebar-next" class="stch-sidebar-value">—</span></div>
          <div class="stch-sidebar-progress"><div id="stch-sidebar-progress-bar" class="stch-sidebar-progress-bar"></div></div>
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">当前宝石</span><span id="stch-sidebar-gems" class="stch-sidebar-value">—</span></div>
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">宝石价格参考</span><span id="stch-sidebar-gem-price" class="stch-sidebar-value">—</span></div>
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">分解临界点</span><span id="stch-sidebar-grind-threshold" class="stch-sidebar-value">—</span></div>
          <div id="stch-sidebar-status" class="stch-sidebar-status">正在准备侧栏信息...</div>
          <div class="stch-sidebar-actions"><button id="stch-sidebar-refresh" class="stch-sidebar-refresh" type="button">刷新</button></div>
        </div>
      </div>
      <div id="stch-sidebar-handle" class="stch-sidebar-handle" aria-label="侧栏"></div>
    `;
    document.body.appendChild(sidebar);

    const initialPinned = !!GM_getValue(SIDEBAR_PINNED_KEY, false);
    setSidebarPinned(initialPinned);
    document.getElementById("stch-sidebar-pin")?.addEventListener("click", event => {
      event.stopPropagation();
      setSidebarPinned(!sidebar.classList.contains("pinned"));
    });
    document.getElementById("stch-sidebar-handle")?.addEventListener("click", event => {
      event.stopPropagation();
      setSidebarPinned(!sidebar.classList.contains("pinned"));
    });
    document.getElementById("stch-sidebar-refresh")?.addEventListener("click", event => {
      event.stopPropagation();
      refreshSidebarData();
    });

    renderSidebar();
    refreshSidebarData();
  }
