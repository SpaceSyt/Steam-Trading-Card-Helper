import { unsafeWindow } from "../globals.js";
import { state } from "../state.js";
import { initializeCurrencyContext, formatMoney } from "../services/currency.js";
import { tradeAssetKey, readTradeSide, summarizeTradeSide, compareTradeSides } from "./trade-model.js";
import { createTradePrices, TRADE_PRICE_TTL } from "./trade-prices.js";
import css from "./trade-offer.css";

export function initTradeOffer() {
  const doc = unsafeWindow.document;
  const slots = [doc.getElementById("your_slots"), doc.getElementById("their_slots")];
  if (slots.some(slot => !slot) || doc.getElementById("stch-trade-comparison")) return null;
  GM_addStyle(css);
  const currencyContext = initializeCurrencyContext({ configuredCurrencyId: state.cfg.currencyId });
  const money = value => formatMoney(value, currencyContext);
  const summaries = slots.map(slot => {
    const row = doc.createElement("div");
    row.className = "stch-trade-summary";
    row.setAttribute("role", "status");
    for (let i = 0; i < 3; i++) row.appendChild(doc.createElement("span"));
    slot.before(row);
    return row;
  });
  const comparison = doc.createElement("div");
  comparison.id = "stch-trade-comparison";
  comparison.className = "stch-trade-comparison";
  comparison.setAttribute("role", "status");
  const text = doc.createElement("span");
  const retry = doc.createElement("button");
  retry.type = "button";
  retry.textContent = "重试估价";
  retry.className = "stch-trade-retry";
  comparison.append(text, retry);
  const readyStatus = doc.getElementById("you_cantready") || doc.getElementById("you_notready");
  if (readyStatus) readyStatus.before(comparison);
  else slots[0].after(comparison);
  let frame = 0;
  let expiryTimer = 0;
  let stopped = false;
  const schedule = () => {
    if (!stopped && !frame) frame = requestAnimationFrame(render);
  };
  const prices = createTradePrices({ currencyContext, cfg: state.cfg, onChange: schedule });
  retry.addEventListener("click", () => prices.retry());
  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }
  function render() {
    frame = 0;
    clearTimeout(expiryTimer);
    const status = unsafeWindow.g_rgCurrentTradeStatus;
    const sides = slots.map((slot, index) => {
      const descriptions = new Map();
      const currencySlot = doc.getElementById(index ? "their_slots_currency" : "your_slots_currency");
      for (const root of [slot, currencySlot]) {
        for (const element of root?.querySelectorAll(".item") || []) {
          const item = element.rgItem;
          if (item) descriptions.set(tradeAssetKey(item, root === currencySlot), item);
        }
      }
      const side = summarizeTradeSide(readTradeSide(status?.[index ? "them" : "me"], descriptions), item => prices.get(item));
      const fields = summaries[index].children;
      setText(fields[0], `物品种类：${side?.uniqueCount ?? "—"}`);
      setText(fields[1], `总数量：${side?.quantity ?? "—"}`);
      let value = "交易数据未就绪";
      if (side) {
        value = side.totalMinor !== null ? money(side.totalMinor)
          : !currencyContext?.currencyId ? "币种未识别"
          : side.pending ? `估价中（${side.pending} 件待查${side.missing ? `，${side.missing} 件缺价` : ""}）`
          : side.quantity === null ? "物品数量异常" : `—（${side.missing} 件缺价）`;
      }
      setText(fields[2], `估算总价：${value}`);
      fields[2].title = `Steam 市场在售最低价（含手续费）${Number.isFinite(side?.observedAt) ? ` · ${new Date(side.observedAt).toLocaleString("zh-CN")}` : ""}`;
      return side;
    });
    const difference = compareTradeSides(...sides);
    comparison.hidden = sides.every(side => side?.quantity === 0);
    comparison.dataset.direction = difference === null || difference === 0 ? "equal" : difference > 0 ? "gain" : "loss";
    const message = difference === null ? "价格未齐，暂不比较"
      : difference === 0 ? "双方物品价值相同"
      : `${difference > 0 ? "对方物品价值比你高" : "你的物品价值比对方高"} ${money(Math.abs(difference))}`;
    setText(text, message + (prices.storageError ? " · 价格缓存读写失败" : ""));
    retry.hidden = !currencyContext?.currencyId || !sides.some(side => side?.retryable && !side.pending);
    const expiresAt = Math.min(...sides.map(side => side?.observedAt ?? Infinity)) + TRADE_PRICE_TTL;
    if (Number.isFinite(expiresAt)) expiryTimer = setTimeout(schedule, Math.max(1000, expiresAt - Date.now()));
  }
  // Observe only offer slots, including stack amount text; our summaries sit outside them.
  const observer = new MutationObserver(schedule);
  for (const id of ["your_slots", "their_slots", "your_slots_currency", "their_slots_currency"]) {
    const root = doc.getElementById(id);
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true });
  }
  const stop = () => {
    stopped = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(expiryTimer);
    prices.stop();
  };
  window.addEventListener("pagehide", event => { if (!event.persisted) stop(); });
  window.addEventListener("pageshow", event => { if (event.persisted) schedule(); });
  render();
  return { stop, refresh: schedule };
}
