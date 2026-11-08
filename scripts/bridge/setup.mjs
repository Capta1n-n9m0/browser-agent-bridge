// @ts-check
// `npm run setup [-- --dry-run] [-- --replace-mcp]` from a clone, `npx browser-agent-bridge setup [--dry-run]` from the
// installed package (bundled to dist/setup.js): one-command install on Windows, macOS and Linux (Step 14 S2a, Step 15 S3).
// Node built-ins only (runs before `npm ci`). The token is never printed, logged or put on a command line: it is
// written to the per-user bridge.token only, and reaches the clipboard tool on stdin after the user says yes.
// `--platform=win32|darwin|linux` is accepted with `--dry-run` only, to show another OS's plan.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import * as lib from "./lib.mjs";
import { writeHostRegistration } from "./host-register.mjs";

const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "setup"));
const flags = new Set(args), dry = flags.has("--dry-run");
const platformArg = args.find((a) => a.startsWith("--platform="))?.slice("--platform=".length);
if (platformArg !== undefined && !dry) { console.error("--platform is only for --dry-run (it shows another OS's plan and writes nothing)."); process.exit(2); }
if (platformArg !== undefined && !["win32", "darwin", "linux"].includes(platformArg)) { console.error("--platform must be win32, darwin or linux."); process.exit(2); }
const platform = platformArg ?? process.platform, foreign = platform !== process.platform;
const here = path.dirname(fileURLToPath(import.meta.url));
/** The first package.json up from here: ours without `workspaces` → the installed package (like the SDK's findPackageRoot). */
const pkgRoot = (() => {
  for (let d = here; ; d = path.dirname(d)) {
    try {
      const p = JSON.parse(readFileSync(path.join(d, "package.json"), "utf8"));
      if (p && typeof p === "object") return p.name === lib.SERVER_NAME && !("workspaces" in p) ? d : null;
    } catch { /* keep walking */ }
    if (path.dirname(d) === d) return null;
  }
})();
/** @type {"clone" | "package"} */
const mode = pkgRoot ? "package" : "clone";
const root = pkgRoot ?? path.resolve(here, "..", "..");
const repo = root; // clone only: the checkout (in package mode no repo is used)
const env = process.env;
const home = (platform === "win32" ? null : env.HOME?.trim()) || null;
const say = (/** @type {string} */ s) => console.log(s);
const head = (/** @type {string} */ s) => say(`\n== ${s}${dry ? " (dry run)" : ""}`);
const quote = (/** @type {string} */ a) => (/[\s"&]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
/** @param {string} file @param {string[]} argv @param {object} [o] a .cmd shim needs a shell (Node >= 20.12) */
const run = (file, argv, o = {}) => /\.(cmd|bat)$/i.test(file)
  ? spawnSync(quote(file), argv.map(quote), { shell: true, ...o }) : spawnSync(file, argv, o);
/** @param {string} name full path of `name` on PATH, or null */
const which = (name) => {
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean))
    for (const ext of platform === "win32" ? ["", ...(env.PATHEXT ?? ".EXE;.CMD").toLowerCase().split(";")] : [""]) {
      const f = path.join(dir, name + ext);
      if ((ext || platform !== "win32") && existsSync(f)) return f;
    }
  return null;
};
// Under `npm run`, npm_execpath is npm-cli.js: run it with this node (no shell, no .cmd shim).
const npmExec = env.npm_execpath?.endsWith(".js") ? env.npm_execpath : null;
/** @param {string[]} argv @param {object} [o] */
const npm = (argv, o) => npmExec ? run(process.execPath, [npmExec, ...argv], o) : run(which("npm") ?? "npm", argv, o);
const out = (/** @type {any} */ r) => (r.status === 0 ? String(r.stdout).trim().split("\n")[0] : null);
/** @param {string} what @param {string[]} argv */
const npmStep = (what, argv) => {
  if (dry) return say(`would run: npm ${argv.join(" ")}`);
  say(`${what}: npm ${argv.join(" ")}`);
  if (npm(argv, { cwd: repo, stdio: "inherit" }).status !== 0) { say(`FAIL: npm ${argv[0]} failed (above).`); process.exit(1); }
};
/** @type {(f: string) => string | null} */
const readMaybe = (f) => { if (foreign) return null; try { return readFileSync(f, "utf8"); } catch { return null; } };

