// @ts-check
// Step 15 S6: `npm run release:build [-- --tag vX.Y.Z]` builds every release file into build/release/ (gitignored):
//   browser-agent-bridge-<v>.tgz            the npm package (`npm run pack:npm`)
//   browser-agent-bridge-<v>.mcpb           the Claude Desktop extension (`npm run pack:mcpb`)
//   browser-agent-bridge-extension-<v>.zip  the Chrome extension, manifest without `key` (S0 item 1), forward slashes
//   release-notes.md                        the CHANGELOG.md section for <v>
//   SHA256SUMS.txt
// .github/workflows/release.yml calls it with the tag. With --tag, the tag must equal the version and a full release
// (no `-pre`) must have its changelog section. Never publishes. Prints file names, sizes and hashes only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkRepo } from "./version-cli.mjs";
import { changelogSection, isPrerelease } from "./version.mjs";
import { extensionZipFiles, makeZip, manifestFiles, storeManifest, zipEntries } from "./zip.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const at = (/** @type {string[]} */ ...p) => path.join(repo, ...p);
const readJson = (/** @type {string} */ f) => JSON.parse(readFileSync(f, "utf8"));
const fail = (/** @type {string} */ msg) => { console.error(`release:build: ${msg}`); process.exit(1); };

const tagAt = process.argv.indexOf("--tag");
const tag = tagAt > 0 ? process.argv[tagAt + 1] : undefined;
if (tagAt > 0 && !tag) fail("--tag needs a value");

const { version, problems } = checkRepo(tag);
if (problems.length) fail(problems.join("; "));

const changelog = existsSync(at("CHANGELOG.md")) ? readFileSync(at("CHANGELOG.md"), "utf8") : "";
let notes = changelogSection(changelog, version);
if (!notes) {
  if (tag && !isPrerelease(version)) fail(`CHANGELOG.md has no section for ${version}`);
  console.warn(`release:build: no CHANGELOG.md section for ${version}; the notes say so`);
  notes = `No changelog section for ${version}${isPrerelease(version) ? " (a prerelease)" : ""}.`;
}

const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) fail("run it under npm: npm run release:build");
const npm = (/** @type {string} */ script) => execFileSync(process.execPath, [/** @type {string} */ (npmCli), "run", script], { cwd: repo, stdio: "inherit" });
npm("build");
npm("pack:npm");
npm("pack:mcpb");

// The generated files carry the root version (#447).
const generated = [
  ["build/npm/package.json", readJson(at("build", "npm", "package.json")).version],
  ["build/mcpb/manifest.json", readJson(at("build", "mcpb", "manifest.json")).version],
];
for (const [where, v] of generated) if (v !== version) fail(`${where} has version ${v}, want ${version}`);

const out = at("build", "release");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const name = readJson(at("package.json")).name;
const tgz = `${name}-${version}.tgz`;
const mcpb = `${name}-${version}.mcpb`;
const zip = `${name}-extension-${version}.zip`;
copyFileSync(at("build", tgz), path.join(out, tgz));
copyFileSync(at("build", mcpb), path.join(out, mcpb));

// The extension zip: manifest without `key`, the pages, dist/*.js, icons/*.png.
const ext = at("extension");
const listing = [
  ...readdirSync(ext).filter((f) => statSync(path.join(ext, f)).isFile()),
  ...["dist", "icons"].filter((d) => existsSync(path.join(ext, d))).flatMap((d) => readdirSync(path.join(ext, d)).map((f) => `${d}/${f}`)),
];
const manifestText = storeManifest(readFileSync(path.join(ext, "manifest.json"), "utf8"));
const files = extensionZipFiles(listing).map((f) => ({
  name: f,
  data: f === "manifest.json" ? Buffer.from(manifestText, "utf8") : readFileSync(path.join(ext, ...f.split("/"))),
}));
const zipped = makeZip(files);
const names = zipEntries(zipped).map((e) => e.name);
for (const need of manifestFiles(JSON.parse(manifestText))) if (!names.includes(need)) fail(`the zip lacks ${need}, which the manifest names`);
if (names.some((n) => n.includes("\\"))) fail("a zip entry has a backslash");
if ("key" in JSON.parse(manifestText)) fail("the zip manifest still has key");
writeFileSync(path.join(out, zip), zipped);

writeFileSync(path.join(out, "release-notes.md"), notes + "\n");
const sums = [tgz, mcpb, zip].map((f) => `${createHash("sha256").update(readFileSync(path.join(out, f))).digest("hex")}  ${f}`);
writeFileSync(path.join(out, "SHA256SUMS.txt"), sums.join("\n") + "\n");

for (const f of readdirSync(out).sort()) console.log(`build/release/${f}  ${statSync(path.join(out, f)).size} bytes`);
console.log(`extension zip: ${names.length} files, no key`);
console.log(sums.join("\n"));
