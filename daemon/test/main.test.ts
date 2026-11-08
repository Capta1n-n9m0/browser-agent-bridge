import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { resolveToken as realResolveToken } from "@bridge/sdk/token";
import { buildHash } from "../src/build.js";
import { ClientRegistry } from "../src/registry.js";
import type { HostStats, WsHostOptions } from "../src/wsHost.js";
import { runDaemon, parseIdleMs, DEFAULT_IDLE_MS, DEFAULT_PORT, type DaemonDeps, type DaemonHost } from "../src/main.js";

const TOKEN = "tok-3f9a1c0e5b7d";

class FakeHost implements DaemonHost {
  readonly registry = new ClientRegistry<object>();
  listen = vi.fn<() => Promise<number>>();
  shutdownCodes: number[] = [];
  private done: Promise<void> | undefined;

  constructor(readonly opts: WsHostOptions & { onShutdown?: (code: number) => void }) {
    this.listen.mockResolvedValue(opts.port);
  }

  shutdown(code: number): Promise<void> {
    this.shutdownCodes.push(code);
    if (this.done) return this.done;
    this.done = Promise.resolve().then(() => this.opts.onShutdown?.(code));
    return this.done;
  }

  stats(): HostStats {
    return { clients: this.registry.count(), extensionEvents: 2, ignoredClientFrames: 1 };
  }
}

interface Harness {
  deps: DaemonDeps;
  lines: string[];
  exit: ReturnType<typeof vi.fn>;
  handlers: Map<string, (...args: unknown[]) => void>;
  host: () => FakeHost;
  argv1: string;
}

let dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function entryFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bridge-main-"));
  dirs.push(dir);
  const file = path.join(dir, "index.js");
  writeFileSync(file, "// fake daemon bundle\n");
  return file;
}

function harness(over: Partial<DaemonDeps> & { listen?: (h: FakeHost) => void } = {}): Harness {
  const lines: string[] = [];
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const exit = vi.fn();
  let created: FakeHost | undefined;
  const argv1 = over.argv1 ?? entryFile();
  const deps: DaemonDeps = {
    env: { BRIDGE_TOKEN: TOKEN },
    argv1,
    pid: 4242,
    logger: { log: (m) => lines.push(m), setSecret: () => {} },
    exit,
    on: (event, listener) => {
      handlers.set(event, listener);
    },
    createHost: (opts) => {
      created = new FakeHost(opts);
      over.listen?.(created);
      return created;
    },
    ...over,
  };
  return { deps, lines, exit, handlers, host: () => created!, argv1 };
}

function addrInUse(): Error {
  return Object.assign(new Error("listen EADDRINUSE: address already in use 127.0.0.1:9234"), { code: "EADDRINUSE" });
}

function expectClean(lines: string[]): void {
  for (const l of lines) {
    expect(l).not.toContain(TOKEN);
    expect(l).not.toContain("://");
  }
}

const flush = () => new Promise<void>((r) => setImmediate(r));

