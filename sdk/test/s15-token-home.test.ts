// Step 15 S2 (#449): the token's per-user home and the lookup order — BRIDGE_TOKEN, then the per-user file, then a
// clone's bridge.token (skipped inside the installed package) — and the daemon found next to the installed package.
// Every fact is injected: env, platform and the tree are scratch; the real per-user folder is never read.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findFileToken, findPackageRoot, resolveToken, userTokenFile } from "../src/token.js";
import { resolveDaemonPath } from "../src/paths.js";

const SECRET = "s15-secret-token-value";

describe("userTokenFile — the per-user file per OS, from env alone", () => {
  it("Windows: %APPDATA%\\browser-agent-bridge\\bridge.token", () => {
    expect(userTokenFile({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "win32")).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\browser-agent-bridge\\bridge.token",
    );
  });
  it("Windows without APPDATA: %USERPROFILE%\\AppData\\Roaming", () => {
    expect(userTokenFile({ USERPROFILE: "C:\\Users\\u" }, "win32")).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\browser-agent-bridge\\bridge.token",
    );
  });
  it("macOS: ~/Library/Application Support/browser-agent-bridge/bridge.token", () => {
    expect(userTokenFile({ HOME: "/Users/u", XDG_CONFIG_HOME: "/x" }, "darwin")).toBe(
      "/Users/u/Library/Application Support/browser-agent-bridge/bridge.token",
    );
  });
  it("Linux: $XDG_CONFIG_HOME/browser-agent-bridge/bridge.token", () => {
    expect(userTokenFile({ HOME: "/home/u", XDG_CONFIG_HOME: "/home/u/cfg" }, "linux")).toBe(
      "/home/u/cfg/browser-agent-bridge/bridge.token",
    );
  });
  it("Linux without XDG_CONFIG_HOME, or with a relative one: ~/.config", () => {
    expect(userTokenFile({ HOME: "/home/u" }, "linux")).toBe("/home/u/.config/browser-agent-bridge/bridge.token");
    expect(userTokenFile({ HOME: "/home/u", XDG_CONFIG_HOME: "rel/cfg" }, "linux")).toBe(
      "/home/u/.config/browser-agent-bridge/bridge.token",
    );
  });
  it("no home in env → null (nothing is read)", () => {
    expect(userTokenFile({}, "win32")).toBeNull();
    expect(userTokenFile({}, "darwin")).toBeNull();
    expect(userTokenFile({ XDG_CONFIG_HOME: "rel" }, "linux")).toBeNull();
    expect(userTokenFile({ HOME: "  " }, "linux")).toBeNull();
  });
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "bridge-s15-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const json = (file: string, v: unknown) => writeFileSync(file, JSON.stringify(v));
/** A clone: root/{package.json with workspaces, sdk/src, bridge.token?}. */
function clone(withToken: string | null): string {
  const dir = path.join(root, "clone");
  mkdirSync(path.join(dir, "sdk", "src"), { recursive: true });
  json(path.join(dir, "package.json"), { name: "browser-agent-bridge", workspaces: ["sdk"] });
  json(path.join(dir, "sdk", "package.json"), { name: "@bridge/sdk" });
  if (withToken !== null) writeFileSync(path.join(dir, "bridge.token"), withToken);
  return path.join(dir, "sdk", "src");
}
/** An installed package inside a project whose own root has workspaces and a bridge.token. */
function installed(): string {
  const proj = path.join(root, "proj");
  const pkg = path.join(proj, "node_modules", "browser-agent-bridge");
  mkdirSync(path.join(pkg, "dist"), { recursive: true });
  json(path.join(proj, "package.json"), { name: "someone-else", workspaces: ["a"] });
  writeFileSync(path.join(proj, "bridge.token"), "PROJECT-TOKEN");
  json(path.join(pkg, "package.json"), { name: "browser-agent-bridge", version: "0.2.0" });
  return path.join(pkg, "dist");
}
/** env whose per-user file lives under root/appdata (Windows layout). */
function userEnv(token: string | null): Record<string, string> {
  const appdata = path.join(root, "appdata");
  if (token !== null) {
    mkdirSync(path.join(appdata, "browser-agent-bridge"), { recursive: true });
    writeFileSync(path.join(appdata, "browser-agent-bridge", "bridge.token"), token);
  }
  return { APPDATA: appdata };
}
const W = { platform: "win32" as const };
// path.win32 joins the scratch path as given; on POSIX hosts the test uses linux with XDG_CONFIG_HOME instead.
const plat = process.platform === "win32" ? W : { platform: "linux" as const };
function env(token: string | null): Record<string, string> {
  const e = userEnv(token);
  return process.platform === "win32" ? e : { XDG_CONFIG_HOME: e.APPDATA };
}

describe("findPackageRoot — the installed package, never a clone", () => {
  it("the first package.json up names browser-agent-bridge and has no workspaces → its folder", () => {
    const dist = installed();
    expect(findPackageRoot(dist)).toBe(path.dirname(dist));
  });
  it("a clone (workspaces) or a workspace package (@bridge/sdk) → null", () => {
    expect(findPackageRoot(clone(null))).toBeNull();
    expect(findPackageRoot(path.join(root, "clone"))).toBeNull();
  });
  it("someone else's package.json first → null (it stops at the first one)", () => {
    mkdirSync(path.join(root, "app", "lib"), { recursive: true });
    json(path.join(root, "app", "package.json"), { name: "app" });
    json(path.join(root, "package.json"), { name: "browser-agent-bridge" });
    expect(findPackageRoot(path.join(root, "app", "lib"))).toBeNull();
  });
});

describe("the lookup order: BRIDGE_TOKEN, the per-user file, a clone's bridge.token", () => {
  it("BRIDGE_TOKEN wins over both files", () => {
    expect(resolveToken({ env: { ...env("USER"), BRIDGE_TOKEN: "ENV" }, startDir: clone("CLONE"), ...plat })).toBe("ENV");
  });
  it("the per-user file wins over the clone's bridge.token, trimmed", () => {
    expect(resolveToken({ env: env(`  ${SECRET}\r\n`), startDir: clone("CLONE"), ...plat })).toBe(SECRET);
    expect(findFileToken({ env: env(SECRET), startDir: clone("CLONE"), ...plat })).toMatchObject({ source: "user" });
  });
  it("an empty per-user file falls through to the clone's bridge.token", () => {
    expect(resolveToken({ env: env(" \n"), startDir: clone("CLONE"), ...plat })).toBe("CLONE");
    expect(findFileToken({ env: env(null), startDir: clone("CLONE"), ...plat })).toMatchObject({
      source: "clone",
      file: path.join(root, "clone", "bridge.token"),
    });
  });
  it("inside the installed package the clone step is skipped (a project's bridge.token is never read)", () => {
    const dist = installed();
    expect(() => resolveToken({ env: env(null), startDir: dist, ...plat })).toThrow(/BRIDGE_TOKEN/);
    expect(findFileToken({ env: env(null), startDir: dist, ...plat })).toBeNull();
    expect(resolveToken({ env: env(SECRET), startDir: dist, ...plat })).toBe(SECRET);
  });
  it("none → the message names BRIDGE_TOKEN and the per-user file, never a token value", () => {
    const e = env(null);
    let message = "";
    try {
      resolveToken({ env: e, startDir: installed(), ...plat });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("BRIDGE_TOKEN");
    expect(message).toContain(path.join(Object.values(e)[0], "browser-agent-bridge", "bridge.token"));
    expect(message).not.toContain("PROJECT-TOKEN");
  });
  it("a clone with neither file names all three places", () => {
    const e = env(null);
    expect(() => resolveToken({ env: e, startDir: clone(null), ...plat })).toThrow(/BRIDGE_TOKEN.*browser-agent-bridge.*bridge\.token/s);
  });
});

describe("resolveDaemonPath — next to the installed package", () => {
  it("installed: <package>/dist/daemon.js, not the clone layout", () => {
    const dist = installed();
    writeFileSync(path.join(dist, "daemon.js"), "// daemon");
    expect(resolveDaemonPath({ env: {}, startDir: dist })).toBe(path.join(dist, "daemon.js"));
  });
  it("installed but daemon.js missing → an error naming the file and a reinstall", () => {
    const dist = installed();
    expect(() => resolveDaemonPath({ env: {}, startDir: dist })).toThrow(/daemon\.js.*reinstall/s);
  });
  it("BRIDGE_DAEMON still overrides the package's daemon", () => {
    const dist = installed();
    writeFileSync(path.join(dist, "daemon.js"), "// daemon");
    const other = path.join(root, "other.js");
    writeFileSync(other, "// other");
    expect(resolveDaemonPath({ env: { BRIDGE_DAEMON: other }, startDir: dist })).toBe(other);
  });
});
