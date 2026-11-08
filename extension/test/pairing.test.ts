// Step 15 S4 (#449): the extension's pairing logic (extension/src/pairing.ts), pure, with injected storage and host.
import { describe, expect, it, vi } from "vitest";
import {
  PAIR_FIRST_RETRY_MS, PAIR_MAX_RETRY_MS, PAIR_REQUEST, PAIR_TIMEOUT_MS, PairBackoff, pairLogLine, pairOnce, validPairReply,
  type PairDeps, type PairOutcome,
} from "../src/pairing.js";

const TOKEN = "ab".repeat(32);

describe("validPairReply", () => {
  it("accepts exactly {ok:true, token, port}", () => {
    expect(validPairReply({ ok: true, token: TOKEN, port: 9234 })).toEqual({ token: TOKEN, port: 9234 });
    expect(validPairReply({ port: 1, token: "x".repeat(16), ok: true })).toEqual({ token: "x".repeat(16), port: 1 });
    expect(validPairReply({ ok: true, token: TOKEN, port: 65535 })).not.toBeNull();
  });
  it.each([
    null, undefined, "x", 1, [], [TOKEN],
    { ok: false, error: "no-token" },
    { ok: true, token: TOKEN },
    { ok: true, port: 9234 },
    { ok: "true", token: TOKEN, port: 9234 },
    { ok: true, token: TOKEN, port: 9234, extra: 1 },
    { ok: true, token: "", port: 9234 },
    { ok: true, token: "short", port: 9234 },
    { ok: true, token: "has space 0000000000", port: 9234 },
    { ok: true, token: "x".repeat(257), port: 9234 },
    { ok: true, token: 'quote"00000000000000', port: 9234 },
    { ok: true, token: "line\n00000000000000", port: 9234 },
    { ok: true, token: 123, port: 9234 },
    { ok: true, token: TOKEN, port: 0 },
    { ok: true, token: TOKEN, port: 65536 },
    { ok: true, token: TOKEN, port: 9234.5 },
    { ok: true, token: TOKEN, port: "9234" },
    { ok: true, token: TOKEN, port: Number.NaN },
  ])("refuses %j", (r) => expect(validPairReply(r)).toBeNull());
});

describe("PairBackoff", () => {
  it("due at once; after failures 30 s, 60 s, 120 s … capped at 30 min; reset makes it due again", () => {
    let now = 1_000;
    const b = new PairBackoff(() => now);
    expect(b.due()).toBe(true);
    const waits: number[] = [];
    for (let i = 0; i < 9; i++) {
      b.failed();
      const start = now;
      expect(b.due()).toBe(false);
      while (!b.due()) now += 1_000;
      waits.push(now - start);
    }
    expect(waits.slice(0, 4)).toEqual([PAIR_FIRST_RETRY_MS, 2 * PAIR_FIRST_RETRY_MS, 4 * PAIR_FIRST_RETRY_MS, 8 * PAIR_FIRST_RETRY_MS]);
    expect(Math.max(...waits)).toBe(PAIR_MAX_RETRY_MS);
    b.failed();
    b.reset();
    expect(b.due()).toBe(true);
  });
  it("the 25 s keepalive starts at most one host per back-off step (10 min of ticks → 5 attempts)", async () => {
    let now = 0;
    const b = new PairBackoff(() => now);
    const ask = vi.fn(async () => Promise.reject(new Error("Specified native messaging host not found.")));
    const deps: PairDeps = { ask, readToken: async () => undefined, write: vi.fn(async () => {}), delay: () => new Promise(() => {}) };
    for (; now <= 10 * 60_000; now += 25_000) await pairOnce(deps, b);
    // attempts at 0, 50 s (≥30), 125 s (≥110), 250 s (≥245), 500 s (≥490); the next is due at 980 s
    expect(ask).toHaveBeenCalledTimes(5);
  });
});

