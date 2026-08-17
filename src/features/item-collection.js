import { state } from "../state.js";
import {
  addItemCollectionEntries,
  isItemCollectionHealthy,
  removeItemCollectionEntries,
} from "../services/item-collection.js";
import {
  getSelectedSurplusResults,
  renderSurplusResults,
} from "./surplus.js";
import {
  getSelectedGrindResults,
  renderGrindResults,
} from "./grind.js";
import { enableTileDragSelection } from "../ui/checkbox-drag.js";
import { updateAllActionStates } from "../ui/action-state.js";

const CATEGORY_LABELS = {
  card: "卡牌",
  background: "背景",
  emoticon: "表情",
};

function getProcessingMode() {
  const value = document.getElementById("stch-surplus-item-mode")?.value
    || state.cfg.surplusItemMode
    || "card";
  return ["card", "background", "emoticon"].includes(value) ? value : "card";
}

function setCollectionStatus(message, type = "") {
  const status = document.getElementById("stch-collection-status");
  if (!status) return;
  status.textContent = message || "";
  status.className = `stch-status-text ${type}`.trim();
  status.style.display = message ? "" : "none";
}

export function collectSelectedProcessingItems() {
  const category = getProcessingMode();
  const selected = category === "card"
    ? getSelectedSurplusResults()
    : getSelectedGrindResults();
  if (selected.length === 0) return;
  const result = addItemCollectionEntries(selected.map(item => ({
    ...item,
    category,
    itemName: item.itemName || item.cardName || item.marketHashName,
  })));
  if (!result.ok) {
    setCollectionStatus(result.error, "err");
    return;
  }
  state.selectedSurplusResults = new Set();
  state.selectedGrindResults = new Set();
  renderSurplusResults();
  renderGrindResults();
  renderItemCollection();
  setCollectionStatus(`已收藏 ${result.added} 项，共 ${result.total} 项`, "ok");
  updateAllActionStates();
}

export function removeSelectedCollectionItems() {
  const selected = state.selectedItemCollection || new Set();
  if (selected.size === 0) return;
  const result = removeItemCollectionEntries(selected);
  if (!result.ok) {
    setCollectionStatus(result.error, "err");
    return;
  }
  state.selectedItemCollection = new Set();
  renderItemCollection();
  renderSurplusResults();
  renderGrindResults();
  setCollectionStatus(`已移除 ${result.removed} 项收藏`, "ok");
  updateAllActionStates();
}

export function setAllItemCollectionSelection(selected) {
  state.selectedItemCollection = new Set(
    selected ? (state.itemCollectionItems || []).map(item => item.key) : []
  );
  renderItemCollection();
}

export function renderItemCollection() {
  const list = document.getElementById("stch-collection-list");
  if (!list) return;
  if (!state.selectedItemCollection) state.selectedItemCollection = new Set();
  const items = state.itemCollectionItems || [];
  const validKeys = new Set(items.map(item => item.key));
  for (const key of [...state.selectedItemCollection]) {
    if (!validKeys.has(key)) state.selectedItemCollection.delete(key);
  }

  enableTileDragSelection(list, {
    isSelected: tile => state.selectedItemCollection.has(tile.dataset.key),
    setSelected: (tile, selected) => {
      if (selected) state.selectedItemCollection.add(tile.dataset.key);
      else state.selectedItemCollection.delete(tile.dataset.key);
    },
    onSelectionChange: renderItemCollectionSummary,
  });
  list.innerHTML = "";
  list.classList.add("stch-inventory-grid");

  if (!isItemCollectionHealthy()) {
    const empty = document.createElement("div");
    empty.className = "stch-inventory-empty";
    empty.textContent = "收藏数据已损坏；为保护物品，出售和分解已停用";
    list.appendChild(empty);
  } else if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "stch-inventory-empty";
    empty.textContent = "尚未收藏物品；请在多余物品处理中选择后收藏";
    list.appendChild(empty);
  } else {
    for (const item of items) {
      const tile = document.createElement("div");
      tile.className = "stch-inv-tile stch-collection-tile";
      tile.dataset.key = item.key;
      tile.classList.toggle("selected", state.selectedItemCollection.has(item.key));
      tile.title = [
        item.gameName,
        item.itemName || item.marketHashName,
        `类型：${CATEGORY_LABELS[item.category] || "物品"}`,
        "收藏中的物品不会出现在出售或分解候选中",
      ].filter(Boolean).join("\n");

      if (item.imageUrl) {
        const image = document.createElement("img");
        image.src = item.imageUrl;
        image.alt = item.itemName || item.marketHashName || "";
        tile.appendChild(image);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "stch-inv-placeholder";
        placeholder.textContent = item.itemName || "?";
        tile.appendChild(placeholder);
      }

      const category = document.createElement("span");
      category.className = "stch-inv-badge stch-inv-badge-left";
      category.textContent = CATEGORY_LABELS[item.category] || "物品";
      tile.appendChild(category);

      const name = document.createElement("div");
      name.className = "stch-inv-name";
      name.textContent = item.itemName || item.marketHashName || "未知物品";
      tile.appendChild(name);
      list.appendChild(tile);
    }
  }
  renderItemCollectionSummary();
}

export function renderItemCollectionSummary() {
  const total = state.itemCollectionItems?.length || 0;
  const selected = state.selectedItemCollection?.size || 0;
  const summary = document.getElementById("stch-collection-summary");
  if (summary) summary.textContent = `已收藏 ${total} 项 · 已选择 ${selected} 项`;
  const selectAll = document.getElementById("stch-collection-select-all");
  if (selectAll) {
    selectAll.textContent = total > 0 && selected === total ? "取消全选" : "全选";
    selectAll.classList.toggle("disabled", total === 0);
  }
  document.getElementById("stch-collection-remove")?.classList.toggle(
    "disabled",
    selected === 0 || !isItemCollectionHealthy()
  );
}

export function activateItemCollectionTab() {
  renderItemCollection();
}
