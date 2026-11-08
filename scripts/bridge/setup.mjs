// @ts-check
// `npm run setup [-- --dry-run] [-- --replace-mcp]`: one-command install on a Windows device (Step 14 S2a, #427-#429).
// Node built-ins only (runs before `npm ci`). The token is never printed, logged or put on a command line: it is
// written to bridge.token only, and reaches clip.exe on stdin after the user says yes.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import * as lib from "./lib.mjs";

const flags = new Set(process.argv.slice(2)), dry = flags.has("--dry-run");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const say = (/** @type {string} */ s) => console.log(s);
const head = (/** @type {string} */ s) => say(`\n== ${s}${dry ? " (dry run)" : ""}`);
const quote = (/** @type {string} */ a) => (/[\s"&]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
/** @param {string} file @param {string[]} argv @param {object} [o] a .cmd shim needs a shell (Node >= 20.12) */
const run = (file, argv, o = {}) => /\.(cmd|bat)$/i.test(file)
  ? spawnSync(quote(file), argv.map(quote), { shell: true, ...o }) : spawnSync(file, argv, o);
/** @param {string} name full path of `name` on PATH, or null */
const which = (name) => {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean))
    for (const ext of ["", ...(process.env.PATHEXT ?? ".EXE;.CMD").toLowerCase().split(";")]) {
      const f = path.join(dir, name + ext);
      if (ext && existsSync(f)) return f;
    }
  return null;
};
// Under `npm run`, npm_execpath is npm-cli.js: run it with this node (no shell, no .cmd shim).
const npmExec = process.env.npm_execpath?.endsWith(".js") ? process.env.npm_execpath : null;
/** @param {string[]} argv @param {object} [o] */
const npm = (argv, o) => npmExec ? run(process.execPath, [npmExec, ...argv], o) : run(which("npm") ?? "npm", argv, o);
const out = (/** @type {any} */ r) => (r.status === 0 ? String(r.stdout).trim().split("\n")[0] : null);
/** @param {string} what @param {string[]} argv */
const npmStep = (what, argv) => {
  if (dry) return say(`would run: npm ${argv.join(" ")}`);
  say(`${what}: npm ${argv.join(" ")}`);
  if (npm(argv, { cwd: repo, stdio: "inherit" }).status !== 0) { say(`FAIL: npm ${argv[0]} failed (above).`); process.exit(1); }
};

head("Prerequisites");
const pf = process.env["ProgramFiles"] ?? "C:\\Program Files", pf86 = process.env["ProgramFiles(x86)"] ?? "";
const chrome = [pf, pf86, process.env.LOCALAPPDATA ?? ""].filter(Boolean)
  .some((d) => existsSync(path.join(d, "Google", "Chrome", "Application", "chrome.exe")));
const lines = lib.checkPrereqs({ node: process.versions.node, npm: out(npm(["--version"], { encoding: "utf8" })),
  git: out(spawnSync("git", ["--version"], { encoding: "utf8" })), chrome });
for (const l of lines) say(`${l.level.toUpperCase().padEnd(4)} ${l.name}: ${l.detail}${l.fix ? ` - ${l.fix}` : ""}`);
if (lines.some((l) => l.level === "fail")) process.exit(1);

head("Install and build");
const mtime = (/** @type {string} */ f) => (existsSync(f) ? statSync(f).mtimeMs : null);
if (lib.installNeeded(mtime(path.join(repo, "package-lock.json")) ?? 0, mtime(path.join(repo, "node_modules", ".package-lock.json"))))
  npmStep("Installing", ["ci", "--no-audit", "--no-fund"]);
else say("node_modules is up to date with package-lock.json: npm ci skipped.");
/** newest mtime under a file or folder, null if missing @param {string} f @returns {number | null} */
const newest = (f) => { const st = existsSync(f) ? statSync(f) : null; if (!st?.isDirectory()) return st ? st.mtimeMs : null;
  return Math.max(st.mtimeMs, ...readdirSync(f).map((n) => newest(path.join(f, n)) ?? 0)); };
const inputs = lib.BUILD_INPUTS.map((f) => newest(path.join(repo, f))).filter((m) => m !== null);
if (lib.buildNeeded(lib.BUILD_OUTPUTS.map((f) => mtime(path.join(repo, f))), /** @type {number[]} */ (inputs)))
  npmStep("Building", ["run", "build"]);
