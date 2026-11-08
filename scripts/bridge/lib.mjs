// @ts-check
// Step 14: the pure logic of `npm run setup` (and, from S2b, doctor and update). Node built-ins only: setup runs
// before `npm ci`. Nothing here reads a file, spawns a process or holds a token value (#427-#429).
import path from "node:path";

export const SERVER_NAME = "browser-agent-bridge";
/** The MCP server's names before the rename (Step 15 S1, #444): setup replaces them, the doctor reports them. */
export const LEGACY_SERVER_NAMES = ["chrome-agent-bridge"];
export const PORT = 9234;
export const MIN_NODE_MAJOR = 20; // docs/setup.md Prerequisites; no `engines` field in package.json
/** npm runs these on its own (`npm ci` among them): no root script may take one (Stage0.md C1). */
export const LIFECYCLE_NAMES = [
  "preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare",
  "prepack", "postpack", "publish", "dependencies", "update", "preupdate", "postupdate",
];

/** @typedef {{ name: string, level: "ok" | "fail" | "hint", detail: string, fix: string }} Line */

/**
 * @param {{ node: string, npm: string | null, git: string | null, chrome: boolean }} found versions, null = missing
 * @returns {Line[]}
 */
export function checkPrereqs(found) {
  /** @type {(name: string, ok: boolean, bad: "fail" | "hint", detail: string, fix: string) => Line} */
  const line = (name, ok, bad, detail, fix) => ({ name, level: ok ? "ok" : bad, detail, fix: ok ? "" : fix });
  return [
    line("Node.js", Number(found.node.split(".")[0]) >= MIN_NODE_MAJOR, "fail", `v${found.node}`,
      `install Node.js ${MIN_NODE_MAJOR} or newer from nodejs.org, then open a new terminal`),
    line("npm", !!found.npm, "fail", found.npm ?? "not found", "npm comes with Node.js: reinstall Node.js, then open a new terminal"),
    line("git", !!found.git, "fail", found.git ?? "not found", "install Git for Windows from git-scm.com (update uses git pull)"),
    line("Chrome", found.chrome, "hint", found.chrome ? "found" : "not found", "install Google Chrome before loading the extension"),
  ];
}

/** @param {string | null} content the bridge.token file's content, null if missing */
export function tokenDecision(content) {
  return content !== null && content.trim() !== "" ? "keep" : "create";
}

/**
 * `npm ci` only when npm's own record of the tree (node_modules/.package-lock.json) is missing or older than the lock.
 * @param {number} lockMtimeMs @param {number | null} installedMtimeMs
 */
export function installNeeded(lockMtimeMs, installedMtimeMs) {
  return installedMtimeMs === null || installedMtimeMs < lockMtimeMs;
}

/** What `npm run build` writes, and what it reads (files, or folders walked whole), relative to the repo. */
export const BUILD_OUTPUTS = ["daemon/dist/index.js", "mcp/dist/index.js",
  ...["sw", "content", "offscreen", "options"].map((n) => `extension/dist/${n}.js`)];
export const BUILD_INPUTS = ["package.json", "package-lock.json", "tsconfig.base.json", "node_modules/.package-lock.json",
  ...["shared", "daemon", "sdk", "mcp", "extension"].flatMap((w) => ["src", "package.json", "tsconfig.json", "build.mjs"]
    .map((f) => `${w}/${f}`))];

/**
 * Build unless every output exists and is strictly newer than every input (any doubt: build).
 * @param {(number | null)[]} outputMtimes null = missing @param {number[]} inputMtimes
 */
export function buildNeeded(outputMtimes, inputMtimes) {
  if (outputMtimes.length === 0 || inputMtimes.length === 0 || outputMtimes.some((m) => m === null)) return true;
  return Math.max(...inputMtimes) >= Math.min(.../** @type {number[]} */ (outputMtimes));
}

/** @param {Record<string, string | undefined>} env @param {string} homedir */
export function claudeConfigPath(env, homedir) {
  return path.win32.join(env.CLAUDE_CONFIG_DIR || homedir, ".claude.json");
}

