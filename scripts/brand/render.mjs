// Step 15 S8: rasterizes assets/brand/*.svg into the extension icons, the 512 px .mcpb icon and the store promo tile.
// `@resvg/resvg-js` is deliberately not a repo dependency: install it anywhere and point RESVG_DIR at that folder
// (`npm i @resvg/resvg-js --prefix <dir>`; RESVG_DIR=<dir>). The promo tile's text uses the system's Segoe UI.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = process.env.RESVG_DIR;
if (!dir) throw new Error("set RESVG_DIR to a folder with @resvg/resvg-js installed");
const { Resvg } = createRequire(path.join(dir, "x.js"))("@resvg/resvg-js");
const svg = (n) => readFileSync(path.join(repo, "assets", "brand", n), "utf8");
const png = (src, width, out, extra = {}) =>
  writeFileSync(path.join(repo, out), new Resvg(src, { fitTo: { mode: "width", value: width }, ...extra }).render().asPng());

for (const s of [16, 32, 48, 128]) png(svg("icon.svg"), s, `extension/icons/icon-${s}.png`);
png(svg("icon.svg"), 512, "assets/brand/icon-512.png");
png(svg("promo-tile.svg"), 440, "assets/brand/promo-tile-440x280.png", { font: { loadSystemFonts: true } });
