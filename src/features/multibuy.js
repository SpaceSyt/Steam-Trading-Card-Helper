import { state } from "../state.js";

import { $J, unsafeWindow } from "../globals.js";

import { getBadgeTargetLevel, getBadgeUrlSuffix } from "../utils/badge.js";

import { getProfileUrl, getMarketMinimumPriceCents } from "../utils/steam.js";

import { getMarketHashNameFromLink } from "../parsers/market-listing.js";

import { MULTIBUY_DATA_KEY, MULTIBUY_DATA_TTL, MULTIBUY_FILL_TIMEOUT } from "../constants.js";

import { scanStatus } from "../status-controllers.js";

import { getActiveCurrencyContext } from "../services/currency.js";

const { log } = scanStatus;

  export function clearMultibuyData() {
    GM_setValue(MULTIBUY_DATA_KEY, null);
  }

  export function getMultibuyQuantity(mode, badgeLevel, owned, targetLevel = 5) {
    const maxLevel = Math.max(1, Math.floor(Number(targetLevel) || 5));
    switch (mode) {
      case "complete5": return Math.max(0, (maxLevel - badgeLevel) - owned);
      case "buy1":      return 1;
      case "buy5":      return maxLevel;
      default:          return owned < 1 ? 1 : 0;
    }
  }

  export function sameMarketItems(left, right) {
    if (left.length !== right.length) return false;
    const a = [...left].sort();
    const b = [...right].sort();
    return a.every((item, index) => item === b[index]);
  }

  export function getMultibuyItemsFromUrl(url) {
    const params = new URL(url).searchParams;
    const repeatedItems = params.getAll("items[]");
    if (repeatedItems.length > 0) return repeatedItems;

    const indexedItems = [];
    for (const [key, value] of params.entries()) {
      const match = key.match(/^items\[(\d+)\]$/);
      if (match) {
        indexedItems.push({ index: Number(match[1]), value });
      }
    }
    indexedItems.sort((a, b) => a.index - b.index);
    return indexedItems.map(item => item.value);
  }

  export function getFieldContext(field) {
    const attributes = [
      field?.name,
      field?.id,
      field?.className,
      field?.getAttribute?.("placeholder"),
      field?.getAttribute?.("aria-label"),
      field?.getAttribute?.("data-field"),
    ];
    return attributes.filter(Boolean).join(" ").toLowerCase();
  }

  export function findMultibuyFields(row) {
    const steamQuantity = row.querySelector(
      "input.market_multi_quantity, input[name$='_qty'], input[id$='_qty']"
    );
    const steamPrice = row.querySelector(
      "input.market_multi_price, input[name$='_price'], input[id$='_price']"
    );
    if (steamQuantity || steamPrice) {
      return { quantity: steamQuantity, price: steamPrice };
    }

    const fields = [...row.querySelectorAll("input, select")].filter(field => {
      const type = (field.type || "").toLowerCase();
      return !field.disabled && !["hidden", "button", "submit", "checkbox", "radio"].includes(type);
    });
    const quantityPattern = /qty|quantity|count|数量/;
    const pricePattern = /price|cost|currency|buyorder|金额|价格|单价/;
    const quantity = fields.find(field => quantityPattern.test(getFieldContext(field))) || null;

    const priceCandidates = fields.filter(
      field => field !== quantity && (field.tagName || "").toUpperCase() !== "SELECT"
    );
    let price = priceCandidates.find(field => pricePattern.test(getFieldContext(field))) || null;
    if (!price) {
      const nestedPriceFields = [...row.querySelectorAll(
        ".market_multibuy_price input, .market_commodity_buyorder_price input, [class*='price'] input"
      )].filter(field => priceCandidates.includes(field));
      if (nestedPriceFields.length === 1) price = nestedPriceFields[0];
    }
    if (!price && priceCandidates.length === 1) {
      price = priceCandidates[0];
    }

    return { quantity, price };
  }

  export function findMultibuyRow(link) {
    const isSingleItemContainer = node => {
      if (!node?.querySelector("input, select")) return false;
      const listingCount = node.querySelectorAll?.('a[href*="/market/listings/753/"]').length || 0;
      return listingCount <= 1;
    };
    const preferred = link.closest(
      "tr, .market_multibuy_item, .multibuy_item_row, [class*='multibuy'][class*='item']"
    );
    if (isSingleItemContainer(preferred)) return preferred;

    let node = link.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 8; depth++, node = node.parentElement) {
      if (isSingleItemContainer(node)) return node;
    }
    return null;
  }

  export function setMultibuyFieldValue(field, value) {
    if (!field) return false;
    const nextValue = String(value);
    if (field.value === nextValue) return false;
    field.value = nextValue;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "0" }));
    $J(field).trigger("blur");
    return true;
  }

  export function openMultibuy(info) {
    const cardsWithHash = info.cards.filter(c => c.marketHashName);
    if (cardsWithHash.length === 0) {
      log(`${info.gameName}: 无可用卡牌数据`, "warn");
      return;
    }

    const mode = state.cfg.buyMode || "complete1";
    const params = new URLSearchParams();
    params.set("appid", "753");

    const qtyByCard = [];
    cardsWithHash.forEach(c => {
      const qty = getMultibuyQuantity(mode, info.level, c.owned, getBadgeTargetLevel(info));
      qtyByCard.push({ card: c, qty });
    });
    const toBuy = qtyByCard.filter(q => q.qty > 0);
    if (toBuy.length === 0) {
      log(`${info.gameName}: 当前模式下无需购买卡牌`, "info");
      return;
    }
    toBuy.forEach(q => {
      params.append("items[]", q.card.marketHashName);
      params.append("qty[]", String(q.qty));
    });

    const profileUrl = getProfileUrl();
    if (profileUrl) {
      params.set("steamdb_return_to", `${profileUrl}/gamecards/${info.appid}/${getBadgeUrlSuffix(info)}`);
    }

    // Multibuy remains on the manual profile even while long-order automatic
    // pricing is enabled in the modal.
    const adjustmentValue = state.cfg.priceAdjustment;
    const bufferCents = Math.round(
      (Number.isFinite(adjustmentValue) ? adjustmentValue : 0) * 100
    );
    const currencyContext = getActiveCurrencyContext();
    const minimumPriceMinor = getMarketMinimumPriceCents(currencyContext);
    if (
      !Number.isInteger(currencyContext?.currencyId)
      || !Number.isSafeInteger(minimumPriceMinor)
      || minimumPriceMinor <= 0
    ) {
      log(`${info.gameName}: 无法确认 Steam 钱包币种，已停止打开批量购买`, "warn");
      return;
    }
    const buyData = {
      appid: info.appid,
      isFoil: !!info.isFoil,
      gameName: info.gameName,
      currencyId: currencyContext?.currencyId ?? null,
      bufferCents,
      createdAt: Date.now(),
      items: toBuy.map(q => q.card.marketHashName),
      cards: toBuy.map(q => ({
        marketHashName: q.card.marketHashName,
        lowestCents: q.card.priceSource === "lowest"
          && Number.isFinite(q.card.lowestCents)
          && q.card.lowestCents > 0
          ? q.card.lowestCents
          : null,
        name: q.card.name,
        qty: q.qty,
      })),
    };

    GM_setValue(MULTIBUY_DATA_KEY, JSON.stringify(buyData));

    const multibuyUrl = `https://steamcommunity.com/market/multibuy?${params.toString()}`;
    const totalQty = toBuy.reduce((s, q) => s + q.qty, 0);
    log(`${info.gameName}: 打开批量购买 (${totalQty} 张, 模式: ${mode})`, "ok");
    window.open(multibuyUrl, "_blank");
  }

  export function initMultibuyAutoFill() {
    let data;
    try {
      const raw = GM_getValue(MULTIBUY_DATA_KEY, null);
      if (!raw) return;
      data = JSON.parse(raw);
    } catch (_) {
      clearMultibuyData();
      return;
    }

    const currentItems = getMultibuyItemsFromUrl(window.location.href);
    const storedItems = Array.isArray(data?.items) ? data.items : [];
    const sameItems = sameMarketItems(currentItems, storedItems);
    const isFresh = Number.isFinite(data?.createdAt)
      && Date.now() - data.createdAt <= MULTIBUY_DATA_TTL;
    const currencyContext = getActiveCurrencyContext();
    const sameCurrency = Number.isInteger(currencyContext?.currencyId)
      && Number(data?.currencyId) === currencyContext.currencyId;

    if (
      !data
      || !Array.isArray(data.cards)
      || data.cards.length === 0
      || !sameItems
      || !isFresh
      || !sameCurrency
    ) {
      console.warn("[STCH] Ignoring stale or mismatched multibuy data", {
        currentItems,
        storedItems,
        isFresh,
        storedCurrencyId: data?.currencyId,
        activeCurrencyId: currencyContext?.currencyId,
      });
      clearMultibuyData();
      return;
    }

    const bufferCents = data.bufferCents || 0;
    const minimumPriceMinor = getMarketMinimumPriceCents(currencyContext);
    if (!Number.isSafeInteger(minimumPriceMinor) || minimumPriceMinor <= 0) {
      console.warn("[STCH] Ignoring multibuy data because the market minimum is unavailable");
      clearMultibuyData();
      return;
    }

    // Inject "恢复默认价格" button next to Steam's title
    const injectResetBtn = () => {
      const heading = document.querySelector("h2, h1, .market_multibuy_header, .pageheader");
      if (heading && !document.getElementById("stch-reset-btn")) {
        const btn = document.createElement("span");
        btn.id = "stch-reset-btn";
        btn.textContent = "恢复默认价格";
        btn.style.cssText = "margin-left:12px;padding:4px 12px;background:rgba(67,137,179,0.85);color:#fff;border-radius:3px;cursor:pointer;font-size:13px;";
        btn.addEventListener("click", () => { location.reload(); });
        heading.appendChild(btn);
      }
    };
    injectResetBtn();

    const cardsByHash = new Map(data.cards.map(card => [card.marketHashName, card]));
    const filledCards = new Set();
    const warnedCards = new Set();
    let finished = false;
    let completionTimer = null;
    let deadlineTimer = null;
    let observer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (completionTimer) clearTimeout(completionTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      clearMultibuyData();
      observer?.disconnect();
    };

    const tryFill = () => {
      if (finished) return;

      let changed = false;
      const listingLinks = document.querySelectorAll('a[href*="/market/listings/753/"]');
      listingLinks.forEach(listingLink => {
        const marketHashName = getMarketHashNameFromLink(listingLink);
        if (filledCards.has(marketHashName)) return;
        const card = cardsByHash.get(marketHashName);
        if (!card) return;

        const row = findMultibuyRow(listingLink);
        if (!row) return;
        const { quantity, price } = findMultibuyFields(row);
        if (!price) {
          if (!warnedCards.has(marketHashName)) {
            warnedCards.add(marketHashName);
            console.warn(`[STCH] Price input not found for ${marketHashName}`);
          }
          return;
        }

        if (card.lowestCents > 0) {
          changed = setMultibuyFieldValue(
            price,
            (
              Math.max(minimumPriceMinor, card.lowestCents + bufferCents)
              / currencyContext.minorUnitFactor
            ).toFixed(currencyContext.decimalDigits)
          ) || changed;
        }
        if (quantity) {
          changed = setMultibuyFieldValue(quantity, card.qty || 0) || changed;
        }
        filledCards.add(marketHashName);
      });

      if (changed && typeof unsafeWindow.UpdateOrderTotal === "function") {
        unsafeWindow.UpdateOrderTotal();
      }

      if (filledCards.size === data.cards.length && !completionTimer) {
        completionTimer = setTimeout(() => {
          tryFill();
          finish();
        }, 750);
      }
    };

    let pollCount = 0;
    const poll = () => {
      tryFill();
      if (finished) return;
      if (++pollCount >= MULTIBUY_FILL_TIMEOUT / 500) {
        finish();
        return;
      }
      setTimeout(poll, 500);
    };
    setTimeout(poll, 600);

    observer = new MutationObserver(() => {
      if (!finished) tryFill();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    deadlineTimer = setTimeout(finish, MULTIBUY_FILL_TIMEOUT);
  }
