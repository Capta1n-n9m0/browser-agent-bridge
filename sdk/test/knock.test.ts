import { describe, it, expect, vi } from "vitest";
import { BridgeError, ErrorCodes } from "@bridge/shared";
import { knock, type KnockIo } from "../src/knock.js";
import { FakeConnection, fakeClock, fakeDaemon, refused } from "./fakes.js";

const TOKEN = "tok-sekret-123";
const PORT = 9555;
const DAEMON_PATH = "/repo/daemon/dist/index.js";

type Step = "refused" | Error | (() => FakeConnection);

/** tryConnect follows `steps` in order; the last step repeats. Every connection made is recorded. */
function setup(steps: Step[], expected = "NEW", overrides: Partial<KnockIo> = {}, allowHandover?: boolean) {
  const clock = fakeClock();
  const conns: FakeConnection[] = [];
  let i = 0;
  const tryConnect = vi.fn(async (_port: number, _timeoutMs?: number) => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    // A knock that loops (e.g. a second handover) must fail the test, not hang the worker.
    if (i > 200) throw new Error("runaway knock: more than 200 connection attempts");
    if (step === "refused") throw refused();
    if (step instanceof Error) throw step;
    const conn = step();
    conns.push(conn);
    return conn;
  });
  const spawnDaemon = vi.fn(async (_opts: { daemonPath: string; port: number; token: string }) => {});
  const hashDaemon = vi.fn(async (_p: string) => expected);
  const io: KnockIo = { tryConnect, spawnDaemon, hashDaemon, sleep: clock.sleep, now: clock.now, ...overrides };
  const run = () =>
    knock({
      port: PORT,
      token: TOKEN,
      name: "test-script",
      daemonPath: DAEMON_PATH,
      io,
      ...(allowHandover === undefined ? {} : { allowHandover }),
    });
  return { io, clock, conns, tryConnect, spawnDaemon, hashDaemon, run };
}

