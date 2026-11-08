// Step 15 S3: a clone daemon and a package daemon on one port must not hand the port back and forth. The knock
// uses another install's daemon as it is when that daemon is current for its install and not older than ours.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { daemonRecordFile, writeDaemonRecord } from "../../daemon/src/daemon-record.js";
import {
  adoptDecision,
  compareVersions,
  installVersion,
  makeAdoptDaemon,
  parseDaemonRecord,
  stateDirFromEnv,
} from "../src/adopt.js";
import { knock, type KnockIo } from "../src/knock.js";
import { fakeClock, fakeDaemon, type FakeConnection } from "./fakes.js";

const MINE = { path: "/clone/daemon/dist/index.js", version: "0.2.0" };
const rec = (over: Partial<{ build: string; path: string }> = {}) => ({ build: "OTHER", path: "/pkg/dist/daemon.js", ...over });

describe("compareVersions", () => {
  it("compares x.y.z numerically; anything else is null", () => {
    expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.0-beta.1", "0.2.0")).toBe(0);
    expect(compareVersions("x", "0.2.0")).toBeNull();
    expect(compareVersions(null, "0.2.0")).toBeNull();
  });
});

describe("adoptDecision", () => {
  const base = { running: "OTHER", record: rec(), mine: MINE, recordHash: "OTHER", recordVersion: "0.2.0" };
  it("adopts the current daemon of another install of the same or a newer version", () => {
    expect(adoptDecision(base)).toBe("adopt");
    expect(adoptDecision({ ...base, recordVersion: "0.3.0" })).toBe("adopt");
  });
  it("hands over an older install's daemon (an upgrade)", () => {
    expect(adoptDecision({ ...base, recordVersion: "0.1.9" })).toBe("handover");
  });
  it("hands over when there is no record, or the record is of another build (a pre-S3 daemon: today's behaviour)", () => {
    expect(adoptDecision({ ...base, record: null })).toBe("handover");
    expect(adoptDecision({ ...base, record: rec({ build: "THIRD" }) })).toBe("handover");
  });
  it("hands over our own install's old daemon (npm run build changed the file)", () => {
    expect(adoptDecision({ ...base, record: rec({ path: MINE.path }) })).toBe("handover");
  });
  it("hands over when the other install's file changed or is gone (the running daemon is stale)", () => {
    expect(adoptDecision({ ...base, recordHash: "REBUILT" })).toBe("handover");
    expect(adoptDecision({ ...base, recordHash: null })).toBe("handover");
  });
  it("hands over when either version is unknown", () => {
    expect(adoptDecision({ ...base, recordVersion: null })).toBe("handover");
    expect(adoptDecision({ ...base, mine: { ...MINE, version: null } })).toBe("handover");
  });
  it("compares paths case-blind on Windows only", () => {
    const winBase = { ...base, mine: { path: "C:\\Repo\\daemon\\dist\\index.js", version: "0.2.0" } };
    expect(adoptDecision({ ...winBase, record: rec({ path: "c:\\repo\\daemon\\dist\\index.js" }) }, "win32")).toBe("handover");
    expect(adoptDecision({ ...base, record: rec({ path: "/CLONE/daemon/dist/index.js" }) }, "linux")).toBe("adopt");
  });
});

