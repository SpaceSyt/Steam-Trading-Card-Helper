  export const CONFIG_STORAGE_KEY = "stch_config";

  export const CONFIG_SCHEMA_VERSION = 25;

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
      anchorKey: "automaticAggressiveWallAnchor",
      wallOffsetKey: "automaticAggressiveWallOffset",
      noWallOffsetKey: "automaticAggressiveNoWallOffset",
    }),
  });

  export const DEFAULT_CONFIG = {
    configVersion: CONFIG_SCHEMA_VERSION,
    currencyId: 23,
    threshold: 5,
    requestInterval: 330,
    batchSize: 20,
    batchPause: 53000,
    showNoResultLogs: false,
    showAdvancedSettings: false,
    sidebarDisabled: false,
    includeDrops: false,
    foilScanMode: false,
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
    automaticPriceAdjustment: 0,
    automaticConservativeWallAnchor: "bottom",
    automaticConservativeWallOffset: 0,
    automaticConservativeNoWallOffset: -0.02,
    automaticBalancedWallAnchor: "top",
    automaticBalancedWallOffset: 0,
    automaticBalancedNoWallOffset: -0.01,
    automaticAggressiveWallAnchor: "top",
    automaticAggressiveWallOffset: 0.01,
    automaticAggressiveNoWallOffset: 0.01,
    minimumPriceFallback: true,
    earlyPricePrediction: true,
    earlyPredictionAutoBlacklist: false,
    craftInterval: 500,
    craftMode: "step",
    surplusOnlyTradable: false,
    surplusOnlyRecommended: true,
    surplusItemMode: "card",
    surplusSellPriceSource: "lowest",
    surplusSellPriceAdjustment: 0,
    grindIncludeSurplusCards: true,
    grindReserveCopies: 1,
    grindIncludePointsShopItems: false,
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
    merged.showAdvancedSettings = merged.showAdvancedSettings === true;
    merged.sidebarDisabled = merged.sidebarDisabled === true;
    merged.minimumPriceFallback = minimumPriceFallback;
    merged.surplusOnlyRecommended = legacyOnlyRecommended;
    const blacklistExpiryDays = Number(merged.blacklistExpiryDays);
    merged.blacklistExpiryDays = Number.isFinite(blacklistExpiryDays)
      ? Math.max(1, Math.floor(blacklistExpiryDays))
      : defaults.blacklistExpiryDays;
    merged.automaticPriceStrategy = ["conservative", "balanced", "aggressive"]
      .includes(merged.automaticPriceStrategy)
      ? merged.automaticPriceStrategy
      : defaults.automaticPriceStrategy;
    for (const key of [
      "priceAdjustment",
      "automaticPriceAdjustment",
      ...Object.values(AUTOMATIC_PRICE_STRATEGY_CONFIG).flatMap(rule => [
        rule.wallOffsetKey,
        rule.noWallOffsetKey,
      ]),
    ]) {
      const value = Number(merged[key]);
      merged[key] = Number.isFinite(value) ? value : defaults[key];
    }
    for (const rule of Object.values(AUTOMATIC_PRICE_STRATEGY_CONFIG)) {
      merged[rule.anchorKey] = ["top", "bottom"].includes(merged[rule.anchorKey])
        ? merged[rule.anchorKey]
        : defaults[rule.anchorKey];
    }
    merged.configVersion = CONFIG_SCHEMA_VERSION;
    return merged;
  }

  export function getActiveOrderPricingProfile(cfg = DEFAULT_CONFIG) {
    if (cfg?.automaticPricingEnabled) {
      return {
        automatic: true,
        priceSource: ["conservative", "balanced", "aggressive"]
          .includes(cfg.automaticPriceStrategy)
          ? cfg.automaticPriceStrategy
          : DEFAULT_CONFIG.automaticPriceStrategy,
        adjustment: Number.isFinite(Number(cfg.automaticPriceAdjustment))
          ? Number(cfg.automaticPriceAdjustment)
          : DEFAULT_CONFIG.automaticPriceAdjustment,
        strategyRule: getAutomaticPriceStrategyRule(cfg, cfg.automaticPriceStrategy),
      };
    }
    return {
      automatic: false,
      priceSource: ["lowest", "median", "highest"].includes(cfg?.orderPriceSource)
        ? cfg.orderPriceSource
        : DEFAULT_CONFIG.orderPriceSource,
      adjustment: Number.isFinite(Number(cfg?.priceAdjustment))
        ? Number(cfg.priceAdjustment)
        : DEFAULT_CONFIG.priceAdjustment,
    };
  }

  export function getAutomaticPriceStrategyRule(cfg = DEFAULT_CONFIG, strategy = "balanced") {
    const normalizedStrategy = Object.hasOwn(AUTOMATIC_PRICE_STRATEGY_CONFIG, strategy)
      ? strategy
      : "balanced";
    const fields = AUTOMATIC_PRICE_STRATEGY_CONFIG[normalizedStrategy];
    const anchor = ["top", "bottom"].includes(cfg?.[fields.anchorKey])
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
    const defaults = { ...DEFAULT_CONFIG };
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