describe("runDaemon — configuration", () => {
  it("defaults: port 9234, idle 600000, the build is buildHash of argv1 (never 'dev')", async () => {
    const h = harness();
    await runDaemon(h.deps);
    expect(DEFAULT_PORT).toBe(9234);
    expect(DEFAULT_IDLE_MS).toBe(600_000);
    const opts = h.host().opts;
    expect(opts.port).toBe(9234);
    expect(opts.token).toBe(TOKEN);
    expect(opts.build).toBe(buildHash(h.argv1));
    expect(opts.build).not.toBe("dev");
    expect(h.host().listen).toHaveBeenCalledTimes(1);
    expect(h.exit).not.toHaveBeenCalled();
    expect(h.lines.some((l) => l.includes("pid=4242") && l.includes(buildHash(h.argv1)))).toBe(true);
    expectClean(h.lines);
  });

  it("honours BRIDGE_PORT", async () => {
    const h = harness({ env: { BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: "9555" } });
    await runDaemon(h.deps);
    expect(h.host().opts.port).toBe(9555);
  });

  it("an invalid BRIDGE_PORT logs and exits 1 without creating a host", async () => {
    for (const bad of ["abc", "0", "70000", "12.5", "-1", ""]) {
      const h = harness({ env: { BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: bad } });
      await runDaemon(h.deps);
      expect(h.exit).toHaveBeenCalledTimes(1);
      expect(h.exit).toHaveBeenCalledWith(1);
      expect(h.host()).toBeUndefined();
      expect(h.lines.some((l) => /BRIDGE_PORT/.test(l))).toBe(true);
    }
  });

  it("honours BRIDGE_DAEMON_IDLE_MS", async () => {
    vi.useFakeTimers();
    const h = harness({ env: { BRIDGE_TOKEN: TOKEN, BRIDGE_DAEMON_IDLE_MS: "5000" } });
    await runDaemon(h.deps);
    await vi.advanceTimersByTimeAsync(4999);
    expect(h.host().shutdownCodes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.host().shutdownCodes).toEqual([1001]);
  });

  it("an invalid BRIDGE_DAEMON_IDLE_MS logs and falls back to the default", async () => {
    vi.useFakeTimers();
    const h = harness({ env: { BRIDGE_TOKEN: TOKEN, BRIDGE_DAEMON_IDLE_MS: "soon" } });
    await runDaemon(h.deps);
    expect(h.lines.some((l) => l.includes("BRIDGE_DAEMON_IDLE_MS") && l.includes("600000"))).toBe(true);
    await vi.advanceTimersByTimeAsync(599_999);
    expect(h.host().shutdownCodes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.host().shutdownCodes).toEqual([1001]);
  });

  it("parseIdleMs caps at setTimeout's maximum (2147483647 ms)", () => {
    expect(parseIdleMs("2147483647")).toBe(2147483647);
    expect(parseIdleMs("2147483648")).toBeNull();
    expect(parseIdleMs("99999999999")).toBeNull();
  });

  it("a BRIDGE_DAEMON_IDLE_MS above setTimeout's maximum logs and uses the default, never a 1 ms timer", async () => {
    vi.useFakeTimers();
    const h = harness({ env: { BRIDGE_TOKEN: TOKEN, BRIDGE_DAEMON_IDLE_MS: "99999999999" } });
    await runDaemon(h.deps);
    expect(h.lines.some((l) => l.includes("BRIDGE_DAEMON_IDLE_MS") && l.includes("600000"))).toBe(true);
    expect(h.lines.some((l) => l.includes("idleMs=600000"))).toBe(true);
    await vi.advanceTimersByTimeAsync(599_999);
    expect(h.host().shutdownCodes).toEqual([]);
    expect(h.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.host().shutdownCodes).toEqual([1001]);
  });

  it("a missing token logs resolveToken's message and exits 1; the log names no token", async () => {
    const empty = mkdtempSync(path.join(tmpdir(), "bridge-notoken-"));
    dirs.push(empty);
    const h = harness({
      env: {},
      resolveToken: (env) => realResolveToken({ env, startDir: empty }),
    });
    await runDaemon(h.deps);
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.host()).toBeUndefined();
    expect(h.lines.some((l) => l.includes("No bridge token"))).toBe(true);
    expectClean(h.lines);
  });

  it("hands the token to the logger as its secret", async () => {
    const secrets: string[] = [];
    const h = harness();
    h.deps.logger = { log: () => {}, setSecret: (t) => secrets.push(t) };
    await runDaemon(h.deps);
    expect(secrets).toEqual([TOKEN]);
  });

  it("a missing entry file (no build hash) logs and exits 1", async () => {
    const h = harness({ argv1: path.join(tmpdir(), "definitely-not-here-7c1e", "index.js") });
    await runDaemon(h.deps);
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.host()).toBeUndefined();
  });
});