head(`Prerequisites (${mode}, ${platform})`);
if (foreign) say("Another OS's dry run: the probes for node, npm, git and Chrome are skipped.");
else {
  const cand = lib.chromeCandidates(platform, env);
  const chrome = cand.files.some((f) => existsSync(f)) || cand.onPath.some((n) => which(n));
  const lines = lib.checkPrereqs({ node: process.versions.node, npm: out(npm(["--version"], { encoding: "utf8" })),
    git: mode === "package" ? null : out(spawnSync("git", ["--version"], { encoding: "utf8" })), chrome }, { mode });
  for (const l of lines) say(lib.formatLine(l));
  if (lines.some((l) => l.level === "fail")) process.exit(1);
}

if (mode === "clone") {
  head("Install and build");
  if (foreign) say("Skipped (another OS's dry run).");
  else {
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
  }
}

head("Token");
const userFile = lib.userTokenFile(env, platform);
const repoFile = mode === "clone" ? path.join(repo, lib.TOKEN_FILE) : null;
const userTok = userFile ? readMaybe(userFile) : null, repoTok = repoFile ? readMaybe(repoFile) : null;
const tplan = lib.tokenPlan({ user: userTok, repo: repoTok });
/** @type {string | null} */ let token = userTok?.trim() ? userTok : repoTok;
/** @param {string} file @param {string} text @param {number} mode */
const writeSecure = (file, text, mode) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text, { mode }); };
const rmRepo = () => { if (repoFile && !dry) unlinkSync(repoFile); };
if (!userFile) { say("FAIL: no home folder found in the environment (APPDATA / USERPROFILE / HOME): cannot place the token file."); process.exit(1); }
say(`Token file: ${userFile}`);
if (tplan === "keep") say("exists: kept (not shown).");
else if (tplan === "keep-both-differ") say(`Both ${userFile} and ${repoFile} hold a token and they differ: kept both. The per-user file wins; delete the checkout's copy if you do not use it.`);
else if (tplan === "keep-remove-repo") { say(`The checkout's bridge.token equals the per-user file: ${dry ? "would delete" : "deleted"} the checkout's copy.`); rmRepo(); }
else if (tplan === "move") {
  say(`${dry ? "would move" : "Moved"} the checkout's bridge.token into the per-user file (not shown).`);
  if (!dry) { writeSecure(userFile, /** @type {string} */ (repoTok).trim() + "\n", 0o600); rmRepo(); }
} else if (dry) say("would create it (random, 256 bits).");
else { token = randomBytes(32).toString("hex"); writeSecure(userFile, token + "\n", 0o600); say("Created (random, 256 bits; not shown)."); }

head("Claude Code MCP entry (user scope)");
const cfgPath = lib.claudeConfigPath(env, os.homedir(), platform);
/** @type {any} */ let cfg = {};
/** @type {string[]} */ const failed = [];
try { const t = readMaybe(cfgPath); if (t) cfg = JSON.parse(t); }
catch { cfg = null; failed.push("MCP registration"); say(`FAIL: cannot parse ${cfgPath}: registration skipped; fix the file and run setup again.`); }
const claude = foreign ? null : which("claude");
const addArgv = lib.mcpAddArgv(repo, { mode, platform });
const setupAgain = mode === "package" ? "npx browser-agent-bridge setup" : "npm run setup";
if (cfg) {
  const d = lib.mcpDecision(cfg, repo, { tokenFile: token, replace: flags.has("--replace-mcp"), mode, platform });
  const where = mode === "package" ? "the npm package (npx)" : "this checkout";
  /** @param {string[]} argv */
  const claudeRun = (argv) => {
    if (dry || !claude) return say(`${claude || dry ? "would run" : "run"}: claude ${argv.map(quote).join(" ")}`);
    const r = run(claude, argv, { stdio: "inherit" });
    if (r.status !== 0) failed.push(`claude ${argv[1]}`);
    say(r.status === 0 ? "done." : `FAIL: claude exited ${r.status}: run it yourself: claude ${argv.map(quote).join(" ")}`);
  };
  if (!claude && !dry && d.action !== "leave") say("The claude CLI is not on PATH: install Claude Code (claude.com/claude-code), then:");
  if (d.action === "leave") say(`${lib.SERVER_NAME} already points at ${where}: left as it is.`);
  if (d.action === "report") say(`${lib.SERVER_NAME} points at ${d.existing}, not ${where}. Left as it is; run ${setupAgain} ${mode === "package" ? "" : "-- "}--replace-mcp to replace it.`);
  for (const name of d.legacy) {
    say(`Replacing the old ${name} entry with ${lib.SERVER_NAME} (the product's new name).`);
    claudeRun(lib.mcpRemoveArgv(name));
  }
  if (d.action === "replace" && d.current) claudeRun(lib.MCP_REMOVE_ARGV);
  if (d.action === "add" || d.action === "replace") claudeRun(addArgv);
  for (const dir of d.localLeftovers) say(`A local-scope ${lib.SERVER_NAME} entry for ${dir} wins there: in that folder run claude mcp remove -s local ${lib.SERVER_NAME}`);
  for (const { dir, name } of d.legacyLocal) say(`A local-scope ${name} entry (the old name) for ${dir} runs there: in that folder run claude mcp remove -s local ${name}`);
  if (d.envToken === "differs") say("The entry's env BRIDGE_TOKEN differs from the token file and wins over it: remove BRIDGE_TOKEN from the entry.");
  if (d.envToken === "same") say("The entry's env BRIDGE_TOKEN equals the token file (it is not needed there).");
}

