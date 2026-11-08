// The bridge token lookup (Step 15 S2, decisions.md #449): `BRIDGE_TOKEN` env wins, then the per-user file
// (`userTokenFile`), then `bridge.token` at a clone's workspace root — that last step is skipped inside the installed
// npm package, so a project's own `bridge.token` is never read. The daemon imports this file through the `./token`
// subpath, so it must import node built-ins only — never the client. Never put the token in a message.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOKEN_FILE = "bridge.token";
/** The npm package's name; also the per-user folder's name. */
export const PACKAGE_NAME = "browser-agent-bridge";

type ReadFile = (file: string) => string;
type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

const readUtf8: ReadFile = (file) => readFileSync(file, "utf8");

/**
 * Walks up from `startDir` to the first directory whose `package.json` parses and has a
 * `"workspaces"` field. Stops at the filesystem root (`dirname(dir) === dir`: `C:\`, a UNC root,
 * `/`); returns null if none was found.
 */
export function findWorkspaceRoot(startDir: string, readFile: ReadFile = readUtf8): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    try {
      const pkg: unknown = JSON.parse(readFile(path.join(dir, "package.json")));
      if (typeof pkg === "object" && pkg !== null && "workspaces" in pkg) return dir;
    } catch {
      // missing or unparsable package.json — keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The installed npm package's folder: walks up from `startDir` to the first `package.json` that parses, and returns
 * its folder when it names `browser-agent-bridge` and has no `workspaces` (a clone's root has them); else null. It
 * stops at that first `package.json`, so the SDK bundled into someone else's package is not taken for ours (that app then gets the clone rules for its own root).
 */
export function findPackageRoot(startDir: string, readFile: ReadFile = readUtf8): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    let pkg: unknown = undefined;
    try {
      pkg = JSON.parse(readFile(path.join(dir, "package.json")));
    } catch {
      // missing or unparsable — keep walking
    }
    if (typeof pkg === "object" && pkg !== null) {
      const p = pkg as { name?: unknown; workspaces?: unknown };
      return p.name === PACKAGE_NAME && !("workspaces" in p) ? dir : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The per-user token file, from `env` and `platform` alone (null when env names no home, so nothing is read):
 * Windows `%APPDATA%\browser-agent-bridge\bridge.token` (else `%USERPROFILE%\AppData\Roaming\…`), macOS
 * `~/Library/Application Support/browser-agent-bridge/bridge.token`, others `$XDG_CONFIG_HOME/…` when absolute,
 * else `~/.config/browser-agent-bridge/bridge.token`.
 */
export function userTokenFile(env: Env, platform: NodeJS.Platform = process.platform): string | null {
  const v = (k: string) => env[k]?.trim() || undefined;
  if (platform === "win32") {
    const p = path.win32;
    const appdata = v("APPDATA") ?? (v("USERPROFILE") ? p.join(v("USERPROFILE")!, "AppData", "Roaming") : undefined);
    return appdata ? p.join(appdata, PACKAGE_NAME, TOKEN_FILE) : null;
  }
  const p = path.posix;
  const home = v("HOME");
  if (platform === "darwin") return home ? p.join(home, "Library", "Application Support", PACKAGE_NAME, TOKEN_FILE) : null;
  const xdg = v("XDG_CONFIG_HOME");
  const base = xdg && p.isAbsolute(xdg) ? xdg : home ? p.join(home, ".config") : undefined;
  return base ? p.join(base, PACKAGE_NAME, TOKEN_FILE) : null;
}

/** This module's own directory: `sdk/src` from source, `mcp/dist` or `daemon/dist` once bundled. */
export function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export interface ResolveTokenOptions {
  env?: Env;
  /** Where the package and workspace-root walks start. Default: this module's directory. */
  startDir?: string;
  /** Default `process.platform`: picks the per-user file's layout. */
  platform?: NodeJS.Platform;
  readFile?: ReadFile;
}

/** Where a file token was found; `file` is a path, never shown with the token. */
export interface FileToken {
  token: string;
  source: "user" | "clone";
  file: string;
}

function readTrimmed(file: string, readFile: ReadFile): string {
  try {
    return readFile(file).trim();
  } catch {
    return ""; // missing or unreadable counts as empty
  }
}

/**
 * The token from the files alone (BRIDGE_TOKEN is not consulted): the per-user file, then a clone's `bridge.token`
 * (not inside the installed package). Null when neither holds one.
 */
export function findFileToken(options: ResolveTokenOptions = {}): FileToken | null {
  const env = options.env ?? process.env;
  const startDir = options.startDir ?? moduleDir();
  const readFile = options.readFile ?? readUtf8;
  const user = userTokenFile(env, options.platform ?? process.platform);
  if (user) {
    const token = readTrimmed(user, readFile);
    if (token) return { token, source: "user", file: user };
  }
  if (findPackageRoot(startDir, readFile) !== null) return null;
  const root = findWorkspaceRoot(startDir, readFile);
  if (root === null) return null;
  const file = path.join(root, TOKEN_FILE);
  const token = readTrimmed(file, readFile);
  return token ? { token, source: "clone", file } : null;
}

/**
 * The bridge token. Throws (before any socket is opened) when no place has one, naming each place looked at;
 * the message never contains a token value.
 */
export function resolveToken(options: ResolveTokenOptions = {}): string {
  const env = options.env ?? process.env;
  const startDir = options.startDir ?? moduleDir();
  const readFile = options.readFile ?? readUtf8;

  const fromEnv = env.BRIDGE_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const hit = findFileToken({ ...options, env, startDir, readFile });
  if (hit) return hit.token;

  const user = userTokenFile(env, options.platform ?? process.platform);
  const places = ["set the BRIDGE_TOKEN environment variable"];
  if (user) places.push(`put the token in ${user}`);
  let tail = "";
  if (findPackageRoot(startDir, readFile) === null) {
    const root = findWorkspaceRoot(startDir, readFile);
    if (root === null) tail = ` (no workspace root found above ${path.resolve(startDir)} for a clone's ${TOKEN_FILE})`;
    else places.push(`put it in ${path.join(root, TOKEN_FILE)} (a clone)`);
  }
  throw new Error(
    `No bridge token: ${places.join(", or ")} — missing or empty${tail}. It must match the token in the extension's Options.`,
  );
}
