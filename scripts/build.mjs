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

const banner = normalizeNewlines(
  readFileSync(join(root, "src", "meta.txt"), "utf8")
).replace(/__VERSION__/g, pkg.version);

await build({
  entryPoints: [join(root, "src", "index.js")],
  bundle: true,
  format: "iife",
  charset: "utf8",
  minify: true,
  keepNames: true,
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
  outfile: join(root, "steam-trading-card-helper.user.js"),
});

console.log(`built steam-trading-card-helper.user.js v${pkg.version}`);
