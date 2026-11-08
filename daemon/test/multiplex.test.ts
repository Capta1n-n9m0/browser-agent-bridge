import { describe, it, expect, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { Bridge } from "../src/bridge.js";
import { WsHost } from "../src/wsHost.js";

/**
 * Stage D2 over real `ws` sockets bound to port 0: two roles on one port, the client registry,
 * request routing with id remapping, daemon methods, shutdown, events and the heartbeat.
 */

const TOKEN = "tok-SENTINEL-6f1e";
const BUILD = "test-build";

type Frame = Record<string, unknown>;

/** A socket that records every frame and its close, with event-driven waits. */
class Peer {
  readonly frames: Frame[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: Array<() => void> = [];

  constructor(readonly ws: WebSocket) {
    ws.on("message", (raw) => {
      this.frames.push(JSON.parse(raw.toString()) as Frame);
      this.wake();
    });
    ws.on("close", (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      this.wake();
    });
  }

  private wake(): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }

  /** Resolve once `pred` holds (re-checked on every frame / close), or fail after `timeoutMs`. */
  until<T>(pred: () => T | undefined | false, timeoutMs = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Peer.until timed out")), timeoutMs);
      const check = () => {
        const v = pred();
        if (v) {
          clearTimeout(timer);
          resolve(v);
        } else this.waiters.push(check);
      };
      check();
    });
  }

  frame(pred: (f: Frame) => boolean, timeoutMs?: number): Promise<Frame> {
    return this.until(() => this.frames.find(pred), timeoutMs);
  }

  whenClosed(timeoutMs?: number): Promise<{ code: number; reason: string }> {
    return this.until(() => this.closed ?? undefined, timeoutMs);
  }

  send(frame: unknown): void {
    this.ws.send(JSON.stringify(frame));
  }
}

function open(port: number, opts: { autoPong?: boolean } = {}): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, opts);
    const peer = new Peer(ws);
    ws.on("open", () => resolve(peer));
    ws.on("error", reject);
  });
}

const isWelcome = (f: Frame) => f.type === "welcome";
const response = (id: unknown) => (f: Frame) => f.id === id && ("result" in f || "error" in f);
const statusEvent = (connected: boolean) => (f: Frame) =>
  f.event === "extensionStatus" && (f.params as { connected?: unknown })?.connected === connected;

async function client(port: number, name?: string, opts: { autoPong?: boolean } = {}): Promise<Peer> {
  const p = await open(port, opts);
  const hello: Frame = { type: "hello", token: TOKEN, role: "client", proto: 2, build: "whatever" };
  if (name !== undefined) hello.name = name;
  p.send(hello);
  await p.frame(isWelcome);
  return p;
}

/** A fake v1 extension: a hello without role; records requests (frames with id+method). */
async function extension(port: number): Promise<Peer> {
  const p = await open(port);
  p.send({ type: "hello", token: TOKEN });
  await p.frame(isWelcome);
  return p;
}

const requests = (ext: Peer) => ext.frames.filter((f) => typeof f.id === "string" && typeof f.method === "string");

