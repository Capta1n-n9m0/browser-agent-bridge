// Step 15 S5 (#449): the MCP server registers the native host on its first start, from wherever it runs, and makes the
// per-user token when there is none. The decision is pure (injected facts); the I/O runs against a temp folder with a
// fake `reg`. Nothing here reads the real environment, the real registry or a repo token.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstStartDecision, manifestText, nativeHostPlan } from "../bridge/lib.mjs";
import { firstStartRegistration, findPackageRootFrom } from "../bridge/host-register.mjs";

describe("nativeHostPlan under Electron (Claude Desktop's built-in Node)", () => {
  it("the launchers run the Electron binary as Node", () => {
    const w = nativeHostPlan({ platform: "win32", env: { APPDATA: "C:\\A" }, home: null, mode: "package", root: "C:\\pk", nodePath: "C:\\C\\Claude.exe", electron: true })!;
    expect(w.launcherText).toBe('@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\C\\Claude.exe" "C:\\pk\\dist\\native-host.js" %*\r\n');
    const m = nativeHostPlan({ platform: "darwin", env: { HOME: "/U" }, home: "/U", mode: "package", root: "/pk", nodePath: "/C/Claude", electron: true })!;
    expect(m.launcherText).toBe('#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "/C/Claude" "/pk/dist/native-host.js" "$@"\n');
  });
  it("plain Node keeps the S3 launcher", () => {
    const l = nativeHostPlan({ platform: "linux", env: { HOME: "/h" }, home: "/h", mode: "package", root: "/pk", nodePath: "/n", electron: false })!;
    expect(l.launcherText).toBe('#!/bin/sh\nexec "/n" "/pk/dist/native-host.js" "$@"\n');
  });
});

describe("firstStartDecision", () => {
  const plan = (root: string, platform: "win32" | "linux" = "linux") => platform === "win32"
    ? nativeHostPlan({ platform, env: { APPDATA: "C:\\A" }, home: null, mode: "package", root, nodePath: "C:\\n.exe" })!
    : nativeHostPlan({ platform, env: { HOME: "/h" }, home: "/h", mode: "package", root, nodePath: "/n" })!;
  const current = (p: NonNullable<ReturnType<typeof plan>>) => ({ manifest: manifestText(p), launcher: p.launcherText, registry: p.registry?.value ?? null });
  const base = { mode: "package" as const, disabled: false, script: true, envToken: false, userToken: true };

  it("disabled: nothing at all", () => {
    expect(firstStartDecision({ ...base, disabled: true, userToken: false, plan: plan("/pk"), current: current(plan("/pk")) }))
      .toEqual({ register: false, createToken: false, reason: "disabled" });
  });
  it("a clone: setup owns its registration and its token", () => {
    expect(firstStartDecision({ ...base, mode: "clone", userToken: false, plan: plan("/r"), current: { manifest: null, launcher: null, registry: null } }))
      .toEqual({ register: false, createToken: false, reason: "clone" });
  });
  it("no home folder: nothing", () => {
    expect(firstStartDecision({ ...base, userToken: false, plan: null, current: { manifest: null, launcher: null, registry: null } }))
      .toEqual({ register: false, createToken: false, reason: "no-home" });
  });
  it("the host script missing: no registration pointing nowhere, the token still made", () => {
    expect(firstStartDecision({ ...base, script: false, userToken: false, plan: plan("/pk"), current: { manifest: null, launcher: null, registry: null } }))
      .toEqual({ register: false, createToken: true, reason: "no-script" });
  });
  it("everything in place: up to date (idempotent)", () => {
    expect(firstStartDecision({ ...base, plan: plan("/pk"), current: current(plan("/pk")) })).toEqual({ register: false, createToken: false, reason: "up-to-date" });
    const w = plan("C:\\pk", "win32");
    expect(firstStartDecision({ ...base, plan: w, current: current(w) }).reason).toBe("up-to-date");
    expect(firstStartDecision({ ...base, plan: w, current: { ...current(w), registry: w.registry!.value.toUpperCase() } }).reason).toBe("up-to-date");
  });
  it("nothing registered yet: register", () => {
    expect(firstStartDecision({ ...base, plan: plan("/pk"), current: { manifest: null, launcher: null, registry: null } }))
      .toEqual({ register: true, createToken: false, reason: "changed" });
  });
  it("the server moved (a new npx cache folder): the launcher differs → register again", () => {
    expect(firstStartDecision({ ...base, plan: plan("/npx/2"), current: current(plan("/npx/1")) }).register).toBe(true);
  });
  it("an older manifest (S3's empty allowed_origins) → register again", () => {
    const p = plan("/pk");
    const old = JSON.stringify({ ...p.manifest, allowed_origins: [] }, null, 2) + "\n";
    expect(firstStartDecision({ ...base, plan: p, current: { ...current(p), manifest: old } }).register).toBe(true);
  });
  it("win32: the registry key missing or pointing elsewhere → register; off Windows the registry is not looked at", () => {
    const w = plan("C:\\pk", "win32");
    expect(firstStartDecision({ ...base, plan: w, current: { ...current(w), registry: null } }).register).toBe(true);
    expect(firstStartDecision({ ...base, plan: w, current: { ...current(w), registry: "C:\\other.json" } }).register).toBe(true);
    const l = plan("/pk");
    expect(firstStartDecision({ ...base, plan: l, current: { ...current(l), registry: null } }).register).toBe(false);
  });
  it.each([
    [{ envToken: false, userToken: false }, true],
    [{ envToken: true, userToken: false }, false], // BRIDGE_TOKEN wins: a file token would differ from it
    [{ envToken: false, userToken: true }, false],
  ])("the token: %j → create %s, also when the registration is up to date", (t, want) => {
    expect(firstStartDecision({ ...base, ...t, plan: plan("/pk"), current: current(plan("/pk")) }).createToken).toBe(want);
  });
});

