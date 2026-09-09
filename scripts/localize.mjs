import { parse } from "acorn";

const han = /\p{Script=Han}/u;
const attributes = /\b(title|placeholder|aria-label|alt)=(['"])([\s\S]*?)\2/g;
const selectWidths = { "stch-buy-mode": 180, "stch-craft-mode": 160, "stch-surplus-item-mode": 292, "stch-currency-fallback": 236 };

// Expand the existing declarations instead of shipping a second CSS override layer.
export function localizeStyles(source) {
  return source.replace(/(\.stch-auto-strategy-row\s*\{[^}]*grid-template-columns:\s*)48px/, "$1100px")
    .replace(/(\.stch-input\.stch-auto-wall-anchor\s*\{\s*width:\s*)104px/, "$1152px");
}

// Only JavaScript string values and untagged templates are eligible. Regular
// expressions, identifiers, comments and external item data stay untouched.
export function localizeSource(source, { translate = value => value, filename = "" } = {}) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  function text(value, node) {
    if (!han.test(value)) return value;
    const localize = part => {
      const key = part.trim();
      if (!han.test(key)) return part;
      const translated = translate(key, { filename, line: node.loc.start.line });
      const slots = text => (text.match(/\{\{\d+\}\}/g) || []).join(",");
      if (typeof translated !== "string" || slots(translated) !== slots(key)) {
        throw new Error(`Translation placeholders changed at ${filename}:${node.loc.start.line}: ${key}`);
      }
      return part.replace(key, () => translated);
    };
    if (!/<\/?[a-z][^>]*>/i.test(value)) return localize(value);
    const parts = value.split(/(<(?:[^"'<>]|"[^"]*"|'[^']*')*>)/g);
    return parts.map((part, index) => {
      if (part.startsWith("<")) {
        const width = /^<select\b/i.test(part) && selectWidths[part.match(/\bid="([^"]+)"/)?.[1]];
        if (width) part = part.replace(/\bwidth:\s*\d+px/, `width:${width}px`);
        return part.replace(attributes, (_, name, quote, content) => `${name}=${quote}${localize(content).replaceAll(quote, quote === '"' ? "&quot;" : "&#39;")}${quote}`);
      }
      let translated = localize(part);
      // Chinese text needs no word separator beside inline markup; English does.
      if (translated !== part) {
        if (/^\w/.test(translated) && /^<\/(?:b|strong|a|span)>$/i.test(parts[index - 1] || "")) translated = " " + translated;
        if (/\w$/.test(translated) && /^<(?:b|strong|a|span)\b/i.test(parts[index + 1] || "")) translated += " ";
      }
      return translated;
    }).join("");
  }
  function render(node, parent) {
    if (node.type === "Literal" && typeof node.value === "string") {
      // UI sorting and date/number formatting use English; currency definitions
      // and Steam request parameters are independent of the interface language.
      if (/^zh(?:-CN)?$/.test(node.value) && parent?.type === "CallExpression"
          && parent.callee.type === "MemberExpression" && !parent.callee.computed
          && ["localeCompare", "toLocaleString"].includes(parent.callee.property.name)) {
        return '"en-US"';
      }
      const translated = text(node.value, node);
      return translated === node.value ? source.slice(node.start, node.end) : JSON.stringify(translated);
    }
    if (node.type === "TemplateLiteral" && parent?.type !== "TaggedTemplateExpression"
        && node.quasis.some(part => han.test(part.value.cooked || ""))) {
      if (node.quasis.some(part => part.value.cooked === null)) return source.slice(node.start, node.end);
      if (node.quasis.some(part => /\{\{\d+\}\}/.test(part.value.cooked))) {
        throw new Error(`Reserved translation placeholder at ${filename}:${node.loc.start.line}`);
      }
      const original = node.quasis.map((part, index) => part.value.cooked + (index < node.expressions.length ? `{{${index}}}` : "")).join("");
      const translated = text(original, node);
      const pieces = translated.split(/(\{\{\d+\}\})/g);
      return "`" + pieces.map(part => /^\{\{\d+\}\}$/.test(part)
        ? "${" + render(node.expressions[Number(part.slice(2, -2))], node) + "}"
        : part.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")).join("") + "`";
    }
    const children = Object.values(node).flatMap(value => Array.isArray(value) ? value : [value])
      .filter(value => value && typeof value === "object" && typeof value.type === "string")
      .sort((a, b) => a.start - b.start);
    let result = "", position = node.start;
    for (const child of children) {
      if (child.start < position) continue;
      result += source.slice(position, child.start) + render(child, node);
      position = child.end;
    }
    return result + source.slice(position, node.end);
  }
  return render(ast, null);
}