/** @param {string} p */
const norm = (p) => path.win32.normalize(p).replace(/\\+$/, "").toLowerCase();

/** @param {string} repo */
export const entryPath = (repo) => path.win32.join(repo, "mcp", "dist", "index.js");

/**
 * What setup does with the user-scope MCP entry, from the parsed `.claude.json`.
 * @param {any} config @param {string} repo
 * @param {{ tokenFile: string | null, replace?: boolean }} opts
 * `current`: a user-scope entry under SERVER_NAME exists. `legacy`: the old names present at user scope; with no
 * current entry the old one stands in for it and the action is always "replace" (the rename, #444).
 * @returns {{ action: "add" | "leave" | "report" | "replace", existing: string | null, localLeftovers: string[],
 *   envToken: "none" | "same" | "differs" | "nofile", current: boolean, legacy: string[],
 *   legacyLocal: { dir: string, name: string }[] }}
 */
export function mcpDecision(config, repo, opts) {
  const servers = config?.mcpServers ?? {};
  const current = Boolean(servers[SERVER_NAME]);
  const legacy = LEGACY_SERVER_NAMES.filter((n) => servers[n]);
  const e = mcpEntry(config);
  const projects = Object.entries(config?.projects ?? {});
  const localLeftovers = projects.filter(([, p]) => p?.mcpServers?.[SERVER_NAME]).map(([dir]) => dir);
  const legacyLocal = projects.flatMap(([dir, p]) => LEGACY_SERVER_NAMES.filter((n) => p?.mcpServers?.[n]).map((name) => ({ dir, name })));
  const envTok = e?.env?.BRIDGE_TOKEN;
  /** @type {"none" | "same" | "differs" | "nofile"} */
  const envToken = typeof envTok !== "string" ? "none" : !opts.tokenFile ? "nofile" : envTok.trim() === opts.tokenFile?.trim() ? "same" : "differs";
  const base = { localLeftovers, envToken, current, legacy, legacyLocal };
  if (!e) return { action: "add", existing: null, ...base };
  const args = Array.isArray(e.args) ? e.args : [];
  const existing = String(args.at(-1) ?? e.command ?? "");
  const same = /^node(\.exe)?$/i.test(path.win32.basename(String(e.command ?? ""))) && norm(existing) === norm(entryPath(repo));
  const action = !current ? "replace" : same ? "leave" : opts.replace ? "replace" : "report";
  return { action, existing, ...base };
}

/** The user-scope entry the MCP runs under: SERVER_NAME's, else an old name's. @param {any} config @returns {any} */
export function mcpEntry(config) {
  const servers = config?.mcpServers ?? {};
  return servers[SERVER_NAME] ?? LEGACY_SERVER_NAMES.map((n) => servers[n]).find(Boolean);
}

/** @param {string} repo */
export function mcpAddArgv(repo) {
  return ["mcp", "add", "-s", "user", SERVER_NAME, "--", "node", entryPath(repo)];
}
/** @param {string} name */
export function mcpRemoveArgv(name) {
  return ["mcp", "remove", "-s", "user", name];
}
export const MCP_REMOVE_ARGV = mcpRemoveArgv(SERVER_NAME);

/** A failed part (claude mcp add, an unparsable config) ends setup with exit 2 after the other steps (S2a F2). */
export function finish(/** @type {string[]} */ failedParts) {
  return failedParts.length === 0 ? { code: 0, line: "" }
    : { code: 2, line: `Setup finished, but these parts failed (see above): ${failedParts.join("; ")}.` };
}

/** @param {string} repo @param {{ copied: boolean }} o */
export function nextSteps(repo, o) {
  const tokenFile = path.win32.join(repo, "bridge.token");
  return [
    "Next steps in Chrome:",
    "  1. Open chrome://extensions and turn on Developer mode (top right).",
    `  2. Click "Load unpacked" and choose the folder ${path.win32.join(repo, "extension")}`,
    "  3. Open its Options page (Details > Extension options).",
    `  4. Port: ${PORT}. Token: ${o.copied ? "paste it from the clipboard (Ctrl+V)"
      : `open ${tokenFile} in Notepad and copy its one line (or run npm run setup again to copy it)`}. Save.`,
    "  5. Pin the extension's toolbar button (puzzle-piece menu > pin): it is the kill switch, and so is Alt+Shift+K.",
    "  6. In Claude Code run /mcp (or start a new session); browser_status should say the extension is connected.",
  ].join("\n");
}

