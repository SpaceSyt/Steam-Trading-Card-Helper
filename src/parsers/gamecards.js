import { getBadgeTargetLevel, isUnlimitedLevelBadge } from "../utils/badge.js";

function parseCardImageUrl(cardElement) {
  const image = cardElement?.querySelector("img.gamecard, .game_card_ctn img");
  const source = String(image?.getAttribute("src") || "").trim();
  if (/^https?:\/\//i.test(source)) return source;
  if (source.startsWith("//")) return `https:${source}`;

  const onclick = String(
    cardElement?.querySelector(".game_card_ctn")?.getAttribute("onclick") || ""
  );
  const match = onclick.match(/https?:\\?\/\\?\/[^"')\s]+/i);
  return match ? match[0].replace(/\\\//g, "/") : "";
}

  export function parseGameCardsHtml(html, appid, isFoil) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // game name from title
    let gameName = "";
    const titleEl = doc.querySelector(".badge_title");
    if (titleEl) {
      gameName = (titleEl.querySelector(".badge_title_row")?.textContent || titleEl.textContent)
        .replace(/(?:View badge progress|查看徽章进度|View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "")
        .replace(/\s*(?:徽章|Badge)\s*$/i, "")
        .trim();
    }

    // level from meta description: "徽章（0 级）" or "Badge (Level 0)"
    let level = 0;
    const metaDesc = doc.querySelector('meta[name="Description"]')?.content || "";
    const lm = metaDesc.match(/(?:徽章[（(](\d+)\s*级|Badge\s*\(Level\s*(\d+)\)|Level\s*(\d+)\b)/i);
    if (lm) level = parseInt(lm[1] || lm[2] || lm[3], 10);
    const isUnlimitedLevelBadgeValue = !isFoil && isUnlimitedLevelBadge({
      appid,
      gameName,
      level,
      metaDescription: metaDesc,
    });
    const targetLevel = getBadgeTargetLevel({
      isFoil,
      level,
      gameName,
      appid,
      metaDescription: metaDesc,
      isUnlimitedLevelBadge: isUnlimitedLevelBadgeValue,
    });

    // drops remaining
    let dropsRemaining = 0;
    const progressBold = doc.querySelector(".progress_info_bold");
    if (progressBold) {
      const txt = progressBold.textContent;
      const dm = txt.match(/(\d+)\s*card drops?\s*remaining/i) || txt.match(/(\d+)\s*张剩余卡牌掉落/);
      if (dm) dropsRemaining = parseInt(dm[1], 10);
    }

    // Parse card info from badge_card_set_card: name + owned count (IN ORDER)
    const cardSetCards = doc.querySelectorAll(".badge_card_set_card");
    const cardList = [];
    cardSetCards.forEach((el, idx) => {
      const titleNode = el.querySelector(".badge_card_set_title");
      if (!titleNode) return;
      const qtyNode = el.querySelector(".badge_card_set_text_qty");
      const owned = qtyNode ? (parseInt(qtyNode.textContent.replace(/[()（）\[\]]/g, ""), 10) || 0) : 0;
      let name = titleNode.textContent.trim();
      if (qtyNode) {
        name = name.replace(qtyNode.textContent, "").trim();
      }
      let marketHashName = "";
      const marketLink = el.querySelector('a[href*="/market/listings/"]');
      const href = marketLink?.getAttribute("href") || "";
      const marketMatch = href.match(/\/market\/listings\/\d+\/(.+?)(?:\?|#|$)/);
      if (marketMatch) {
        try { marketHashName = decodeURIComponent(marketMatch[1]); } catch (_) { marketHashName = marketMatch[1]; }
      }
      cardList.push({
        name,
        owned,
        marketHashName,
        imageUrl: parseCardImageUrl(el),
        idx,
      });
    });

    // Primary: match market hash names from multibuy URL (has ALL cards, IN ORDER)
    const multibuyBtn = doc.querySelector('a[href*="multibuy"]');
    if (multibuyBtn) {
      const mbHref = multibuyBtn.getAttribute("href") || "";
      let items = [];
      try {
        const mbUrl = new URL(mbHref, window.location.origin);
        items = mbUrl.searchParams.getAll("items[]");
      } catch (_) {
        const m = mbHref.match(/[?&]items\[\]=([^&]+)/g) || [];
        items = m.map(s => {
          try { return decodeURIComponent(s.replace(/[?&]items\[\]=/, "").replace(/&$/, "")); } catch (_) { return s; }
        });
      }
      for (let i = 0; i < Math.min(items.length, cardList.length); i++) {
        cardList[i].marketHashName = items[i];
      }
    }

    // Secondary: badge_card_to_collect links (fills any gaps)
    const toCollect = doc.querySelectorAll(".badge_card_to_collect");
    toCollect.forEach(tc => {
      const titleNode = tc.querySelector(".badge_card_set_title");
      const marketLink = tc.querySelector('a[href*="/market/listings/"]');
      if (!titleNode || !marketLink) return;
      const name = titleNode.textContent.trim();
      const href = marketLink.getAttribute("href") || "";
      const m = href.match(/\/market\/listings\/\d+\/(.+?)(?:\?|$)/);
      if (!m) return;
      let mhn = "";
      try { mhn = decodeURIComponent(m[1]); } catch (_) { mhn = m[1]; }
      // find card by name and fill if missing
      for (const card of cardList) {
        if (card.name === name && !card.marketHashName) {
          card.marketHashName = mhn;
          break;
        }
      }
    });

    cardList.forEach(card => {
      if (!card.marketHashName && appid && card.name) {
        card.marketHashName = `${appid}-${card.name}`;
      }
    });
    const totalInSet = cardList.length;
    if (totalInSet === 0) {
      return {
        gameName,
        level,
        isUnlimitedLevelBadge: isUnlimitedLevelBadgeValue,
        totalInSet: 0,
        dropsRemaining,
        cards: cardList,
        need: 0,
        setsToLevel5: 0,
        targetLevel,
      };
    }

    // single set calculation
    const cappedOwned = cardList.reduce((sum, c) => sum + Math.min(c.owned, 1), 0);
    const need = Math.max(0, totalInSet - cappedOwned);
    const setsToLevel5 = Math.max(0, targetLevel - level);

    return {
      gameName,
      level,
      isUnlimitedLevelBadge: isUnlimitedLevelBadgeValue,
      totalInSet,
      dropsRemaining,
      cards: cardList,
      need,
      setsToLevel5,
      targetLevel,
    };
  }

  export function parseCraftCandidatesHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const candidates = [];
    const seen = new Set();

    doc.querySelectorAll(".badge_row").forEach(row => {
      const craftLink = row.querySelector(
        ".badge_progress_info a.badge_craft_button[href*='/gamecards/']"
      );
      if (!craftLink) return;

      const href = craftLink.getAttribute("href") || "";
      const match = href.match(/\/gamecards\/(\d+)\/?/);
      if (!match) return;

      const appid = match[1];
      const isFoil = /[?&]border=1(?:&|$)/.test(href);
      const key = `${appid}_${isFoil ? 1 : 0}`;
      if (seen.has(key)) return;
      seen.add(key);

      const titleEl = row.querySelector(".badge_title");
      const gameName = (titleEl?.textContent || "")
        .replace(/(?:View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "")
        .trim();
      candidates.push({ appid, isFoil, gameName, href });
    });

    return candidates;
  }

  export function parseCraftableGameCardsHtml(html, candidate) {
    const info = parseGameCardsHtml(html, candidate.appid, candidate.isFoil);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const craftButton = doc.querySelector(
      ".gamecard_badge_craftbtn_ctn .badge_craft_button"
    );
    const multicraftButton = doc.querySelector(
      ".gamecard_badge_craftbtn_ctn .badge_craft_button.multicraft"
    );
    const multicraftOnclick = multicraftButton?.getAttribute("onclick") || "";
    const multicraftMatch = multicraftOnclick.match(
      /Profile_CraftGameBadge\([^)]*,\s*(\d+)\s*\)\s*;?\s*$/
    );
    const nativeMaxLevels = multicraftMatch
      ? Math.max(1, parseInt(multicraftMatch[1], 10) || 1)
      : craftButton
        ? 1
        : 0;
    const availableSets = info.cards.length > 0
      ? Math.min(...info.cards.map(card => Math.max(0, Number(card.owned) || 0)))
      : 0;
    const maxCraftable = info.isUnlimitedLevelBadge && nativeMaxLevels > 0
      ? availableSets
      : Math.min(availableSets, nativeMaxLevels);

    return {
      ...candidate,
      gameName: candidate.gameName || info.gameName || "",
      level: info.level,
      cards: info.cards,
      totalInSet: info.totalInSet,
      isUnlimitedLevelBadge: info.isUnlimitedLevelBadge,
      availableSets,
      nativeMaxLevels,
      maxCraftable,
      craftCount: maxCraftable,
      selected: maxCraftable > 0,
      status: maxCraftable > 0 ? "待合成" : "不可合成",
    };
  }