/** Poll host-side state (bridge / registry) that no socket frame announces. */
function waitUntil(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitUntil timed out"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

/** Wait a short fixed window when asserting that nothing arrives. */
const quiet = (ms = 100) => new Promise((r) => setTimeout(r, ms));

describe("WsHost v2 — roles, routing, daemon methods", () => {
  let host: WsHost | undefined;
  const peers: Peer[] = [];
  afterEach(async () => {
    for (const p of peers.splice(0)) p.ws.terminate();
    await host?.close();
    host = undefined;
    vi.restoreAllMocks();
  });

  async function start(opts: { heartbeatMs?: number } = {}) {
    const bridge = new Bridge();
    host = new WsHost(bridge, { port: 0, token: TOKEN, build: BUILD, ...opts });
    const port = await host.listen();
    return { bridge, host, port };
  }
  const track = (p: Peer) => (peers.push(p), p);

  it("two clients with colliding ids, answered out of order, each get their own result", async () => {
    const { port } = await start();
    const ext = track(await extension(port));
    const a = track(await client(port, "A"));
    const b = track(await client(port, "B"));

    // 2026-10-23 (Step 8 S2b, decisions.md #81 F8): was "whoami" — an unlisted method without tab is now refused (VERSION against this no-proto fake, BAD_PARAMS against a proto:2 one); a free method routes the same way
    a.send({ id: "1", method: "downloadChunk", params: { who: "A" } });
    b.send({ id: "1", method: "downloadChunk", params: { who: "B" } });
    await ext.until(() => requests(ext).length === 2);

    const [r1, r2] = requests(ext);
    expect(r1.id).not.toBe(r2.id); // remapped to the daemon's own ids
    // Answer in reverse order.
    ext.send({ id: r2.id, result: { who: (r2.params as { who: string }).who } });
    ext.send({ id: r1.id, result: { who: (r1.params as { who: string }).who } });

    expect(await a.frame(response("1"))).toEqual({ id: "1", result: { who: "A" } });
    expect(await b.frame(response("1"))).toEqual({ id: "1", result: { who: "B" } });
    await quiet(50);
    expect(a.frames.filter(response("1"))).toHaveLength(1);
    expect(b.frames.filter(response("1"))).toHaveLength(1);
  });

  it("a client disconnecting mid-call drops only its own reply; the other client's call still resolves", async () => {
    const { port, host } = await start();
    const ext = track(await extension(port));
    const a = track(await client(port, "A"));
    const b = track(await client(port, "B"));
    const errors = vi.spyOn(console, "error");

    // 2026-10-23 (Step 8 S2b, decisions.md #81 F8): were "slow"/"again" — an unlisted method without tab is now refused (VERSION against this no-proto fake, BAD_PARAMS against a proto:2 one); free methods route the same way
    a.send({ id: "a1", method: "downloadStart", params: {} });
    b.send({ id: "b1", method: "downloadStart", params: {} });
    await ext.until(() => requests(ext).length === 2);
    const framesBefore = a.frames.length;

    a.ws.close();
    await a.whenClosed();
    await waitUntil(() => host.registry.count() === 1);

    for (const r of requests(ext)) ext.send({ id: r.id, result: "done" });
    expect(await b.frame(response("b1"))).toEqual({ id: "b1", result: "done" });
    await quiet(50);
    expect(a.frames.length).toBe(framesBefore);
    expect(errors).not.toHaveBeenCalled();

    // The host still serves B afterwards.
    b.send({ id: "b2", method: "downloadEnd" });
    await ext.until(() => requests(ext).length === 3);
    ext.send({ id: requests(ext)[2].id, result: 2 });
    expect(await b.frame(response("b2"))).toEqual({ id: "b2", result: 2 });
  });

  it("the extension going away fails every client's in-flight call with NOT_CONNECTED", async () => {
    const { port, bridge } = await start();
    const ext = await extension(port);
    const a = track(await client(port, "A"));
    const b = track(await client(port, "B"));

    // 2026-10-22 (decisions.md #52, applying #42): was "snapshot" — a no-proto extension now gets VERSION for tab methods
    // 2026-10-23 (Step 8 S2b, decisions.md #81 F8): was "slow" — an unlisted method without tab is now refused (VERSION against this no-proto fake, BAD_PARAMS against a proto:2 one); a free method routes the same way
    a.send({ id: "a1", method: "downloadStart" });
    b.send({ id: "b1", method: "downloadStart" });
    await ext.until(() => requests(ext).length === 2);
    ext.ws.close();

    expect(await a.frame(response("a1"))).toEqual({
      id: "a1",
      error: { code: "NOT_CONNECTED", message: "extension disconnected" },
    });
    expect(await b.frame(response("b1"))).toEqual({
      id: "b1",
      error: { code: "NOT_CONNECTED", message: "extension disconnected" },
    });
    await waitUntil(() => !bridge.isConnected());

    // No extension at all: NOT_CONNECTED at once, with today's text.
    a.send({ id: "a2", method: "snapshot" });
    expect(await a.frame(response("a2"), 500)).toEqual({
      id: "a2",
      error: {
        code: "NOT_CONNECTED",
        message: "Extension not connected — is Chrome open and the Browser Agent Bridge extension enabled?",
      },
    });
  });

  it("daemon.status lists the clients by name with build, port, uptime and extensionConnected", async () => {
    const { port } = await start();
    track(await extension(port));
    const a = track(await client(port, "alpha"));
    track(await client(port, "beta"));
    track(await client(port)); // no name → default

    a.send({ id: "s", method: "daemon.status" });
    const reply = await a.frame(response("s"));
    const result = reply.result as {
      build: string;
      uptime: number;
      extensionConnected: boolean;
      clients: Array<{ id: string; name: string; since: number }>;
      port: number;
    };
    expect(result.build).toBe(BUILD);
    expect(result.port).toBe(port);
    expect(result.extensionConnected).toBe(true);
    expect(typeof result.uptime).toBe("number");
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.clients.map((c) => c.name)).toEqual(["alpha", "beta", "unnamed"]);
    expect(result.clients.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    for (const c of result.clients) expect(typeof c.since).toBe("number");
  });

  it("daemon.shutdown replies {ok:true} to the caller, then closes every socket with 4002 \"upgrading\"", async () => {
    const { port } = await start();
    const ext = track(await extension(port));
    const a = track(await client(port, "A"));
    const b = track(await client(port, "B"));

    a.send({ id: "bye", method: "daemon.shutdown" });
    const [ca, cb, ce] = await Promise.all([a.whenClosed(), b.whenClosed(), ext.whenClosed()]);
    expect(a.frames.find(response("bye"))).toEqual({ id: "bye", result: { ok: true } });
    expect(ca).toEqual({ code: 4002, reason: "upgrading" });
    expect(cb).toEqual({ code: 4002, reason: "upgrading" });
    expect(ce).toEqual({ code: 4002, reason: "upgrading" });
    expect(requests(ext)).toEqual([]); // never forwarded

    // Nothing new is welcomed after shutdown.
    const outcome = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("error", () => resolve("refused"));
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "hello", token: TOKEN, role: "client" }));
        ws.on("message", (raw) => {
          if (JSON.parse(raw.toString()).type === "welcome") resolve("welcomed");
        });
        ws.on("close", () => resolve("closed"));
      });
    });
    expect(outcome).not.toBe("welcomed");
  });

  it("host.shutdown terminates a peer that ignores the close handshake after ~1 s", async () => {
    const { port, host } = await start();
    const a = track(await client(port, "A"));
    // Stop the client's socket from answering the close frame: pause its underlying TCP socket.
    (a.ws as unknown as { _socket: { pause(): void } })._socket.pause();
    const t0 = Date.now();
    await host.shutdown(4002);
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(900);
    expect(took).toBeLessThan(3000);
    expect(host.registry.count()).toBe(0);
  });

  it("a v1 hello is the extension: welcomed with clientId \"extension\", never counted as a client", async () => {
    const { port, bridge, host } = await start();
    const ext = await extension(port);
    expect(ext.frames.find(isWelcome)).toEqual({
      type: "welcome",
      build: BUILD,
      proto: 2,
      clientId: "extension",
      extensionConnected: true,
    });
    expect(bridge.isConnected()).toBe(true);
    expect(host.registry.count()).toBe(0);

    // The extension reconnects on a new socket: again the extension, still no client.
    ext.ws.close();
    await ext.whenClosed();
    await waitUntil(() => !bridge.isConnected());
    const ext2 = track(await extension(port));
    expect(ext2.frames.find(isWelcome)).toMatchObject({ clientId: "extension" });
    expect(bridge.isConnected()).toBe(true);
    expect(host.registry.count()).toBe(0);
  });

  it("role \"extension\" explicitly is the extension too", async () => {
    const { port, bridge, host } = await start();
    const p = track(await open(port));
    p.send({ type: "hello", token: TOKEN, role: "extension" });
    expect(await p.frame(isWelcome)).toMatchObject({ clientId: "extension", extensionConnected: true });
    expect(bridge.isConnected()).toBe(true);
    expect(host.registry.count()).toBe(0);
  });

  it("welcomes a client with build, proto 2, its id and extensionConnected (false, then true)", async () => {
    const { port } = await start();
    const a = track(await client(port, "A"));
    expect(a.frames.find(isWelcome)).toEqual({
      type: "welcome",
      build: BUILD,
      proto: 2,
      clientId: "c1",
      extensionConnected: false,
    });
    track(await extension(port));
    const b = track(await client(port, "B"));
    expect(b.frames.find(isWelcome)).toEqual({
      type: "welcome",
      build: BUILD,
      proto: 2,
      clientId: "c2",
      extensionConnected: true,
    });
  });

  it("defaults build to \"dev\" when the option is absent", async () => {
    host = new WsHost(new Bridge(), { port: 0, token: TOKEN });
    const port = await host.listen();
    const a = track(await client(port, "A"));
    expect(a.frames.find(isWelcome)).toMatchObject({ build: "dev" });
  });

  it("closes a bad token and an unknown role with exactly 4001, never logging the token", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((m) => vi.spyOn(console, m));
    const { port, bridge, host } = await start();

    const bad = track(await open(port));
    bad.send({ type: "hello", token: "wrong-token", role: "client" });
    const c1 = await bad.whenClosed();
    expect(c1.code).toBe(4001);

    const admin = track(await open(port));
    admin.send({ type: "hello", token: TOKEN, role: "admin" });
    const c2 = await admin.whenClosed();
    expect(c2.code).toBe(4001);

    for (const c of [c1, c2]) expect(c.reason).not.toContain(TOKEN);
    expect(bridge.isConnected()).toBe(false);
    expect(host.registry.count()).toBe(0);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        for (const arg of call) expect(String(arg instanceof Error ? arg.stack : arg)).not.toContain(TOKEN);
      }
    }
  });

  it("D2.3: an extension event frame reaches no client and is counted", async () => {
    const { port, host } = await start();
    const ext = track(await extension(port));
    const a = track(await client(port, "A"));
    const b = track(await client(port, "B"));
    const before = [a.frames.length, b.frames.length];

    ext.send({ event: "tabCreated", params: { tabId: 7 } });
    await quiet(100); // fixed window: nothing may arrive
    expect([a.frames.length, b.frames.length]).toEqual(before);
    expect(host.stats().extensionEvents).toBe(1);
    expect(ext.frames.filter((f) => "error" in f)).toEqual([]);
  });

  it("daemon.foo answers UNKNOWN_METHOD and is never forwarded", async () => {
    const { port } = await start();
    const ext = track(await extension(port));
    const a = track(await client(port, "A"));
    a.send({ id: "u", method: "daemon.foo", params: {} });
    expect(await a.frame(response("u"))).toEqual({
      id: "u",
      error: { code: "UNKNOWN_METHOD", message: "unknown daemon method: daemon.foo" },
    });
    await quiet(50);
    expect(requests(ext)).toEqual([]);
  });

  it("answers BAD_PARAMS on the socket for a bad request and ignores unparseable frames", async () => {
    const { port, host } = await start();
    const a = track(await client(port, "A"));
    a.ws.send("not json");
    a.send({ id: "p", method: "snapshot", params: [1] });
    expect(await a.frame(response("p"))).toEqual({
      id: "p",
      error: { code: "BAD_PARAMS", message: "request params must be an object" },
    });
    expect(host.stats().ignoredClientFrames).toBe(1);
  });
});