// ---- S2b: doctor and update ----

/** @param {Line} l */
export const formatLine = (l) => `${l.level.toUpperCase().padEnd(4)} ${l.name}: ${l.detail}${l.fix ? ` - ${l.fix}` : ""}`;

/**
 * The daemon log's last `extension resync` stamp (`YYYY-MM-DDTHH:MM:SSZ <msg>`, daemon/src/log.ts), null if none.
 * @param {string} log
 */
export function lastResyncMs(log) {
  const hits = [...log.matchAll(/^(\S+Z) extension resync:/gm)];
  return hits.length ? Date.parse(hits[hits.length - 1][1]) : null;
}

/**
 * #432 heuristic: the loaded extension may be older than the build when sw.js was written after the last resync's
 * whole second (the stamp has second precision); no resync seen (or no sw.js) counts as "may be older" (null).
 * @param {number | null} swMtimeMs @param {number | null} resyncMs @returns {boolean | null}
 */
export const extensionOlder = (swMtimeMs, resyncMs) =>
  resyncMs === null || swMtimeMs === null ? null : swMtimeMs >= resyncMs + 1000;

/**
 * @typedef {{ state: "down" } | { state: "refused" } | { state: "notoken" } | { state: "error", detail: string }
 *   | { state: "up", buildSame: boolean, extensionConnected: boolean }} DaemonFact
 * @typedef {"none" | "same" | "differs"} Same
 * @param {{ node: string, build: { missing: boolean, stale: boolean }, token: "ok" | "missing",
 *   mcp: ReturnType<typeof mcpDecision> | null, shellToken: Same, shellPort: Same, daemon: DaemonFact,
 *   extensionOlder: boolean | null, port: string, mode?: "clone" | "package", pkgVersion?: string,
 *   tokenSource?: "user" | "clone" | null, userTokenFile?: string | null }} f the doctor's facts; no token value, only
 *   same/differs. `mode: "package"` (Step 15 S2): run from the installed npm package, so no build, no checkout path and
 *   no `npm run setup` (S3 brings setup to the package).
 * @returns {Line[]}
 */
