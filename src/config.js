  export const CONFIG_STORAGE_KEY = "stch_config";

  export const CONFIG_SCHEMA_VERSION = 21;

  export const DEFAULT_CONFIG = {
    configVersion: CONFIG_SCHEMA_VERSION,
    currencyId: 23,
    threshold: 5,
    requestInterval: 330,
    batchSize: 20,
    batchPause: 53000,
    showNoResultLogs: false,
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
    autoBlackThreshold: 10,
    autoBlackEnabled: false,
    buyMode: "complete5",
    orderPriceSource: "lowest",
    priceAdjustment: 0,
    automaticPricingEnabled: false,
    automaticPriceStrategy: "balanced",
    automaticPriceAdjustment: 0,
    earlyPricePrediction: true,
    earlyPredictionAutoBlacklist: false,
    craftInterval: 500,
    craftMode: "step",
    surplusOnlyMaxed: false,
    surplusOnlyTradable: false,
    surplusCompareGems: false,
    surplusItemMode: "card",
    surplusSellPriceSource: "lowest",
    surplusSellPriceAdjustment: 0,
    grindOnlyRecommended: true,
    grindIncludeSurplusCards: true,
    grindReserveCopies: 1,
    grindIncludePointsShopItems: false,
  };

  export function normalizeConfig(saved) {
    const defaults = { ...DEFAULT_CONFIG };
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
      return defaults;
    }

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
    merged.automaticPriceStrategy = ["conservative", "balanced", "aggressive"]
      .includes(merged.automaticPriceStrategy)
      ? merged.automaticPriceStrategy
      : defaults.automaticPriceStrategy;
    for (const key of ["priceAdjustment", "automaticPriceAdjustment"]) {
      const value = Number(merged[key]);
      merged[key] = Number.isFinite(value) ? value : defaults[key];
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
