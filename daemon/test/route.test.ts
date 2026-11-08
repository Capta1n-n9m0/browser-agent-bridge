import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BridgeError } from "@bridge/shared";
import { Bridge } from "../src/bridge.js";
import { ExtensionConnection } from "../src/connection.js";
import { ClientRegistry } from "../src/registry.js";
import { route, daemonWaitMs, DAEMON_SLACK_MS, type RouteHost, type RouteContext } from "../src/route.js";

function makeHost(over: Partial<RouteHost> = {}): RouteHost {
  return {
    build: "b123",
    port: 4567,
    uptimeMs: () => 9000,
    shutdown: vi.fn(async () => {}),
    ...over,
  };
}

function makeCtx(over: Partial<RouteContext> = {}): RouteContext {
  return {
    bridge: new Bridge(),
    registry: new ClientRegistry<unknown>({ now: () => 111 }),
    host: makeHost(),
    ...over,
  };
}

interface SentRequest {
  id: string;
  method: string;
  params?: unknown;
}

/** A bridge whose fake extension answers through `answer` (or never, when omitted), recording what it was sent. */
function connected(answer?: (req: SentRequest) => unknown) {
  const sent: SentRequest[] = [];
  const bridge = new Bridge();
  const conn: ExtensionConnection = new ExtensionConnection((d) => {
    const req = JSON.parse(d) as SentRequest;
    sent.push(req);
    if (answer) queueMicrotask(() => conn.handleMessage(JSON.stringify(answer(req))));
  });
  bridge.setConnection(conn);
  return { bridge, conn, sent };
}

describe("daemonWaitMs", () => {
  it("defaults to 30 000 + slack when absent", () => {
    expect(DAEMON_SLACK_MS).toBe(5000);
    expect(daemonWaitMs(undefined)).toBe(35_000);
  });
  it("clamps into [100, 600 000] before adding the slack", () => {
    expect(daemonWaitMs(50)).toBe(5100);
    expect(daemonWaitMs(100)).toBe(5100);
    expect(daemonWaitMs(1000)).toBe(6000);
    expect(daemonWaitMs(600_000)).toBe(605_000);
    expect(daemonWaitMs(10_000_000)).toBe(605_000);
  });
});

describe("route — forwarding", () => {
  it("forwards a request and answers under the client's id", async () => {
    const { bridge, sent } = connected((req) => ({ id: req.id, result: { echoed: req.method } }));
    const out = await route({ id: "client-7", method: "navigate", params: { url: "x" } }, makeCtx({ bridge }));
    expect(out?.response).toEqual({ id: "client-7", result: { echoed: "navigate" } });
    expect(sent).toEqual([{ id: "1", method: "navigate", params: { url: "x" } }]);
  });

  it("answers an undefined result as null so the reply stays a response", async () => {
    const bridge = new Bridge();
    vi.spyOn(bridge, "call").mockResolvedValue(undefined);
    const out = await route({ id: "a", method: "noop" }, makeCtx({ bridge }));
    expect(out?.response).toEqual({ id: "a", result: null });
    expect("result" in (out?.response ?? {})).toBe(true);
  });

  it("passes the clamped wait (+5000) to bridge.call", async () => {
    const bridge = new Bridge();
    const spy = vi.spyOn(bridge, "call").mockResolvedValue("ok");
    await route({ id: "a", method: "evaluate", params: {}, timeoutMs: 20_000 }, makeCtx({ bridge }));
    await route({ id: "b", method: "snapshot" }, makeCtx({ bridge }));
    expect(spy.mock.calls[0]).toEqual(["evaluate", {}, { timeoutMs: 25_000 }]);
    expect(spy.mock.calls[1]).toEqual(["snapshot", undefined, { timeoutMs: 35_000 }]);
  });

  it("answers NOT_CONNECTED immediately with today's text when no extension is connected", async () => {
    const out = await route({ id: "a", method: "snapshot" }, makeCtx());
    expect(out?.response).toEqual({
      id: "a",
      error: {
        code: "NOT_CONNECTED",
        message: "Extension not connected — is Chrome open and the Browser Agent Bridge extension enabled?",
      },
    });
  });

  it("passes an extension's v2 error through with code and data", async () => {
    const { bridge } = connected((req) => ({
      id: req.id,
      error: { code: "REF_STALE", message: "ref e9 is stale", data: { ref: "e9" } },
    }));
    const out = await route({ id: "a", method: "click", params: { ref: "e9" } }, makeCtx({ bridge }));
    expect(out?.response).toEqual({
      id: "a",
      error: { code: "REF_STALE", message: "ref e9 is stale", data: { ref: "e9" } },
    });
  });

  it("wraps a v1 {message} extension error as INTERNAL", async () => {
    const { bridge } = connected((req) => ({ id: req.id, error: { message: "unknown method: foo" } }));
    const out = await route({ id: "a", method: "foo" }, makeCtx({ bridge }));
    expect(out?.response).toEqual({ id: "a", error: { code: "INTERNAL", message: "unknown method: foo" } });
  });

  it("maps a thrown plain Error to INTERNAL with its message", async () => {
    const bridge = new Bridge();
    vi.spyOn(bridge, "call").mockRejectedValue(new Error("boom"));
    const out = await route({ id: "a", method: "x" }, makeCtx({ bridge }));
    expect(out?.response).toEqual({ id: "a", error: { code: "INTERNAL", message: "boom" } });
  });

  it("keeps a thrown BridgeError's code", async () => {
    const bridge = new Bridge();
    vi.spyOn(bridge, "call").mockRejectedValue(new BridgeError("TIMEOUT", "Timed out after 1ms calling x"));
    const out = await route({ id: "a", method: "x" }, makeCtx({ bridge }));
    expect(out?.response).toEqual({
      id: "a",
      error: { code: "TIMEOUT", message: "Timed out after 1ms calling x" },
    });
  });
});

