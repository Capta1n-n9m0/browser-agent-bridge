// Step 8 S4 — SDK failure reports (phase doc 0.5): which errors are enriched, the 5 s budget on an
// injected clock, the screenshot path, `failureReports: false`, and `report()`'s shape and line cap.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BridgeError,
  ErrorCodes,
  type NetworkEntry,
  type SnapshotElement,
  type SnapshotResult,
  type WelcomeMessage,
} from "@bridge/shared";
import { BridgeClient, type Timers } from "../src/client.js";
import { connect } from "../src/connect.js";
import { ATTACH_BUDGET_MS, ATTACH_CODES, attachContext, renderReport } from "../src/error.js";
import type { Knocked } from "../src/knock.js";
import { Tab, type TabHost } from "../src/tab.js";
import { FakeConnection } from "./fakes.js";

const SEVEN = ["LOCATOR_NOT_FOUND", "LOCATOR_AMBIGUOUS", "REF_STALE", "OFFSCREEN", "PAGE_ERROR", "NAV_FAILED", "TIMEOUT"];
const ATTACH_METHODS = ["snapshot", "screenshot", "networkRequests"];

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;
/** 2026-10-23T09:00:00.123Z */
const NOW = Date.UTC(2026, 9, 23, 9, 0, 0, 123);
const FILE = "2026-10-23T09-00-00-123Z-T3.png";

function el(i: number, over: Partial<SnapshotElement> = {}): SnapshotElement {
  return { ref: `e${i}`, role: "button", name: `Button ${i}`, depth: 0, ...over };
}

function snap(n: number, truncated = false): SnapshotResult {
  return { url: "https://a.test/page", title: "A page", elements: Array.from({ length: n }, (_, i) => el(i + 1)), truncated };
}

function entry(i: number, over: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    id: `r${i}`,
    tabId: 11,
    url: `https://a.test/api/${i}`,
    method: "GET",
    type: "xmlhttprequest",
    startedAt: NOW - 1000,
    endedAt: NOW - 900,
    durationMs: 100,
    status: 200,
    ...over,
  };
}

// ── a manual clock: timers fire only when the test advances virtual time ──────────────────────

function manualTimers() {
  let t = 0;
  const list: { fn: () => void; due: number; cleared: boolean; fired: boolean; ms: number }[] = [];
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const e = { fn, due: t + ms, cleared: false, fired: false, ms };
      list.push(e);
      return e;
    },
    clearTimeout: (h) => {
      if (h) (h as { cleared: boolean }).cleared = true;
    },
  };
  const advance = async (to: number) => {
    t = to;
    for (const e of [...list]) {
      if (!e.cleared && !e.fired && e.due <= t) {
        e.fired = true;
        e.fn();
      }
    }
    await flush();
  };
  return { timers, list, advance };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
}

// ── a fake daemon connection scripted per method ──────────────────────────────────────────────

type Behaviour =
  | { result: unknown }
  | { error: { code: string; message: string; data?: unknown } }
  | "hang"
  | ((m: Record<string, unknown>, c: FakeConnection) => void);

const DEFAULTS: Record<string, Behaviour> = {
  "tabs.claim": { result: { tab: "T3" } },
  snapshot: { result: snap(3) },
  screenshot: { result: { dataUrl: DATA_URL } },
  networkRequests: { result: { entries: [entry(1), entry(2, { status: 404 })], total: 2 } },
};

function scripted(behave: Record<string, Behaviour>): FakeConnection {
  const all = { ...DEFAULTS, ...behave };
  return new FakeConnection((m, c) => {
    if (typeof m.method !== "string") return;
    const b = all[m.method] ?? { result: { ok: true } };
    if (b === "hang") return;
    if (typeof b === "function") return b(m, c);
    if ("error" in b) c.emit({ id: m.id, error: b.error });
    else c.emit({ id: m.id, result: b.result });
  });
}

function welcome(): WelcomeMessage {
  return { type: "welcome", build: "B", proto: 2, clientId: "c1", extensionConnected: true };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "bridge-failures-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface SetupOptions {
  failureReports?: boolean;
  env?: Record<string, string | undefined>;
  homedir?: () => string;
}

async function setup(behave: Record<string, Behaviour>, o: SetupOptions = {}) {
  const conn = scripted(behave);
  const clock = manualTimers();
  const knock = vi.fn(async (): Promise<Knocked> => ({ conn, welcome: welcome() }));
  const client = new BridgeClient({
    knock,
    timers: clock.timers,
    failureReports: o.failureReports,
    env: o.env ?? { BRIDGE_FAILURES_DIR: dir },
    homedir: o.homedir ?? (() => path.join(dir, "home")),
    now: () => NOW,
  });
  await client.connect();
  const tab = await client.claim("T3");
  return { client, tab, conn, clock };
}

/** Frames sent after the claim, as method/params/timeoutMs. */
function sentAfterClaim(conn: FakeConnection) {
  const calls = conn.sent.filter((f) => typeof f.method === "string");
  return calls.slice(1).map((f) => ({ method: f.method as string, params: f.params as Record<string, unknown>, timeoutMs: f.timeoutMs }));
}

