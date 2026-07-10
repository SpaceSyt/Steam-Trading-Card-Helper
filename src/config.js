  export const DEFAULT_CONFIG = {
    configVersion: 15,
    threshold: 5,
    scanInterval: 0,
    requestInterval: 330,
    batchSize: 20,
    batchPause: 53000,
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
    craftInterval: 500,
    craftMode: "step",
    seasonalTargetLevel: 40,
    seasonalInterval: 200,
    surplusOnlyMaxed: false,
    surplusCompareGems: false,
    surplusItemMode: "card",
    surplusSellPriceSource: "lowest",
    surplusSellPriceAdjustment: 0,
    grindOnlyRecommended: true,
    grindIncludeSurplusCards: true,
  };

  export function loadConfig() {
    const defaults = { ...DEFAULT_CONFIG };
    const currentVersion = defaults.configVersion;
    try {
      const raw = GM_getValue("stch_config", null);
      if (raw) {
        const saved = JSON.parse(raw);
        const merged = { ...defaults, ...saved };
        // Drop keys that no longer exist in defaults (renamed/removed fields).
        let pruned = false;
        for (const key of Object.keys(merged)) {
          if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
            delete merged[key];
            pruned = true;
          }
        }
        const savedVersion = Number(saved?.configVersion) || 0;
        if (savedVersion < currentVersion) {
          merged.configVersion = currentVersion;
          saveConfig(merged);
        } else if (pruned) {
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
    GM_setValue("stch_config", JSON.stringify(cfg));
  }