describe("route — daemon-side wait, real ExtensionConnection under fake timers (D2.5)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function waitsExactly(timeoutMs: number | undefined, expectedWait: number) {
    const { bridge } = connected(); // the fake extension never answers
    const req: Record<string, unknown> = { id: "a", method: "evaluate" };
    if (timeoutMs !== undefined) req.timeoutMs = timeoutMs;
    let settled = false;
    const p = route(req, makeCtx({ bridge })).then((o) => {
      settled = true;
      return o;
    });
    await vi.advanceTimersByTimeAsync(expectedWait - 1);
    const settledBefore = settled;
    await vi.advanceTimersByTimeAsync(1);
    const out = await p;
    return { settledBefore, response: out?.response };
  }

  it("timeoutMs 1000 → still pending at 5999 ms, TIMEOUT at 6000 ms", async () => {
    const r = await waitsExactly(1000, 6000);
    expect(r.settledBefore).toBe(false);
    expect(r.response).toEqual({
      id: "a",
      error: { code: "TIMEOUT", message: "Timed out after 6000ms calling evaluate" },
    });
  });

  it("timeoutMs 50 is clamped to 100 → waits 5100 ms", async () => {
    const r = await waitsExactly(50, 5100);
    expect(r.settledBefore).toBe(false);
    expect(r.response).toMatchObject({ id: "a", error: { code: "TIMEOUT" } });
  });

  it("timeoutMs 10 000 000 is clamped to 600 000 → waits 605 000 ms", async () => {
    const r = await waitsExactly(10_000_000, 605_000);
    expect(r.settledBefore).toBe(false);
    expect(r.response).toMatchObject({ id: "a", error: { code: "TIMEOUT" } });
  });

  it("absent timeoutMs → waits 35 000 ms", async () => {
    const r = await waitsExactly(undefined, 35_000);
    expect(r.settledBefore).toBe(false);
    expect(r.response).toMatchObject({ id: "a", error: { code: "TIMEOUT" } });
  });
});

