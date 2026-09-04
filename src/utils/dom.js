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

  export function appendEmptyState(root, text) {
    const empty = document.createElement("div");
    empty.className = "stch-inventory-empty";
    empty.textContent = text;
    root.appendChild(empty);
  }

  export function appendInventoryImage(root, imageUrl, label) {
    const image = document.createElement(imageUrl ? "img" : "div");
    if (imageUrl) {
      image.loading = "lazy";
      image.decoding = "async";
      image.src = imageUrl;
      image.alt = label || "";
    } else {
      image.className = "stch-inv-placeholder";
      image.textContent = label || "?";
    }
    root.appendChild(image);
  }

  export function createInventoryTile({
    key,
    selected,
    title,
    imageUrl,
    label,
    className = "",
    volumeZero = false,
    nameColor = "",
    backgroundColor = "",
  }) {
    const tile = document.createElement("div");
    tile.className = `stch-inv-tile${className ? ` ${className}` : ""}`;
    tile.dataset.key = key;
    tile.classList.toggle("selected", selected);
    tile.classList.toggle("stch-volume-zero", volumeZero);
    tile.title = title;
    if (nameColor) tile.style.borderColor = nameColor;
    if (backgroundColor) tile.style.backgroundColor = backgroundColor;
    appendInventoryImage(tile, imageUrl, label);
    return tile;
  }

  export function appendInventoryTileText(root, tagName, className, text, title = "") {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    element.title = title;
    root.appendChild(element);
  }

  export function setStatusText(id, text, type = "") {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = text || "";
    element.className = `stch-status-text${type ? ` ${type}` : ""}`;
    element.style.display = text ? "" : "none";
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
