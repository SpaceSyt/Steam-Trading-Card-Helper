  export function isFoilBadge(value) {
    return typeof value === "boolean" ? value : !!value?.isFoil;
  }

  export function getBadgeTargetLevel(value) {
    return isFoilBadge(value) ? 1 : 5;
  }

  export function getBadgeUrlSuffix(value) {
    return isFoilBadge(value) ? "?border=1" : "";
  }

  export function getBadgeModeLabel(value) {
    return isFoilBadge(value) ? "闪卡" : "普通卡";
  }
