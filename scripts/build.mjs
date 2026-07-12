import { build, transform } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const normalizeNewlines = text => text.replace(/\r\n?/g, "\n");

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
    name: "minify-css-text",
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
    },
  }],
  banner: { js: banner },
  outfile: join(root, "steam-trading-card-helper.user.js"),
});

console.log(`built steam-trading-card-helper.user.js v${pkg.version}`);