describe("runDaemon — the bind is the lock", () => {
  it("EADDRINUSE logs and exits 0 exactly once, with a single listen and no retry", async () => {
    vi.useFakeTimers();
    const h = harness({ listen: (host) => host.listen.mockRejectedValue(addrInUse()) });
    await runDaemon(h.deps);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(h.host().listen).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.lines.some((l) => l.includes("port 9234 in use") && l.includes("another daemon"))).toBe(true);
    expect(h.host().shutdownCodes).toEqual([]);
    expectClean(h.lines);
  });

  it("any other bind error logs and exits 1", async () => {
    const h = harness({
      listen: (host) => host.listen.mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" })),
    });
    await runDaemon(h.deps);
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.host().listen).toHaveBeenCalledTimes(1);
  });

  it("with a real socket: a port held by another server exits 0 (bound on an ephemeral port, never 9234)", async () => {
    const blocker: Server = createServer();
    const port = await new Promise<number>((resolve) =>
      blocker.listen(0, "127.0.0.1", () => resolve((blocker.address() as { port: number }).port)),
    );
    try {
      const h = harness({ env: { BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(port) } });
      delete (h.deps as Partial<DaemonDeps>).createHost; // the real WsHost
      await runDaemon(h.deps);
      expect(h.exit).toHaveBeenCalledTimes(1);
      expect(h.exit).toHaveBeenCalledWith(0);
      expect(h.lines.some((l) => l.includes(`port ${port} in use`))).toBe(true);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});

describe("runDaemon — stopping", () => {
  it("SIGINT, SIGTERM and SIGBREAK handlers are installed, plus the fatal handlers", async () => {
    const h = harness();
    await runDaemon(h.deps);
    for (const ev of ["SIGINT", "SIGTERM", "SIGBREAK", "uncaughtException", "unhandledRejection"]) {
      expect(h.handlers.has(ev)).toBe(true);
    }
  });

  it("a signal shuts the host down with 1001, then exits 0 once; a second signal changes nothing", async () => {
    const h = harness();
    await runDaemon(h.deps);
    h.handlers.get("SIGTERM")!("SIGTERM");
    h.handlers.get("SIGINT")!("SIGINT");
    await flush();
    expect(h.host().shutdownCodes[0]).toBe(1001);
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.lines.some((l) => l.includes("SIGTERM"))).toBe(true);
    // The exit line carries the host's counts.
    expect(h.lines.some((l) => l.includes("clients=0") && l.includes("extensionEvents=2") && l.includes("ignoredClientFrames=1"))).toBe(true);
  });

  it("idle fire shuts down with 1001 then exits 0 — the timer is armed at start (0 clients)", async () => {
    vi.useFakeTimers();
    const h = harness({ env: { BRIDGE_TOKEN: TOKEN, BRIDGE_DAEMON_IDLE_MS: "1000" } });
    await runDaemon(h.deps);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.host().shutdownCodes).toEqual([1001]);
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.lines.some((l) => l.includes("idle"))).toBe(true);
  });

  it("never idles out while a client is connected; re-arms when the last one leaves", async () => {
    vi.useFakeTimers();
    const h = harness({ env: { BRIDGE_TOKEN: TOKEN, BRIDGE_DAEMON_IDLE_MS: "1000" } });
    await runDaemon(h.deps);
    const reg = h.host().registry;
    await vi.advanceTimersByTimeAsync(500);
    const id = reg.add({}, { name: "export-grades.ts" });
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(h.host().shutdownCodes).toEqual([]);
    expect(h.exit).not.toHaveBeenCalled();
    reg.remove(id);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.exit).toHaveBeenCalledTimes(1);
  });

  it("logs client + / client - with the name and the count", async () => {
    const h = harness();
    await runDaemon(h.deps);
    const reg = h.host().registry;
    const a = reg.add({}, { name: "export-grades.ts" });
    reg.add({}, { name: "mcp-123" });
    reg.remove(a);
    expect(h.lines).toContain('client + "export-grades.ts" (1 client)');
    expect(h.lines).toContain('client + "mcp-123" (2 clients)');
    expect(h.lines).toContain('client - "export-grades.ts" (1 client)');
  });

  it("a daemon.shutdown (the host shuts itself down with 4002) exits 0", async () => {
    const h = harness();
    await runDaemon(h.deps);
    await h.host().shutdown(4002);
    await flush();
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.lines.some((l) => l.includes("4002"))).toBe(true);
  });

  it("an uncaught exception logs only its name and exits 1", async () => {
    const h = harness();
    await runDaemon(h.deps);
    const err = new TypeError(`boom https://secret.example/?t=${TOKEN}`);
    h.handlers.get("uncaughtException")!(err);
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.lines).toContain("fatal: TypeError");
    expectClean(h.lines);
    h.handlers.get("unhandledRejection")!(new RangeError("x"));
    expect(h.exit).toHaveBeenCalledTimes(1); // already exiting
  });

  it("an unhandled rejection with a non-Error reason logs its type and exits 1", async () => {
    const h = harness();
    await runDaemon(h.deps);
    h.handlers.get("unhandledRejection")!("a string reason with https://x");
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.lines).toContain("fatal: string");
  });
});