describe("pairOnce", () => {
  const setup = (o: Partial<PairDeps> & { stored?: unknown } = {}) => {
    let stored: unknown = o.stored;
    const write = vi.fn(async (p: { token: string; port: number }) => {
      stored = p.token;
    });
    const deps: PairDeps = {
      ask: o.ask ?? vi.fn(async () => ({ ok: true, token: TOKEN, port: 9301 })),
      readToken: o.readToken ?? vi.fn(async () => stored),
      write: o.write ?? write,
      delay: o.delay ?? (() => new Promise(() => {})),
    };
    return { deps, write, backoff: new PairBackoff(() => 0) };
  };

  it("a valid reply with the token still empty writes exactly {token, port}", async () => {
    for (const stored of [undefined, null, ""]) {
      const { deps, write, backoff } = setup({ stored });
      expect(await pairOnce(deps, backoff)).toBe("paired");
      expect(write).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0]![0]).toEqual({ token: TOKEN, port: 9301 });
      expect(Object.keys(write.mock.calls[0]![0]).sort()).toEqual(["port", "token"]);
    }
  });

  it("the request sent is the host's one request", async () => {
    expect(PAIR_REQUEST).toEqual({ type: "pair" });
    expect(Object.isFrozen(PAIR_REQUEST)).toBe(true);
  });

  it("a token typed meanwhile is never overwritten: re-read right before the write", async () => {
    const readToken = vi.fn(async () => "typed-by-the-human-0000");
    const { deps, write, backoff } = setup({ readToken });
    expect(await pairOnce(deps, backoff)).toBe("token-present");
    expect(readToken).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it("the re-read happens after the host answered (order: ask, read, write)", async () => {
    const order: string[] = [];
    const { deps, backoff } = setup({
      ask: async () => (order.push("ask"), { ok: true, token: TOKEN, port: 9234 }),
      readToken: async () => (order.push("read"), ""),
      write: async () => void order.push("write"),
    });
    expect(await pairOnce(deps, backoff)).toBe("paired");
    expect(order).toEqual(["ask", "read", "write"]);
  });

  it("host missing / forbidden / exited / timed out → host-unavailable, no write, back-off", async () => {
    for (const msg of ["Specified native messaging host not found.", "Access to the specified native messaging host is forbidden.", "Native host has exited."]) {
      const { deps, write, backoff } = setup({ ask: async () => Promise.reject(new Error(msg)) });
      expect(await pairOnce(deps, backoff)).toBe("host-unavailable");
      expect(write).not.toHaveBeenCalled();
      expect(backoff.due()).toBe(false);
    }
    const delay = vi.fn(async () => {});
    const { deps, write, backoff } = setup({ ask: () => new Promise(() => {}), delay });
    expect(await pairOnce(deps, backoff)).toBe("host-unavailable");
    expect(delay).toHaveBeenCalledWith(PAIR_TIMEOUT_MS);
    expect(write).not.toHaveBeenCalled();
  });

  it("a refusal or an invalid reply → no write, back-off", async () => {
    const cases: [unknown, PairOutcome][] = [
      [{ ok: false, error: "no-token" }, "host-refused"],
      [{ ok: false }, "host-refused"],
      [{ ok: true, token: "bad token with spaces", port: 9234 }, "invalid-reply"],
      [{ ok: true, token: TOKEN, port: 70000 }, "invalid-reply"],
      [undefined, "invalid-reply"],
      ["text", "invalid-reply"],
    ];
    for (const [reply, want] of cases) {
      const { deps, write, backoff } = setup({ ask: async () => reply });
      expect(await pairOnce(deps, backoff), JSON.stringify(reply)).toBe(want);
      expect(write).not.toHaveBeenCalled();
      expect(backoff.due()).toBe(false);
    }
  });

  it("a failing re-read or write → store-failed (no throw)", async () => {
    const a = setup({ readToken: async () => Promise.reject(new Error("x")) });
    expect(await pairOnce(a.deps, a.backoff)).toBe("store-failed");
    expect(a.write).not.toHaveBeenCalled();
    const b = setup({ write: async () => Promise.reject(new Error("quota")) });
    expect(await pairOnce(b.deps, b.backoff)).toBe("store-failed");
  });

  it("not due → nothing asked", async () => {
    const ask = vi.fn(async () => ({ ok: true, token: TOKEN, port: 9234 }));
    const { deps, backoff } = setup({ ask });
    backoff.failed();
    expect(await pairOnce(deps, backoff)).toBe("not-due");
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("pairLogLine: fixed strings, never a value", () => {
  it("one fixed line per attempted outcome, none for not-due", () => {
    const outcomes: PairOutcome[] = ["paired", "host-unavailable", "host-refused", "invalid-reply", "token-present", "store-failed"];
    const lines = outcomes.map(pairLogLine);
    for (const l of lines) {
      expect(l).toMatch(/^\[bridge\] pairing: /);
      expect(l).not.toContain(TOKEN);
      expect(l).not.toMatch(/9301|9234|chrome-extension|native messaging host not found/);
    }
    expect(new Set(lines).size).toBe(outcomes.length);
    expect(pairLogLine("not-due")).toBeNull();
  });
});