describe("WsHost v2 — extensionStatus events (D2.7)", () => {
  let host: WsHost | undefined;
  const peers: Peer[] = [];
  afterEach(async () => {
    for (const p of peers.splice(0)) p.ws.terminate();
    await host?.close();
    host = undefined;
  });
  const track = (p: Peer) => (peers.push(p), p);

  it("clients get {connected:true} on the extension hello and {connected:false} when it closes", async () => {
    const bridge = new Bridge();
    host = new WsHost(bridge, { port: 0, token: TOKEN, build: BUILD });
    const port = await host.listen();
    const a = track(await client(port, "A"));
    const b = track(await client(port, "B"));

    const ext = await extension(port);
    expect(await a.frame(statusEvent(true))).toEqual({ event: "extensionStatus", params: { connected: true } });
    expect(await b.frame(statusEvent(true))).toEqual({ event: "extensionStatus", params: { connected: true } });

    ext.ws.close();
    expect(await a.frame(statusEvent(false))).toEqual({ event: "extensionStatus", params: { connected: false } });
    expect(await b.frame(statusEvent(false))).toEqual({ event: "extensionStatus", params: { connected: false } });
  });

  it("an old extension socket closing after a newer one connected emits no {connected:false}", async () => {
    const bridge = new Bridge();
    host = new WsHost(bridge, { port: 0, token: TOKEN, build: BUILD });
    const port = await host.listen();
    const a = track(await client(port, "A"));

    const old = await extension(port);
    track(await extension(port));
    await a.until(() => a.frames.filter(statusEvent(true)).length === 2);

    old.ws.close();
    await old.whenClosed();
    await quiet(100); // fixed window: no false event may arrive
    expect(a.frames.filter(statusEvent(false))).toEqual([]);
    expect(bridge.isConnected()).toBe(true);
  });
});

describe("WsHost v2 — client heartbeat", () => {
  let host: WsHost | undefined;
  const peers: Peer[] = [];
  afterEach(async () => {
    for (const p of peers.splice(0)) p.ws.terminate();
    await host?.close();
    host = undefined;
  });

  it("terminates a client that stops answering pings and removes it from the registry", async () => {
    host = new WsHost(new Bridge(), { port: 0, token: TOKEN, heartbeatMs: 30 });
    const port = await host.listen();
    const counts: number[] = [];
    host.registry.onCountChange((n) => counts.push(n));

    const dead = await client(port, "dead", { autoPong: false });
    peers.push(dead);
    await dead.whenClosed();
    await waitUntil(() => host!.registry.count() === 0);
    expect(counts).toEqual([1, 0]);
  });

  it("keeps a ponging client across several intervals", async () => {
    host = new WsHost(new Bridge(), { port: 0, token: TOKEN, heartbeatMs: 30 });
    const port = await host.listen();
    const live = await client(port, "live");
    peers.push(live);
    await quiet(150); // ~5 intervals
    expect(live.closed).toBeNull();
    expect(host.registry.count()).toBe(1);
  });
});
