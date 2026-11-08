import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeError, ErrorCodes } from "@bridge/shared";
import { connect } from "../src/connect.js";
import type { Timers } from "../src/client.js";
import type { KnockIo } from "../src/knock.js";
import { FakeConnection, fakeClock, fakeDaemon } from "./fakes.js";

const TOKEN = "connect-test-token-xyz";
let root: string;
let startDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "bridge-connect-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ workspaces: ["daemon", "sdk"] }));
  mkdirSync(path.join(root, "daemon", "dist"), { recursive: true });
  writeFileSync(path.join(root, "daemon", "dist", "index.js"), "// daemon build");
  startDir = path.join(root, "sdk", "src");
  mkdirSync(startDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fakeTimers() {
  const list: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const e = { fn, ms, cleared: false };
      list.push(e);
      return e;
    },
    clearTimeout: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
  };
  return { timers, list };
}

function makeIo(conn: () => FakeConnection, over: Partial<KnockIo> = {}) {
  const clock = fakeClock();
  const io: KnockIo = {
    tryConnect: vi.fn(async () => conn()),
    spawnDaemon: vi.fn(async () => {}),
    hashDaemon: vi.fn(async () => "NEW"),
    sleep: clock.sleep,
    now: clock.now,
    ...over,
  };
  return io;
}

async function rejection(p: Promise<unknown>): Promise<BridgeError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeError);
    return err as BridgeError;
  }
  throw new Error("expected a rejection");
}

const flush = () => new Promise<void>((r) => setImmediate(r));

describe("connect()", () => {
  it("missing token → rejects before any socket, naming both places", async () => {
    const io = makeIo(() => fakeDaemon({ build: "NEW" }));
    const err = await rejection(connect({ name: "t", env: {}, startDir, io }));
    expect(err.code).toBe(ErrorCodes.NOT_CONNECTED);
    expect(err.message).toContain("BRIDGE_TOKEN");
    expect(err.message).toContain(path.join(path.resolve(root), "bridge.token"));
    expect(io.tryConnect).not.toHaveBeenCalled();
    expect(io.spawnDaemon).not.toHaveBeenCalled();
  });

  it("missing daemon/dist/index.js → rejects before the knock", async () => {
    rmSync(path.join(root, "daemon", "dist", "index.js"));
    const io = makeIo(() => fakeDaemon({ build: "NEW" }));
    const err = await rejection(connect({ name: "t", env: { BRIDGE_TOKEN: TOKEN }, startDir, io }));
    expect(err.message).toContain("daemon not built — run `npm run build`");
    expect(io.tryConnect).not.toHaveBeenCalled();
    expect(io.hashDaemon).not.toHaveBeenCalled();
  });

  it("an invalid BRIDGE_PORT rejects before the knock", async () => {
    const io = makeIo(() => fakeDaemon({ build: "NEW" }));
    const err = await rejection(
      connect({ name: "t", env: { BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: "99999" }, startDir, io }),
    );
    expect(err.message).toBe('BRIDGE_PORT must be a valid port number, got: "99999"');
    expect(io.tryConnect).not.toHaveBeenCalled();
  });

  it("hashes the resolved daemon path, knocks on BRIDGE_PORT and resolves a connected client", async () => {
    const io = makeIo(() => fakeDaemon({ build: "NEW" }));
    const client = await connect({ name: "script", env: { BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: "9611" }, startDir, io });
    expect(io.hashDaemon).toHaveBeenCalledWith(path.join(path.resolve(root), "daemon", "dist", "index.js"));
    expect(io.tryConnect).toHaveBeenCalledWith(9611, expect.any(Number));
    expect(client.welcome?.build).toBe("NEW");
    client.close();
  });

  it("an explicit port override wins and reaches both the knock and the spawn", async () => {
    let first = true;
    const io = makeIo(() => fakeDaemon({ build: "NEW" }), {
      tryConnect: vi.fn(async () => {
        if (first) {
          first = false;
          throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
        }
        return fakeDaemon({ build: "NEW" });
      }),
    });
    const client = await connect({ name: "t", env: { BRIDGE_TOKEN: TOKEN }, startDir, io, port: 9622 });
    expect(io.tryConnect).toHaveBeenCalledWith(9622, expect.any(Number));
    expect(io.spawnDaemon).toHaveBeenCalledWith(expect.objectContaining({ port: 9622, token: TOKEN }));
    client.close();
  });

  it("extension not connected → waits for extensionStatus {connected:true}", async () => {
    const conn = fakeDaemon({ build: "NEW", extensionConnected: false });
    const io = makeIo(() => conn);
    const ft = fakeTimers();
    let resolved = false;
    const p = connect({ name: "t", env: { BRIDGE_TOKEN: TOKEN }, startDir, io, timers: ft.timers }).then((c) => {
      resolved = true;
      return c;
    });
    await flush();
    expect(resolved).toBe(false);
    expect(ft.list.map((t) => t.ms)).toEqual([15_000]);
    conn.emit({ event: "extensionStatus", params: { connected: false } });
    await flush();
    expect(resolved).toBe(false);
    conn.emit({ event: "extensionStatus", params: { connected: true } });
    const client = await p;
    expect(client.extensionConnected).toBe(true);
    expect(ft.list[0].cleared).toBe(true);
    client.close();
  });

  it("extension never connects → closes the client and rejects NOT_CONNECTED with today's text + the port", async () => {
    const conn = fakeDaemon({ build: "NEW", extensionConnected: false });
    const io = makeIo(() => conn);
    const ft = fakeTimers();
    const p = connect({
      name: "t",
      env: { BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: "9633" },
      startDir,
      io,
      timers: ft.timers,
      waitForExtensionMs: 500,
    });
    await flush();
    expect(ft.list.map((t) => t.ms)).toEqual([500]);
    ft.list[0].fn();
    const err = await rejection(p);
    expect(err.code).toBe(ErrorCodes.NOT_CONNECTED);
    expect(err.message).toBe(
      "Extension not connected — is Chrome open and the Browser Agent Bridge extension enabled? (waited 500 ms on port 9633)",
    );
    expect(conn.closeCalls.length).toBeGreaterThan(0);
  });

  it("waiting for the extension: a 4002 reconnect whose welcome says extensionConnected → resolves", async () => {
    const first = fakeDaemon({ build: "NEW", extensionConnected: false });
    const second = fakeDaemon({ build: "NEW", extensionConnected: true });
    const conns = [first, second];
    let n = 0;
    const io = makeIo(() => conns[Math.min(n++, 1)]);
    const ft = fakeTimers();
    let resolved = false;
    const p = connect({ name: "t", env: { BRIDGE_TOKEN: TOKEN }, startDir, io, timers: ft.timers }).then((c) => {
      resolved = true;
      return c;
    });
    await flush();
    expect(resolved).toBe(false);
    first.fireClose(4002, "upgrading");
    await flush();
    expect(resolved).toBe(true);
    const client = await p;
    expect(client.extensionConnected).toBe(true);
    expect(client.welcome?.extensionConnected).toBe(true);
    expect(ft.list[0].cleared).toBe(true);
    client.close();
  });

  it("waiting for the extension: a non-4002 close fails fast with the client's close error, not 'is Chrome open'", async () => {
    const conn = fakeDaemon({ build: "NEW", extensionConnected: false });
    const io = makeIo(() => conn);
    const ft = fakeTimers();
    const p = connect({ name: "t", env: { BRIDGE_TOKEN: TOKEN }, startDir, io, timers: ft.timers });
    const settled = vi.fn();
    p.then(settled, settled);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    conn.fireClose(1006, "gone");
    await flush();
    expect(settled).toHaveBeenCalled();
    const err = await rejection(p);
    expect(err.code).toBe(ErrorCodes.NOT_CONNECTED);
    expect(err.message).toContain("1006");
    expect(err.message).toContain("does not reconnect");
    expect(err.message).not.toContain("is Chrome open");
    expect(ft.list[0].cleared).toBe(true);
    expect(io.tryConnect).toHaveBeenCalledTimes(1);
  });

  it("a 4002 reconnect never hands the daemon over: a different build there → VERSION naming both builds", async () => {
    const first = fakeDaemon({ build: "NEW", extensionConnected: false });
    const second = fakeDaemon({ build: "OTHER" });
    let n = 0;
    const io = makeIo(() => (n++ === 0 ? first : second));
    const ft = fakeTimers();
    const p = connect({ name: "t", env: { BRIDGE_TOKEN: TOKEN }, startDir, io, timers: ft.timers });
    await flush();
    first.fireClose(4002, "upgrading");
    const err = await rejection(p);
    expect(err.code).toBe(ErrorCodes.VERSION);
    expect(err.message).toContain("NEW");
    expect(err.message).toContain("OTHER");
    expect(second.sent.filter((m) => m.method === "daemon.shutdown")).toHaveLength(0);
    expect(second.closeCalls.length).toBeGreaterThan(0);
  });

  it("knock failures propagate as BridgeErrors", async () => {
    const io = makeIo(() => new FakeConnection());
    const err = await rejection(connect({ name: "t", env: { BRIDGE_TOKEN: TOKEN }, startDir, io }));
    expect(err.code).toBe(ErrorCodes.VERSION);
  });
});

