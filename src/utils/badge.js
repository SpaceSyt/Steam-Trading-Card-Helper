  export function isFoilBadge(value) {
    return typeof value === "boolean" ? value : !!value?.isFoil;
  }

  export function getBadgeTargetLevel(value) {
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
