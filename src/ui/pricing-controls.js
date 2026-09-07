import { state } from "../state.js";
import { createAutomaticPricingDraft, getActiveOrderPricingProfile, saveConfig } from "../config.js";
import { getActiveCurrencyContext } from "../services/currency.js";

const priceOptions = [
  [["lowest", "在售最低"], ["median", "平均价格"], ["highest", "求购最高"]],
  [["conservative", "保守"], ["balanced", "平衡"], ["aggressive", "抢单"]],
  [["instant", "速售"], ["follow", "跟价"], ["conservative", "保守"]],
];
const controlGroups = [
  [["stch-order-", "stch-"], ["stch-order-page-", "stch-order-page-"]],
  [["stch-surplus-sell-", "stch-surplus-sell-"]],
];
function draftKey(sell) {
  return sell ? "sellAutomaticPricingDraft" : "automaticPricingDraft";
}
function resetDraft(sell) {
  const strategy = state.cfg[sell ? "sellAutomaticPriceStrategy" : "automaticPriceStrategy"];
  return state[draftKey(sell)] = createAutomaticPricingDraft(state.cfg, strategy, sell);
}
function getProfile(sell) {
  const strategy = state.cfg[sell ? "sellAutomaticPriceStrategy" : "automaticPriceStrategy"];
  if (state[draftKey(sell)]?.strategy !== strategy) resetDraft(sell);
  return getActiveOrderPricingProfile(state.cfg, state[draftKey(sell)], sell);
}
function optionsHtml(profile, sell) {
  return priceOptions[profile.automatic ? sell ? 2 : 1 : 0].map(([value, label]) =>
    `<option value="${value}" ${profile.priceSource === value ? "selected" : ""}>${label}</option>`
  ).join("");
}

export function priceControlsHtml(pricePrefix, adjustmentPrefix, sell = false) {
  const profile = getProfile(sell);
  const { automatic, strategyRule } = profile;
  const activeClass = automatic ? "stch-auto-pricing-active" : "";
  const currency = getActiveCurrencyContext()?.symbol || "¤";
  return `<label id="${pricePrefix}price-label" class="stch-primary-label ${activeClass}">${sell ? "出售" : "购买"}价格
    <select id="${pricePrefix}price-source" class="stch-input" style="width:118px">${optionsHtml(profile, sell)}</select></label>
    <label id="${adjustmentPrefix}price-wall-adjustment-label" class="stch-primary-label ${activeClass}" ${automatic && !sell ? "" : 'style="display:none"'}>有墙调整 ${currency}
      <input id="${adjustmentPrefix}price-wall-adjustment" class="stch-input" type="number" step="0.01" value="${(strategyRule?.wallOffsetMinor || 0) / 100}" style="width:68px"></label>
    <label id="${adjustmentPrefix}price-adjustment-label" class="stch-primary-label ${activeClass}"><span id="${adjustmentPrefix}price-adjustment-text">${automatic && !sell ? "无墙调整" : sell ? "售价调整" : "买价调整"}</span> ${currency}
      <input id="${adjustmentPrefix}price-adjustment" class="stch-input" type="number" step="0.01" value="${automatic ? strategyRule.noWallOffsetMinor / 100 : profile.adjustment}" style="width:68px"></label>
    <label class="stch-auto-pricing-toggle ${activeClass}"><input id="${adjustmentPrefix}auto-pricing" type="checkbox" ${automatic ? "checked" : ""}> 智能定价模式</label>`;
}

export function bindPricingControls(refreshBuySummaries) {
  controlGroups.forEach((controls, side) => {
    const sell = !!side;
    const enabledKey = sell ? "sellAutomaticPricingEnabled" : "automaticPricingEnabled";
    const strategyKey = sell ? "sellAutomaticPriceStrategy" : "automaticPriceStrategy";
    const sourceKey = sell ? "surplusSellPriceSource" : "orderPriceSource";
    const adjustmentKey = sell ? "surplusSellPriceAdjustment" : "priceAdjustment";
    const refresh = () => { if (!sell) refreshBuySummaries(); };
    const render = (exceptId = "") => {
      const profile = getProfile(sell);
      const { automatic, strategyRule } = profile;
      for (const [pricePrefix, prefix] of controls) {
        const source = document.getElementById(`${pricePrefix}price-source`);
        source.innerHTML = optionsHtml(profile, sell);
        const adjustment = document.getElementById(`${prefix}price-adjustment`);
        if (adjustment.id !== exceptId) adjustment.value = automatic ? strategyRule.noWallOffsetMinor / 100 : profile.adjustment;
        const wall = document.getElementById(`${prefix}price-wall-adjustment`);
        if (wall.id !== exceptId) wall.value = (strategyRule?.wallOffsetMinor || 0) / 100;
        wall.parentElement.style.display = automatic && !sell ? "" : "none";
        document.getElementById(`${prefix}price-adjustment-text`).textContent = automatic && !sell ? "无墙调整" : sell ? "售价调整" : "买价调整";
        const toggle = document.getElementById(`${prefix}auto-pricing`);
        toggle.checked = automatic;
        for (const input of [source, adjustment, wall, toggle]) input.parentElement.classList.toggle("stch-auto-pricing-active", automatic);
      }
    };
    for (const [pricePrefix, prefix] of controls) {
      document.getElementById(`${pricePrefix}price-source`).addEventListener("change", event => {
        const automatic = state.cfg[enabledKey];
        state.cfg[automatic ? strategyKey : sourceKey] = event.currentTarget.value;
        if (automatic) resetDraft(sell);
        render();
        saveConfig(state.cfg);
        refresh();
      });
      for (const wall of [false, true]) {
        const input = document.getElementById(`${prefix}price-${wall ? "wall-" : ""}adjustment`);
        const sync = normalize => {
          const value = parseFloat(input.value) || 0;
          const automatic = state.cfg[enabledKey];
          if (automatic) state[draftKey(sell)][wall ? "wallOffsetMinor" : "noWallOffsetMinor"] = Math.round(value * 100);
          else if (!wall) state.cfg[adjustmentKey] = value;
          render(normalize ? "" : input.id);
          if (!automatic && !wall) saveConfig(state.cfg);
          refresh();
        };
        input.addEventListener("input", () => sync(false));
        input.addEventListener("change", () => sync(true));
      }
      document.getElementById(`${prefix}auto-pricing`).addEventListener("change", event => {
        state.cfg[enabledKey] = event.currentTarget.checked;
        if (state.cfg[enabledKey]) resetDraft(sell);
        render();
        saveConfig(state.cfg);
        refresh();
      });
    }
    render();
  });
}