function shutdownsSent(conns: FakeConnection[]): number {
  return conns.flatMap((c) => c.sent).filter((m) => m.method === "daemon.shutdown").length;
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

describe("knock — the §0.7 state machine", () => {
  it("refused → spawn → knock every 250 ms → hello → welcome", async () => {
    const s = setup(["refused", "refused", () => fakeDaemon({ build: "NEW" })]);
    const { conn, welcome } = await s.run();

    expect(welcome.build).toBe("NEW");
    expect(s.spawnDaemon).toHaveBeenCalledTimes(1);
    expect(s.spawnDaemon).toHaveBeenCalledWith({ daemonPath: DAEMON_PATH, port: PORT, token: TOKEN });
    // F24: the port knocked on is the port handed to the spawned daemon.
    for (const call of s.tryConnect.mock.calls) expect(call[0]).toBe(PORT);
    expect(s.clock.sleep.mock.calls.filter(([ms]) => ms === 250)).toHaveLength(2);
    expect(s.hashDaemon).toHaveBeenCalledWith(DAEMON_PATH);
    expect(conn).toBe(s.conns[0]);
    expect(s.conns[0].sent[0]).toEqual({
      type: "hello",
      token: TOKEN,
      role: "client",
      name: "test-script",
      build: "NEW",
      proto: 2,
    });
    // The knock hands over a connection with none of its own listeners left on it.
    expect(s.conns[0].listenerCount).toBe(0);
  });

  it("connected, matching build → done without spawning", async () => {
    const s = setup([() => fakeDaemon({ build: "NEW" })]);
    const { welcome } = await s.run();
    expect(welcome.build).toBe("NEW");
    expect(s.spawnDaemon).not.toHaveBeenCalled();
    expect(shutdownsSent(s.conns)).toBe(0);
  });

  it("connected but stale build → daemon.shutdown → wait close → knock until refused → spawn → reconnected", async () => {
    const s = setup([() => fakeDaemon({ build: "OLD" }), "refused", () => fakeDaemon({ build: "NEW" })]);
    const { welcome, conn } = await s.run();

    expect(welcome.build).toBe("NEW");
    expect(conn).toBe(s.conns[1]);
    expect(shutdownsSent(s.conns)).toBe(1);
    const shutdown = s.conns[0].sent.find((m) => m.method === "daemon.shutdown");
    expect(typeof shutdown?.id).toBe("string");
    expect(s.spawnDaemon).toHaveBeenCalledTimes(1);
    expect(s.spawnDaemon).toHaveBeenCalledWith({ daemonPath: DAEMON_PATH, port: PORT, token: TOKEN });
  });

  it("after the handover, the old daemon still answering is knocked on until the port is refused", async () => {
    const s = setup([
      () => fakeDaemon({ build: "OLD" }),
      () => fakeDaemon({ build: "OLD" }), // still draining
      "refused",
      () => fakeDaemon({ build: "NEW" }),
    ]);
    const { welcome } = await s.run();
    expect(welcome.build).toBe("NEW");
    expect(shutdownsSent(s.conns)).toBe(1);
    expect(s.conns[1].closeCalls.length).toBeGreaterThan(0);
    expect(s.spawnDaemon).toHaveBeenCalledTimes(1);
  });

  it("another client already upgraded the daemon during our handover → accept it, no spawn", async () => {
    const s = setup([() => fakeDaemon({ build: "OLD" }), () => fakeDaemon({ build: "NEW" })]);
    const { welcome } = await s.run();
    expect(welcome.build).toBe("NEW");
    expect(s.spawnDaemon).not.toHaveBeenCalled();
  });

  it("spawn loses the bind race (EADDRINUSE: the other starter's daemon wins) → keeps knocking and succeeds", async () => {
    const s = setup(["refused", "refused", "refused", "refused", () => fakeDaemon({ build: "NEW" })], "NEW", {
      spawnDaemon: vi.fn(async () => {
        throw Object.assign(new Error("listen EADDRINUSE: address already in use 127.0.0.1:9555"), {
          code: "EADDRINUSE",
        });
      }),
    });
    const { welcome } = await s.run();
    expect(welcome.build).toBe("NEW");
    expect(s.io.spawnDaemon).toHaveBeenCalledTimes(1);
    expect(s.tryConnect).toHaveBeenCalledTimes(5);
  });

  it("a spawn that throws synchronously is not fatal either", async () => {
    const s = setup(["refused", () => fakeDaemon({ build: "NEW" })], "NEW", {
      spawnDaemon: () => {
        throw new Error("spawn failed");
      },
    });
    await expect(s.run()).resolves.toMatchObject({ welcome: { build: "NEW" } });
  });

  it("gives up after the injected 10 s, naming the daemon log and the port — no real time passes", async () => {
    const s = setup(["refused"]);
    const realStart = performance.now();
    const err = await rejection(s.run());
    const realElapsed = performance.now() - realStart;

    expect(err.code).toBe(ErrorCodes.NOT_CONNECTED);
    expect(err.message).toContain("~/.browser-agent-bridge/daemon.log");
    expect(err.message).toContain(String(PORT));
    expect(s.clock.now()).toBeGreaterThanOrEqual(10_000);
    expect(s.clock.now()).toBeLessThan(10_000 + 250 + 1);
    expect(s.spawnDaemon).toHaveBeenCalledTimes(1);
    expect(s.tryConnect.mock.calls.length).toBeGreaterThanOrEqual(40);
    expect(realElapsed).toBeLessThan(2_000);
  });

  it("a second build mismatch after its own handover → VERSION naming both builds, exactly one daemon.shutdown", async () => {
    const s = setup([() => fakeDaemon({ build: "OLD" }), "refused", () => fakeDaemon({ build: "OTHER" })]);
    const err = await rejection(s.run());

    expect(err.code).toBe(ErrorCodes.VERSION);
    expect(err.message).toContain("NEW");
    expect(err.message).toContain("OTHER");
    expect(shutdownsSent(s.conns)).toBe(1);
    expect(s.conns[1].closeCalls.length).toBeGreaterThan(0);
    expect(s.spawnDaemon).toHaveBeenCalledTimes(1);
  });

  it("connected, hello sent, no welcome within 2 s → VERSION naming a pre-Step-6 server; no spawn, no shutdown", async () => {
    const silent = new FakeConnection();
    const s = setup([() => silent]);
    const err = await rejection(s.run());

    expect(err.code).toBe(ErrorCodes.VERSION);
    expect(err.message).toContain("pre-Step-6");
    expect(err.message).toContain(String(PORT));
    expect(err.message).toMatch(/end the old Claude session/i);
    expect(silent.closeCalls.length).toBeGreaterThan(0);
    expect(s.spawnDaemon).not.toHaveBeenCalled();
    expect(shutdownsSent(s.conns)).toBe(0);
    expect(s.tryConnect).toHaveBeenCalledTimes(1);
    expect(s.clock.sleep).toHaveBeenCalledWith(2_000, expect.anything());
    expect(silent.sent.map((m) => m.type)).toEqual(["hello"]);
  });

  it("closed with 4001 during hello → rejected without retrying; the token is not in the message", async () => {
    const s = setup([() => new FakeConnection((m, c) => m.type === "hello" && c.fireClose(4001, "invalid token"))]);
    const err = await rejection(s.run());

    expect(err.code).toBe(ErrorCodes.NOT_CONNECTED);
    expect(err.message).toMatch(/rejected the token/);
    expect(err.message).toContain("bridge.token");
    expect(err.message).toContain("BRIDGE_TOKEN");
    expect(err.message).not.toContain(TOKEN);
    expect(s.tryConnect).toHaveBeenCalledTimes(1);
    expect(s.spawnDaemon).not.toHaveBeenCalled();
  });

  it("welcome.proto !== 2 → VERSION", async () => {
    const s = setup([() => fakeDaemon({ build: "NEW", proto: 3 })]);
    const err = await rejection(s.run());
    expect(err.code).toBe(ErrorCodes.VERSION);
    expect(err.message).toMatch(/protocol/);
    expect(s.conns[0].closeCalls.length).toBeGreaterThan(0);
  });

  it("a close other than 4001 during hello (the daemon going away) → keep knocking", async () => {
    const s = setup([
      () => new FakeConnection((m, c) => m.type === "hello" && c.fireClose(1006)),
      () => fakeDaemon({ build: "NEW" }),
    ]);
    await expect(s.run()).resolves.toMatchObject({ welcome: { build: "NEW" } });
    expect(s.spawnDaemon).not.toHaveBeenCalled();
  });

  it("a connect error other than ECONNREFUSED does not spawn but keeps knocking", async () => {
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const s = setup([reset, () => fakeDaemon({ build: "NEW" })]);
    await expect(s.run()).resolves.toMatchObject({ welcome: { build: "NEW" } });
    expect(s.spawnDaemon).not.toHaveBeenCalled();
  });

  it("frames other than welcome before the welcome are ignored", async () => {
    const s = setup([
      () =>
        new FakeConnection((m, c) => {
          if (m.type !== "hello") return;
          c.emit({ event: "extensionStatus", params: { connected: true } });
          c.emit({ type: "welcome", build: "NEW", proto: 2, clientId: "c9", extensionConnected: false });
        }),
    ]);
    const { welcome } = await s.run();
    expect(welcome.clientId).toBe("c9");
  });

  it("stops listening at the welcome: a frame right behind it is left for the client", async () => {
    const s = setup([
      () =>
        new FakeConnection((m, c) => {
          if (m.type !== "hello") return;
          c.emit({ type: "welcome", build: "NEW", proto: 2, clientId: "c1", extensionConnected: false });
          // Same tick: the knock's listener must already be gone.
          expect(c.listenerCount).toBeLessThanOrEqual(1);
        }),
    ]);
    await s.run();
    expect(s.conns[0].listenerCount).toBe(0);
  });

  it("passes tryConnect the remaining budget as its handshake timeout", async () => {
    const s = setup(["refused", "refused", () => fakeDaemon({ build: "NEW" })]);
    await s.run();
    expect(s.tryConnect.mock.calls.map((c) => c[1])).toEqual([10_000, 9_750, 9_500]);
  });

  it("a handshake timeout (ETIMEDOUT) does not spawn; the knock keeps going and gives up at the deadline", async () => {
    const timedOut = Object.assign(new Error("WebSocket handshake timed out"), { code: "ETIMEDOUT" });
    const s = setup([timedOut]);
    const err = await rejection(s.run());
    expect(err.code).toBe(ErrorCodes.NOT_CONNECTED);
    expect(err.message).toContain("ETIMEDOUT");
    expect(err.message).toContain("~/.browser-agent-bridge/daemon.log");
    expect(err.message).toContain(String(PORT));
    expect(s.spawnDaemon).not.toHaveBeenCalled();
    expect(s.clock.now()).toBeGreaterThanOrEqual(10_000);
  });

  it("the 10 s budget restarts at the handover: give-up ≈ handover time + 10 s, the message says so", async () => {
    // 4 refusals (t = 1000 ms), then the stale daemon is handed over, then nothing ever answers.
    const s = setup(["refused", "refused", "refused", "refused", () => fakeDaemon({ build: "OLD" }), "refused"]);
    const err = await rejection(s.run());
    expect(err.code).toBe(ErrorCodes.NOT_CONNECTED);
    expect(s.clock.now()).toBeGreaterThanOrEqual(1_000 + 10_000);
    expect(s.clock.now()).toBeLessThan(1_000 + 10_000 + 250 + 1);
    expect(err.message).toContain("~/.browser-agent-bridge/daemon.log");
    expect(err.message).toContain(String(PORT));
    expect(err.message).toContain("within 10 s of asking the old daemon to step down");
    expect(shutdownsSent(s.conns)).toBe(1);
  });

  it("the give-up without a handover says the 10 s run from the first knock", async () => {
    const s = setup(["refused"]);
    const err = await rejection(s.run());
    expect(err.message).toContain("within 10 s of the first knock");
  });

  it("after its own handover, the old build still answering at the deadline → VERSION naming both builds", async () => {
    const s = setup([() => fakeDaemon({ build: "OLD" }), () => fakeDaemon({ build: "OLD" })]);
    const err = await rejection(s.run());
    expect(err.code).toBe(ErrorCodes.VERSION);
    expect(err.message).toContain("OLD");
    expect(err.message).toContain("NEW");
    expect(shutdownsSent(s.conns)).toBe(1);
    expect(s.spawnDaemon).not.toHaveBeenCalled();
    expect(s.clock.now()).toBeGreaterThanOrEqual(10_000);
  });

  it("allowHandover: false (a reconnect after 4002) + a build mismatch → VERSION naming both, no daemon.shutdown", async () => {
    const s = setup([() => fakeDaemon({ build: "OTHER" })], "NEW", {}, false);
    const err = await rejection(s.run());
    expect(err.code).toBe(ErrorCodes.VERSION);
    expect(err.message).toContain("OTHER");
    expect(err.message).toContain("NEW");
    expect(shutdownsSent(s.conns)).toBe(0);
    expect(s.conns[0].closeCalls.length).toBeGreaterThan(0);
    expect(s.spawnDaemon).not.toHaveBeenCalled();
    expect(s.tryConnect).toHaveBeenCalledTimes(1);
  });

  it("allowHandover: false still spawns on a refused port (spawning is not a handover)", async () => {
    const s = setup(["refused", () => fakeDaemon({ build: "NEW" })], "NEW", {}, false);
    const { welcome } = await s.run();
    expect(welcome.build).toBe("NEW");
    expect(s.spawnDaemon).toHaveBeenCalledTimes(1);
  });

  it("closed with 4001 → the daemon's close reason is in the message; the token never is", async () => {
    const s = setup([() => new FakeConnection((m, c) => m.type === "hello" && c.fireClose(4001, "unknown role"))]);
    const err = await rejection(s.run());
    expect(err.code).toBe(ErrorCodes.NOT_CONNECTED);
    expect(err.message).toMatch(/rejected the token/);
    expect(err.message).toContain('"unknown role"');
    expect(err.message).toContain("bridge.token");

    const leaky = setup([() => new FakeConnection((m, c) => m.type === "hello" && c.fireClose(4001, `bad ${TOKEN}`))]);
    const err2 = await rejection(leaky.run());
    expect(err2.message).not.toContain(TOKEN);
  });
});
