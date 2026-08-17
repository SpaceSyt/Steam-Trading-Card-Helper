import { normalizeTabColors, normalizeTabOrder } from "../services/tab-preferences.js";

export function readTabOrder(container) {
  return normalizeTabOrder(
    [...(container?.querySelectorAll?.(".stch-tab[data-tab]") || [])]
      .map(tab => tab.dataset.tab)
  );
}

function syncSettingsSpacer(container) {
  const tabs = [...container.querySelectorAll(".stch-tab[data-tab]")];
  for (const tab of tabs) tab.classList.remove("stch-tab-right");
  const last = tabs.at(-1);
  if (last?.dataset.tab === "settings") last.classList.add("stch-tab-right");
}

export function applyTabOrder(container, value) {
  if (!container) return [];
  const byId = new Map(
    [...container.querySelectorAll(".stch-tab[data-tab]")]
      .map(tab => [tab.dataset.tab, tab])
  );
  const order = normalizeTabOrder(value);
  for (const id of order) {
    const tab = byId.get(id);
    if (tab) container.appendChild(tab);
  }
  syncSettingsSpacer(container);
  return readTabOrder(container);
}

export function applyTabColors(container, value) {
  const colors = normalizeTabColors(value);
  for (const tab of container?.querySelectorAll?.(".stch-tab[data-tab]") || []) {
    const color = colors[tab.dataset.tab] || "";
    tab.classList.toggle("stch-tab-custom-color", !!color);
    if (color) tab.style.setProperty("--stch-tab-label-color", color);
    else tab.style.removeProperty("--stch-tab-label-color");
  }
  return colors;
}

export function enableTabDragReordering(container, onOrderChange) {
  if (!container || container.dataset.dragReordering === "1") return;
  container.dataset.dragReordering = "1";
  let pointerDrag = null;
  let suppressClickUntil = 0;

  container.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const tab = event.target instanceof Element
      ? event.target.closest(".stch-tab[data-tab]")
      : null;
    if (!tab || !container.contains(tab)) return;
    pointerDrag = {
      tab,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialOrder: readTabOrder(container).join(","),
      active: false,
    };
    try { tab.setPointerCapture?.(event.pointerId); } catch (_) {}
  });
  container.addEventListener("pointermove", event => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    if (!pointerDrag.active) {
      const distance = Math.hypot(
        event.clientX - pointerDrag.startX,
        event.clientY - pointerDrag.startY
      );
      if (distance < 5) return;
      pointerDrag.active = true;
      pointerDrag.tab.classList.add("stch-tab-dragging");
    }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(
      ".stch-tab[data-tab]"
    );
    if (target && target !== pointerDrag.tab && container.contains(target)) {
      const rect = target.getBoundingClientRect();
      const insertBefore = event.clientX < rect.left + rect.width / 2;
      container.insertBefore(
        pointerDrag.tab,
        insertBefore ? target : target.nextSibling
      );
      syncSettingsSpacer(container);
    }
    event.preventDefault();
  }, { passive: false });

  const finish = event => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    const { tab, pointerId, initialOrder, active } = pointerDrag;
    pointerDrag = null;
    tab.classList.remove("stch-tab-dragging");
    try { if (tab.hasPointerCapture?.(pointerId)) tab.releasePointerCapture(pointerId); } catch (_) {}
    if (!active) return;
    suppressClickUntil = Date.now() + 100;
    const order = readTabOrder(container);
    syncSettingsSpacer(container);
    if (order.join(",") !== initialOrder) onOrderChange?.(order);
  };
  container.addEventListener("pointerup", finish);
  container.addEventListener("pointercancel", finish);
  container.addEventListener("lostpointercapture", event => {
    if (pointerDrag?.active) finish(event);
  });
  container.addEventListener("click", event => {
    if (Date.now() > suppressClickUntil) return;
    const tab = event.target instanceof Element
      ? event.target.closest(".stch-tab[data-tab]")
      : null;
    if (!tab || !container.contains(tab)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