export function doctorLines(f) {
  /** @type {Line[]} */ const out = [];
  /** @type {(name: string, level: Line["level"], detail: string, fix?: string) => Line[]} */
  const add = (name, level, detail, fix = "") => (out.push({ name, level, detail, fix: level === "ok" ? "" : fix }), out);
  add("Node.js", Number(f.node.split(".")[0]) >= MIN_NODE_MAJOR ? "ok" : "fail", `v${f.node}`,
    `install Node.js ${MIN_NODE_MAJOR} or newer from nodejs.org, then open a new terminal`);
  const pkg = f.mode === "package";
  const setupFix = pkg ? `put the extension's token in ${f.userTokenFile ?? "the per-user bridge.token"} (or set BRIDGE_TOKEN)`
    : "run npm run setup";
  if (pkg) add("Package", "ok", `${SERVER_NAME} ${f.pkgVersion ?? "(unknown version)"}, installed from npm`);
  else if (f.build.missing) add("Build", "fail", "dist files missing", "run npm run build");
  else if (f.build.stale) add("Build", "fail", "sources are newer than dist", "run npm run build, then reload the extension and run /mcp");
  else add("Build", "ok", "dist present and newer than its sources");
  add("Token file", f.token === "ok" ? "ok" : "fail", f.token !== "ok" ? "bridge.token missing or empty"
    : f.tokenSource === "user" ? "the per-user bridge.token present (not shown)" : "bridge.token present (not shown)",
    pkg ? `${setupFix}; the same token goes in the extension's Options`
      : "run npm run setup (it creates bridge.token), then paste the token in the extension's Options");
  const m = f.mcp;
  if (!m) add("MCP entry", "fail", ".claude.json cannot be parsed", "fix the JSON in .claude.json, then run the doctor again");
  else if (!m.current && m.legacy?.length) add("MCP entry", "fail", `a user-scope ${m.legacy.join(", ")} entry (the old name)`,
    `run npm run setup (it replaces it with ${SERVER_NAME})`);
  else if (m.action === "add") add("MCP entry", "fail", `no user-scope ${SERVER_NAME} entry`,
    pkg ? `claude mcp add -s user ${SERVER_NAME} -- npx -y ${SERVER_NAME}` : "run npm run setup");
  else if (pkg) add("MCP entry", "ok", "user scope (its command is not checked from the package)");
  else if (m.action === "leave") add("MCP entry", "ok", "user scope, points at this checkout");
  else add("MCP entry", "fail", `points at ${m.existing}, not this checkout`, "run npm run setup -- --replace-mcp");
  if (m?.envToken === "differs") add("MCP entry's token", "fail", "the entry's BRIDGE_TOKEN differs from bridge.token and wins",
    `remove the entry (claude mcp remove -s user ${m.current ? SERVER_NAME : m.legacy[0]}), then run npm run setup`);
  if (m?.envToken === "same") add("MCP entry's token", "ok", "the entry's BRIDGE_TOKEN equals bridge.token (it works; the env entry is optional)");
  if (m?.envToken === "nofile") add("MCP entry's token", "hint", "bridge.token missing; the MCP entry's own token is used",
    "run npm run setup (it creates bridge.token); remove BRIDGE_TOKEN from the entry only if the doctor then says it differs");
  if (m?.current && m.legacy?.length) add("Old MCP entry", "fail", `a user-scope ${m.legacy.join(", ")} entry (the old name) runs beside it`,
    `run npm run setup (it removes the old entry)`);
  for (const dir of m?.localLeftovers ?? []) add("Local MCP entry", "fail", `a local-scope entry for ${dir} wins there`,
    `in that folder run claude mcp remove -s local ${SERVER_NAME}`);
  for (const { dir, name } of m?.legacyLocal ?? []) add("Local MCP entry", "fail", `a local-scope ${name} entry (the old name) for ${dir} runs there`,
    `in that folder run claude mcp remove -s local ${name}`);
  if (f.shellToken !== "none") add("Shell BRIDGE_TOKEN", f.shellToken === "same" ? "hint" : "fail",
    `${f.shellToken === "same" ? "same as" : "differs from"} the token the MCP uses`, "unset BRIDGE_TOKEN in this shell (scripts then use bridge.token)");
  if (f.shellPort !== "none") add("Shell BRIDGE_PORT", f.shellPort === "same" ? "hint" : "fail",
    `${f.shellPort === "same" ? "same as" : "differs from"} the port the MCP uses`, "unset BRIDGE_PORT (every client must use one port)");
  const d = f.daemon;
  if (d.state === "notoken") add("Daemon", "hint", "not checked: no token to knock with", setupFix);
  else if (d.state === "down") add("Daemon", "hint", "not running", "it starts with the first client (Claude Code or a script)");
  else if (d.state === "refused") add("Daemon", "fail", "running, but it refused the token",
    "it was started with another token: end the sessions that use it, then run /mcp");
  else if (d.state === "error") add("Daemon", "fail", `no answer (${d.detail})`, `check what holds port ${f.port}: netstat -ano | findstr ${f.port}`);
  else add("Daemon", d.buildSame ? "ok" : "hint", d.buildSame ? "running the build on disk" : "running another build than the one on disk",
    "the next client hands it over: run /mcp in Claude Code");
  if (d.state !== "up") return add("Extension", "hint", "not checked (no daemon answered)", "start Claude Code or a script, then run the doctor again");
  add("Extension", d.extensionConnected ? "ok" : "fail", d.extensionConnected ? "connected" : "not connected",
    `open Chrome; check the extension is loaded and enabled and its Options hold port ${f.port} and the token from bridge.token`);
  if (!d.extensionConnected || pkg) return out;
  return add("Extension build (heuristic)", f.extensionOlder === false ? "ok" : "hint",
    f.extensionOlder === false ? "extension resynced after the last build (a heuristic: it cannot tell the loaded build)" : "may be older than the build",
    "reload it: the reload button on chrome://extensions, or npm run bridge-update");
}

