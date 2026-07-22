import { getSteamId, getProfileUrl, parseSteamIdFromText, parseSteamIdFromProfileUrl } from "../utils/steam.js";

import { stchRequestText } from "../request/http.js";

import { getFirstText, getFirstImageUrl, getFirstAttr, normalizeSteamAvatarUrl } from "../utils/dom.js";

import { parseIntLoose } from "../utils/format.js";

import { xpRequiredForLevel, xpStepForLevel } from "./../utils/xp.js";

  export async function resolveSidebarSteamId(profileUrl, badgeHtml) {
    const known = getSteamId()
      || parseSteamIdFromText(badgeHtml)
      || parseSteamIdFromProfileUrl(profileUrl);
    if (known) return known;

    if (!profileUrl) return "";
    try {
      const xml = await stchRequestText(`${profileUrl}/?xml=1`);
      const match = xml.match(/<steamID64>(\d{17})<\/steamID64>/);
      return match ? match[1] : "";
    } catch (_) {
      return "";
    }
  }

  export function parseSidebarProfileInfo(doc, html, profileUrl, steamId) {
    const bodyText = (doc.body?.innerText || doc.body?.textContent || "").replace(/\u00a0/g, " ");
    const rawName = getFirstText(doc, [
      ".profile_small_header_name > a",
      ".profile_small_header_name",
      ".profile_header .persona_name .actual_persona_name",
      ".profile_header .persona_name_text_content",
      ".actual_persona_name",
      "#global_actions .persona",
    ]) || getFirstText(document, ["#global_actions .persona"]);
    const name = rawName.replace(/\s*».*$/, "").trim();
    const avatarSelectors = [
      ".profile_small_header_avatar > .playerAvatar > picture img",
      ".profile_small_header_avatar > .playerAvatar > img",
      ".profile_header .playerAvatar > picture img",
      ".profile_header .playerAvatar > img",
      ".playerAvatarAutoSizeInner > img",
      "#global_actions a.user_avatar > img",
    ];
    const avatar = getFirstImageUrl(doc, avatarSelectors)
      || getFirstImageUrl(document, avatarSelectors)
      || normalizeSteamAvatarUrl(getFirstAttr(doc, [
        "meta[property='og:image']",
        "meta[name='twitter:image']",
        "link[rel='image_src']",
      ], "content") || getFirstAttr(doc, ["link[rel='image_src']"], "href"));

    const level = parseIntLoose(getFirstText(doc, [
      ".profile_xp_block .friendPlayerLevelNum",
      ".friendPlayerLevelNum",
    ]));

    const xpMatches = [...bodyText.matchAll(/([\d,，]+)\s*(?:点经验值|XP)/gi)]
      .map(match => parseIntLoose(match[1]))
      .filter(Boolean);
    const totalXp = xpMatches.length > 0 ? Math.max(...xpMatches) : 0;
    let nextLevel = level ? level + 1 : 0;
    let remainingXp = 0;
    const zhNextMatch = bodyText.match(/升到\s*(\d+)\s*级还需\s*([\d,，]+)\s*点经验值/i);
    const enNextMatch = bodyText.match(/([\d,，]+)\s*XP\s*(?:needed|required).*?Level\s*(\d+)/i);
    if (zhNextMatch) {
      nextLevel = parseIntLoose(zhNextMatch[1]) || nextLevel;
      remainingXp = parseIntLoose(zhNextMatch[2]);
    } else if (enNextMatch) {
      remainingXp = parseIntLoose(enNextMatch[1]);
      nextLevel = parseIntLoose(enNextMatch[2]) || nextLevel;
    } else if (level && totalXp) {
      remainingXp = Math.max(0, xpRequiredForLevel(level + 1) - totalXp);
    }
    const stepXp = level ? xpStepForLevel(level) : 0;
    const earnedThisLevel = stepXp ? Math.max(0, stepXp - remainingXp) : 0;

    return {
      avatar,
      name: name || "Steam 用户",
      level,
      totalXp,
      nextLevel,
      remainingXp,
      stepXp,
      earnedThisLevel,
      profileUrl,
      steamId,
      html,
    };
  }

  export async function loadSidebarProfileInfo() {
    const profileUrl = getProfileUrl();
    if (!profileUrl) throw new Error("未找到个人资料地址");

    let html = "";
    if (location.hostname === "steamcommunity.com" && location.pathname.includes("/badges")) {
      html = document.documentElement.outerHTML;
    } else {
      html = await stchRequestText(`${profileUrl}/badges/`);
    }
    const steamId = await resolveSidebarSteamId(profileUrl, html);
    const doc = new DOMParser().parseFromString(html, "text/html");
    return parseSidebarProfileInfo(doc, html, profileUrl, steamId);
  }
