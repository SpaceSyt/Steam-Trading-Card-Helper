  export function isFoilBadge(value) {
    return typeof value === "boolean" ? value : !!value?.isFoil;
  }

  export function isUnlimitedLevelBadge(value) {
    if (!value || typeof value !== "object") return false;
    if (value.isUnlimitedLevelBadge) return true;
    const text = [
      value.appid,
      value.gameName,
      value.badgeName,
      value.metaDescription,
    ].filter(Boolean).join(" ");
    return /(?:summer|winter|spring|autumn|fall)\s+sale|steam\s+(?:sale|awards)|(?:夏季|夏日|冬季|秋季|春季|农历新年|春节).{0,8}(?:特卖|促销|徽章)|(?:特卖|促销).{0,8}徽章/i.test(text);
  }

  export function getBadgeTargetLevel(value) {
    if (!isFoilBadge(value) && isUnlimitedLevelBadge(value)) {
      return Math.max(0, Number(value.level) || 0) + 5;
    }
    return isFoilBadge(value) ? 1 : 5;
  }

  export function getBadgeUrlSuffix(value, options = {}) {
    const params = new URLSearchParams();
    if (isFoilBadge(value)) params.set("border", "1");
    if (options.language) params.set("l", options.language);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  export function getGameCardsUrl(profileUrl, appid, value, options = {}) {
    const base = String(profileUrl || "").replace(/\/+$/, "");
    return `${base}/gamecards/${appid}/${getBadgeUrlSuffix(value, options)}`;
  }

  export function getBadgeModeLabel(value) {
    return isFoilBadge(value) ? "闪卡" : "普通卡";
  }