describe("runDaemon — real WsHost end to end on an ephemeral port", () => {
  it("a client's daemon.shutdown gets {ok:true}, a 4002 close, and the daemon exits 0", async () => {
    // Find a free ephemeral port (never 9234), then hand it to the daemon.
    const probe = createServer();
    const port = await new Promise<number>((resolve) =>
      probe.listen(0, "127.0.0.1", () => resolve((probe.address() as { port: number }).port)),
    );
    await new Promise<void>((r) => probe.close(() => r()));

    const h = harness({ env: { BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(port) } });
    delete (h.deps as Partial<DaemonDeps>).createHost;
    await runDaemon(h.deps);
    expect(h.exit).not.toHaveBeenCalled();

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    const frames: unknown[] = [];
    const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as { type?: string };
      frames.push(msg);
      if (msg.type === "welcome") ws.send(JSON.stringify({ id: "bye", method: "daemon.shutdown" }));
    });
    ws.send(JSON.stringify({ type: "hello", token: TOKEN, role: "client", name: "e2e", proto: 2 }));
    const code = await Promise.race([closed, new Promise<number>((r) => setTimeout(() => r(-1), 2000))]);
    if (code === -1) throw new Error(`no close within 2 s; frames: ${JSON.stringify(frames)}`);
    expect(code).toBe(4002);
    await new Promise((r) => setTimeout(r, 20));
    expect(frames).toContainEqual({ id: "bye", result: { ok: true } });
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.lines).toContain('client + "e2e" (1 client)');
    expectClean(h.lines);
  });
});

describe("runDaemon — the handle mark (Step 8 S2b.9, decisions.md #79)", () => {
  it("stateDir wires a handle mark in that directory into the host; without stateDir the host gets none (tests never touch the real one)", async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "bridge-main-state-"));
    dirs.push(stateDir);
    const h = harness({ stateDir });
    await runDaemon(h.deps);
    const numbers = h.host().opts.handleNumbers;
    expect(numbers).toBeDefined();
    expect(numbers!.next()).toBe(1);
    expect(readFileSync(path.join(stateDir, "handle-mark"), "utf8")).toBe("64\n");

    const h2 = harness();
    await runDaemon(h2.deps);
    expect(h2.host().opts.handleNumbers).toBeUndefined();
  });
});

describe("runDaemon — the daemon record (Step 15 S3)", () => {
  it("writes daemon-<port>.json {build, path, pid} in stateDir after the bind; none without stateDir or when the port is taken", async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "bridge-main-record-"));
    dirs.push(stateDir);
    const h = harness({ stateDir, env: { BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: "9555" } });
    await runDaemon(h.deps);
    const rec = JSON.parse(readFileSync(path.join(stateDir, "daemon-9555.json"), "utf8"));
    expect(rec).toEqual({ build: buildHash(h.argv1), path: path.resolve(h.argv1), pid: 4242 });
    expectClean(h.lines);
    expect(h.lines.some((l) => l.includes(h.argv1))).toBe(false);

    const taken = mkdtempSync(path.join(tmpdir(), "bridge-main-record-"));
    dirs.push(taken);
    const h2 = harness({ stateDir: taken, env: { BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: "9556" },
      listen: (host) => host.listen.mockRejectedValue(addrInUse()) });
    await runDaemon(h2.deps);
    expect(existsSync(path.join(taken, "daemon-9556.json"))).toBe(false);
  });

  it("a record that cannot be written is one pathless log line; the daemon keeps running", async () => {
    const h = harness({ stateDir: path.join(tmpdir(), "bridge-no-such-dir-" + process.pid, "x") });
    await runDaemon(h.deps);
    expect(h.exit).not.toHaveBeenCalled();
    expect(h.lines.filter((l) => l.startsWith("daemon record not written"))).toHaveLength(1);
  });
});
