// Step 15 S5: `npm run pack:mcpb` builds the Claude Desktop extension, build/browser-agent-bridge-<version>.mcpb, from a
// clean tree: the npm package (build.mjs → build/npm/), its one runtime dependency (ws, copied from node_modules), the
// generated manifest.json and the placeholder icon, staged in build/mcpb/; then the official tool (@anthropic-ai/mcpb,
// a pinned devDependency) validates the manifest and packs. Never publishes. It prints file names and counts only.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { placeholderIcon } from "./icon.mjs";
import { mcpbManifest } from "./manifest.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const at = (...p) => path.join(repo, ...p);
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

execFileSync(process.execPath, [at("scripts", "package", "build.mjs")], { stdio: "inherit" });

const stage = at("build", "mcpb");
rmSync(stage, { recursive: true, force: true });
cpSync(at("build", "npm"), stage, { recursive: true, filter: (src) => !src.startsWith(at("build", "npm", "types")) });
const want = readJson(at("build", "npm", "package.json")).dependencies;
for (const name of Object.keys(want)) {
  const dir = at("node_modules", name);
  mkdirSync(path.join(stage, "node_modules"), { recursive: true });
  cpSync(dir, path.join(stage, "node_modules", name), { recursive: true });
  const deps = Object.keys(readJson(path.join(dir, "package.json")).dependencies ?? {});
  if (deps.length) throw new Error(`${name} has dependencies of its own; copy them too`);
}
const root = readJson(at("package.json"));
writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(mcpbManifest(root), null, 2) + "\n");
writeFileSync(path.join(stage, "icon.png"), placeholderIcon(512));

const cli = at("node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
const out = at("build", `${root.name}-${root.version}.mcpb`);
execFileSync(process.execPath, [cli, "validate", path.join(stage, "manifest.json")], { stdio: "inherit" });
execFileSync(process.execPath, [cli, "pack", stage, out], { stdio: "inherit" });
console.log(`built build/${path.basename(out)} (${Object.keys(want).length} runtime dependency copied)`);