head("Native host (registration)");
const plan = lib.nativeHostPlan({ platform, env, home, mode, root, nodePath: process.execPath });
if (!plan) { say("FAIL: no home folder found: the native host was not registered."); failed.push("native host registration"); }
else {
  say(`manifest: ${plan.manifestPath}\nlauncher: ${plan.launcherPath}\nscript:   ${plan.scriptPath}${existsSync(plan.scriptPath) ? "" : " (missing: the extension cannot pair by itself until it exists)"}`);
  if (plan.registry) say(`registry: ${plan.registry.key} (default value = the manifest path)`);
  if (!dry) {
    try {
      writeHostRegistration(plan); // Step 15 S5: the same writes the MCP server's first start makes
      say(`Registered for the extension ${lib.EXTENSION_ID} only: it hands that extension the token and port, nothing else.`);
    } catch (err) { failed.push("native host registration"); say(`FAIL: ${err instanceof Error ? err.message : "write failed"}`); }
  }
}

const clipTool = platform === "win32" ? "clip.exe" : platform === "darwin" ? "pbcopy" : null;
let copied = false, /** @type {import("node:readline/promises").Interface | null} */ rl = null;
if (!dry && token && process.stdin.isTTY && process.stdout.isTTY && clipTool) {
  head("Token to the clipboard");
  rl = createInterface({ input: process.stdin, output: process.stdout });
  if (/^y/i.test(await rl.question("Copy the token to the clipboard for the extension's Options page? [y/N] "))) {
    copied = spawnSync(clipTool, { input: token.trim() }).status === 0;
    say(copied ? (platform === "win32" ? "Copied (Windows clipboard history, Win+V, may keep a copy: delete it there after pasting)." : "Copied.") : "Copy failed.");
  }
} else if (!dry && !clipTool) say(`\nNo clipboard tool on this OS: open ${userFile} and copy its one line.`);
else if (!dry) say(`\nNo terminal to ask in: the token was not copied. Run ${setupAgain} in a terminal to copy it.`);
say(`\n${lib.nextSteps(repo, { copied, platform, mode, tokenFile: userFile })}`);
if (rl && copied && clipTool) {
  // Ctrl+C or a closed stdin at this prompt still empties the clipboard (S2a F5): once, on any way out.
  let emptied = false;
  const empty = () => { if (!emptied) { emptied = true; say(spawnSync(clipTool, { input: "" }).status === 0 ? "Clipboard emptied." : "Could not empty the clipboard."); } };
  process.on("exit", empty);
  rl.on("SIGINT", () => process.exit(130));
  rl.on("close", () => { if (!emptied) process.exit(130); });
  await rl.question("\nAfter pasting the token in step 4, press Enter to empty the clipboard... ");
  empty();
}
rl?.close();
const end = lib.finish(failed);
if (end.code) { say(`\n${end.line}`); process.exitCode = end.code; }
