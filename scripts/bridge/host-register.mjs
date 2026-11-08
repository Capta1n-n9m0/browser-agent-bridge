// @ts-check
// Step 15 S5 (#449): the native host registration's I/O, shared by setup and the MCP server's first start. Node
// built-ins only (setup runs before `npm ci`; the MCP bundles it). It never prints, never logs and never returns a
// path, an error message or a token: the first start's caller logs one fixed line from `status`.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as lib from "./lib.mjs";

/**
 * @typedef {{ readFile: (f: string) => string | null, exists: (f: string) => boolean, mkdir: (d: string) => void,
 *   writeFile: (f: string, data: string, o: { mode: number, flag?: string }) => void, chmod: (f: string, mode: number) => void }} Io
 * @typedef {(argv: string[]) => { status: number | null, stdout: string }} Reg
 * @typedef {NonNullable<ReturnType<typeof lib.nativeHostPlan>>} Plan
 */

/** @type {Io} */
const realIo = {
  readFile: (f) => { try { return readFileSync(f, "utf8"); } catch { return null; } },
  exists: (f) => existsSync(f),
  mkdir: (d) => { mkdirSync(d, { recursive: true }); },
  writeFile: (f, data, o) => writeFileSync(f, data, o),
  chmod: (f, mode) => chmodSync(f, mode),
};
/** `reg.exe` by argv, never a shell. @type {Reg} */
export const realReg = (argv) => {
  const r = spawnSync("reg", argv, { encoding: "utf8", timeout: 5000, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "" };
};

/**
 * The installed package's folder: the first `package.json` up from `startDir`, when it is ours without `workspaces`
 * (as the SDK's `findPackageRoot` and setup decide). A clone's `mcp/package.json` (`@bridge/mcp`) gives null.
 * @param {string} startDir @param {Io["readFile"]} [readFile]
 */
export function findPackageRootFrom(startDir, readFile = realIo.readFile) {
  for (let d = path.resolve(startDir); ; d = path.dirname(d)) {
    const text = readFile(path.join(d, "package.json"));
    if (text !== null) {
      try {
        const p = JSON.parse(text);
        if (p && typeof p === "object") return p.name === lib.SERVER_NAME && !("workspaces" in p) ? d : null;
      } catch { /* unparsable: keep walking */ }
    }
    if (path.dirname(d) === d) return null;
  }
}

/** What is registered now. @param {Plan} plan @param {Io} io @param {Reg} reg */
export function readHostState(plan, io, reg) {
  let registry = null;
  if (plan.registry) {
    const r = reg(lib.regQueryArgv(plan.registry.key));
    registry = r.status === 0 ? lib.parseRegDefault(r.stdout) : null;
  }
  return { manifest: io.readFile(plan.manifestPath), launcher: io.readFile(plan.launcherPath), registry };
}

/**
 * Writes the manifest, the launcher and (Windows) the HKCU key. Throws on any failure.
 * @param {Plan} plan @param {Partial<Io>} [ioOverride] @param {Reg} [reg]
 */
export function writeHostRegistration(plan, ioOverride = {}, reg = realReg) {
  const io = { ...realIo, ...ioOverride };
  io.mkdir(path.dirname(plan.manifestPath));
  io.mkdir(path.dirname(plan.launcherPath));
  io.writeFile(plan.manifestPath, lib.manifestText(plan), { mode: 0o644 });
  io.writeFile(plan.launcherPath, plan.launcherText, { mode: plan.launcherMode });
  if (plan.launcherMode & 0o100) io.chmod(plan.launcherPath, plan.launcherMode);
  if (plan.registry) {
    const r = reg(lib.regAddArgv(plan.registry));
    if (r.status !== 0) throw new Error(`reg add exited ${r.status}`);
  }
}

/**
 * The MCP server's first-start step: makes the per-user token when none exists, then registers the native host for
 * this install when the registration differs. Never throws. `BRIDGE_NO_HOST_REGISTRATION=1` turns it off.
 * @param {{ env: Record<string, string | undefined>, platform: NodeJS.Platform, startDir: string, execPath: string,
 *   electron: boolean, reg?: Reg, io?: Partial<Io> }} o
 * @returns {{ status: "skipped" | "up-to-date" | "registered" | "failed", reason: string, tokenCreated: boolean }}
 */
export function firstStartRegistration(o) {
  let tokenCreated = false;
  try {
    const io = { ...realIo, ...o.io }, reg = o.reg ?? realReg;
    const platform = /** @type {"win32" | "darwin" | "linux"} */ (o.platform === "win32" || o.platform === "darwin" ? o.platform : "linux");
    const disabled = o.env.BRIDGE_NO_HOST_REGISTRATION?.trim() === "1";
    const root = disabled ? null : findPackageRootFrom(o.startDir, io.readFile);
    const home = (platform === "win32" ? null : o.env.HOME?.trim()) || null;
    const plan = root === null ? null : lib.nativeHostPlan({ platform, env: o.env, home, mode: "package", root, nodePath: o.execPath, electron: o.electron });
    const tokenFile = lib.userTokenFile(o.env, platform);
    const tokenText = tokenFile && root !== null ? io.readFile(tokenFile) : null;
    const d = lib.firstStartDecision({
      mode: root === null ? "clone" : "package", disabled, plan, script: plan ? io.exists(plan.scriptPath) : false,
      current: plan && root !== null ? readHostState(plan, io, reg) : { manifest: null, launcher: null, registry: null },
      envToken: !!o.env.BRIDGE_TOKEN?.trim(), userToken: !!tokenText?.trim(),
    });
    let failed = false;
    if (d.createToken && tokenFile) {
      try {
        io.mkdir(path.dirname(tokenFile));
        // "wx" when the file is missing: two servers starting at once keep the first token, never swap it.
        io.writeFile(tokenFile, randomBytes(32).toString("hex") + "\n", { mode: 0o600, flag: tokenText === null ? "wx" : "w" });
        tokenCreated = true;
      } catch (err) {
        if (!(err && typeof err === "object" && "code" in err && err.code === "EEXIST")) failed = true;
      }
    }
    if (d.register && plan) {
      try { writeHostRegistration(plan, io, reg); } catch { failed = true; }
    }
    const status = failed ? "failed" : d.register ? "registered" : d.reason === "up-to-date" ? "up-to-date" : "skipped";
    return { status, reason: d.reason, tokenCreated };
  } catch {
    return { status: "failed", reason: "error", tokenCreated };
  }
}
