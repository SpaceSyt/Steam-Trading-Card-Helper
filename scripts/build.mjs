import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const banner = readFileSync(join(root, "src", "meta.txt"), "utf8").replace(
  /__VERSION__/g,
  pkg.version
);

await build({
  entryPoints: [join(root, "src", "index.js")],
  bundle: true,
  format: "iife",
  charset: "utf8",
  legalComments: "none",
  sourcemap: false,
  loader: { ".css": "text" },
  banner: { js: banner },
  outfile: join(root, "steam-trading-card-helper.user.js"),
});

console.log(`built steam-trading-card-helper.user.js v${pkg.version}`);
