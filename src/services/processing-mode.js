const PROCESSING_MODES = new Set(["all", "card", "decoration", "background", "emoticon"]);

export function normalizeProcessingMode(value) {
  return PROCESSING_MODES.has(value) ? value : "card";
}

export function processingModeIncludesCards(value) {
  const mode = normalizeProcessingMode(value);
  return mode === "all" || mode === "card";
}

export function getProcessingDecorationCategories(value) {
  const mode = normalizeProcessingMode(value);
  if (mode === "all" || mode === "decoration") return ["background", "emoticon"];
  return mode === "background" || mode === "emoticon" ? [mode] : [];
}

export function processingModeIncludesDecorations(value) {
  return getProcessingDecorationCategories(value).length > 0;
}
