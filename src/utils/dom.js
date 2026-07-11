  export function createTextSpan(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = String(text);
    return span;
  }

  export function createCheckboxHit(checkbox) {
    const hit = document.createElement("span");
    hit.className = "stch-check-hit";
    hit.appendChild(checkbox);
    return hit;
  }

  export function getFirstText(root, selectors) {
    for (const selector of selectors) {
      const text = root.querySelector(selector)?.textContent?.trim();
      if (text) return text;
    }
    return "";
  }

  export function getFirstAttr(root, selectors, attr) {
    for (const selector of selectors) {
      const value = root.querySelector(selector)?.getAttribute(attr);
      if (value) return value;
    }
    return "";
  }

  export function normalizeResourceUrl(value) {
    const raw = String(value || "").trim().replace(/^url\(["']?/, "").replace(/["']?\)$/, "");
    if (!raw) return "";
    try {
      return new URL(raw, location.origin).href;
    } catch (_) {
      return raw;
    }
  }

  export function normalizeSteamAvatarUrl(value) {
    const url = normalizeResourceUrl(value);
    if (!url.includes("avatars.fastly.steamstatic.com/")) return url;
    return url.replace(
      /(?:_(?:medium|full))?(\.[a-z0-9]+)(\?.*)?$/i,
      "_full$1$2"
    );
  }

  export function getImageUrlFromElement(element) {
    if (!element) return "";
    const direct = element.getAttribute("src")
      || element.getAttribute("data-src")
      || element.getAttribute("data-original")
      || element.getAttribute("data-fullsrc");
    if (direct) return normalizeSteamAvatarUrl(direct);

    const srcset = element.getAttribute("srcset") || element.getAttribute("data-srcset");
    if (srcset) {
      const candidate = srcset.split(",").map(part => part.trim().split(/\s+/)[0]).filter(Boolean).pop();
      if (candidate) return normalizeSteamAvatarUrl(candidate);
    }

    const bg = element.style?.backgroundImage || "";
    if (bg && bg !== "none") return normalizeSteamAvatarUrl(bg);
    return "";
  }

  export function getFirstImageUrl(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const url = getImageUrlFromElement(element);
      if (url) return url;
      const nested = element?.querySelector?.("img");
      const nestedUrl = getImageUrlFromElement(nested);
      if (nestedUrl) return nestedUrl;
    }
    return "";
  }