async function caught(p: Promise<unknown>): Promise<BridgeError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeError);
    return err as BridgeError;
  }
  throw new Error("expected a rejection");
}

/** A TabHost whose `call` rejects the first call with `err` and answers the rest from DEFAULTS. */
function rejectingHost(err: BridgeError, o: { failureReports?: boolean } = {}) {
  const clock = manualTimers();
  const calls: { method: string; params?: Record<string, unknown>; options?: { timeoutMs?: number } }[] = [];
  const host: TabHost = {
    call: vi.fn(async (method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }) => {
      calls.push({ method, params, options });
      if (calls.length === 1) throw err;
      const b = DEFAULTS[method];
      return b && typeof b === "object" && "result" in b ? b.result : { ok: true };
    }),
    generation: () => 0,
    failureReports: () =>
      o.failureReports === false
        ? null
        : { timers: clock.timers, env: { BRIDGE_FAILURES_DIR: dir }, homedir: () => dir, now: () => NOW },
  };
  return { host, calls, clock };
}

// ── the attach set ─────────────────────────────────────────────────────────────────────────────

describe("the attach set (S4.2)", () => {
  it("ATTACH_CODES is exactly the seven codes of 0.5, frozen; the budget is 5000 ms", () => {
    expect([...ATTACH_CODES].sort()).toEqual([...SEVEN].sort());
    expect(Object.isFrozen(ATTACH_CODES)).toBe(true);
    expect(ATTACH_BUDGET_MS).toBe(5000);
  });

  for (const code of Object.keys(ErrorCodes)) {
    const inSet = SEVEN.includes(code);
    it(`${code}: ${inSet ? "attaches snapshot, screenshot, network" : "attaches nothing, rethrown untouched"}`, async () => {
      const { tab, conn } = await setup({ click: { error: { code, message: `failed with ${code}` } } });
      const err = await caught(tab.click("e1"));
      expect(err.code).toBe(code);
      const methods = sentAfterClaim(conn).map((f) => f.method);
      if (inSet) {
        expect(methods[0]).toBe("click");
        expect(methods.slice(1).sort()).toEqual([...ATTACH_METHODS].sort());
        expect(typeof err.report).toBe("function");
        expect(err.attachErrors).toEqual([]);
      } else {
        expect(methods).toEqual(["click"]);
        for (const k of ["snapshot", "screenshotPath", "network", "attachErrors", "report"]) {
          expect(Object.prototype.hasOwnProperty.call(err, k)).toBe(false);
        }
      }
    });
  }

  for (const code of ["TAB_HELD", "TAB_GONE", "NOT_CONNECTED"]) {
    it(`${code} is rethrown as the same object with no attach call and no property set`, async () => {
      const original = new BridgeError(code, "nope", { owner: "x" });
      const { host, calls } = rejectingHost(original);
      const tab = new Tab(host, "T3", 0);
      const err = await caught(tab.click("e1"));
      expect(err).toBe(original);
      expect(calls.map((c) => c.method)).toEqual(["click"]);
      // The shared constructor's own enumerable properties only: nothing was added.
      expect(Object.keys(err).sort()).toEqual(["code", "data", "name"]);
      expect(err.report).toBeUndefined();
      expect(err.attachErrors).toBeUndefined();
    });
  }

  it("an enriched error is the same object, still instanceof BridgeError, code/message/data unchanged", async () => {
    const original = new BridgeError("LOCATOR_NOT_FOUND", "no button", { candidates: [] });
    const { host } = rejectingHost(original);
    const err = await caught(new Tab(host, "T3", 0).click({ role: "button", name: "Save" }));
    expect(err).toBe(original);
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.code).toBe("LOCATOR_NOT_FOUND");
    expect(err.message).toBe("no button");
    expect(err.data).toEqual({ candidates: [] });
    expect(err.snapshot).toEqual(snap(3));
    expect(typeof err.report).toBe("function");
  });

  it("attach calls carry tab: <handle>, timeoutMs within [100, remaining budget], and network asks for the last 20", async () => {
    const { tab, conn } = await setup({ navigate: { error: { code: "NAV_FAILED", message: "net::ERR" } } });
    await caught(tab.navigate("https://x.test/"));
    const attach = sentAfterClaim(conn).slice(1);
    expect(attach.map((f) => f.method).sort()).toEqual([...ATTACH_METHODS].sort());
    for (const f of attach) {
      expect(f.params.tab).toBe("T3");
      expect(typeof f.timeoutMs).toBe("number");
      expect(f.timeoutMs as number).toBeLessThanOrEqual(ATTACH_BUDGET_MS);
      expect(f.timeoutMs as number).toBeGreaterThanOrEqual(100);
    }
    expect(attach.find((f) => f.method === "networkRequests")!.params).toStrictEqual({ tab: "T3", limit: 20 });
    expect(attach.find((f) => f.method === "screenshot")!.params).toStrictEqual({ tab: "T3" });
    expect(attach.find((f) => f.method === "snapshot")!.params).toStrictEqual({ tab: "T3" });
  });

  it("network keeps at most the last 20 entries the call returned", async () => {
    const entries = Array.from({ length: 25 }, (_, i) => entry(i + 1));
    const { tab } = await setup({
      click: { error: { code: "REF_STALE", message: "stale" } },
      networkRequests: { result: { entries, total: 25 } },
    });
    const err = await caught(tab.click("e1"));
    expect(err.network!.map((e) => e.id)).toEqual(entries.slice(5).map((e) => e.id));
  });

  it("a failing focusTab of a trusted click is enriched once, and the click is not sent", async () => {
    const { tab, conn } = await setup({ focusTab: { error: { code: "TIMEOUT", message: "slow" } } });
    const err = await caught(tab.click("e1", { trusted: true }));
    expect(err.code).toBe("TIMEOUT");
    const methods = sentAfterClaim(conn).map((f) => f.method);
    expect(methods[0]).toBe("focusTab");
    expect(methods.slice(1).sort()).toEqual([...ATTACH_METHODS].sort());
  });

  it("download errors with an attach-set code are enriched", async () => {
    const { tab, conn } = await setup({ downloadStart: { error: { code: "TIMEOUT", message: "fetch slow" } } });
    const err = await caught(tab.download("https://f.test/x", path.join(dir, "x.bin")));
    expect(err.code).toBe("TIMEOUT");
    expect(sentAfterClaim(conn).map((f) => f.method).slice(1).sort()).toEqual([...ATTACH_METHODS].sort());
    expect(typeof err.report).toBe("function");
  });

  it("a local error before any call (stale guard) is not enriched", async () => {
    const { host, calls } = rejectingHost(new BridgeError("TIMEOUT", "x"));
    const tab = new Tab({ ...host, generation: () => 1 }, "T3", 0);
    const err = await caught(tab.click("e1"));
    expect(err.code).toBe("TAB_UNKNOWN");
    expect(calls).toEqual([]);
    expect(err.report).toBeUndefined();
  });
});

