  import { DEFAULT_TAB_ORDER } from "./constants.js";
  import { normalizeTabColors, normalizeTabOrder } from "./services/tab-preferences.js";
  import { normalizeProcessingMode } from "./services/processing-mode.js";

  export const CONFIG_STORAGE_KEY = "stch_config";

  export const CONFIG_SCHEMA_VERSION = 35;

  export const AUTOMATIC_PRICE_STRATEGY_CONFIG = Object.freeze({
    conservative: Object.freeze({
      anchorKey: "automaticConservativeWallAnchor",
      wallOffsetKey: "automaticConservativeWallOffset",
      noWallOffsetKey: "automaticConservativeNoWallOffset",
    }),
    balanced: Object.freeze({
      anchorKey: "automaticBalancedWallAnchor",
      wallOffsetKey: "automaticBalancedWallOffset",
      noWallOffsetKey: "automaticBalancedNoWallOffset",
    }),
    aggressive: Object.freeze({
      wallOffsetKey: "automaticAggressiveWallOffset",
      noWallOffsetKey: "automaticAggressiveNoWallOffset",
    }),
  });

  export const SELL_AUTOMATIC_PRICE_STRATEGY_CONFIG = Object.freeze({
    instant: { wallOffsetKey: "sellInstantOffset", noWallOffsetKey: "sellInstantOffset" },
    follow: { wallOffsetKey: "sellFollowOffset", noWallOffsetKey: "sellFollowOffset" },
    conservative: { anchorKey: "sellConservativeAnchor", wallOffsetKey: "sellConservativeOffset", noWallOffsetKey: "sellConservativeOffset" },
  });
  function strategyConfig(sell) {
    return sell ? SELL_AUTOMATIC_PRICE_STRATEGY_CONFIG : AUTOMATIC_PRICE_STRATEGY_CONFIG;
  }
  function normalizeStrategy(strategy, sell) {
    return Object.hasOwn(strategyConfig(sell), strategy) ? strategy : sell ? "follow" : "balanced";
  }
  const ALL_AUTOMATIC_STRATEGY_FIELDS = [
    ...Object.values(AUTOMATIC_PRICE_STRATEGY_CONFIG),
    ...Object.values(SELL_AUTOMATIC_PRICE_STRATEGY_CONFIG),
  ];

  export const DEFAULT_CONFIG = {
    configVersion: CONFIG_SCHEMA_VERSION,
    currencyId: 23,
    threshold: 5,
    requestInterval: 330,
    showNoResultLogs: false,
    showAdvancedSettings: false,
    sidebarDisabled: false,
    includeDrops: false,
    foilScanMode: false,
    showScanCompletionColumn: true,
    showScanSellSetColumn: true,
    orderCacheDays: 3,
    skipCachedOrderResults: false,
    maxBadgePages: 1,
    blacklist: "",
    blacklistNames: "{}",
    blacklistSources: "{}",
    blacklistDates: "{}",
    blacklistFixed: "{}",
    blacklistPriceData: "{}",
    blacklistExpiryDays: 7,
    autoBlackThreshold: 10,
    autoBlackEnabled: false,
    buyMode: "complete5",
    orderPriceSource: "lowest",
    priceAdjustment: 0,
    automaticPricingEnabled: false,
    automaticPriceStrategy: "balanced",
    automaticConservativeWallAnchor: "bottom",
    automaticConservativeWallOffset: 0,
    automaticConservativeNoWallOffset: -0.02,
    automaticBalancedWallAnchor: "top",
    automaticBalancedWallOffset: 0,
    automaticBalancedNoWallOffset: -0.01,
    automaticAggressiveWallOffset: 0.01,
    automaticAggressiveNoWallOffset: 0.01,
    parallelOrderPricingEnabled: false,
    parallelOrderPricingConcurrency: 4,
    parallelOtherRequestsEnabled: true,
    parallelOtherRequestsConcurrency: 8,
    minimumPriceFallback: true,
    earlyPricePrediction: true,
    earlyPredictionAutoBlacklist: false,
    craftInterval: 500,
    craftMode: "step",
    surplusOnlyTradable: false,
    surplusOnlyRecommended: true,
    surplusItemMode: "card",
    surplusIncludeFoil: false,
    surplusKeepMaxLevelCards: true,
    surplusSellPriceSource: "lowest",
    surplusSellPriceAdjustment: 0,
    sellAutomaticPricingEnabled: false,
    sellAutomaticPriceStrategy: "follow",
    sellInstantOffset: 0,
    sellFollowOffset: -0.01,
    sellConservativeAnchor: "bottom",
    sellConservativeOffset: 0,
    grindReserveCopies: 1,
    grindIncludePointsShopItems: false,
    tabOrder: [...DEFAULT_TAB_ORDER],
    tabColors: {},
  };

  export function normalizeConfig(saved) {
    const defaults = { ...DEFAULT_CONFIG };
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
      return defaults;
    }

    const legacyOnlyRecommended = typeof saved.surplusOnlyRecommended === "boolean"
      ? saved.surplusOnlyRecommended
      : typeof saved.grindOnlyRecommended === "boolean"
        ? saved.grindOnlyRecommended
        : defaults.surplusOnlyRecommended;
    const minimumPriceFallback = typeof saved.minimumPriceFallback === "boolean"
      ? saved.minimumPriceFallback
      : typeof saved.noBuyOrderMinimumFallback === "boolean"
        ? saved.noBuyOrderMinimumFallback
        : defaults.minimumPriceFallback;
    const merged = { ...defaults, ...saved };
    // Drop keys that no longer exist in defaults (renamed/removed fields).
    for (const key of Object.keys(merged)) {
      if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
        delete merged[key];
      }
    }

    const currencyId = Number(merged.currencyId);
    merged.currencyId = Number.isInteger(currencyId) && currencyId > 0
      ? currencyId
      : defaults.currencyId;
    merged.automaticPricingEnabled = merged.automaticPricingEnabled === true;
    merged.sellAutomaticPricingEnabled = merged.sellAutomaticPricingEnabled === true;
    merged.parallelOrderPricingEnabled = merged.parallelOrderPricingEnabled === true;
    merged.parallelOtherRequestsEnabled = merged.parallelOtherRequestsEnabled !== false;
    merged.showAdvancedSettings = merged.showAdvancedSettings === true;
    merged.sidebarDisabled = merged.sidebarDisabled === true;
    merged.showScanCompletionColumn = merged.showScanCompletionColumn !== false;
    merged.showScanSellSetColumn = merged.showScanSellSetColumn !== false;
    merged.minimumPriceFallback = minimumPriceFallback;
    merged.surplusOnlyRecommended = legacyOnlyRecommended;
    merged.surplusItemMode = normalizeProcessingMode(merged.surplusItemMode);
    merged.surplusIncludeFoil = merged.surplusIncludeFoil === true;
    merged.surplusKeepMaxLevelCards = merged.surplusKeepMaxLevelCards !== false;
    merged.tabOrder = normalizeTabOrder(merged.tabOrder);
    merged.tabColors = normalizeTabColors(merged.tabColors);
    const blacklistExpiryDays = Number(merged.blacklistExpiryDays);
    merged.blacklistExpiryDays = Number.isFinite(blacklistExpiryDays)
      ? Math.max(1, Math.floor(blacklistExpiryDays))
      : defaults.blacklistExpiryDays;
    const parallelOrderPricingConcurrency = Number(merged.parallelOrderPricingConcurrency);
    merged.parallelOrderPricingConcurrency = Number.isFinite(parallelOrderPricingConcurrency)
      ? Math.min(20, Math.max(1, Math.floor(parallelOrderPricingConcurrency)))
      : defaults.parallelOrderPricingConcurrency;
    const parallelOtherRequestsConcurrency = Number(merged.parallelOtherRequestsConcurrency);
    merged.parallelOtherRequestsConcurrency = Number.isFinite(parallelOtherRequestsConcurrency)
      ? Math.min(20, Math.max(1, Math.floor(parallelOtherRequestsConcurrency)))
      : defaults.parallelOtherRequestsConcurrency;
    for (const key of ["automaticPriceStrategy", "sellAutomaticPriceStrategy"]) {
      merged[key] = normalizeStrategy(merged[key], key === "sellAutomaticPriceStrategy");
    }
    for (const key of [
      "priceAdjustment",
      "surplusSellPriceAdjustment",
      ...ALL_AUTOMATIC_STRATEGY_FIELDS.flatMap(rule => [
        rule.wallOffsetKey,
        rule.noWallOffsetKey,
      ]),
    ]) {
      const value = Number(merged[key]);
      merged[key] = Number.isFinite(value) ? value : defaults[key];
    }
    for (const rule of ALL_AUTOMATIC_STRATEGY_FIELDS) {
      if (!rule.anchorKey) continue;
      const anchors = rule.anchorKey === "sellConservativeAnchor" ? ["bottom", "previous"] : ["top", "bottom"];
      merged[rule.anchorKey] = anchors.includes(merged[rule.anchorKey])
        ? merged[rule.anchorKey]
        : defaults[rule.anchorKey];
    }
    merged.configVersion = CONFIG_SCHEMA_VERSION;
    return merged;
  }

  export function createAutomaticPricingDraft(cfg = DEFAULT_CONFIG, strategy = "balanced", sell = false) {
    const normalizedStrategy = normalizeStrategy(strategy, sell);
    return {
      strategy: normalizedStrategy,
      ...getAutomaticPriceStrategyRule(cfg, normalizedStrategy, sell),
    };
  }

  export function getActiveOrderPricingProfile(cfg = DEFAULT_CONFIG, automaticDraft = null, sell = false) {
    const enabledKey = sell ? "sellAutomaticPricingEnabled" : "automaticPricingEnabled";
    const strategyKey = sell ? "sellAutomaticPriceStrategy" : "automaticPriceStrategy";
    const sourceKey = sell ? "surplusSellPriceSource" : "orderPriceSource";
    const adjustmentKey = sell ? "surplusSellPriceAdjustment" : "priceAdjustment";
    if (cfg?.[enabledKey]) {
      const priceSource = normalizeStrategy(cfg[strategyKey], sell);
      const draftRule = automaticDraft?.strategy === priceSource
        ? automaticDraft
        : null;
      return {
        automatic: true,
        priceSource,
        adjustment: 0,
        strategyRule: draftRule
          ? {
            wallAnchor: draftRule.wallAnchor,
            wallOffsetMinor: draftRule.wallOffsetMinor,
            noWallOffsetMinor: draftRule.noWallOffsetMinor,
          }
          : getAutomaticPriceStrategyRule(cfg, priceSource, sell),
      };
    }
    return {
      automatic: false,
      priceSource: ["lowest", "median", "highest"].includes(cfg?.[sourceKey])
        ? cfg[sourceKey]
        : DEFAULT_CONFIG[sourceKey],
      adjustment: Number.isFinite(Number(cfg?.[adjustmentKey]))
        ? Number(cfg[adjustmentKey])
        : DEFAULT_CONFIG[adjustmentKey],
    };
  }

  export function getAutomaticPriceStrategyRule(cfg = DEFAULT_CONFIG, strategy = "balanced", sell = false) {
    const normalizedStrategy = normalizeStrategy(strategy, sell);
    const fields = strategyConfig(sell)[normalizedStrategy];
    const anchor = (sell ? ["bottom", "previous"] : ["top", "bottom"]).includes(cfg?.[fields.anchorKey])
      ? cfg[fields.anchorKey]
      : DEFAULT_CONFIG[fields.anchorKey];
    const toMinor = key => {
      const value = Number(cfg?.[key]);
      const fallback = Number(DEFAULT_CONFIG[key]) || 0;
      return Math.round((Number.isFinite(value) ? value : fallback) * 100);
    };
    return {
      wallAnchor: anchor,
      wallOffsetMinor: toMinor(fields.wallOffsetKey),
      noWallOffsetMinor: toMinor(fields.noWallOffsetKey),
    };
  }

  export function loadConfig() {
    const defaults = {
      ...DEFAULT_CONFIG,
      tabOrder: [...DEFAULT_TAB_ORDER],
      tabColors: {},
    };
    try {
      const raw = GM_getValue(CONFIG_STORAGE_KEY, null);
      if (raw) {
        const saved = typeof raw === "string" ? JSON.parse(raw) : raw;
        const merged = normalizeConfig(saved);
        if (JSON.stringify(saved) !== JSON.stringify(merged)) {
          saveConfig(merged);
        }
        return merged;
      }
    } catch (e) {
      console.warn("[STCH] Config load failed:", e);
    }
    return defaults;
  }

  export function saveConfig(cfg) {
    const normalized = normalizeConfig(cfg);
    for (const key of Object.keys(cfg || {})) {
      if (!Object.prototype.hasOwnProperty.call(normalized, key)) delete cfg[key];
    }
    Object.assign(cfg, normalized);
    GM_setValue(CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  }
