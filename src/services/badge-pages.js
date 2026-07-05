import { getProfileUrl } from "../utils/steam.js";

  export async function scanBadgePages(cfg, onProgress, queue) {
    const profileUrl = getProfileUrl();
    if (!profileUrl) throw new Error("Profile URL not found");

    // detect current sort from URL, default to "p" (in progress)
    const curUrl = new URL(window.location.href);
    const curSort = curUrl.searchParams.get("sort") || "p";

    const candidates = [];
    const seen = new Set();
    const perPage = 150;
    const scanModeLabel = cfg.foilScanMode ? "闪卡" : "普通卡";

    for (let page = 1; page <= cfg.maxBadgePages; page++) {
      const rangeStart = (page - 1) * perPage + 1;
      const rangeEnd = page * perPage;
      onProgress?.(`正在扫描${scanModeLabel}候选徽章 ${rangeStart}-${rangeEnd} (页${page})...`);
      const url = `${profileUrl}/badges/?sort=${curSort}&p=${page}`;
      const res = await queue.fetch(url);
      if (!res || !res.text) {
        if (page === 1) throw new Error(`Failed to fetch badges: ${res?.status}`);
        break;
      }
      const doc = new DOMParser().parseFromString(res.text, "text/html");

      const rows = doc.querySelectorAll(".badge_row");
      const actualEnd = Math.min(rangeEnd, rangeStart + rows.length - 1);
      if (rows.length === 0) break;

      let pageCandidateCount = 0;

      for (const row of rows) {
        const overlay = row.querySelector(".badge_row_overlay");
        if (!overlay) continue;
        const href = overlay.getAttribute("href") || "";

        // extract appid from /gamecards/{appid}/ or /badges/{appid}/
        const m = href.match(/\/(?:gamecards|badges)\/(\d+)\/?(\?|$)/);
        if (!m) continue;
        const appid = m[1];
        const sourceIsFoil = href.includes("border=1");
        if (!cfg.foilScanMode && sourceIsFoil) continue;
        const isFoil = cfg.foilScanMode || sourceIsFoil;
        const key = `${appid}_${isFoil ? 1 : 0}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // skip completed badges (no card progress shown)
        const progressEl = row.querySelector(".badge_progress_info");
        if (!progressEl) continue;
        const progressText = progressEl.textContent.trim();
        // "已收集 X / Y 张卡牌" or "Collected X / Y cards"
        const countMatch = progressText.match(/(\d+)\s*\/\s*(\d+)/);
        if (!countMatch) continue;
        const owned = parseInt(countMatch[1], 10);
        const totalInSet = parseInt(countMatch[2], 10);

        // In foil mode the visible progress may belong to the normal badge, so
        // keep broader app candidates and let the ?border=1 card page decide.
        if (!cfg.foilScanMode && (owned === 0 || owned >= totalInSet)) continue;

        // game name
        const titleEl = row.querySelector(".badge_title");
        let gameName = "";
        if (titleEl) {
          gameName = (titleEl.querySelector(".badge_title_row")?.textContent
            || titleEl.textContent)
            .replace(/(?:View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "")
            .trim();
        }

        // drops remaining
        let dropsRemaining = 0;
        const dropsEl = row.querySelector(".progress_info_bold");
        if (dropsEl) {
          const dt = dropsEl.textContent;
          const dm = dt.match(/(\d+)\s*(?:张剩余卡牌掉落|card drops? remaining)/i);
          if (dm) dropsRemaining = parseInt(dm[1], 10);
        }

        candidates.push({ appid, isFoil, gameName, owned, totalInSet, dropsRemaining });
        pageCandidateCount++;
      }

      onProgress?.(`徽章 ${rangeStart}-${actualEnd}: ${pageCandidateCount} 个${scanModeLabel}候选 (共 ${rows.length} 个徽章)`);

      const nextLink = doc.querySelector(`a.pagebtn[href*="p=${page + 1}"]`);
      if (!nextLink) break;

      await new Promise(r => setTimeout(r, cfg.scanInterval));
    }

    onProgress?.(`徽章列表扫描完成, 共 ${candidates.length} 个${scanModeLabel}候选`);
    return candidates;
  }
