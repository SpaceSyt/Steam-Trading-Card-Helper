import { build, transform } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { localizeSource, localizeStyles } from "./localize.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const normalizeNewlines = text => text.replace(/\r\n?/g, "\n");

function compactMainModalHtml(source) {
  let matches = 0;
  const compacted = source.replace(
    /(modal\.innerHTML\s*=\s*`)([\s\S]*?)(`;\s*document\.body\.appendChild\(modal\);)/,
    (_match, open, html, close) => {
      matches += 1;
      const compactHtml = html
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .join(" ");
      return `${open}${compactHtml}${close}`;
    }
  );
  if (matches !== 1) {
    throw new Error(`Expected one main modal HTML template, found ${matches}.`);
  }
  return compacted;
}

const plus = process.argv.includes("--plus");
const english = process.argv.includes("--en");
const standalone = process.argv.includes("--standalone");
const compatibility = plus && !standalone;
const unknown = process.argv.slice(2).filter(argument => !["--plus", "--en", "--standalone"].includes(argument));
if (unknown.length) throw new Error(`Unknown build option: ${unknown.join(", ")}`);
if (standalone && !plus) throw new Error("Standalone requires --plus. Use: npm run build -- --plus --standalone");
const filename = `steam-trading-card-helper${plus ? "-plus" : ""}${standalone ? "-standalone" : ""}${english ? "-en" : ""}.user.js`;
const outputDirectory = standalone || (!plus && english) ? join(root, "build") : root;
const translations = english ? JSON.parse(readFileSync(join(root, "src/locales/en.json"), "utf8")) : null;
let banner = normalizeNewlines(
  readFileSync(join(root, "src", "meta.txt"), "utf8")
).replace(/__VERSION__/g, pkg.version);

if (plus) {
  banner = banner.replace(/^(\/\/ @name\s+).+$/m, "$1Steam Trading Card Helper Plus")
    .replace(/^(\/\/ @name:zh-CN\s+).+$/m, "$1Steam 卡牌助手 Plus")
    .replace(/^(\/\/ @description\s+).+$/m, "$1Badge and inventory tools with native Steam trade offer valuation")
    .replace(/^(\/\/ @description:zh-CN\s+).+$/m, "$1徽章与库存工具，增强 Steam 原生交易报价页，显示双方估价与差额")
    .replace(/^\/\/ @(?:downloadURL|updateURL)[^\n]*\n/gm, "")
    .replace("// @grant        GM_addStyle", "// @match        https://steamcommunity.com/tradeoffer/*\n// @grant        GM_addStyle");
}

if (english) {
  banner = banner.replace(/^(\/\/ @name\s+)(.+)$/m, "$1$2 (English)")
    .replace(/^\/\/ @(?:name|description):zh-CN[^\n]*\n/gm, "")
    .replaceAll("/steam-trading-card-helper.user.js", `/${filename}`);
}

if (standalone) {
  banner = banner.replace(/^(\/\/ @name\s+)(.+)$/m, "$1$2 (Standalone)")
    .replace(/^(\/\/ @name:zh-CN\s+)(.+)$/m, "$1$2（独立版）");
}

await build({
  entryPoints: [join(root, "src", plus ? "plus/index.js" : "index.js")],
  bundle: true,
  format: "iife",
  charset: "utf8",
  minify: true,
  legalComments: "none",
  sourcemap: false,
  loader: { ".css": "text" },
  plugins: [{
    name: "compact-embedded-assets",
    setup(buildContext) {
      buildContext.onLoad({ filter: /\.css$/ }, async args => {
        let source = normalizeNewlines(readFileSync(args.path, "utf8"));
        if (compatibility && args.path === join(root, "src", "plus", "trade-offer.css")) {
          source += "\n" + normalizeNewlines(readFileSync(join(root, "src", "plus", "trade-compat.css"), "utf8"));
        }
        const result = await transform(
          english ? localizeStyles(source) : source,
          {
            loader: "css",
            minify: true,
            charset: "utf8",
            legalComments: "none",
          }
        );
        return {
          contents: normalizeNewlines(result.code).trim(),
          loader: "text",
        };
      });
      buildContext.onLoad({ filter: /\.js$/ }, args => {
        const modal = /[\\/]ui[\\/]modal\.js$/.test(args.path);
        if (!english && !modal) return;
        let contents = normalizeNewlines(readFileSync(args.path, "utf8"));
        if (english) contents = localizeSource(contents, {
          filename: args.path,
          translate(key, context) {
            if (!Object.hasOwn(translations, key)) throw new Error(`Missing English translation at ${context.filename}:${context.line}: ${key}`);
            return translations[key];
          },
        });
        if (modal) contents = compactMainModalHtml(contents);
        return { contents, loader: "js", resolveDir: dirname(args.path) };
      });
    },
  }],
  banner: { js: banner },
  outfile: join(outputDirectory, filename),
});

console.log(`built ${filename} v${pkg.version}`);