describe("connect({ requireExtension: false }) — Step 6 D5b (decisions.md · 2026-10-22 #27)", () => {
  it("resolves on a welcome with extensionConnected:false without registering a wait timer; the client stays open", async () => {
    const conn = fakeDaemon({ build: "NEW", extensionConnected: false });
    const io = makeIo(() => conn);
    const ft = fakeTimers();
    let resolved = false;
    const p = connect({
      name: "t",
      env: { BRIDGE_TOKEN: TOKEN },
      startDir,
      io,
      timers: ft.timers,
      requireExtension: false,
    }).then((c) => {
      resolved = true;
      return c;
    });
    await flush();
    // Resolved with no time advanced and no wait timer ever registered.
    expect(resolved).toBe(true);
    expect(ft.list).toEqual([]);
    expect(io.sleep).not.toHaveBeenCalled();
    const client = await p;
    expect(client.extensionConnected).toBe(false);
    expect(client.welcome?.extensionConnected).toBe(false);
    expect(conn.closeCalls).toEqual([]);
    // The same client follows the extension coming up.
    conn.emit({ event: "extensionStatus", params: { connected: true } });
    expect(client.extensionConnected).toBe(true);
    expect(conn.closeCalls).toEqual([]);
    client.close();
  });

  it("ignores waitForExtensionMs when requireExtension is false", async () => {
    const conn = fakeDaemon({ build: "NEW", extensionConnected: false });
    const io = makeIo(() => conn);
    const ft = fakeTimers();
    const client = await connect({
      name: "t",
      env: { BRIDGE_TOKEN: TOKEN },
      startDir,
      io,
      timers: ft.timers,
      requireExtension: false,
      waitForExtensionMs: 500,
    });
    expect(ft.list).toEqual([]);
    expect(client.extensionConnected).toBe(false);
    expect(conn.closeCalls).toEqual([]);
    client.close();
  });
});
