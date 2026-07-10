  export function formatCNY(cents) {
    if (cents == null || isNaN(cents)) return "?";
    return (cents / 100).toFixed(2);
  }

  export function formatInt(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "—";
  }

  export function parseIntLoose(value) {
    const number = parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(number) ? number : 0;
  }

  export function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
  }

  export function clampNumber(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    const usable = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, Math.min(max, usable));
  }

  export function decodeHtmlEntities(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(value || "");
    return textarea.value;
  }