else say("Every build output is newer than its sources: npm run build skipped (dist/ untouched).");
head("Token");
const tokenPath = path.join(repo, "bridge.token");
let token = existsSync(tokenPath) ? readFileSync(tokenPath, "utf8") : null;
if (lib.tokenDecision(token) === "keep") say("bridge.token exists: kept (not shown).");
else if (dry) say("would create bridge.token (random, 256 bits).");
else { token = randomBytes(32).toString("hex"); writeFileSync(tokenPath, token + "\n", { mode: 0o600 }); say("Created bridge.token (random, 256 bits; not shown)."); }

head("Claude Code MCP entry (user scope)");
const cfgPath = lib.claudeConfigPath(process.env, os.homedir());
/** @type {any} */ let cfg = {};
/** @type {string[]} */ const failed = [];
try { if (existsSync(cfgPath)) cfg = JSON.parse(readFileSync(cfgPath, "utf8")); }
catch { cfg = null; failed.push("MCP registration"); say(`FAIL: cannot parse ${cfgPath}: registration skipped; fix the file and run setup again.`); }
const claude = which("claude");
const addArgv = lib.mcpAddArgv(repo);
if (cfg) {
  const d = lib.mcpDecision(cfg, repo, { tokenFile: token, replace: flags.has("--replace-mcp") });
  /** @param {string[]} argv */
  const claudeRun = (argv) => {
    if (dry || !claude) return say(`${claude ? "would run" : "run"}: claude ${argv.map(quote).join(" ")}`);
    const r = run(claude, argv, { stdio: "inherit" });
    if (r.status !== 0) failed.push(`claude ${argv[1]}`);
    say(r.status === 0 ? "done." : `FAIL: claude exited ${r.status}: run it yourself: claude ${argv.map(quote).join(" ")}`);
  };
  if (!claude && d.action !== "leave") say("The claude CLI is not on PATH: install Claude Code (claude.com/claude-code), then:");
  if (d.action === "leave") say(`${lib.SERVER_NAME} already points at this checkout: left as it is.`);
  if (d.action === "report") say(`${lib.SERVER_NAME} points at ${d.existing}, not this checkout. Left as it is; run npm run setup -- --replace-mcp to replace it.`);
  for (const name of d.legacy) {
    say(`Replacing the old ${name} entry with ${lib.SERVER_NAME} (the product's new name).`);
    claudeRun(lib.mcpRemoveArgv(name));
  }
  if (d.action === "replace" && d.current) claudeRun(lib.MCP_REMOVE_ARGV);
  if (d.action === "add" || d.action === "replace") claudeRun(addArgv);
  for (const dir of d.localLeftovers) say(`A local-scope ${lib.SERVER_NAME} entry for ${dir} wins there: in that folder run claude mcp remove -s local ${lib.SERVER_NAME}`);
  for (const { dir, name } of d.legacyLocal) say(`A local-scope ${name} entry (the old name) for ${dir} runs there: in that folder run claude mcp remove -s local ${name}`);
  if (d.envToken === "differs") say("The entry's env BRIDGE_TOKEN differs from bridge.token and wins over it: remove BRIDGE_TOKEN from the entry.");
  if (d.envToken === "same") say("The entry's env BRIDGE_TOKEN equals bridge.token (it is not needed there).");
}

let copied = false, /** @type {import("node:readline/promises").Interface | null} */ rl = null;
if (!dry && token && process.stdin.isTTY && process.stdout.isTTY) {
  head("Token to the clipboard");
  rl = createInterface({ input: process.stdin, output: process.stdout });
  if (/^y/i.test(await rl.question("Copy the token to the clipboard for the extension's Options page? [y/N] "))) {
    copied = spawnSync("clip.exe", { input: token.trim() }).status === 0;
    say(copied ? "Copied (Windows clipboard history, Win+V, may keep a copy: delete it there after pasting)." : "Copy failed.");
  }
} else if (!dry) say("\nNo terminal to ask in: the token was not copied. Run npm run setup in a terminal to copy it.");
say(`\n${lib.nextSteps(repo, { copied })}`);
if (rl && copied) {
  // Ctrl+C or a closed stdin at this prompt still empties the clipboard (S2a F5): once, on any way out.
  let emptied = false;
  const empty = () => { if (!emptied) { emptied = true; say(spawnSync("clip.exe", { input: "" }).status === 0 ? "Clipboard emptied." : "Could not empty the clipboard."); } };
  process.on("exit", empty);
  rl.on("SIGINT", () => process.exit(130));
  rl.on("close", () => { if (!emptied) process.exit(130); });
  await rl.question("\nAfter pasting the token in step 4, press Enter to empty the clipboard... ");
  empty();
}
rl?.close();
const end = lib.finish(failed);
if (end.code) { say(`\n${end.line}`); process.exitCode = end.code; }
