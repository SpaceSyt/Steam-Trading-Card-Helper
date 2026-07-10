import { decodeHtmlEntities } from "../utils/format.js";

import { SIDEBAR_GEM_SACK_HASH } from "../constants.js";

  export function isGemSackDescription(description) {
    const hash = String(description?.market_hash_name || "").trim();
    const name = String(description?.name || "").trim();
    return hash === SIDEBAR_GEM_SACK_HASH
      || /sack of gems/i.test(name)
      || /宝石袋|袋装宝石/.test(name);
  }

  export function isLooseGemDescription(description) {
    const hash = String(description?.market_hash_name || "").trim();
    const name = String(description?.name || "").trim();
    const type = String(description?.type || "").trim();
    if (isGemSackDescription(description)) return false;
    return hash === "Gems"
      || /^gems$/i.test(name)
      || /^宝石$/.test(name)
      || /steam gems?/i.test(type)
      || /^宝石$/.test(type);
  }

  export function getDescriptionKey(item) {
    return `${item?.classid || ""}_${item?.instanceid || ""}`;
  }

  export function getDescriptionTags(description) {
    return Array.isArray(description?.tags) ? description.tags : [];
  }

  export function findDescriptionTag(description, category, internalName = null) {
    return getDescriptionTags(description).find(tag => {
      if (String(tag?.category || "") !== category) return false;
      return internalName == null || String(tag?.internal_name || "") === internalName;
    }) || null;
  }

  export function getDescriptionImageUrl(description, size = "96fx96f") {
    const rawIcon = String(description?.icon_url_large || description?.icon_url || "").trim();
    if (!rawIcon) return "";
    if (/^https?:\/\//i.test(rawIcon)) return rawIcon;
    const suffix = size ? `/${size}` : "";
    return `https://community.fastly.steamstatic.com/economy/image/${rawIcon}${suffix}`;
  }

  export function getDescriptionColor(description, field) {
    const value = String(description?.[field] || "").trim();
    return /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : "";
  }

  export function isTradingCardDescription(description) {
    return !!findDescriptionTag(description, "item_class", "item_class_2");
  }

  export function isProfileBackgroundDescription(description) {
    return !!findDescriptionTag(description, "item_class", "item_class_3");
  }

  export function isEmoticonDescription(description) {
    return !!findDescriptionTag(description, "item_class", "item_class_4");
  }

  export function getCommunityItemCategory(description) {
    if (isTradingCardDescription(description)) return "card";
    if (isProfileBackgroundDescription(description)) return "background";
    if (isEmoticonDescription(description)) return "emoticon";
    return "other";
  }

  export function getCardGameAppid(description) {
    const feeApp = String(description?.market_fee_app || "").trim();
    if (/^\d+$/.test(feeApp)) return feeApp;
    const gameTag = findDescriptionTag(description, "Game");
    const match = String(gameTag?.internal_name || "").match(/^app_(\d+)$/);
    return match ? match[1] : "";
  }

  export function getCardGameName(description) {
    const gameTag = findDescriptionTag(description, "Game");
    return String(gameTag?.localized_tag_name || "").trim();
  }

  export function isFoilCardDescription(description) {
    return !!findDescriptionTag(description, "cardborder", "cardborder_1");
  }

  export function normalizeCardName(name) {
    return String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  export function getAssetAmount(asset) {
    return Math.max(1, parseInt(asset?.amount, 10) || 1);
  }

  export function addInventoryCard(groupMap, asset, description) {
    if (!description || !isTradingCardDescription(description)) return false;
    const marketHashName = String(description.market_hash_name || "").trim();
    const appid = getCardGameAppid(description);
    if (!marketHashName || !appid) return false;

    const isFoil = isFoilCardDescription(description);
    const badgeKey = `${appid}_${isFoil ? 1 : 0}`;
    let group = groupMap.get(badgeKey);
    if (!group) {
      group = {
        appid,
        isFoil,
        gameName: getCardGameName(description),
        cardsByHash: new Map(),
        cardsByName: new Map(),
        totalCount: 0,
      };
      groupMap.set(badgeKey, group);
    }
    if (!group.gameName) group.gameName = getCardGameName(description);

    const gemValue = parseGemValueFromDescription(description);
    let card = group.cardsByHash.get(marketHashName);
    if (!card) {
      card = {
        appid,
        isFoil,
        gameName: group.gameName,
        name: String(description.name || marketHashName).trim(),
        marketHashName,
        imageUrl: getDescriptionImageUrl(description),
        nameColor: getDescriptionColor(description, "name_color"),
        backgroundColor: getDescriptionColor(description, "background_color"),
        gemValue,
        totalCount: 0,
        assets: [],
      };
      group.cardsByHash.set(marketHashName, card);
      const nameKey = normalizeCardName(card.name);
      if (nameKey && !group.cardsByName.has(nameKey)) {
        group.cardsByName.set(nameKey, card);
      }
    } else if (!card.gemValue && gemValue) {
      card.gemValue = gemValue;
    }

    const amount = getAssetAmount(asset);
    card.totalCount += amount;
    group.totalCount += amount;
    card.assets.push({
      assetid: String(asset.assetid || ""),
      contextid: String(asset.contextid || "6"),
      classid: String(asset.classid || ""),
      instanceid: String(asset.instanceid || ""),
      amount,
      gemValue,
      marketable: Number(description.marketable) === 1,
      tradable: Number(description.tradable) === 1,
    });
    return true;
  }

  export function findInventoryCardForBadgeCard(group, badgeCard) {
    if (badgeCard.marketHashName && group.cardsByHash.has(badgeCard.marketHashName)) {
      return group.cardsByHash.get(badgeCard.marketHashName);
    }
    const nameKey = normalizeCardName(badgeCard.name);
    return nameKey ? group.cardsByName.get(nameKey) || null : null;
  }

  export function selectSurplusAssets(assets, surplusCount) {
    const sorted = [...assets].sort((left, right) => {
      const marketCompare = Number(right.marketable) - Number(left.marketable);
      if (marketCompare) return marketCompare;
      const tradeCompare = Number(right.tradable) - Number(left.tradable);
      if (tradeCompare) return tradeCompare;
      return String(left.assetid).localeCompare(String(right.assetid), "en");
    });
    const selected = [];
    let remaining = surplusCount;
    for (const asset of sorted) {
      if (remaining <= 0) break;
      const amount = Math.min(asset.amount, remaining);
      selected.push({ ...asset, selectedAmount: amount });
      remaining -= amount;
    }
    return selected;
  }

  export function summarizeAssetIds(assets) {
    const ids = assets.map(asset =>
      asset.selectedAmount > 1
        ? `${asset.assetid}x${asset.selectedAmount}`
        : asset.assetid
    );
    const visible = ids.slice(0, 3).join(", ");
    return {
      text: ids.length > 3 ? `${visible} ...` : visible,
      title: ids.join("\n"),
    };
  }

  export function normalizeInventoryText(value) {
    const div = document.createElement("div");
    div.innerHTML = String(value ?? "").replace(/<br\s*\/?>/gi, " ");
    return decodeHtmlEntities(div.textContent || div.innerText || String(value || ""))
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  export function parseGemValueFromText(text) {
    const normalized = normalizeInventoryText(text).replace(/[，,]/g, "");
    if (!normalized) return 0;
    const direct = normalized.match(
      /(?:turn(?:ed)?\s+into|convert(?:ed)?\s+into|worth|可分解为|可转换为|可转化为|转换为|转化为|分解为|分解成)[^\d]{0,40}(\d+)\s*(?:gems?|宝石)/i
    );
    const fallback = direct || normalized.match(/(\d+)\s*(?:gems?|宝石)/i);
    return fallback ? Math.max(0, parseInt(fallback[1], 10) || 0) : 0;
  }

  export function parseGemValueFromDescription(description) {
    const values = [];
    ["owner_descriptions", "descriptions", "owner_actions", "actions"].forEach(key => {
      const list = Array.isArray(description?.[key]) ? description[key] : [];
      list.forEach(item => {
        values.push(item?.value, item?.name, item?.link);
      });
    });
    return values.reduce((best, value) => {
      if (value == null) return best;
      return Math.max(best, parseGemValueFromText(value));
    }, 0);
  }

  export function parseGooValueParams(description) {
    const links = [];
    ["owner_actions", "actions"].forEach(key => {
      const list = Array.isArray(description?.[key]) ? description[key] : [];
      list.forEach(item => {
        if (item?.link) links.push(String(item.link));
      });
    });
    for (const link of links) {
      const match = link.match(/GetGooValue\s*\(([^)]*)\)/i);
      if (!match) continue;
      const args = match[1]
        .split(",")
        .map(value => value.trim().replace(/^['"]|['"]$/g, ""));
      if (args.length < 5) continue;
      const appid = args[args.length - 3];
      const itemType = args[args.length - 2];
      const borderColor = args[args.length - 1];
      if (/^\d+$/.test(appid) && /^\d+$/.test(itemType) && /^\d+$/.test(borderColor)) {
        return { appid, itemType, borderColor };
      }
    }
    return null;
  }

  export function getCommunityItemType(description) {
    if (isTradingCardDescription(description)) {
      return isFoilCardDescription(description) ? "闪亮卡牌" : "卡牌";
    }
    const itemClass = findDescriptionTag(description, "item_class");
    return String(
      description?.type
      || itemClass?.localized_tag_name
      || "物品"
    ).replace(/\s+/g, " ").trim();
  }