/**
 * @param {{ dirty: boolean, code?: number | null, before?: string, after?: string, output?: string }} r
 * @returns {{ kind: "dirty" | "updated" | "current" | "notff" | "fail", stop: boolean, line: string }}
 */
export function pullOutcome(r) {
  if (r.dirty) return { kind: "dirty", stop: true, line: "STOP: the checkout has uncommitted changes: commit or stash them, then run npm run bridge-update again." };
  if (r.code === 0) return r.before === r.after ? { kind: "current", stop: false, line: "Already up to date." }
    : { kind: "updated", stop: false, line: "Pulled the new commits." };
  if (/not possible to fast-forward|diverg/i.test(r.output ?? ""))
    return { kind: "notff", stop: true, line: "STOP: the pull is not a fast-forward (local commits): merge or rebase by hand, then run npm run bridge-update again." };
  return { kind: "fail", stop: true, line: `STOP: git pull failed (exit ${r.code}; above).` };
}

/**
 * How update runs npm with no shell: npm_execpath (set by `npm run`) with this node, else the npm-cli.js that nodejs.org
 * and nvm-windows put beside node.exe and beside the npm.cmd shim on PATH; null when there is none.
 * @param {Record<string, string | undefined>} env @param {string} execPath @param {(f: string) => boolean} exists
 */
export function npmCli(env, execPath, exists) {
  if (env.npm_execpath?.endsWith(".js")) return env.npm_execpath;
  const dirs = [path.win32.dirname(execPath), ...(env.PATH ?? env.Path ?? "").split(";").filter(Boolean)];
  return dirs.map((d) => path.win32.join(d, "node_modules", "npm", "bin", "npm-cli.js")).find(exists) ?? null;
}

const RELOAD_BY_HAND = "reload it by hand: chrome://extensions > Browser Agent Bridge > the reload button";
/**
 * recipes/reload-extension.ps1: 0 reloaded; 2 pressed nothing → one re-run (#99), then a hint (#431); else a failure.
 * Its exit 2 never becomes update's own exit code: update exits 0 or 1 (S2a-verifier2 N4).
 * @param {{ noReload?: boolean, code?: number | null, attempt?: number }} r
 * @returns {{ action: "skip" | "done" | "retry" | "hint" | "fail", line: string }}
 */
export function reloadStep(r) {
  if (r.noReload) return { action: "skip", line: `--no-reload: the extension was not reloaded; ${RELOAD_BY_HAND}.` };
  if (r.code === 0) return { action: "done", line: "Extension reloaded." };
  if (r.code === 2) return r.attempt === 1 ? { action: "retry", line: "The reload pressed nothing (exit 2): running it once more." }
    : { action: "hint", line: `The reload pressed nothing twice (exit 2): ${RELOAD_BY_HAND}.` };
  return { action: "fail", line: `FAIL: reload-extension.ps1 exited ${r.code} (above); ${RELOAD_BY_HAND}.` };
}

export const UPDATE_DONE =
  "Done. In Claude Code run /mcp (or start a new session); the daemon is handed over to the new build by the next client that connects.";

/**
 * Newest mtime under a file or folder, null if missing. @param {string} f
 * @param {{ stat: (f: string) => { mtimeMs: number, isDirectory(): boolean } | null, list: (f: string) => string[],
 *   join: (a: string, b: string) => string }} fs @returns {number | null}
 */
export function newestMtime(f, fs) {
  const st = fs.stat(f);
  if (!st?.isDirectory()) return st ? st.mtimeMs : null;
  return Math.max(st.mtimeMs, ...fs.list(f).map((n) => newestMtime(fs.join(f, n), fs) ?? 0));
}