describe("route — daemon methods", () => {
  it("daemon.status reports build, uptime, extensionConnected, clients and port", async () => {
    const registry = new ClientRegistry<unknown>({ now: () => 111 });
    registry.add({}, { name: "mcp:1" });
    registry.add({}, { name: "script" });
    const out = await route({ id: "s", method: "daemon.status" }, makeCtx({ registry }));
    expect(out?.response).toEqual({
      id: "s",
      result: {
        build: "b123",
        uptime: 9000,
        extensionConnected: false,
        clients: [
          { id: "c1", name: "mcp:1", since: 111 },
          { id: "c2", name: "script", since: 111 },
        ],
        port: 4567,
      },
    });
    expect(out?.after).toBeUndefined();
  });

  it("daemon.status sees a connected extension and is never forwarded", async () => {
    const { bridge, sent } = connected();
    const out = await route({ id: "s", method: "daemon.status" }, makeCtx({ bridge }));
    expect(out?.response).toMatchObject({ id: "s", result: { extensionConnected: true } });
    expect(sent).toEqual([]);
  });

  it("daemon.shutdown replies {ok:true} and only shuts down in `after`, with 4002", async () => {
    const host = makeHost();
    const { bridge, sent } = connected();
    const out = await route({ id: "x", method: "daemon.shutdown" }, makeCtx({ host, bridge }));
    expect(out?.response).toEqual({ id: "x", result: { ok: true } });
    expect(host.shutdown).not.toHaveBeenCalled();
    await out?.after?.();
    expect(host.shutdown).toHaveBeenCalledWith(4002);
    expect(sent).toEqual([]);
  });

  it("any other daemon.* method is UNKNOWN_METHOD and never forwarded", async () => {
    const { bridge, sent } = connected((req) => ({ id: req.id, result: "should not happen" }));
    const out = await route({ id: "u", method: "daemon.foo" }, makeCtx({ bridge }));
    expect(out?.response).toEqual({
      id: "u",
      error: { code: "UNKNOWN_METHOD", message: "unknown daemon method: daemon.foo" },
    });
    expect(sent).toEqual([]);
  });
});

describe("route — validation", () => {
  const bad = (id: unknown, message: string) => ({ id, error: { code: "BAD_PARAMS", message } });

  it("ignores a frame that is not an object or has no usable id (returns null)", async () => {
    const ctx = makeCtx();
    expect(await route("hello", ctx)).toBeNull();
    expect(await route(null, ctx)).toBeNull();
    expect(await route([1, 2], ctx)).toBeNull();
    expect(await route({ method: "snapshot" }, ctx)).toBeNull();
    expect(await route({ id: { x: 1 }, method: "snapshot" }, ctx)).toBeNull();
  });

  it("answers BAD_PARAMS, echoing the id, for a numeric or empty id", async () => {
    const ctx = makeCtx();
    expect((await route({ id: 1, method: "snapshot" }, ctx))?.response).toEqual(
      bad(1, "request id must be a non-empty string"),
    );
    expect((await route({ id: "", method: "snapshot" }, ctx))?.response).toEqual(
      bad("", "request id must be a non-empty string"),
    );
  });

  it("answers BAD_PARAMS for a missing or non-string method", async () => {
    const ctx = makeCtx();
    expect((await route({ id: "a" }, ctx))?.response).toEqual(bad("a", "request method must be a non-empty string"));
    expect((await route({ id: "a", method: 5 }, ctx))?.response).toEqual(
      bad("a", "request method must be a non-empty string"),
    );
  });

  it("answers BAD_PARAMS for params that are not a plain object", async () => {
    const ctx = makeCtx();
    for (const params of [[1], "x", 3, null]) {
      expect((await route({ id: "a", method: "snapshot", params }, ctx))?.response).toEqual(
        bad("a", "request params must be an object"),
      );
    }
  });

  it("answers BAD_PARAMS for a timeoutMs that is not a finite number", async () => {
    const ctx = makeCtx();
    for (const timeoutMs of ["100", null, Number.NaN, Infinity]) {
      expect((await route({ id: "a", method: "snapshot", timeoutMs }, ctx))?.response).toEqual(
        bad("a", "request timeoutMs must be a finite number"),
      );
    }
  });

  it("does not forward a request that fails validation", async () => {
    const { bridge, sent } = connected((req) => ({ id: req.id, result: 1 }));
    await route({ id: "a", method: "snapshot", params: [1] }, makeCtx({ bridge }));
    expect(sent).toEqual([]);
  });
});