// ── failures to attach ─────────────────────────────────────────────────────────────────────────

describe("attach failures are recorded, never thrown (S4.2)", () => {
  it("an attach call that rejects → '<what>: <CODE> <first line>' in attachErrors; the original is thrown", async () => {
    const { tab } = await setup({
      click: { error: { code: "OFFSCREEN", message: "not on screen" } },
      screenshot: { error: { code: "WINDOW_MINIMIZED", message: "The window is minimized\nsecond line" } },
    });
    const err = await caught(tab.click("e1"));
    expect(err.code).toBe("OFFSCREEN");
    expect(err.message).toBe("not on screen");
    expect(err.attachErrors).toEqual(["screenshot: WINDOW_MINIMIZED The window is minimized"]);
    expect(err.screenshotPath).toBeUndefined();
    expect(err.snapshot).toEqual(snap(3));
    expect(err.network).toHaveLength(2);
  });

  it("the original object is thrown when every attach call rejects", async () => {
    const original = new BridgeError("PAGE_ERROR", "boom");
    const clock = manualTimers();
    const host: TabHost = {
      call: vi.fn(async () => {
        throw original;
      }),
      generation: () => 0,
      failureReports: () => ({ timers: clock.timers, env: { BRIDGE_FAILURES_DIR: dir }, homedir: () => dir, now: () => NOW }),
    };
    const err = await caught(new Tab(host, "T3", 0).evaluate("x"));
    expect(err).toBe(original);
    expect(err.attachErrors!.sort()).toEqual(
      ["network: PAGE_ERROR boom", "screenshot: PAGE_ERROR boom", "snapshot: PAGE_ERROR boom"],
    );
  });

  it("an attach call that hangs is cut at exactly 5000 ms of the injected clock — not at 4999", async () => {
    const { tab, clock } = await setup({ click: { error: { code: "REF_STALE", message: "stale" } }, screenshot: "hang" });
    let settled: BridgeError | null = null;
    tab.click("e1").catch((e: BridgeError) => {
      settled = e;
    });
    await flush();
    await clock.advance(4999);
    expect(settled).toBeNull();
    await clock.advance(5000);
    expect(settled).not.toBeNull();
    const err = settled! as BridgeError;
    expect(err.code).toBe("REF_STALE");
    expect(err.attachErrors).toEqual(["screenshot: not attached within 5 s"]);
    expect(err.snapshot).toEqual(snap(3));
    expect(err.network).toHaveLength(2);
    expect(err.screenshotPath).toBeUndefined();
  });

  it("a screenshot that arrives after the cut is ignored and writes no file", async () => {
    let answerShot: (() => void) | null = null;
    const { tab, clock } = await setup({
      click: { error: { code: "TIMEOUT", message: "slow" } },
      screenshot: (m, c) => {
        answerShot = () => c.emit({ id: m.id, result: { dataUrl: DATA_URL } });
      },
    });
    let settled: BridgeError | null = null;
    tab.click("e1").catch((e: BridgeError) => {
      settled = e;
    });
    await flush();
    await clock.advance(5000);
    expect(settled).not.toBeNull();
    answerShot!();
    await flush();
    // Real time for the file system: a write that slipped through would land well within this.
    await new Promise<void>((r) => setTimeout(r, 300));
    const err = settled! as BridgeError;
    expect(err.screenshotPath).toBeUndefined();
    expect(err.attachErrors).toEqual(["screenshot: not attached within 5 s"]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("the budget timer is cleared when every attachment settles in time", async () => {
    const { tab, clock } = await setup({ click: { error: { code: "TIMEOUT", message: "slow" } } });
    await caught(tab.click("e1"));
    const budget = clock.list.filter((e) => e.ms === ATTACH_BUDGET_MS);
    expect(budget).toHaveLength(1);
    expect(budget[0]!.cleared).toBe(true);
  });
});

// ── the screenshot path ────────────────────────────────────────────────────────────────────────

describe("the screenshot path", () => {
  it("is BRIDGE_FAILURES_DIR/<iso>-<handle>.png when the variable is set; the PNG bytes are written", async () => {
    const target = path.join(dir, "custom", "nested");
    const { tab } = await setup({ click: { error: { code: "TIMEOUT", message: "slow" } } }, { env: { BRIDGE_FAILURES_DIR: target } });
    const err = await caught(tab.click("e1"));
    expect(err.screenshotPath).toBe(path.join(target, FILE));
    expect(readFileSync(err.screenshotPath!)).toEqual(PNG);
  });

  it("is <homedir>/.browser-agent-bridge/failures/ when BRIDGE_FAILURES_DIR is unset or empty", async () => {
    for (const env of [{}, { BRIDGE_FAILURES_DIR: "" }]) {
      const home = mkdtempSync(path.join(dir, "home-"));
      const { tab } = await setup({ click: { error: { code: "TIMEOUT", message: "slow" } } }, { env, homedir: () => home });
      const err = await caught(tab.click("e1"));
      expect(err.screenshotPath).toBe(path.join(home, ".browser-agent-bridge", "failures", FILE));
      expect(existsSync(err.screenshotPath!)).toBe(true);
    }
  });

  it("report() shows a path under the injected home as ~, while err.screenshotPath stays absolute (S14)", async () => {
    const home = mkdtempSync(path.join(dir, "home-"));
    const { tab } = await setup({ click: { error: { code: "TIMEOUT", message: "slow" } } }, { env: {}, homedir: () => home });
    const err = await caught(tab.click("e1"));
    const sep = path.sep;
    expect(path.isAbsolute(err.screenshotPath!)).toBe(true);
    expect(err.report!().split("\n")).toContain(`Screenshot: ~${sep}.browser-agent-bridge${sep}failures${sep}${FILE}`);
  });

  it("a throwing homedir() with BRIDGE_FAILURES_DIR set keeps the report; the line prints the absolute path (S14)", async () => {
    const { tab } = await setup(
      { click: { error: { code: "TIMEOUT", message: "slow" } } },
      {
        env: { BRIDGE_FAILURES_DIR: dir },
        homedir: () => {
          throw new Error("no home");
        },
      },
    );
    const err = await caught(tab.click("e1"));
    expect(typeof err.report).toBe("function");
    expect(err.screenshotPath).toBe(path.join(dir, FILE));
    expect(err.report!().split("\n")).toContain(`Screenshot: ${path.join(dir, FILE)}`);
  });

  it("the file name has no ':' (Windows)", async () => {
    const { tab } = await setup({ click: { error: { code: "TIMEOUT", message: "slow" } } });
    const err = await caught(tab.click("e1"));
    expect(path.basename(err.screenshotPath!)).not.toContain(":");
    expect(path.basename(err.screenshotPath!)).toBe(FILE);
  });
});

// ── where it runs, and turning it off ──────────────────────────────────────────────────────────

describe("where enrichment runs; failureReports: false", () => {
  it("failureReports: false → zero attach calls, error untouched", async () => {
    const { tab, conn } = await setup({ click: { error: { code: "LOCATOR_NOT_FOUND", message: "no" } } }, { failureReports: false });
    const err = await caught(tab.click("e1"));
    expect(sentAfterClaim(conn).map((f) => f.method)).toEqual(["click"]);
    expect(err.report).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(err, "attachErrors")).toBe(false);
  });

  it("a host with failure reports off (null) → the same object, untouched", async () => {
    const original = new BridgeError("TIMEOUT", "slow");
    const { host, calls } = rejectingHost(original, { failureReports: false });
    const err = await caught(new Tab(host, "T3", 0).click("e1"));
    expect(err).toBe(original);
    expect(calls).toHaveLength(1);
    expect(err.report).toBeUndefined();
  });

  it("a mirrored client method (client.click) is enriched", async () => {
    const { client, conn } = await setup({ click: { error: { code: "LOCATOR_AMBIGUOUS", message: "2 match" } } });
    const err = await caught(client.click({ role: "button", name: "Go" }));
    expect(err).toBeInstanceOf(BridgeError);
    expect(sentAfterClaim(conn).map((f) => f.method).slice(1).sort()).toEqual([...ATTACH_METHODS].sort());
    expect(typeof err.report).toBe("function");
  });

  it("raw client.call() is not enriched", async () => {
    const { client, conn } = await setup({ click: { error: { code: "LOCATOR_NOT_FOUND", message: "no" } } });
    const err = await caught(client.call("click", { tab: "T3", ref: "e1" }));
    expect(sentAfterClaim(conn).map((f) => f.method)).toEqual(["click"]);
    expect(err.report).toBeUndefined();
  });

  it("connect({failureReports: false}) reaches the client: no attach call; with reports on the PNG lands in BRIDGE_FAILURES_DIR", async () => {
    const daemonFile = path.join(dir, "index.js");
    writeFileSync(daemonFile, "// fake daemon bundle");
    // os.homedir() reads USERPROFILE on Windows and HOME on POSIX: point both at a temp dir, so an
    // env-handling regression writes there (and fails the assertion below), never into the real home.
    const fakeHome = mkdtempSync(path.join(dir, "home-"));
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    try {
    for (const failureReports of [false, undefined]) {
      const conn = scripted({ click: { error: { code: "TIMEOUT", message: "slow" } } });
      const helloing = new FakeConnection((m, c) => {
        if (m.type === "hello") {
          c.emit({ type: "welcome", build: "NEW", proto: 2, clientId: "c1", extensionConnected: true });
          return;
        }
        conn.send(m);
      });
      // Route the scripted answers back through the socket the client listens on.
      conn.onMessage((msg) => helloing.emit(msg));
      const client = await connect({
        name: "s4-test",
        env: { BRIDGE_TOKEN: "s4-token", BRIDGE_DAEMON: daemonFile, BRIDGE_FAILURES_DIR: dir },
        failureReports,
        io: {
          tryConnect: vi.fn(async () => helloing),
          spawnDaemon: vi.fn(async () => {}),
          hashDaemon: vi.fn(async () => "NEW"),
          sleep: vi.fn(async () => {}),
          now: () => 0,
        },
      });
      const tab = await client.claim("T3");
      const err = await caught(tab.click("e1"));
      const methods = helloing.sent.filter((f) => typeof f.method === "string").map((f) => f.method);
      if (failureReports === false) expect(methods).toEqual(["tabs.claim", "click"]);
      else {
        expect(methods.slice(2).sort()).toEqual([...ATTACH_METHODS].sort());
        expect(err.screenshotPath!.startsWith(dir + path.sep)).toBe(true);
        expect(path.dirname(err.screenshotPath!)).toBe(dir);
      }
      expect(err.code).toBe("TIMEOUT");
      client.close();
    }
    expect(readdirSync(fakeHome)).toEqual([]);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

// ── report() ───────────────────────────────────────────────────────────────────────────────────

function lineCount(s: string): number {
  return s.split("\n").length;
}

describe("report()", () => {
  it("LOCATOR_NOT_FOUND: first line CODE: message, candidates before the snapshot, window around the candidate", async () => {
    const candidates = [{ ref: "e150", role: "button", name: "Button 150" }, { ref: "e151", role: "button", name: "Button 151" }];
    const { tab } = await setup({
      click: { error: { code: "LOCATOR_NOT_FOUND", message: "no button \"Sav\".", data: { candidates } } },
      snapshot: { result: snap(300) },
    });
    const err = await caught(tab.click({ role: "button", name: "Sav" }));
    const text = err.report!();
    const lines = text.split("\n");
    expect(lines[0]).toBe('LOCATOR_NOT_FOUND: no button "Sav".');
    expect(lines.length).toBeLessThanOrEqual(60);
    const cand = lines.findIndex((l) => l.includes('"Button 150"') && l.includes("e150"));
    const urlLine = lines.findIndex((l) => l.startsWith("url: https://a.test/page"));
    const anchor = lines.findIndex((l) => l === '- button "Button 150" [ref=e150]');
    expect(cand).toBeGreaterThan(0);
    expect(urlLine).toBeGreaterThan(cand);
    expect(anchor).toBeGreaterThan(urlLine);
    // a window around e150, not the top of the page
    expect(text).not.toContain("[ref=e1]");
    expect(text).toContain("[ref=e140]");
    expect(text).toContain("[ref=e160]");
    expect(lines.some((l) => /lines? above/.test(l))).toBe(true);
    expect(lines.some((l) => /lines? below/.test(l))).toBe(true);
    expect(text).toContain(`Screenshot: ${path.join(dir, FILE)}`);
    // failed network requests only: r2 (404) is listed, r1 (200) is not
    expect(lines.some((l) => l.includes("[r2]"))).toBe(true);
    expect(lines.some((l) => l.includes("[r1]"))).toBe(false);
  });

  it("the snapshot window holds at most 60 lines in total, also for a short report", () => {
    const text = renderReport({ code: "TIMEOUT", message: "slow", snapshot: snap(500), attachErrors: [], now: NOW });
    expect(lineCount(text)).toBeLessThanOrEqual(60);
    expect(text).toContain("[ref=e1]"); // no anchor → the top
    expect(text).not.toContain("[ref=e100]");
  });

  it("REF_STALE through a Tab call: the window is NOT anchored on the failing ref (the snapshot re-minted it) — it starts at the top", async () => {
    const { tab } = await setup({
      click: { error: { code: "REF_STALE", message: "ref e300 is stale" } },
      snapshot: { result: snap(500) },
    });
    const err = await caught(tab.click("e300"));
    const text = err.report!();
    expect(text).toContain("[ref=e1]");
    expect(text).not.toContain("[ref=e300]");
    expect(text.split("\n").some((l) => /lines? above/.test(l))).toBe(false);
  });

  it("a match line with no role prints no role placeholder; the candidates heading has no 'none matched' parenthesis", () => {
    const text = renderReport({
      code: "LOCATOR_AMBIGUOUS",
      message: "2 match",
      data: { matches: [{ ref: "e1", name: "Go" }], candidates: [{ ref: "e2", role: "button", name: "Gone" }] },
      attachErrors: [],
      now: NOW,
    });
    expect(text).toContain('  - "Go" [ref=e1]');
    expect(text).not.toContain("?");
    expect(text).toContain("Nearest candidates:");
    expect(text).not.toMatch(/none matched/);
  });

  it("a truncated snapshot says the element cap was reached, never that elements were dropped (F35)", () => {
    const text = renderReport({ code: "TIMEOUT", message: "slow", snapshot: snap(800, true), attachErrors: [], now: NOW });
    expect(text).toMatch(/800-element cap/);
    expect(text).not.toMatch(/dropped/i);
    expect(text).not.toContain("truncated at 800 elements");
  });

  it("worst case: 800-element truncated snapshot, 20 ambiguous matches, 20 failed requests, three attach errors, a long multi-line message → ≤ 60 lines", () => {
    const matches = Array.from({ length: 20 }, (_, i) => ({ ref: `e${400 + i}`, name: `Button ${400 + i}` }));
    const network = Array.from({ length: 20 }, (_, i) => entry(i + 1, { status: 500, url: `https://a.test/${"x".repeat(300)}` }));
    const text = renderReport({
      code: "LOCATOR_AMBIGUOUS",
      message: `${"20 elements match\n".repeat(50)}${"y".repeat(5000)}`,
      data: { matches },
      snapshot: snap(800, true),
      screenshotPath: path.join(dir, FILE),
      network,
      attachErrors: ["snapshot: TIMEOUT a", "screenshot: not attached within 5 s", "network: LOCK_TIMEOUT b"],
      now: NOW,
    });
    expect(lineCount(text)).toBeLessThanOrEqual(60);
    const lines = text.split("\n");
    expect(lines[0]!.startsWith("LOCATOR_AMBIGUOUS: 20 elements match 20 elements match")).toBe(true);
    expect(text).toContain("[ref=e400]");
    expect(lines.some((l) => /and \d+ more/.test(l))).toBe(true);
    expect(text).toContain(`Screenshot: ${path.join(dir, FILE)}`);
    expect(text).toContain("network: LOCK_TIMEOUT b");
  });

  it("stays ≤ 60 lines even with pathological attachErrors and data", () => {
    const text = renderReport({
      code: "LOCATOR_NOT_FOUND",
      message: "x",
      data: { candidates: Array.from({ length: 100 }, (_, i) => ({ ref: `e${i}`, role: "link", name: `L${i}` })) },
      snapshot: snap(800, true),
      network: Array.from({ length: 200 }, (_, i) => entry(i, { error: "net::ERR_FAILED", status: undefined })),
      attachErrors: Array.from({ length: 100 }, (_, i) => `err ${i}`),
      screenshotPath: "p.png",
      now: NOW,
    });
    expect(lineCount(text)).toBeLessThanOrEqual(60);
  });

  it("stays ≤ 60 lines when strings the sections do not flatten carry newlines (the final hard cap)", () => {
    const text = renderReport({
      code: "LOCATOR_NOT_FOUND",
      message: "x",
      data: { candidates: [{ ref: `e1${"\n".repeat(40)}`, role: "button", name: "B" }] },
      snapshot: snap(30),
      screenshotPath: `p${"\n".repeat(40)}.png`,
      attachErrors: [],
      now: NOW,
    });
    expect(lineCount(text)).toBeLessThanOrEqual(60);
    expect(text.split("\n").at(-1)).toMatch(/cut at 60 lines/);
  });

  it("a small truncated snapshot shows the cap note in place of formatSnapshot's footer (F35)", () => {
    const text = renderReport({ code: "TIMEOUT", message: "slow", snapshot: snap(5, true), attachErrors: [], now: NOW });
    expect(text).toContain("[ref=e5]");
    expect(text).toMatch(/800-element cap/);
    expect(text).not.toContain("truncated at 800 elements");
    expect(text).not.toMatch(/dropped/i);
  });
});

// ── the attach snapshot renumbers refs (S4 verifier finding 1) ─────────────────────────────────

/** The verifier's page: `locate` numbered the buttons one way, the attach snapshot another. */
const RENUMBERED: SnapshotResult = {
  url: "https://a.test/page",
  title: "A page",
  elements: [
    el(1, { role: "link", name: "Home" }),
    el(2, { name: "Delete" }),
    el(3, { name: "Create folder" }),
    el(4, { name: "Upload" }),
    el(5, { name: "Create item" }),
  ],
  truncated: false,
};

function locateCandidates() {
  return [
    { ref: "e1", role: "button", name: "Create item" },
    { ref: "e2", role: "button", name: "Create folder" },
    { ref: "e3", role: "button", name: "Delete" },
    { ref: "e4", role: "button", name: "Upload" },
  ];
}

/** Every `- [role] "name" [ref=eN]` line of `text` names an element of `snap` with that ref, name and role. */
function expectRefsValidIn(text: string, snapshot: SnapshotResult): number {
  let n = 0;
  for (const line of text.split("\n")) {
    const m = /- (?:(\S+) )?"([^"]*)" \[ref=([^\]]+)\]/.exec(line);
    if (!m) {
      expect(line).not.toContain("[ref=");
      continue;
    }
    n += 1;
    const e = snapshot.elements.find((x) => x.ref === m[3]);
    expect(e, line).toBeDefined();
    expect(e!.name).toBe(m[2]);
    if (m[1] !== undefined) expect(e!.role).toBe(m[1]);
  }
  return n;
}

describe("the attach snapshot renumbers the tab's refs: data refs are rewritten or dropped (finding 1)", () => {
  it("candidates get the attached snapshot's refs by role + name; other fields untouched", async () => {
    const { tab } = await setup({
      click: { error: { code: "LOCATOR_NOT_FOUND", message: "no", data: { candidates: locateCandidates(), hint: "h" } } },
      snapshot: { result: RENUMBERED },
    });
    const err = await caught(tab.click({ role: "button", name: "Create", exact: true }));
    expect(err.data).toEqual({
      hint: "h",
      candidates: [
        { ref: "e5", role: "button", name: "Create item" },
        { ref: "e3", role: "button", name: "Create folder" },
        { ref: "e2", role: "button", name: "Delete" },
        { ref: "e4", role: "button", name: "Upload" },
      ],
    });
    const text = err.report!();
    expect(text).toContain('  - button "Create item" [ref=e5]');
    expect(text).toMatch(/renumbered the tab's refs/);
    expect(expectRefsValidIn(text, RENUMBERED)).toBe(4 + 5);
  });

  it("an ambiguous, role-mismatched or role-less candidate loses its ref", async () => {
    const page: SnapshotResult = {
      ...RENUMBERED,
      elements: [el(1, { name: "Save" }), el(2, { name: "Save" }), el(3, { role: "link", name: "Delete" })],
    };
    const { tab } = await setup({
      click: {
        error: {
          code: "LOCATOR_NOT_FOUND",
          message: "no",
          data: {
            candidates: [
              { ref: "e9", role: "button", name: "Save" },
              { ref: "e8", role: "button", name: "Delete" },
              { ref: "e7", role: "", name: "Delete" },
            ],
          },
        },
      },
      snapshot: { result: page },
    });
    const err = await caught(tab.click({ role: "button", name: "Sav" }));
    expect((err.data as { candidates: unknown[] }).candidates).toStrictEqual([
      { role: "button", name: "Save" },
      { role: "button", name: "Delete" },
      { role: "", name: "Delete" },
    ]);
    expect(err.report!()).not.toMatch(/^  - .*\[ref=/m);
    expectRefsValidIn(err.report!(), page);
  });

  it("matches (no role) never keep a ref: {css:\"p\"} on <p>Go</p><p>Stop</p><button>Go</button> (verifier R1-1)", async () => {
    // locate numbered the two <p> matches e1, e2; the attach snapshot lists only the button, as e1.
    const page: SnapshotResult = { ...RENUMBERED, elements: [el(1, { name: "Go" })] };
    const { tab } = await setup({
      click: {
        error: {
          code: "LOCATOR_AMBIGUOUS",
          message: "2 match",
          data: { matches: [{ ref: "e1", name: "Go" }, { ref: "e2", name: "Stop" }] },
        },
      },
      snapshot: { result: page },
    });
    const err = await caught(tab.click({ css: "p" }));
    expect((err.data as { matches: unknown[] }).matches).toStrictEqual([{ name: "Go" }, { name: "Stop" }]);
    const text = err.report!();
    expect(text).toContain('  - "Go"\n');
    expect(text).not.toMatch(/^  - .*\[ref=/m);
    expect(expectRefsValidIn(text, page)).toBe(1);
  });

  it("a {text} candidate with role \"\" named like a snapshot button keeps no ref (verifier R1-1)", async () => {
    // {text:"Totl"} on <button>Total</button><p>Loading</p><p>Total</p>: locate's candidates are the
    // button (role "button") and the <p> (role ""); the snapshot lists only the button.
    const page: SnapshotResult = { ...RENUMBERED, elements: [el(1, { name: "Total" })] };
    const { tab } = await setup({
      click: {
        error: {
          code: "LOCATOR_NOT_FOUND",
          message: "no",
          data: {
            candidates: [
              { ref: "e2", role: "", name: "Total" },
              { ref: "e1", role: "button", name: "Total" },
            ],
          },
        },
      },
      snapshot: { result: page },
    });
    const err = await caught(tab.click({ text: "Totl", exact: true }));
    expect((err.data as { candidates: unknown[] }).candidates).toStrictEqual([
      { role: "", name: "Total" },
      { ref: "e1", role: "button", name: "Total" },
    ]);
    const text = err.report!();
    expect(text).toContain('  - "Total"\n');
    expect(text).toContain('  - button "Total" [ref=e1]');
    expect(expectRefsValidIn(text, page)).toBe(1 + 1);
  });

  it("the window anchors on the rewritten ref, not on the failing call's number", async () => {
    const { tab } = await setup({
      click: {
        error: { code: "LOCATOR_NOT_FOUND", message: "no", data: { candidates: [{ ref: "e1", role: "button", name: "Button 150" }] } },
      },
      snapshot: { result: snap(300) },
    });
    const err = await caught(tab.click({ role: "button", name: "Button 15" }));
    const text = err.report!();
    expect(text).toContain('  - button "Button 150" [ref=e150]');
    expect(text).toContain("[ref=e140]");
    expect(text).not.toContain("[ref=e1]");
    expectRefsValidIn(text, snap(300));
  });

  it("a rejected snapshot drops every candidate/match ref and says why, outside attachErrors", async () => {
    const { tab } = await setup({
      click: {
        error: {
          code: "LOCATOR_AMBIGUOUS",
          message: "2 match",
          data: { matches: [{ ref: "e1", name: "A" }], candidates: [{ ref: "e2", role: "button", name: "B" }] },
        },
      },
      snapshot: { error: { code: "PAGE_ERROR", message: "boom" } },
    });
    const err = await caught(tab.click({ role: "button", name: "A" }));
    expect(err.data).toStrictEqual({ matches: [{ name: "A" }], candidates: [{ role: "button", name: "B" }] });
    const text = err.report!();
    expect(text).not.toContain("[ref=");
    expect(text).toMatch(/Refs withheld: .*renumbered/);
    expect(err.attachErrors).toEqual(["snapshot: PAGE_ERROR boom"]);
  });

  it("a snapshot cut at 5 s drops every ref too (it may renumber after the error is returned)", async () => {
    const { tab, clock } = await setup({
      click: { error: { code: "LOCATOR_NOT_FOUND", message: "no", data: { candidates: locateCandidates() } } },
      snapshot: "hang",
    });
    let settled: BridgeError | null = null;
    tab.click({ role: "button", name: "Create" }).catch((e: BridgeError) => {
      settled = e;
    });
    await flush();
    await clock.advance(5000);
    const err = settled! as BridgeError;
    for (const c of (err.data as { candidates: Record<string, unknown>[] }).candidates) {
      expect(Object.prototype.hasOwnProperty.call(c, "ref")).toBe(false);
    }
    const text = err.report!();
    expect(text).not.toContain("[ref=");
    expect(text).toMatch(/Refs withheld/);
    expect(err.attachErrors).toContain("snapshot: not attached within 5 s");
  });
});

// ── the stale-generation guard covers the attach calls (finding 2) ─────────────────────────────

describe("attach calls are stale-guarded (#79; finding 2)", () => {
  it("an error and a 4002 in the same turn: no attach frame reaches the new daemon, TAB_UNKNOWN in attachErrors, the original rethrown", async () => {
    const first = new FakeConnection((m, c) => {
      if (m.method === "tabs.claim") c.emit({ id: m.id, result: { tab: "T3" } });
      if (m.method === "click") {
        c.emit({ id: m.id, error: { code: "REF_STALE", message: "stale" } });
        c.fireClose(4002, "upgrading");
      }
    });
    const second = scripted({});
    const conns = [first, second];
    const clock = manualTimers();
    const client = new BridgeClient({
      knock: vi.fn(async (): Promise<Knocked> => ({ conn: conns.shift()!, welcome: welcome() })),
      timers: clock.timers,
      env: { BRIDGE_FAILURES_DIR: dir },
      homedir: () => path.join(dir, "home"),
      now: () => NOW,
    });
    await client.connect();
    const tab = await client.claim("T3");
    const err = await caught(tab.click("e1"));
    await flush();
    expect(err.code).toBe("REF_STALE");
    expect(second.sent.filter((f) => typeof f.method === "string")).toEqual([]);
    expect(err.attachErrors!.sort()).toEqual(
      ["network", "screenshot", "snapshot"].map((w) => expect.stringMatching(new RegExp(`^${w}: TAB_UNKNOWN `))),
    );
    client.close();
  });
});

// ── enriched at most once (finding 4) ──────────────────────────────────────────────────────────

describe("attachContext enriches an error at most once (finding 4)", () => {
  it("a second attachContext on the same error makes no call", async () => {
    const clock = manualTimers();
    const calls: string[] = [];
    const opts = {
      timers: clock.timers,
      env: { BRIDGE_FAILURES_DIR: dir },
      homedir: () => dir,
      now: () => NOW,
      call: async (method: string) => {
        calls.push(method);
        const b = DEFAULTS[method];
        return b && typeof b === "object" && "result" in b ? b.result : { ok: true };
      },
    };
    const err = new BridgeError("TIMEOUT", "slow");
    await attachContext(err, "T3", opts);
    const report = err.report;
    await attachContext(err, "T3", opts);
    expect(calls.sort()).toEqual([...ATTACH_METHODS].sort());
    expect(err.report).toBe(report);
  });
});

describe("S4.3 — nothing in sdk/src logs to the console", () => {
  it("no 'console.' in any sdk/src file", () => {
    const root = path.resolve(__dirname, "../src");
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
      );
    const hits = walk(root).filter((f) => readFileSync(f, "utf8").includes("console."));
    expect(hits).toEqual([]);
  });
});