describe("firstStartRegistration (I/O over a temp folder, fake reg)", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(path.join(os.tmpdir(), "bab-s5-")); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  /** A fake installed package at `dir`: package.json named browser-agent-bridge, dist/mcp.js and dist/native-host.js. */
  const pkg = (dir: string, extra: object = {}) => {
    mkdirSync(path.join(dir, "dist"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "browser-agent-bridge", version: "0.2.0", ...extra }));
    writeFileSync(path.join(dir, "dist", "native-host.js"), "");
    return path.join(dir, "dist");
  };
  const fakeReg = () => {
    const calls: string[][] = [];
    let value: string | null = null;
    const reg = (argv: string[]) => {
      calls.push(argv);
      if (argv[0] === "add") { value = argv[argv.indexOf("/d") + 1]; return { status: 0, stdout: "" }; }
      return value === null ? { status: 1, stdout: "" } : { status: 0, stdout: `\r\nHKEY_CURRENT_USER\\X\r\n    (Default)    REG_SZ    ${value}\r\n` };
    };
    return { reg, calls };
  };
  const env = () => ({ APPDATA: path.join(tmp, "appdata"), HOME: path.join(tmp, "home") });
  const run = (startDir: string, o: { env?: Record<string, string>, reg?: ReturnType<typeof fakeReg>["reg"], io?: object } = {}) =>
    firstStartRegistration({ env: o.env ?? env(), platform: process.platform, startDir, execPath: "/n/node", electron: false, reg: o.reg ?? fakeReg().reg, io: o.io });

  it("findPackageRootFrom stops at the first package.json: ours without workspaces", () => {
    const d = pkg(path.join(tmp, "p"));
    expect(findPackageRootFrom(d)).toBe(path.join(tmp, "p"));
    const c = pkg(path.join(tmp, "c"), { workspaces: ["x"] });
    expect(findPackageRootFrom(c)).toBeNull();
    mkdirSync(path.join(tmp, "w", "mcp", "dist"), { recursive: true });
    writeFileSync(path.join(tmp, "w", "mcp", "package.json"), JSON.stringify({ name: "@bridge/mcp" }));
    writeFileSync(path.join(tmp, "w", "package.json"), JSON.stringify({ name: "browser-agent-bridge" }));
    expect(findPackageRootFrom(path.join(tmp, "w", "mcp", "dist"))).toBeNull();
  });

  it("first start: makes the token, registers; second start: up to date; a moved server: registered again", () => {
    const { reg, calls } = fakeReg();
    const a = pkg(path.join(tmp, "npx", "1", "node_modules", "browser-agent-bridge"));
    const r1 = run(a, { reg });
    expect(r1).toEqual({ status: "registered", reason: "changed", tokenCreated: true });
    const plan = nativeHostPlan({ platform: process.platform as "win32" | "darwin" | "linux", env: env(), home: process.platform === "win32" ? null : env().HOME,
      mode: "package", root: path.dirname(a), nodePath: "/n/node" })!;
    expect(readFileSync(plan.manifestPath, "utf8")).toBe(manifestText(plan));
    expect(readFileSync(plan.launcherPath, "utf8")).toBe(plan.launcherText);
    const tokenFile = path.join(path.dirname(plan.launcherPath), "bridge.token");
    expect(readFileSync(tokenFile, "utf8")).toMatch(/^[0-9a-f]{64}\n$/);
    expect(JSON.stringify(r1)).not.toContain(readFileSync(tokenFile, "utf8").trim());
    if (process.platform === "win32") expect(calls.filter((c) => c[0] === "add")).toHaveLength(1);

    const token = readFileSync(tokenFile, "utf8");
    expect(run(a, { reg })).toEqual({ status: "up-to-date", reason: "up-to-date", tokenCreated: false });
    if (process.platform === "win32") expect(calls.filter((c) => c[0] === "add")).toHaveLength(1);

    const b = pkg(path.join(tmp, "npx", "2", "node_modules", "browser-agent-bridge"));
    expect(run(b, { reg }).status).toBe("registered");
    expect(readFileSync(plan.launcherPath, "utf8")).toContain(path.join(path.dirname(b), "dist", "native-host.js"));
    expect(readFileSync(tokenFile, "utf8")).toBe(token); // never replaced
  });

  it("BRIDGE_TOKEN set: no token file is made", () => {
    const a = pkg(path.join(tmp, "p"));
    expect(run(a, { env: { ...env(), BRIDGE_TOKEN: "f".repeat(64) } }).tokenCreated).toBe(false);
  });

  it("BRIDGE_NO_HOST_REGISTRATION=1: nothing written, nothing spawned", () => {
    const { reg, calls } = fakeReg();
    const a = pkg(path.join(tmp, "p"));
    expect(run(a, { env: { ...env(), BRIDGE_NO_HOST_REGISTRATION: "1" }, reg })).toEqual({ status: "skipped", reason: "disabled", tokenCreated: false });
    expect(calls).toEqual([]);
    expect(existsSync(path.join(tmp, "appdata"))).toBe(false);
  });

  it("a clone's MCP server touches nothing", () => {
    const { reg, calls } = fakeReg();
    const c = pkg(path.join(tmp, "c"), { workspaces: ["mcp"] });
    expect(run(c, { reg })).toEqual({ status: "skipped", reason: "clone", tokenCreated: false });
    expect(calls).toEqual([]);
  });

  it("never throws: a failing write or reg is status failed, with no message or path in the result", () => {
    const a = pkg(path.join(tmp, "p"));
    const io = { writeFile: () => { throw new Error(`EACCES ${tmp}`); } };
    const r = run(a, { io });
    expect(r.status).toBe("failed");
    expect(JSON.stringify(r)).not.toContain(tmp);
    if (process.platform === "win32") {
      const r2 = run(a, { reg: (argv: string[]) => (argv[0] === "add" ? { status: 1, stdout: "" } : { status: 1, stdout: "" }) });
      expect(r2.status).toBe("failed");
    }
  });

  it("an existing per-user token is kept and never read into the result", () => {
    const a = pkg(path.join(tmp, "p"));
    const plan = nativeHostPlan({ platform: process.platform as "win32" | "darwin" | "linux", env: env(), home: process.platform === "win32" ? null : env().HOME,
      mode: "package", root: path.dirname(a), nodePath: "/n/node" })!;
    const tokenFile = path.join(path.dirname(plan.launcherPath), "bridge.token");
    mkdirSync(path.dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, "a".repeat(64) + "\n");
    const r = run(a);
    expect(r.tokenCreated).toBe(false);
    expect(readFileSync(tokenFile, "utf8")).toBe("a".repeat(64) + "\n");
  });
});
