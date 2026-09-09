import { build, transform } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
const filename = plus ? "steam-trading-card-helper-plus.user.js" : "steam-trading-card-helper.user.js";
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
        const result = await transform(
          normalizeNewlines(readFileSync(args.path, "utf8")),
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
      buildContext.onLoad({ filter: /[\\/]ui[\\/]modal\.js$/ }, args => ({
        contents: compactMainModalHtml(normalizeNewlines(readFileSync(args.path, "utf8"))),
        loader: "js",
        resolveDir: dirname(args.path),
      }));
    },
  }],
  banner: { js: banner },
  outfile: join(root, filename),
});

console.log(`built ${filename} v${pkg.version}`);
