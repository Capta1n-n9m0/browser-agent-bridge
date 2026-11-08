// Step 15 S2: generate the npm package in build/npm/ (#449): esbuild bundles of the SDK (the main export), the MCP
// server, the daemon, the doctor, setup, the CLI and the native host; the SDK's declarations; both license texts and the note (#450); the
// third-party notices for what the bundles hold. `--pack` then runs `npm pack` into build/. Never publishes.
// It prints file names and counts only.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { BUNDLE_ENTRIES, packageManifest } from "./manifest.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = path.join(repo, "build", "npm");
const at = (...p) => path.join(repo, ...p);
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "dist"), { recursive: true });

const EXTERNAL = ["bufferutil", "utf-8-validate", "ws"];
const entries = BUNDLE_ENTRIES; // the native host (Step 15 S4) among them: dist/native-host.js
const thirdParty = new Map();
for (const e of entries) {
  const r = await build({
    entryPoints: [at(e.in)], bundle: true, platform: "node", format: "esm", target: "node20",
    outfile: path.join(out, "dist", e.out), banner: e.banner, external: [...EXTERNAL, ...(e.external ?? [])],
    metafile: true, logLevel: "warning", legalComments: "eof",
  });
  for (const input of Object.keys(r.metafile.inputs)) {
    const m = input.replace(/\\/g, "/").match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (m && !m[1].startsWith("@bridge/")) thirdParty.set(m[1], (thirdParty.get(m[1]) ?? new Set()).add(e.out));
  }
}

// The SDK's declarations, with @bridge/shared pointed at the shipped shared/ declarations.
const tmp = at("build", "types-tmp");
rmSync(tmp, { recursive: true, force: true });
execFileSync(process.execPath, [at("node_modules", "typescript", "bin", "tsc"), "-p", at("scripts", "package", "tsconfig.types.json")], { stdio: "inherit" });
const SHARED = { "@bridge/shared": "protocol.js", "@bridge/shared/codes": "codes.js", "@bridge/shared/error": "error.js" };
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
let declarations = 0;
for (const f of walk(tmp)) {
  const rel = path.relative(tmp, f);
  const dest = path.join(out, "types", rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  const text = readFileSync(f, "utf8").replace(/(from|declare module) "(@bridge\/shared(?:\/codes|\/error)?)"/g, (_, kw, spec) => {
    const target = path.join(out, "types", "shared", "src", SHARED[spec]);
    let r = path.relative(path.dirname(dest), target).replace(/\\/g, "/");
    if (!r.startsWith(".")) r = `./${r}`;
    return `${kw} "${r}"`;
  });
  if (/@bridge\//.test(text)) throw new Error(`a declaration still names a private @bridge package: ${rel}`);
  writeFileSync(dest, text);
  declarations++;
}
rmSync(tmp, { recursive: true, force: true });

// Licenses (#450), the third-party notices, the README.
cpSync(at("LICENSE"), path.join(out, "LICENSE"));
cpSync(at("sdk", "LICENSE"), path.join(out, "LICENSE-APACHE"));
cpSync(at("scripts", "package", "LICENSES.md"), path.join(out, "LICENSES.md"));
cpSync(at("README.md"), path.join(out, "README.md"));
const notices = [...thirdParty.keys()].sort().map((name) => {
  const dir = at("node_modules", name);
  const pkg = readJson(path.join(dir, "package.json"));
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  if (!file) throw new Error(`no license file for bundled package ${name}`);
  return `${name}@${pkg.version} (${pkg.license ?? "see text"}) — in ${[...thirdParty.get(name)].join(", ")}\n\n${readFileSync(path.join(dir, file), "utf8").trim()}\n`;
});
writeFileSync(path.join(out, "THIRD-PARTY-NOTICES.txt"),
  `Third-party packages bundled into this package's dist/ files, with their licenses.\n\n${notices.join(`\n${"-".repeat(72)}\n\n`)}`);

const root = readJson(at("package.json"));
const ws = readJson(at("sdk", "package.json")).dependencies.ws;
writeFileSync(path.join(out, "package.json"), JSON.stringify(packageManifest(root, { ws }), null, 2) + "\n");
console.log(`built build/npm: ${entries.length} bundles, ${declarations} declaration files, ${thirdParty.size} third-party packages noticed`);

if (process.argv.includes("--pack")) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !existsSync(npmCli)) throw new Error("--pack runs under npm: use npm run pack:npm");
  execFileSync(process.execPath, [npmCli, "pack", "--pack-destination", path.join(repo, "build")], { cwd: out, stdio: "inherit" });
}
