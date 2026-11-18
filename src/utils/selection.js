export function setItemsSelected(selection, items, getKey, selected) {
  for (const item of items) {
    const key = getKey(item);
    if (selected) selection.add(key);
    else selection.delete(key);
  }
}

export function pruneSelection(selection, items, getKey) {
  const validKeys = new Set();
  for (const item of items) validKeys.add(getKey(item));
  for (const key of selection) {
    if (!validKeys.has(key)) selection.delete(key);
  }
}

export function countSelected(selection, items, getKey) {
  let count = 0;
  for (const item of items) count += Number(selection.has(getKey(item)));
  return count;
}