describe("parseDaemonRecord and stateDirFromEnv", () => {
  it("reads only a well-formed record", () => {
    expect(parseDaemonRecord('{"build":"b","path":"/p","pid":3}\n')).toEqual({ build: "b", path: "/p" });
    expect(parseDaemonRecord("{")).toBeNull();
    expect(parseDaemonRecord('{"build":1,"path":"/p"}')).toBeNull();
    expect(parseDaemonRecord('{"build":"b"}')).toBeNull();
  });
  it("the state dir comes from env alone (USERPROFILE on Windows, HOME elsewhere), so env {} reads nothing", () => {
    expect(stateDirFromEnv({}, "win32")).toBeNull();
    expect(stateDirFromEnv({ USERPROFILE: "C:\\Users\\u" }, "win32")).toBe("C:\\Users\\u\\.browser-agent-bridge");
    expect(stateDirFromEnv({ HOME: "/home/u" }, "linux")).toBe("/home/u/.browser-agent-bridge");
    expect(stateDirFromEnv({ HOME: "/Users/u" }, "darwin")).toBe("/Users/u/.browser-agent-bridge");
  });
});

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
function scratch(): string {
  const d = mkdtempSync(path.join(tmpdir(), "bridge-adopt-"));
  dirs.push(d);
  return d;
}
function write(file: string, text: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

describe("installVersion", () => {
  it("the package's version for <package>/dist/daemon.js, the workspace root's for a clone, else null", () => {
    const d = scratch();
    write(path.join(d, "pkg", "package.json"), JSON.stringify({ name: "browser-agent-bridge", version: "0.3.1" }));
    expect(installVersion(path.join(d, "pkg", "dist", "daemon.js"))).toBe("0.3.1");
    write(path.join(d, "clone", "package.json"), JSON.stringify({ name: "browser-agent-bridge", version: "0.2.0", workspaces: [] }));
    write(path.join(d, "clone", "daemon", "package.json"), JSON.stringify({ name: "@bridge/daemon", version: "9.9.9" }));
    expect(installVersion(path.join(d, "clone", "daemon", "dist", "index.js"))).toBe("0.2.0");
    expect(installVersion(path.join(d, "loose", "daemon.js"))).toBeNull();
  });
});

describe("makeAdoptDaemon over real files (the daemon's writer, the SDK's reader)", () => {
  it("adopts a package daemon from a clone client, and the package client adopts the clone daemon back — no ping-pong", async () => {
    const home = scratch();
    const state = path.join(home, ".browser-agent-bridge");
    mkdirSync(state, { recursive: true });
    const pkgDaemon = write(path.join(home, "pkg", "dist", "daemon.js"), "// package daemon\n");
    write(path.join(home, "pkg", "package.json"), JSON.stringify({ name: "browser-agent-bridge", version: "0.2.0" }));
    const cloneDaemon = write(path.join(home, "clone", "daemon", "dist", "index.js"), "// clone daemon\n");
    write(path.join(home, "clone", "package.json"), JSON.stringify({ name: "browser-agent-bridge", version: "0.2.0", workspaces: [] }));
    const hash = async (f: string) => `H(${path.basename(path.dirname(path.dirname(f)))})`;
    const env = process.platform === "win32" ? { USERPROFILE: home } : { HOME: home };
    const adopt = makeAdoptDaemon(env, hash);

    writeDaemonRecord(state, 9601, { build: await hash(pkgDaemon), path: pkgDaemon, pid: 1 });
    expect(await adopt({ port: 9601, build: await hash(pkgDaemon), daemonPath: cloneDaemon })).toBe(true);
    // Another port's record says nothing about this one.
    expect(await adopt({ port: 9602, build: await hash(pkgDaemon), daemonPath: cloneDaemon })).toBe(false);

    writeDaemonRecord(state, 9601, { build: await hash(cloneDaemon), path: cloneDaemon, pid: 2 });
    expect(await adopt({ port: 9601, build: await hash(cloneDaemon), daemonPath: pkgDaemon })).toBe(true);
    expect(daemonRecordFile(state, 9601)).toBe(path.join(state, "daemon-9601.json"));
  });

  it("never throws: a missing state dir or an unreadable record is a handover", async () => {
    const adopt = makeAdoptDaemon({}, async () => "X");
    expect(await adopt({ port: 9603, build: "X", daemonPath: "/nowhere" })).toBe(false);
  });
});

describe("knock with adoptDaemon", () => {
  function io(conns: FakeConnection[], adoptDaemon?: KnockIo["adoptDaemon"]) {
    const clock = fakeClock();
    const tryConnect = vi.fn(async () => {
      const c = fakeDaemon({ build: "OTHER" });
      conns.push(c);
      return c;
    });
    return { tryConnect, spawnDaemon: vi.fn(), hashDaemon: async () => "MINE", sleep: clock.sleep, now: clock.now, adoptDaemon } as KnockIo;
  }
  it("an adopted daemon is returned as it is: no daemon.shutdown, no spawn", async () => {
    const conns: FakeConnection[] = [];
    const adoptDaemon = vi.fn(async () => true);
    const i = io(conns, adoptDaemon);
    const { welcome } = await knock({ port: 9604, token: "t", name: "n", daemonPath: "/me.js", io: i });
    expect(welcome.build).toBe("OTHER");
    expect(adoptDaemon).toHaveBeenCalledWith({ port: 9604, build: "OTHER", daemonPath: "/me.js" });
    expect(conns.flatMap((c) => c.sent).some((m) => m.method === "daemon.shutdown")).toBe(false);
    expect(i.spawnDaemon).not.toHaveBeenCalled();
  });
  it("adopts on a reconnect after 4002 too (allowHandover false) instead of failing VERSION", async () => {
    const conns: FakeConnection[] = [];
    const { welcome } = await knock({ port: 9605, token: "t", name: "n", daemonPath: "/me.js", io: io(conns, async () => true), allowHandover: false });
    expect(welcome.build).toBe("OTHER");
  });
  it("a refusal to adopt keeps today's handover", async () => {
    const conns: FakeConnection[] = [];
    await expect(knock({ port: 9606, token: "t", name: "n", daemonPath: "/me.js", io: io(conns, async () => false), allowHandover: false }))
      .rejects.toMatchObject({ code: "VERSION" });
  });
});
