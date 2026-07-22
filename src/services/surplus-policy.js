import { getBadgeTargetLevel } from "../utils/badge.js";

export function getSurplusReservePolicy(info) {
  const targetLevel = getBadgeTargetLevel(info);
  const level = Math.max(0, Number(info?.level) || 0);
  if (info?.isUnlimitedLevelBadge) {
    return {
      targetLevel,
      level,
      eligible: true,
      badgeMaxed: level >= 1,
      reservePerCard: level >= 1 ? 0 : 1,
    };
  }
  return {
    targetLevel,
    level,
    eligible: true,
    badgeMaxed: level >= targetLevel,
    reservePerCard: Math.max(0, targetLevel - level),
  };
}
