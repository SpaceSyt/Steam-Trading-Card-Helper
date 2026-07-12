  export const CONFIG_STORAGE_KEY = "stch_config";

  export const CONFIG_SCHEMA_VERSION = 19;

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
    earlyPricePrediction: true,
    earlyPredictionAutoBlacklist: false,
    craftInterval: 500,
    craftMode: "step",
    seasonalTargetLevel: 40,
    seasonalInterval: 200,
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
    merged.configVersion = CONFIG_SCHEMA_VERSION;
    return merged;
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
