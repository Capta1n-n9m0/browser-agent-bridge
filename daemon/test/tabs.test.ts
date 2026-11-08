import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { Bridge } from "../src/bridge.js";
import { WsHost, type WsHostOptions } from "../src/wsHost.js";
import { TAB_METHODS } from "../src/methods.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHandleMark } from "../src/handle-mark.js";

/**
 * Step 7 T2 over real `ws` sockets on port 0: handles, leases, the visibility lock and the intercepts
 * (phase doc T2, exit checks T2.2–T2.5; decisions.md #39–#44, #52–#54). A fake proto:2 extension
 * answers listTabs/newTab/networkRequests and records every request it receives.
 */

const TOKEN = "tok-T2-SENTINEL-91ab";
const BUILD = "t2-build";
const RELOAD_HINT = "the Chrome extension is an older build — reload it at chrome://extensions (↻ on Browser Agent Bridge)";
const NO_WINDOW =
  "No normal Chrome window is focused (a DevTools or popup window may have focus) — click a normal Chrome window and retry";
const HELD = (h: string, name: string) =>
  new RegExp(`^tab ${h} is held by "${name}" since \\d\\d:\\d\\d:\\d\\d — use browser_new_tab, or browser_list_tabs to pick a free tab$`);

type Frame = Record<string, unknown>;
interface Req {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}
interface Tab {
  id: number;
  title: string;
  url: string;
  active: boolean;
  current?: boolean;
}

class Peer {
  readonly frames: Frame[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: Array<() => void> = [];
  onFrame: ((f: Frame) => void) | undefined;

  constructor(readonly ws: WebSocket) {
    ws.on("message", (raw) => {
      const f = JSON.parse(raw.toString()) as Frame;
      this.frames.push(f);
      this.onFrame?.(f);
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
  until<T>(pred: () => T | undefined | false, timeoutMs = 3000): Promise<T> {
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
  whenClosed(): Promise<unknown> {
    return this.until(() => this.closed ?? undefined);
  }
  send(frame: unknown): void {
    this.ws.send(JSON.stringify(frame));
  }
}

function open(port: number): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const peer = new Peer(ws);
    ws.on("open", () => resolve(peer));
    ws.on("error", reject);
  });
}

const response = (id: unknown) => (f: Frame) => f.id === id && ("result" in f || "error" in f);
const isWelcome = (f: Frame) => f.type === "welcome";
const events = (p: Peer, name: string) => p.frames.filter((f) => f.event === name);

let seq = 0;
function send(p: Peer, method: string, params?: Record<string, unknown>, timeoutMs?: number): string {
  const id = `r${++seq}`;
  const f: Frame = { id, method };
  if (params !== undefined) f.params = params;
  if (timeoutMs !== undefined) f.timeoutMs = timeoutMs;
  p.send(f);
  return id;
}
async function call(p: Peer, method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<Frame> {
  return p.frame(response(send(p, method, params, timeoutMs)), 9000);
}
const errOf = (f: Frame) => f.error as { code: string; message: string; data?: Record<string, unknown> };

const quiet = (ms = 80) => new Promise((r) => setTimeout(r, ms));
function waitUntil(pred: () => boolean, timeoutMs = 3000): Promise<void> {
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

/** A fake extension. proto:2 by default; records requests; auto-answers unless the method is held. */
class FakeExt {
  tabs: Tab[] = [
    { id: 1, title: "Fixture One", url: "http://fixture.test/one", active: true, current: true },
    { id: 2, title: "Fixture Two", url: "http://fixture.test/two", active: false },
  ];
  nextId = 101;
  /** Methods answered manually (`answer`). */
  readonly hold = new Set<string>();
  /** networkRequests `total` per tabId (default 0). */
  readonly network = new Map<number, number>();
  constructor(readonly peer: Peer) {
    peer.onFrame = (f) => {
      if (typeof f.id !== "string" || typeof f.method !== "string") return;
      if (this.hold.has(f.method)) return;
      this.answer(f as unknown as Req, this.auto(f as unknown as Req));
    };
  }
  auto(req: Req): unknown {
    switch (req.method) {
      case "listTabs":
        return { tabs: this.tabs.map((t) => ({ ...t })) };
      case "newTab": {
        const id = this.nextId++;
        this.tabs.push({ id, title: "", url: String(req.params?.url ?? ""), active: false });
        return { id };
      }
      case "networkRequests": {
        const tabId = req.params?.tabId as number | undefined;
        const total = tabId === undefined ? 0 : (this.network.get(tabId) ?? 0);
        return {
          entries: [
            { id: "9", tabId: 1, url: "http://fixture.test/api", method: "GET", type: "xmlhttprequest", startedAt: 1 },
            { id: "10", tabId: -1, url: "http://fixture.test/sw", method: "GET", type: "other", startedAt: 2 },
          ],
          total,
          pending: 0,
          recordingSince: 0,
        };
      }
      default:
        return { ok: true, method: req.method };
    }
  }
  reqs(method?: string): Req[] {
    return this.peer.frames.filter(
      (f) => typeof f.id === "string" && typeof f.method === "string" && (!method || f.method === method),
    ) as unknown as Req[];
  }
  answer(req: Req, result: unknown): void {
    if (this.peer.ws.readyState === WebSocket.OPEN) this.peer.send({ id: req.id, result });
  }
  /** S2b: answer with a raw `error` member, exactly as given (it may lack a code). */
  fail(req: Req, error: unknown): void {
    if (this.peer.ws.readyState === WebSocket.OPEN) this.peer.send({ id: req.id, error });
  }
  emit(event: string, params: Record<string, unknown>): void {
    this.peer.send({ event, params });
  }
  async waitReq(method: string, n = 1): Promise<Req> {
    await this.peer.until(() => this.reqs(method).length >= n);
    return this.reqs(method)[n - 1];
  }
}

describe("Step 7 tab layer over a real WsHost", () => {
  let host: WsHost | undefined;
  let logs: string[] = [];
  const peers: Peer[] = [];
  const exts: FakeExt[] = [];

  afterEach(async () => {
    // T2.3 over every request any fake proto:2 extension received in the test.
    for (const ext of exts.splice(0)) {
      for (const r of ext.reqs()) {
        expect(r.params ?? {}, `${r.method} got a tab key`).not.toHaveProperty("tab");
        const tabCarrying = TAB_METHODS.has(r.method) || r.method === "closeTab";
        if (tabCarrying && r.params?.scope !== "all") {
          expect(typeof r.params?.tabId, `${r.method} without numeric tabId`).toBe("number");
        }
      }
    }
    // T2.5: no log line carries a URL or a title.
    for (const line of logs) {
      expect(line).not.toContain("://");
      expect(line).not.toContain("fixture.test");
      expect(line).not.toContain("Fixture");
    }
    for (const p of peers.splice(0)) p.ws.terminate();
    await host?.close();
    host = undefined;
    logs = [];
  });

  async function start(extra: Partial<WsHostOptions> = {}) {
    const bridge = new Bridge();
    host = new WsHost(bridge, { port: 0, token: TOKEN, build: BUILD, log: (m) => logs.push(m), ...extra });
    const port = await host.listen();
    return { port, host, bridge };
  }
  const track = (p: Peer) => (peers.push(p), p);

  async function client(port: number, name: string): Promise<Peer> {
    const p = track(await open(port));
    p.send({ type: "hello", token: TOKEN, role: "client", name, proto: 2 });
    await p.frame(isWelcome);
    return p;
  }

  /** A proto:2 fake extension, after its resync listTabs has been answered. */
  async function extension(port: number, setup?: (e: FakeExt) => void, proto = true, session?: string): Promise<FakeExt> {
    const p = track(await open(port));
    const ext = new FakeExt(p);
    if (proto) exts.push(ext);
    setup?.(ext);
    const hello: Frame = proto ? { type: "hello", token: TOKEN, role: "extension", proto: 2 } : { type: "hello", token: TOKEN };
    if (session !== undefined) hello.session = session; // S2b: the session marker (#74, #80)
    p.send(hello);
    await p.frame(isWelcome);
    if (proto) {
      await ext.waitReq("listTabs");
      await quiet(20);
    }
    return ext;
  }

  async function newTab(p: Peer, url = "http://fixture.test/new"): Promise<{ id: number; tab: string }> {
    const r = await call(p, "newTab", { url });
    return r.result as { id: number; tab: string };
  }

  // ---------------------------------------------------------------- T2.2: leases

  it("A's newTab is held by A; B's click → TAB_HELD naming A; A disconnects → B can claim", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");

    const t = await newTab(a);
    expect(t.tab).toMatch(/^T\d+$/);
    expect(t.id).toBe(101);
    expect(ext.reqs("newTab")[0].params).toEqual({ url: "http://fixture.test/new" });

    const held = await call(b, "click", { tab: t.tab, ref: "e1" });
    expect(errOf(held).code).toBe("TAB_HELD");
    expect(errOf(held).message).toMatch(HELD(t.tab, "A"));
    expect(errOf(held).data).toEqual({ owner: "A", since: expect.any(Number) });
    expect(ext.reqs("click")).toHaveLength(0);

    expect((await call(a, "click", { tab: t.tab, ref: "e1" })).result).toEqual({ ok: true, method: "click" });
    expect(ext.reqs("click")[0].params).toEqual({ ref: "e1", tabId: 101 });

    a.ws.close();
    await a.whenClosed();
    await waitUntil(() => host!.registry.count() === 1);
    expect((await call(b, "tabs.claim", { tab: t.tab })).result).toEqual({ tab: t.tab });
    expect((await call(b, "click", { tab: t.tab, ref: "e2" })).result).toEqual({ ok: true, method: "click" });
  });

  it("listTabs adds handles and owner names and keeps the extension's fields", async () => {
    const { port } = await start();
    await extension(port);
    const a = await client(port, "A");
    const t = await newTab(a);
    const r = (await call(a, "listTabs")).result as { tabs: Array<Record<string, unknown>> };
    expect(r.tabs).toEqual([
      { id: 1, title: "Fixture One", url: "http://fixture.test/one", active: true, current: true, tab: "T1" },
      { id: 2, title: "Fixture Two", url: "http://fixture.test/two", active: false, tab: "T2" },
      { id: 101, title: "", url: "http://fixture.test/new", active: false, tab: t.tab, owner: "A" },
    ]);
  });

  it("tabReplaced keeps A's handle valid and still held; also for a tab nobody holds", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const t = await newTab(a);

    ext.emit("tabReplaced", { addedTabId: 555, removedTabId: 101 });
    ext.emit("tabReplaced", { addedTabId: 777, removedTabId: 2 }); // T2, unheld
    await quiet(50);
    await call(a, "snapshot", { tab: t.tab });
    expect(ext.reqs("snapshot")[0].params).toEqual({ tabId: 555 });
    expect(errOf(await call(b, "snapshot", { tab: t.tab })).code).toBe("TAB_HELD");
    await call(b, "snapshot", { tab: "T2" });
    expect(ext.reqs("snapshot")[1].params).toEqual({ tabId: 777 });
    expect(host!.stats().extensionEvents).toBe(2);
  });

  it("tabRemoved → tabGone to the holder (absent fields omitted) and TAB_GONE with lastUrl/lastTitle", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const t = await newTab(a);

    ext.emit("tabRemoved", { tabId: 101, lastUrl: "http://fixture.test/x", lastTitle: "Fixture X" });
    const gone = await a.frame((f) => f.event === "tabGone");
    expect(gone).toEqual({ event: "tabGone", params: { tab: t.tab, lastUrl: "http://fixture.test/x", lastTitle: "Fixture X" } });
    expect(events(b, "tabGone")).toEqual([]);

    const r = await call(a, "click", { tab: t.tab, ref: "e1" });
    expect(errOf(r).code).toBe("TAB_GONE");
    expect(errOf(r).data).toEqual({ tab: t.tab, lastUrl: "http://fixture.test/x", lastTitle: "Fixture X" });
    expect(errOf(r).message).not.toContain("://");
    expect(ext.reqs("click")).toHaveLength(0);

    // A tab removed with no event values, never cached: tabGone carries only `tab` (never null).
    const t2 = await newTab(a, "");
    ext.tabs = ext.tabs.filter((x) => x.id !== 102);
    ext.emit("tabRemoved", { tabId: 102 });
    await a.until(() => events(a, "tabGone").length === 2);
    expect(events(a, "tabGone")[1]).toEqual({ event: "tabGone", params: { tab: t2.tab } });
    // Removing an unheld tab sends nothing; its handle answers TAB_GONE with the listTabs cache.
    ext.emit("tabRemoved", { tabId: 2 });
    await quiet(50);
    expect(events(a, "tabGone")).toHaveLength(2);
    expect(errOf(await call(b, "click", { tab: "T2", ref: "e1" })).data).toEqual({
      tab: "T2",
      lastUrl: "http://fixture.test/two",
      lastTitle: "Fixture Two",
    });
    // Unknown handle.
    const u = await call(b, "click", { tab: "T99", ref: "e1" });
    expect(errOf(u)).toEqual({ code: "TAB_UNKNOWN", message: "unknown tab handle T99 — call listTabs" });
  });

  it("invalid extension events are ignored but counted", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    ext.emit("tabRemoved", { tabId: "1" });
    ext.emit("tabCreated", { tabId: 3 }); // no url
    ext.emit("somethingElse", {});
    await quiet(50);
    expect(host!.stats().extensionEvents).toBe(3);
    await call(a, "click", { tab: "T1", ref: "e1" });
    expect(ext.reqs("click")[0].params).toEqual({ ref: "e1", tabId: 1 });
  });

  it("opener rule: a tab opened from A's tab is granted to A with leaseGranted; an unleased opener's popup stays unheld", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const t = await newTab(a);

    ext.emit("tabCreated", { tabId: 300, openerTabId: 101, url: "http://fixture.test/popup" });
    const lg = await a.frame((f) => f.event === "leaseGranted");
    expect(lg.params).toEqual({ tab: expect.stringMatching(/^T\d+$/), reason: "opener", url: "http://fixture.test/popup" });
    const popup = (lg.params as { tab: string }).tab;
    expect(popup).not.toBe(t.tab);
    expect(errOf(await call(b, "click", { tab: popup, ref: "e1" })).message).toMatch(HELD(popup, "A"));

    // Opener T1 (the human's tab) is unheld: the popup stays unheld, nobody hears of it.
    ext.emit("tabCreated", { tabId: 301, openerTabId: 1, url: "" });
    ext.emit("tabCreated", { tabId: 302, url: "" }); // no opener
    await quiet(60);
    expect(events(a, "leaseGranted")).toHaveLength(1);
    expect(events(b, "leaseGranted")).toHaveLength(0);
    const st = (await call(b, "daemon.status")).result as { tabs: Array<Record<string, unknown>> };
    const row301 = st.tabs.find((x) => x.tabId === 301)!;
    expect(row301.owner).toBeUndefined();
    await call(b, "click", { tab: row301.tab as string, ref: "e1" });
    await call(a, "click", { tab: row301.tab as string, ref: "e1" });
    expect(ext.reqs("click").map((r) => r.params?.tabId)).toEqual([301, 301]);
  });

  it("F20: tabCreated {openerTabId: A's tab} arriving before B's newTab result leaves the tab with B; A gets no leaseGranted", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const ta = await newTab(a); // id 101, held by A

    ext.hold.add("newTab");
    const id = send(b, "newTab", { url: "http://fixture.test/b" });
    const req = await ext.waitReq("newTab", 2);
    // The event first, then the result, back to back (likely in one TCP read).
    ext.emit("tabCreated", { tabId: 400, openerTabId: ta.id, url: "http://fixture.test/b" });
    ext.answer(req, { id: 400 });
    const res = (await b.frame(response(id))).result as { id: number; tab: string };
    expect(res.id).toBe(400);
    await quiet(80);
    expect(events(a, "leaseGranted")).toEqual([]);
    expect(errOf(await call(a, "click", { tab: res.tab, ref: "e1" })).message).toMatch(HELD(res.tab, "B"));
  });

  it("F20 window: an unrelated popup from A's tab during B's newTab is held by A at once; A gets one leaseGranted after it settles", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const c = await client(port, "C");
    const ta = await newTab(a); // 101

    ext.hold.add("newTab");
    const id = send(b, "newTab", { url: "http://fixture.test/b" });
    const req = await ext.waitReq("newTab", 2);
    ext.emit("tabCreated", { tabId: 500, openerTabId: ta.id, url: "http://fixture.test/popup" });
    await quiet(50);
    const st = (await call(c, "daemon.status")).result as { tabs: Array<Record<string, unknown>> };
    const popup = st.tabs.find((x) => x.tabId === 500)!.tab as string;
    expect(errOf(await call(c, "click", { tab: popup, ref: "e1" })).message).toMatch(HELD(popup, "A"));
    expect(ext.reqs("click")).toHaveLength(0);
    expect(events(a, "leaseGranted")).toEqual([]); // held back while B's newTab is in flight

    ext.answer(req, { id: 501 });
    await b.frame(response(id));
    const lg = await a.frame((f) => f.event === "leaseGranted");
    expect(lg.params).toEqual({ tab: popup, reason: "opener", url: "http://fixture.test/popup" });
    await quiet(50);
    expect(events(a, "leaseGranted")).toHaveLength(1);
    expect(events(b, "leaseGranted")).toHaveLength(0);
    expect(events(c, "leaseGranted")).toHaveLength(0);
  });

  it("F20 window: the opener's holder disconnecting inside the window releases the lease and no event is sent", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const c = await client(port, "C");
    const ta = await newTab(a);

    ext.hold.add("newTab");
    const id = send(b, "newTab", { url: "http://fixture.test/b" });
    const req = await ext.waitReq("newTab", 2);
    ext.emit("tabCreated", { tabId: 600, openerTabId: ta.id, url: "" });
    await quiet(50);
    const popup = ((await call(c, "daemon.status")).result as { tabs: Array<Record<string, unknown>> }).tabs.find(
      (x) => x.tabId === 600,
    )!;
    expect(popup.owner).toBe("A");

    a.ws.close();
    await a.whenClosed();
    await waitUntil(() => host!.registry.count() === 2);
    ext.answer(req, { id: 601 });
    await b.frame(response(id));
    await quiet(80);
    expect(events(a, "leaseGranted")).toEqual([]);
    expect(events(b, "leaseGranted")).toEqual([]);
    expect(events(c, "leaseGranted")).toEqual([]);
    expect((await call(c, "tabs.claim", { tab: popup.tab as string })).result).toEqual({ tab: popup.tab });
  });

  // ---------------------------------------------------------------- T5b fix 3: the popup's url

  const statusRow = async (p: Peer, tabId: number) =>
    ((await call(p, "daemon.status")).result as { tabs: Array<Record<string, unknown>> }).tabs.find((x) => x.tabId === tabId)!;

  it("fix 3: a known url → leaseGranted at once, with no listTabs call", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    await newTab(a); // 101
    const before = ext.reqs("listTabs").length;
    ext.emit("tabCreated", { tabId: 300, openerTabId: 101, url: "http://fixture.test/popup" });
    const lg = await a.frame((f) => f.event === "leaseGranted");
    expect((lg.params as { url: string }).url).toBe("http://fixture.test/popup");
    await quiet(250);
    expect(ext.reqs("listTabs")).toHaveLength(before);
  });

  it("fix 3: a '' url is filled from a later listTabs; the grant holds at once, before the event", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    await newTab(a); // 101
    const n = ext.reqs("listTabs").length;
    ext.hold.add("listTabs");
    ext.tabs.push({ id: 300, title: "", url: "", active: false });
    ext.emit("tabCreated", { tabId: 300, openerTabId: 101, url: "" });

    const first = await ext.waitReq("listTabs", n + 1);
    expect(first.params ?? {}).toEqual({});
    const row = await statusRow(b, 300);
    expect(row.owner).toBe("A");
    expect(errOf(await call(b, "click", { tab: row.tab as string, ref: "e1" })).message).toMatch(HELD(row.tab as string, "A"));
    expect(ext.reqs("click")).toHaveLength(0);
    expect(events(a, "leaseGranted")).toEqual([]);

    ext.answer(first, ext.auto(first)); // still ""
    const second = await ext.waitReq("listTabs", n + 2);
    expect(events(a, "leaseGranted")).toEqual([]);
    ext.tabs.find((t) => t.id === 300)!.url = "http://fixture.test/popup";
    ext.answer(second, ext.auto(second));
    const lg = await a.frame((f) => f.event === "leaseGranted");
    expect(lg.params).toEqual({ tab: row.tab, reason: "opener", url: "http://fixture.test/popup" });
    expect((await statusRow(b, 300)).url).toBe("http://fixture.test/popup");
    await quiet(250);
    expect(events(a, "leaseGranted")).toHaveLength(1);
    expect(events(b, "leaseGranted")).toHaveLength(0);
    expect(ext.reqs("listTabs")).toHaveLength(n + 2);
  });

  it("fix 3: at the 2 s bound the event is sent with the best url seen ('' here), polling every 100 ms", async () => {
    let t = 1_800_000_000_000;
    const { port } = await start({ now: () => t, sleep: async (ms) => void (t += ms) });
    const ext = await extension(port);
    const a = await client(port, "A");
    await newTab(a); // 101
    const n = ext.reqs("listTabs").length;
    ext.tabs.push({ id: 300, title: "", url: "", active: false });
    const emittedAt = t;
    ext.emit("tabCreated", { tabId: 300, openerTabId: 101, url: "" });
    const lg = await a.frame((f) => f.event === "leaseGranted");
    expect((lg.params as { url: string }).url).toBe("");
    expect(t - emittedAt).toBe(2000);
    expect(ext.reqs("listTabs")).toHaveLength(n + 21); // at 0, 100, …, 2000 ms
  });

  it("fix 3: a later about:blank is the best url seen at the bound", async () => {
    let t = 1_800_000_000_000;
    const { port } = await start({ now: () => t, sleep: async (ms) => void (t += ms) });
    const ext = await extension(port);
    const a = await client(port, "A");
    await newTab(a);
    ext.tabs.push({ id: 300, title: "", url: "about:blank", active: false });
    ext.emit("tabCreated", { tabId: 300, openerTabId: 101, url: "" });
    const lg = await a.frame((f) => f.event === "leaseGranted");
    expect((lg.params as { url: string }).url).toBe("about:blank");
  });

  it("fix 3: the grant released during the fill → no event", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    await newTab(a);
    const n = ext.reqs("listTabs").length;
    ext.hold.add("listTabs");
    ext.tabs.push({ id: 300, title: "", url: "", active: false });
    ext.emit("tabCreated", { tabId: 300, openerTabId: 101, url: "" });
    const fill = await ext.waitReq("listTabs", n + 1);
    const row = await statusRow(a, 300);
    expect((await call(a, "tabs.release", { tab: row.tab as string })).result).toEqual({ ok: true });
    ext.tabs.find((x) => x.id === 300)!.url = "http://fixture.test/popup";
    ext.answer(fill, ext.auto(fill));
    await quiet(300);
    expect(events(a, "leaseGranted")).toEqual([]);
  });

  it("fix 3: the grant overridden by a newTab that settles after the fill → no event", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    await newTab(a);
    const n = ext.reqs("listTabs").length;
    ext.hold.add("listTabs");
    ext.hold.add("newTab");
    ext.tabs.push({ id: 300, title: "", url: "", active: false });
    ext.emit("tabCreated", { tabId: 300, openerTabId: 101, url: "" });
    const fill = await ext.waitReq("listTabs", n + 1);
    const id = send(b, "newTab", { url: "http://fixture.test/b" });
    const req = await ext.waitReq("newTab", 2);
    ext.tabs.find((x) => x.id === 300)!.url = "http://fixture.test/b";
    ext.answer(fill, ext.auto(fill)); // the fill ends while B's newTab is in flight → held back
    await quiet(80);
    expect(events(a, "leaseGranted")).toEqual([]);
    ext.answer(req, { id: 300 });
    const res = (await b.frame(response(id))).result as { tab: string };
    await quiet(80);
    expect(events(a, "leaseGranted")).toEqual([]);
    expect(errOf(await call(a, "click", { tab: res.tab, ref: "e1" })).message).toMatch(HELD(res.tab, "B"));
  });

  it("fix 3: the grant's holder disconnecting during the fill → no event, the tab is free", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const c = await client(port, "C");
    await newTab(a);
    const n = ext.reqs("listTabs").length;
    ext.hold.add("listTabs");
    ext.tabs.push({ id: 300, title: "", url: "", active: false });
    ext.emit("tabCreated", { tabId: 300, openerTabId: 101, url: "" });
    const fill = await ext.waitReq("listTabs", n + 1);
    const row = await statusRow(c, 300);
    a.ws.close();
    await a.whenClosed();
    await waitUntil(() => host!.registry.count() === 1);
    ext.tabs.find((x) => x.id === 300)!.url = "http://fixture.test/popup";
    ext.answer(fill, ext.auto(fill));
    await quiet(300);
    expect(events(a, "leaseGranted")).toEqual([]);
    expect(events(c, "leaseGranted")).toEqual([]);
    expect((await call(c, "tabs.claim", { tab: row.tab as string })).result).toEqual({ tab: row.tab });
  });

  it("fix 3 (F5/M17): the extension socket changes mid-fill → polling stops; the old socket's answer is ignored and the event carries the best url seen before ('')", async () => {
    const { port } = await start();
    const ext1 = await extension(port);
    const a = await client(port, "A");
    await newTab(a); // 101
    const n = ext1.reqs("listTabs").length;
    ext1.hold.add("listTabs");
    ext1.tabs.push({ id: 300, title: "", url: "", active: false });
    ext1.emit("tabCreated", { tabId: 300, openerTabId: 101, url: "" });
    const fill = await ext1.waitReq("listTabs", n + 1);

    // A new extension socket takes over (the old one stays open); its resync lists tab 300.
    const ext2 = await extension(port, (e) => {
      e.tabs = ext1.tabs.map((t) => ({ ...t, url: t.id === 300 ? "http://fixture.test/popup" : t.url }));
    });
    expect(events(a, "leaseGranted")).toEqual([]);
    ext1.tabs.find((t) => t.id === 300)!.url = "http://fixture.test/old-socket";
    ext1.answer(fill, ext1.auto(fill)); // answered on the old socket, after the change
    const lg = await a.frame((f) => f.event === "leaseGranted");
    const row = await statusRow(a, 300);
    expect(lg.params).toEqual({ tab: row.tab, reason: "opener", url: "" });
    expect(row.owner).toBe("A"); // the lease survived the resync
    await quiet(300);
    expect(ext1.reqs("listTabs")).toHaveLength(n + 1); // no further poll on the old socket
    expect(ext2.reqs("listTabs")).toHaveLength(1); // only the resync on the new one
    expect(events(a, "leaseGranted")).toHaveLength(1);
  });

  it("fix 3 (F5/M18): the tab is no longer listed → polling stops; the event is sent with the best url seen (about:blank) while the grant stands", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    await newTab(a); // 101
    const n = ext.reqs("listTabs").length;
    ext.hold.add("listTabs");
    ext.tabs.push({ id: 300, title: "", url: "about:blank", active: false });
    ext.emit("tabCreated", { tabId: 300, openerTabId: 101, url: "" });
    const first = await ext.waitReq("listTabs", n + 1);
    ext.answer(first, ext.auto(first)); // about:blank: not known yet, keep polling
    const second = await ext.waitReq("listTabs", n + 2);
    expect(events(a, "leaseGranted")).toEqual([]);
    ext.tabs = ext.tabs.filter((t) => t.id !== 300);
    ext.answer(second, ext.auto(second)); // tab 300 is gone from the list
    const lg = await a.frame((f) => f.event === "leaseGranted");
    expect((lg.params as { url: string; reason: string }).url).toBe("about:blank");
    expect((lg.params as { reason: string }).reason).toBe("opener");
    await quiet(300);
    expect(ext.reqs("listTabs")).toHaveLength(n + 2);
    expect(events(a, "leaseGranted")).toHaveLength(1);
  });

  it("fix 3 (F5/M19): a tabCreated whose url is about:blank triggers the fill — not sent at once", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    await newTab(a); // 101
    const n = ext.reqs("listTabs").length;
    ext.hold.add("listTabs");
    ext.tabs.push({ id: 300, title: "", url: "about:blank", active: false });
    ext.emit("tabCreated", { tabId: 300, openerTabId: 101, url: "about:blank" });
    const fill = await ext.waitReq("listTabs", n + 1);
    await quiet(150);
    expect(events(a, "leaseGranted")).toEqual([]);
    ext.tabs.find((t) => t.id === 300)!.url = "http://fixture.test/popup";
    ext.answer(fill, ext.auto(fill));
    const lg = await a.frame((f) => f.event === "leaseGranted");
    expect((lg.params as { url: string }).url).toBe("http://fixture.test/popup");
    await quiet(250);
    expect(ext.reqs("listTabs")).toHaveLength(n + 1);
    expect(events(a, "leaseGranted")).toHaveLength(1);
  });

  it("closeTab by the holder: forwarded {tabId}, the handle is gone, the lease dropped, no tabGone to the closer", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const t = await newTab(a);
    expect(errOf(await call(b, "closeTab", { tab: t.tab })).code).toBe("TAB_HELD");

    ext.hold.add("closeTab");
    const id = send(a, "closeTab", { tab: t.tab });
    const req = await ext.waitReq("closeTab");
    expect(req.params).toEqual({ tabId: 101 });
    ext.emit("tabRemoved", { tabId: 101, lastUrl: "http://fixture.test/new" }); // before the result
    ext.answer(req, { ok: true });
    expect((await a.frame(response(id))).result).toEqual({ ok: true });
    await quiet(50);
    expect(events(a, "tabGone")).toEqual([]);
    expect(errOf(await call(a, "click", { tab: t.tab, ref: "e1" })).code).toBe("TAB_GONE");
    const st = (await call(a, "daemon.status")).result as { tabs: Array<{ tab: string }> };
    expect(st.tabs.map((x) => x.tab)).not.toContain(t.tab);
  });

  // ---------------------------------------------------------------- tabs.claim / tabs.release

  it("tabs.claim and tabs.release: every answer", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");

    expect(errOf(await call(a, "tabs.claim", { tab: "T42" })).code).toBe("TAB_UNKNOWN");
    expect(errOf(await call(a, "tabs.claim", {})).code).toBe("BAD_PARAMS");
    expect(errOf(await call(a, "tabs.claim", { tab: 1 })).code).toBe("BAD_PARAMS");
    expect((await call(a, "tabs.claim", { tab: "T2" })).result).toEqual({ tab: "T2" });
    expect((await call(a, "tabs.claim", { tab: "T2" })).result).toEqual({ tab: "T2" }); // idempotent
    const held = await call(b, "tabs.claim", { tab: "T2" });
    expect(errOf(held).code).toBe("TAB_HELD");
    expect(errOf(held).message).toMatch(HELD("T2", "A"));

    // {active:true} claims the human's tab (`current: true`), via listTabs.
    const before = ext.reqs("listTabs").length;
    expect((await call(b, "tabs.claim", { active: true })).result).toEqual({ tab: "T1" });
    expect(ext.reqs("listTabs").length).toBe(before + 1);

    expect(errOf(await call(a, "tabs.release", { tab: "T1" })).code).toBe("TAB_HELD");
    expect(errOf(await call(a, "tabs.release", {})).code).toBe("BAD_PARAMS");
    expect(errOf(await call(a, "tabs.release", { tab: "T42" })).code).toBe("TAB_UNKNOWN");
    expect((await call(a, "tabs.release", { tab: "T2" })).result).toEqual({ ok: true });
    expect((await call(a, "tabs.release", { tab: "T2" })).result).toEqual({ ok: true }); // unheld
    expect((await call(b, "tabs.claim", { tab: "T2" })).result).toEqual({ tab: "T2" });

    ext.emit("tabRemoved", { tabId: 2 });
    await b.frame((f) => f.event === "tabGone");
    expect(errOf(await call(b, "tabs.claim", { tab: "T2" })).code).toBe("TAB_GONE");
    expect(errOf(await call(b, "tabs.release", { tab: "T2" })).code).toBe("TAB_GONE");

    // No human's tab → the INTERNAL message.
    ext.tabs = ext.tabs.map(({ current: _current, ...x }) => x); // no human's tab
    expect(errOf(await call(a, "tabs.claim", { active: true }))).toEqual({ code: "INTERNAL", message: NO_WINDOW });
    // None of these reached the extension.
    expect(ext.reqs().filter((r) => r.method.startsWith("tabs."))).toEqual([]);
  });

  it("tabs.claim {active:true} needs the extension: NOT_CONNECTED, then VERSION for a no-proto one", async () => {
    const { port } = await start();
    const a = await client(port, "A");
    expect(errOf(await call(a, "tabs.claim", { active: true })).code).toBe("NOT_CONNECTED");
    await extension(port, undefined, false);
    expect(errOf(await call(a, "tabs.claim", { active: true }))).toEqual({ code: "VERSION", message: RELOAD_HINT });
  });

  // ---------------------------------------------------------------- T2.2: the lock

  it("two concurrent screenshots serialise: the second is not forwarded before the first is answered", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const ta = await newTab(a);
    const tb = await newTab(b);
    ext.hold.add("screenshot");

    const ia = send(a, "screenshot", { tab: ta.tab });
    const first = await ext.waitReq("screenshot");
    const ib = send(b, "screenshot", { tab: tb.tab });
    await quiet(100);
    expect(ext.reqs("screenshot")).toHaveLength(1);
    expect(first.params).toEqual({ tabId: 101 });

    ext.answer(first, { dataUrl: "a" });
    const second = await ext.waitReq("screenshot", 2);
    expect(second.params).toEqual({ tabId: 102 });
    ext.answer(second, { dataUrl: "b" });
    expect((await a.frame(response(ia))).result).toEqual({ dataUrl: "a" });
    expect((await b.frame(response(ib))).result).toEqual({ dataUrl: "b" });
  });

  // 2026-10-23 (Step 8 S2b, decisions.md #84 F11, #85 item 4): the second waiter was `selectTab {id: 102}`,
  // the Step 6 alias with a Chrome id; it is now a second `focusTab {tab}` — the same lock class.
  it("focusTab (twice) waits while a screenshot holds the lock; cdp and fullPage screenshots do not", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const ta = await newTab(a);
    const tb = await newTab(b);
    ext.hold.add("screenshot");

    send(a, "screenshot", { tab: ta.tab });
    const shot = await ext.waitReq("screenshot");
    const ifocus = send(b, "focusTab", { tab: tb.tab });
    const iselect = send(b, "focusTab", { tab: tb.tab });
    send(b, "screenshot", { tab: tb.tab, mode: "cdp" });
    send(b, "screenshot", { tab: tb.tab, fullPage: true });
    await ext.waitReq("screenshot", 3);
    await quiet(100);
    expect(ext.reqs("focusTab")).toHaveLength(0);
    expect(ext.reqs("screenshot").map((r) => r.params)).toEqual([
      { tabId: 101 },
      { tabId: 102, mode: "cdp" },
      { tabId: 102, fullPage: true },
    ]);

    ext.answer(shot, { dataUrl: "a" });
    expect((await b.frame(response(ifocus))).result).toEqual({ ok: true, method: "focusTab" });
    expect((await b.frame(response(iselect))).result).toEqual({ ok: true, method: "focusTab" });
    expect(ext.reqs("focusTab")[0].params).toEqual({ tabId: 102 });
    expect(ext.reqs("focusTab")[1].params).toEqual({ tabId: 102 });
  });

  it("the lock is taken even when the target is the human's active tab", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const ta = await newTab(a);
    ext.hold.add("screenshot");
    send(a, "screenshot", { tab: ta.tab });
    const shot = await ext.waitReq("screenshot");
    const ib = send(b, "screenshot", { tab: "T1" }); // T1 is `current: true`
    await quiet(100);
    expect(ext.reqs("screenshot")).toHaveLength(1);
    ext.answer(shot, {});
    const second = await ext.waitReq("screenshot", 2);
    expect(second.params).toEqual({ tabId: 1 });
    ext.answer(second, { dataUrl: "t1" });
    expect((await b.frame(response(ib))).result).toEqual({ dataUrl: "t1" });
  });

  it("LOCK_TIMEOUT {holder} at the waiter's deadline; the waiter is never forwarded", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const ta = await newTab(a);
    const tb = await newTab(b);
    ext.hold.add("screenshot");
    send(a, "screenshot", { tab: ta.tab });
    await ext.waitReq("screenshot");

    const t0 = Date.now();
    const r = await call(b, "screenshot", { tab: tb.tab }, 150);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
    expect(errOf(r).code).toBe("LOCK_TIMEOUT");
    expect(errOf(r).data).toEqual({ holder: "A" });
    await quiet(50);
    expect(b.frames.filter(response(r.id))).toHaveLength(1);
    expect(ext.reqs("screenshot")).toHaveLength(1);
  });

  it(
    "ATK-L5 (verifier V1): one deadline — a waiter that gets the lock late times out at its own deadline + 5000, not a fresh wait",
    async () => {
      const { port } = await start();
      const ext = await extension(port);
      const a = await client(port, "A");
      const b = await client(port, "B");
      const ta = await newTab(a);
      const tb = await newTab(b);
      ext.hold.add("screenshot");
      send(a, "screenshot", { tab: ta.tab });
      const shotA = await ext.waitReq("screenshot");
      const t0 = Date.now();
      const ib = send(b, "screenshot", { tab: tb.tab }, 2000);
      await quiet(1500);
      ext.answer(shotA, {});
      await ext.waitReq("screenshot", 2); // B forwarded at ~1500 ms; the extension never answers
      const rb = await b.frame(response(ib), 12_000);
      const took = Date.now() - t0;
      expect(errOf(rb).code).toBe("TIMEOUT");
      expect(took).toBeGreaterThanOrEqual(6900);
      expect(took).toBeLessThan(7600); // a fresh wait after the lock would be ~8500
    },
    20_000,
  );

  it("ATK-L6 (verifier V2): a lease taken while a call waits for the lock is re-checked when the lock is granted", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const c = await client(port, "C");
    const ta = await newTab(a);
    ext.hold.add("screenshot");
    send(a, "screenshot", { tab: ta.tab });
    const shotA = await ext.waitReq("screenshot");
    const ib = send(b, "screenshot", { tab: "T2" }); // unheld now
    await quiet(50);
    expect((await call(c, "tabs.claim", { tab: "T2" })).result).toEqual({ tab: "T2" });
    ext.answer(shotA, {});
    const rb = await b.frame(response(ib));
    expect(errOf(rb).code).toBe("TAB_HELD");
    expect(errOf(rb).message).toMatch(HELD("T2", "C"));
    await quiet(50);
    expect(ext.reqs("screenshot")).toHaveLength(1);
    expect(((await call(c, "daemon.status")).result as { lock: unknown }).lock).toEqual({});
  });

  it("the holder disconnecting releases the lock at once; its late reply releases nobody else", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const c = await client(port, "C");
    const ta = await newTab(a);
    const tb = await newTab(b);
    const tc = await newTab(c);
    ext.hold.add("screenshot");

    send(a, "screenshot", { tab: ta.tab });
    const shotA = await ext.waitReq("screenshot");
    const ib = send(b, "screenshot", { tab: tb.tab });
    await quiet(50);
    expect(ext.reqs("screenshot")).toHaveLength(1);

    a.ws.close();
    const shotB = await ext.waitReq("screenshot", 2);
    expect(shotB.params).toEqual({ tabId: 102 });
    const st = (await call(c, "daemon.status")).result as { lock: { holder?: string } };
    expect(st.lock).toEqual({ holder: "B" });

    const ic = send(c, "screenshot", { tab: tc.tab });
    await quiet(50);
    ext.answer(shotA, { dataUrl: "late A" }); // A's late settle
    await quiet(100);
    expect(ext.reqs("screenshot")).toHaveLength(2); // C still waits behind B
    ext.answer(shotB, { dataUrl: "b" });
    expect((await b.frame(response(ib))).result).toEqual({ dataUrl: "b" });
    const shotC = await ext.waitReq("screenshot", 3);
    ext.answer(shotC, { dataUrl: "c" });
    expect((await c.frame(response(ic))).result).toEqual({ dataUrl: "c" });
    // A's leases died with it.
    expect((await call(c, "tabs.claim", { tab: ta.tab })).result).toEqual({ tab: ta.tab });
  });

  it(
    "one deadline (#44): the holder's forwarded call times out at deadline + 5000 and releases exactly once",
    async () => {
      const { port } = await start();
      const ext = await extension(port);
      const a = await client(port, "A");
      const b = await client(port, "B");
      const c = await client(port, "C");
      const ta = await newTab(a);
      const tb = await newTab(b);
      const tc = await newTab(c);
      ext.hold.add("screenshot");

      const t0 = Date.now();
      const ia = send(a, "screenshot", { tab: ta.tab }, 100);
      const shotA = await ext.waitReq("screenshot");
      const ib = send(b, "screenshot", { tab: tb.tab }, 100); // waiter: its deadline rejects once
      const ic = send(c, "screenshot", { tab: tc.tab }, 20_000); // waits for A's release
      const rb = await b.frame(response(ib));
      expect(errOf(rb).code).toBe("LOCK_TIMEOUT");

      const ra = await a.frame(response(ia), 9000);
      const took = Date.now() - t0;
      expect(errOf(ra).code).toBe("TIMEOUT");
      expect(took).toBeGreaterThanOrEqual(5000);
      expect(took).toBeLessThan(6500);

      const shotC = await ext.waitReq("screenshot", 2);
      expect(shotC.params).toEqual({ tabId: 103 });
      const id2 = send(b, "screenshot", { tab: tb.tab }, 20_000);
      ext.answer(shotA, {}); // A's reply after its timeout: must release nothing
      await quiet(100);
      expect(ext.reqs("screenshot")).toHaveLength(2);
      ext.answer(shotC, { dataUrl: "c" });
      expect((await c.frame(response(ic))).result).toEqual({ dataUrl: "c" });
      const shotB2 = await ext.waitReq("screenshot", 3);
      ext.answer(shotB2, { dataUrl: "b2" });
      expect((await b.frame(response(id2))).result).toEqual({ dataUrl: "b2" });
      expect(b.frames.filter(response(ib))).toHaveLength(1);
    },
    15_000,
  );

  // T2.4 (#41)'s legacy-path tests were removed in Step 8 S2b (decisions.md #72, #81; listed in
  // docs/plans/2026-10-21-step8-sdk-surface-and-mcp-cursor-steps/S2b-builder.md); the refusals that replace
  // them are under "Step 8 S2b: the removals" below.

  it("free methods need no lease: downloads, listTabs, networkRequests in every scope, daemon.*, tabs.claim/release", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const ta = await newTab(a);

    for (const [m, p] of [
      ["downloadStart", { url: "http://fixture.test/f.pdf" }],
      ["downloadChunk", { id: "d1", offset: 0, length: 10 }],
      ["downloadEnd", { id: "d1" }],
    ] as const) {
      expect((await call(b, m, p)).result).toEqual({ ok: true, method: m });
      expect(ext.reqs(m)[0].params).toEqual(p);
    }
    expect("result" in (await call(b, "listTabs"))).toBe(true);
    expect("result" in (await call(b, "daemon.status"))).toBe(true);

    // networkRequests: a foreign-held handle, "all", "active", absent, and an id lookup — all free.
    await call(b, "networkRequests", { tab: ta.tab });
    await call(b, "networkRequests", { tab: "all", limit: 3 });
    await call(b, "networkRequests", { tab: "active" });
    await call(b, "networkRequests", {});
    await call(b, "networkRequests", { tab: "all", id: "9" });
    expect(ext.reqs("networkRequests").map((r) => r.params)).toEqual([
      { tabId: 101 },
      { limit: 3, scope: "all" },
      { tabId: 1 },
      { tabId: 1 },
      { id: "9" },
    ]);
    expect(errOf(await call(b, "networkRequests", { tab: "bogus" })).code).toBe("TAB_UNKNOWN");
  });

  it("F12: networkRequests entries carry the handle beside tabId (not for -1)", async () => {
    const { port } = await start();
    await extension(port);
    const a = await client(port, "A");
    const r = (await call(a, "networkRequests", { tab: "all" })).result as { entries: Array<Record<string, unknown>> };
    expect(r.entries[0]).toMatchObject({ tabId: 1, tab: "T1" });
    expect(r.entries[1].tabId).toBe(-1);
    expect(r.entries[1]).not.toHaveProperty("tab");
  });

  it("V3: a network entry naming a closed tab gets its dead handle; a never-seen tab id gets no tab and no live handle", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    ext.emit("tabRemoved", { tabId: 2 });
    await quiet(40);
    const orig = ext.auto.bind(ext);
    ext.auto = (req) =>
      req.method === "networkRequests"
        ? { entries: [{ id: "1", tabId: 2 }, { id: "2", tabId: 4242 }], total: 2, pending: 0, recordingSince: 0 }
        : orig(req);
    const r = (await call(a, "networkRequests", { tab: "all" })).result as { entries: Array<Record<string, unknown>> };
    expect(r.entries[0]).toEqual({ id: "1", tabId: 2, tab: "T2" });
    expect(r.entries[1]).toEqual({ id: "2", tabId: 4242 });
    const st = (await call(a, "daemon.status")).result as { tabs: Array<Record<string, unknown>> };
    expect(st.tabs.map((t) => t.tabId)).toEqual([1]);
  });

  it("networkClear on a foreign tab → TAB_HELD; own tab and the human's tab are forwarded with tabId", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const ta = await newTab(a);

    const held = await call(b, "networkClear", { tab: ta.tab });
    expect(errOf(held).message).toMatch(HELD(ta.tab, "A"));
    expect(ext.reqs("networkClear")).toHaveLength(0);
    await call(a, "networkClear", { tab: ta.tab });
    await call(b, "networkClear", {});
    expect(ext.reqs("networkClear").map((r) => r.params)).toEqual([{ tabId: 101 }, { tabId: 1 }]);
  });

  it("#40 (stricter): networkClear {tab:'all'} is refused whenever another client holds any tab, even one with no entries — nothing is forwarded", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    const ta = await newTab(a); // A's tab has no network entries (the old check→clear race case)

    const refused = await call(b, "networkClear", { tab: "all" });
    expect(errOf(refused).code).toBe("TAB_HELD");
    expect(errOf(refused).message).toMatch(HELD(ta.tab, "A"));
    expect(errOf(refused).data).toEqual({ owner: "A", since: expect.any(Number) });
    expect(ext.reqs("networkRequests")).toHaveLength(0); // no probe
    expect(ext.reqs("networkClear")).toHaveLength(0);
  });

  it("#40 (stricter): networkClear {tab:'all'} with only the caller's own leases and unheld tabs is forwarded as {scope:'all'}", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    await client(port, "B"); // connected, holds nothing
    await newTab(a);
    await call(a, "tabs.claim", { tab: "T1" });
    expect((await call(a, "networkClear", { tab: "all", extra: 1 })).result).toEqual({ ok: true, method: "networkClear" });
    expect(ext.reqs("networkClear").map((r) => r.params)).toEqual([{ extra: 1, scope: "all" }]);
    expect(ext.reqs("networkRequests")).toHaveLength(0);
  });

  it("#40 (stricter): the check runs before any await — the answer needs nothing from the extension, and no probe is sent", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    // The extension answers nothing from here on: any await on it would stall the call.
    ext.hold.add("networkRequests");
    ext.hold.add("listTabs");
    await call(a, "tabs.claim", { tab: "T2" });
    const r = await call(b, "networkClear", { tab: "all" }, 2000);
    expect(errOf(r).message).toMatch(HELD("T2", "A"));
    // A lease granted right behind the clear (same TCP read order) cannot slip in before the check:
    // B's clear, sent before C's claim, is forwarded; C's claim lands afterwards.
    await call(a, "tabs.release", { tab: "T2" });
    ext.hold.add("networkClear");
    const c = await client(port, "C");
    const ib = send(b, "networkClear", { tab: "all" });
    const ic = send(c, "tabs.claim", { tab: "T2" });
    const fwd = await ext.waitReq("networkClear");
    expect(fwd.params).toEqual({ scope: "all" });
    expect((await c.frame(response(ic))).result).toEqual({ tab: "T2" });
    ext.answer(fwd, { ok: true });
    expect((await b.frame(response(ib))).result).toEqual({ ok: true });
    expect(ext.reqs("networkRequests")).toHaveLength(0);
  });

  // 2026-10-23 (Step 8 S2b, decisions.md #84 F11): the loop also sent each method through the legacy path
  // (no tab, or a Chrome `id` for focusTab/selectTab); that path is gone, so each method is sent once.
  it("T2.3: every tab-carrying method reaches the extension with a numeric tabId and no tab key", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const ta = await newTab(a);
    for (const m of TAB_METHODS) {
      const params = m === "networkClear" ? { tab: ta.tab } : { tab: ta.tab, ref: "e1" };
      const r = await call(a, m, params);
      expect("result" in r, m).toBe(true);
    }
    await call(a, "someNewMethod", { tab: ta.tab, x: 1 });
    expect(ext.reqs("someNewMethod")[0].params).toEqual({ x: 1, tabId: 101 });
    for (const r of ext.reqs()) {
      expect(r.params ?? {}).not.toHaveProperty("tab");
      expect(r.params ?? {}).not.toHaveProperty("id", ta.id);
    }
    const tabReqs = ext.reqs().filter((r) => TAB_METHODS.has(r.method));
    expect(tabReqs).toHaveLength(TAB_METHODS.size);
    for (const r of tabReqs) expect(typeof r.params?.tabId).toBe("number");
  });

  // ---------------------------------------------------------------- #42: a no-proto extension

  it("a no-proto extension: tab methods answer VERSION with the reload hint; free methods are forwarded as in Step 6; no resync", async () => {
    const { port } = await start();
    const a = await client(port, "A");
    // NOT_CONNECTED comes before VERSION.
    expect(errOf(await call(a, "snapshot")).code).toBe("NOT_CONNECTED");
    const ext = await extension(port, undefined, false);
    await quiet(50);
    expect(ext.reqs()).toEqual([]); // no resync

    for (const [m, p] of [
      ["snapshot", undefined],
      ["click", { tab: "T1", ref: "e1" }],
      ["screenshot", {}],
      ["closeTab", { id: 1 }],
      ["networkClear", { tab: "all" }],
      ["someNewMethod", { tab: "T1" }],
      // 2026-10-23 (Step 8 S2b, decisions.md #81 F8): an unlisted method without tab was forwarded here as a
      // free method; it is now a tab call without a tab, so a no-proto extension refuses it like the rest.
      ["slow", undefined],
    ] as const) {
      expect(errOf(await call(a, m, p as Record<string, unknown> | undefined)), m).toEqual({
        code: "VERSION",
        message: RELOAD_HINT,
      });
    }
    await call(a, "downloadStart", { url: "u" });
    await call(a, "networkRequests", { tab: "all" });
    expect(ext.reqs().map((r) => [r.method, r.params])).toEqual([
      ["downloadStart", { url: "u" }],
      ["networkRequests", { tab: "all" }],
    ]);
  });

  // ---------------------------------------------------------------- F15: resync on every hello

  it("F15: a reconnecting extension's listTabs mints unseen tabs and marks missing ones gone (tabGone to holders)", async () => {
    const { port } = await start();
    const ext1 = await extension(port);
    const a = await client(port, "A");
    expect((await call(a, "tabs.claim", { tab: "T2" })).result).toEqual({ tab: "T2" });
    ext1.peer.ws.close();
    await ext1.peer.whenClosed();

    const ext2 = await extension(port, (e) => {
      e.tabs = [
        { id: 1, title: "Fixture One", url: "http://fixture.test/one", active: true, current: true },
        { id: 3, title: "Fixture Three", url: "http://fixture.test/three", active: false },
      ];
    });
    const gone = await a.frame((f) => f.event === "tabGone");
    expect(gone.params).toEqual({ tab: "T2", lastUrl: "http://fixture.test/two", lastTitle: "Fixture Two" });
    const st = (await call(a, "daemon.status")).result as { tabs: unknown[]; lock: unknown };
    expect(st.tabs).toEqual([
      { tab: "T1", tabId: 1, url: "http://fixture.test/one" },
      { tab: "T3", tabId: 3, url: "http://fixture.test/three" },
    ]);
    expect(st.lock).toEqual({});
    expect(errOf(await call(a, "click", { tab: "T2", ref: "e1" })).code).toBe("TAB_GONE");
    expect(ext2.reqs("listTabs")).toHaveLength(1);
    expect(logs.some((l) => l.startsWith("extension resync"))).toBe(true);
  });

  // ---------------------------------------------------------------- Step 8 S2b: the removals (#41, #52–#54, #81, #85)

  it("S2b.3: a tab call without tab → BAD_PARAMS 'tab is required'; nothing forwarded; no legacy log line", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const listBefore = ext.reqs("listTabs").length;
    const methods = [...TAB_METHODS].filter((m) => m !== "networkClear"); // network calls keep #40's "active"
    for (const m of [...methods, "closeTab"]) {
      const r = await call(a, m, m === "locate" ? { locator: { role: "button" } } : { ref: "e1" });
      expect(errOf(r), m).toEqual({ code: "BAD_PARAMS", message: "tab is required" });
    }
    expect(errOf(await call(a, "snapshot"))).toEqual({ code: "BAD_PARAMS", message: "tab is required" });
    expect(ext.reqs().filter((r) => r.method !== "listTabs")).toEqual([]);
    expect(ext.reqs("listTabs").length).toBe(listBefore); // no human's-tab lookup either
    expect(logs.filter((l) => l.includes("legacy"))).toEqual([]);
  });

  // Step 11 S2 (S2.4; decisions.md · 2026-10-25 · Step 11: the wire method `uploadFiles`, no visibility lock, no
  // focus (#238)): a tab method — lease-checked, forwarded with a numeric tabId and the paths as sent, no lock.
  it("Step 11 S2.4: uploadFiles on another client's tab → TAB_HELD, nothing forwarded; the holder's is forwarded, no lock", async () => {
    const { port } = await start();
    const ext = await extension(port, (e) => e.hold.add("uploadFiles"));
    const a = await client(port, "A");
    const b = await client(port, "B");
    const t = await newTab(a);
    const paths = ["C:\\Wave\\Up\\a.txt", "/srv/wave/up/b.bin"];

    const held = await call(b, "uploadFiles", { tab: t.tab, ref: "e1", paths });
    expect(errOf(held).code).toBe("TAB_HELD");
    expect(errOf(held).message).toMatch(HELD(t.tab, "A"));
    expect(ext.reqs("uploadFiles")).toHaveLength(0);

    const id = send(a, "uploadFiles", { tab: t.tab, ref: "e1", paths });
    const req = await ext.waitReq("uploadFiles");
    expect(req.params).toEqual({ ref: "e1", paths, tabId: t.id });
    // In flight: the visibility lock is not held.
    expect(((await call(b, "daemon.status")).result as { lock: unknown }).lock).toEqual({});
    ext.answer(req, { files: 2 });
    expect((await a.frame(response(id))).result).toEqual({ files: 2 });
    expect(errOf(await call(a, "uploadFiles", { ref: "e1", paths })).code).toBe("BAD_PARAMS"); // tab is required
  });

  it("S2b.3 (#81 F8): an unlisted method without tab → BAD_PARAMS; with a tab it is resolved and forwarded", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    expect(errOf(await call(a, "someNewMethod", { x: 1 }))).toEqual({ code: "BAD_PARAMS", message: "tab is required" });
    expect(errOf(await call(a, "someNewMethod"))).toEqual({ code: "BAD_PARAMS", message: "tab is required" });
    expect(ext.reqs("someNewMethod")).toEqual([]);
    await call(a, "someNewMethod", { tab: "T2", x: 1 });
    expect(ext.reqs("someNewMethod").map((r) => r.params)).toEqual([{ x: 1, tabId: 2 }]);
  });

  it("S2b.3: closeTab/focusTab with a Chrome id (alone or beside a tab) → BAD_PARAMS; nothing forwarded", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    for (const m of ["closeTab", "focusTab"]) {
      expect(errOf(await call(a, m, { id: 2 })).code, m).toBe("BAD_PARAMS");
      expect(errOf(await call(a, m, { id: 2, tab: "T2" })).code, m).toBe("BAD_PARAMS");
      expect(errOf(await call(a, m, {})), m).toEqual({ code: "BAD_PARAMS", message: "tab is required" });
    }
    expect(ext.reqs("closeTab")).toEqual([]);
    expect(ext.reqs("focusTab")).toEqual([]);
    expect((await call(a, "focusTab", { tab: "T2" })).result).toEqual({ ok: true, method: "focusTab" });
    expect(ext.reqs("focusTab").map((r) => r.params)).toEqual([{ tabId: 2 }]);
  });

  it("S2b.3 (#40, #54): a numeric network tab (number or numeric string) → BAD_PARAMS; nothing forwarded", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    const ta = await newTab(a);
    for (const [m, tab] of [
      ["networkRequests", 1],
      ["networkRequests", "1"],
      ["networkRequests", 1.5],
      ["networkRequests", true],
      ["networkClear", ta.id],
      ["networkClear", String(ta.id)],
      ["networkClear", 2],
    ] as const) {
      expect(errOf(await call(a, m, { tab })).code, `${m} ${String(tab)}`).toBe("BAD_PARAMS");
    }
    expect(ext.reqs("networkRequests")).toEqual([]);
    expect(ext.reqs("networkClear")).toEqual([]);
  });

  it("S2b (#81): a network call without tab, or 'active', is the human's tab — forwarded with tabId, no log line", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    await call(a, "networkRequests", {});
    await call(a, "networkRequests", { tab: "active", limit: 2 });
    await call(a, "networkClear", {});
    await call(a, "networkClear", { tab: "active" });
    expect(ext.reqs("networkRequests").map((r) => r.params)).toEqual([{ tabId: 1 }, { limit: 2, tabId: 1 }]);
    expect(ext.reqs("networkClear").map((r) => r.params)).toEqual([{ tabId: 1 }, { tabId: 1 }]);
    expect(logs.filter((l) => !l.startsWith("extension resync"))).toEqual([]);
  });

  it("S2b.3 (#85 item 4): selectTab is refused by the daemon itself (UNKNOWN_METHOD) before any resolution, though the extension would answer it", async () => {
    const { port } = await start();
    const a = await client(port, "A");
    // No extension at all: still UNKNOWN_METHOD, not NOT_CONNECTED.
    expect(errOf(await call(a, "selectTab", { tab: "T1" })).code).toBe("UNKNOWN_METHOD");
    const ext = await extension(port); // FakeExt answers every method it is sent, selectTab included
    const b = await client(port, "B");
    const ta = await newTab(a);
    const listBefore = ext.reqs("listTabs").length;
    for (const [who, p] of [
      [a, { tab: ta.tab }],
      [b, { tab: ta.tab }], // held by A: UNKNOWN_METHOD, not TAB_HELD
      [b, { id: 2 }],
      [b, {}],
      [b, { tab: "T999" }], // unknown handle: UNKNOWN_METHOD, not TAB_UNKNOWN
    ] as const) {
      expect(errOf(await call(who, "selectTab", p)).code).toBe("UNKNOWN_METHOD");
    }
    expect(ext.reqs("selectTab")).toEqual([]);
    expect(ext.reqs("listTabs").length).toBe(listBefore);
  });

  // ---------------------------------------------------------------- Step 8 S2b: `code` required on receipt (#73)

  it("S2b.4: a proto:2 extension's error without a usable code is delivered as INTERNAL; one log line per connection naming the method only", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "A");
    ext.hold.add("snapshot");
    ext.hold.add("click");
    const bodies: unknown[] = [
      { message: "boom-SECRET-1" },
      { code: "", message: "boom-SECRET-2" },
      { code: 5, message: "boom-SECRET-3" },
      { code: null, message: "boom-SECRET-4" },
    ];
    for (const [i, body] of bodies.entries()) {
      const id = send(a, "snapshot", { tab: "T1" });
      ext.fail(await ext.waitReq("snapshot", i + 1), body);
      const r = await a.frame(response(id));
      expect(errOf(r)).toEqual({ code: "INTERNAL", message: `boom-SECRET-${i + 1}` });
    }
    const idc = send(a, "click", { tab: "T1", ref: "e1" });
    ext.fail(await ext.waitReq("click"), { message: "boom-SECRET-5" });
    expect(errOf(await a.frame(response(idc))).code).toBe("INTERNAL");
    // An unknown code passes through verbatim (Stage 0 F17: today's behaviour, kept).
    const idw = send(a, "snapshot", { tab: "T1" });
    ext.fail(await ext.waitReq("snapshot", 5), { code: "WEIRD", message: "w" });
    expect(errOf(await a.frame(response(idw)))).toEqual({ code: "WEIRD", message: "w" });

    expect(logs.filter((l) => l.startsWith("extension error without code"))).toEqual(["extension error without code: snapshot"]);
    expect(logs.join("\n")).not.toContain("boom-SECRET");

    // A new extension connection gets its own one line.
    ext.peer.ws.close();
    await ext.peer.whenClosed();
    const ext2 = await extension(port);
    ext2.hold.add("click");
    const id2 = send(a, "click", { tab: "T1", ref: "e1" });
    ext2.fail(await ext2.waitReq("click"), { message: "boom-SECRET-6" });
    expect(errOf(await a.frame(response(id2)))).toEqual({ code: "INTERNAL", message: "boom-SECRET-6" });
    expect(logs.filter((l) => l.startsWith("extension error without code"))).toEqual([
      "extension error without code: snapshot",
      "extension error without code: click",
    ]);
  });

  it("S2b.4: a no-proto extension's codeless error is INTERNAL as before, with no log line", async () => {
    const { port } = await start();
    const ext = await extension(port, undefined, false);
    const a = await client(port, "A");
    ext.hold.add("downloadStart");
    const id = send(a, "downloadStart", { url: "u" });
    ext.fail(await ext.waitReq("downloadStart"), { message: "old-style" });
    expect(errOf(await a.frame(response(id)))).toEqual({ code: "INTERNAL", message: "old-style" });
    expect(logs.filter((l) => l.startsWith("extension error without code"))).toEqual([]);
  });

  // ---------------------------------------------------------------- Step 8 S2b: the session marker (#74, #80)

  const MARK_A = "MARK-A-SENTINEL-7f3e";
  const MARK_B = "MARK-B-SENTINEL-19c2";
  const reusedTabs: Tab[] = [
    { id: 1, title: "Reused One", url: "http://fixture.test/reused-one", active: true, current: true },
    { id: 2, title: "Reused Two", url: "http://fixture.test/reused-two", active: false },
  ];

  async function reconnect(port: number, old: FakeExt, session: string | undefined, setup?: (e: FakeExt) => void): Promise<FakeExt> {
    old.peer.ws.close();
    await old.peer.whenClosed();
    return extension(port, setup, true, session);
  }

  it("S2b.5 same marker: today's resync by id — nothing retired, the lease stays (and the first hello retires nothing)", async () => {
    const { port } = await start();
    const ext1 = await extension(port, undefined, true, MARK_A);
    const a = await client(port, "A");
    const b = await client(port, "B");
    await call(a, "tabs.claim", { tab: "T2" });
    await reconnect(port, ext1, MARK_A);
    await quiet(50);
    expect(events(a, "tabGone")).toEqual([]);
    expect(errOf(await call(b, "click", { tab: "T2", ref: "e1" })).message).toMatch(HELD("T2", "A"));
    expect(logs.filter((l) => l.startsWith("extension session changed"))).toEqual([]);
  });

  it("S2b.5 changed marker: every handle retired synchronously before the resync; tabGone once per holder with the pre-restart lastUrl/lastTitle; a reused id gets a new, unheld handle", async () => {
    const { port } = await start();
    const ext1 = await extension(port, undefined, true, MARK_A);
    const a = await client(port, "A");
    const b = await client(port, "B");
    await call(a, "tabs.claim", { tab: "T2" });
    await call(b, "tabs.claim", { tab: "T1" });
    const ta = await newTab(a); // T3, id 101
    expect(ta.tab).toBe("T3");

    // The resync's listTabs is held: the retire must not wait for it.
    const ext2 = await reconnect(port, ext1, MARK_B, (e) => {
      e.tabs = reusedTabs.map((t) => ({ ...t }));
      e.hold.add("listTabs");
    });
    await a.until(() => events(a, "tabGone").length >= 2);
    await b.until(() => events(b, "tabGone").length >= 1);
    expect(events(a, "tabGone").map((f) => f.params)).toEqual([
      { tab: "T2", lastUrl: "http://fixture.test/two", lastTitle: "Fixture Two" },
      { tab: "T3" },
    ]);
    expect(events(b, "tabGone").map((f) => f.params)).toEqual([
      { tab: "T1", lastUrl: "http://fixture.test/one", lastTitle: "Fixture One" },
    ]);
    expect(logs).toContain("extension session changed: 3 handles retired");

    const resync = ext2.reqs("listTabs")[0];
    ext2.answer(resync, ext2.auto(resync));
    ext2.hold.delete("listTabs");
    await quiet(50);

    // The retired handle answers TAB_GONE with its pre-restart page, never the reused one's; nothing forwarded.
    const gone = errOf(await call(a, "click", { tab: "T2", ref: "e1" }));
    expect(gone.code).toBe("TAB_GONE");
    expect(gone.data).toEqual({ tab: "T2", lastUrl: "http://fixture.test/two", lastTitle: "Fixture Two" });
    expect(ext2.reqs("click")).toEqual([]);

    // The reused ids carry new handles nobody holds.
    const listed = (await call(b, "listTabs")).result as { tabs: Array<Record<string, unknown>> };
    expect(listed.tabs.map((t) => [t.id, t.tab, t.owner])).toEqual([
      [1, "T4", undefined],
      [2, "T5", undefined],
    ]);
    expect((await call(b, "click", { tab: "T5", ref: "e1" })).result).toEqual({ ok: true, method: "click" });
    expect(ext2.reqs("click").map((r) => r.params)).toEqual([{ ref: "e1", tabId: 2 }]);

    await quiet(50);
    expect(events(a, "tabGone")).toHaveLength(2); // exactly once each, the resync added none
    expect(events(b, "tabGone")).toHaveLength(1);
    const all = logs.join("\n");
    expect(all).not.toContain(MARK_A);
    expect(all).not.toContain(MARK_B);
    expect(all).not.toContain("SENTINEL");
  });

  it("S2b.5 changed marker drops every lease (S2b fixer 1, verifier F2): no foreign lease survives the retire, the reused id's new handle is claimable, the retired one answers TAB_GONE", async () => {
    const { port } = await start();
    const ext1 = await extension(port, undefined, true, MARK_A);
    const a = await client(port, "A");
    const b = await client(port, "B");
    await call(a, "tabs.claim", { tab: "T2" });
    // Before the retire, A's lease blocks B's networkClear {tab:"all"} (#40 as amended).
    expect(errOf(await call(b, "networkClear", { tab: "all" })).code).toBe("TAB_HELD");

    const ext2 = await reconnect(port, ext1, MARK_B, (e) => {
      e.tabs = reusedTabs.map((t) => ({ ...t }));
    });
    await a.until(() => events(a, "tabGone").length >= 1);
    await quiet(50);

    // A leaked lease on the retired T2 would still be a foreign lease here and refuse with TAB_HELD.
    expect((await call(b, "networkClear", { tab: "all" })).result).toEqual({ ok: true, method: "networkClear" });
    expect(ext2.reqs("networkClear").map((r) => r.params)).toEqual([{ scope: "all" }]);

    // The reused tab id 2 has a new handle that B can claim without TAB_HELD.
    const listed = (await call(b, "listTabs")).result as { tabs: Array<Record<string, unknown>> };
    const reused = listed.tabs.find((t) => t.id === 2);
    expect(reused?.tab).not.toBe("T2");
    expect(reused?.owner).toBeUndefined();
    expect((await call(b, "tabs.claim", { tab: reused?.tab })).result).toEqual({ tab: reused?.tab });

    // The retired handle answers TAB_GONE to a claim, for its old holder and for anyone else.
    expect(errOf(await call(a, "tabs.claim", { tab: "T2" })).code).toBe("TAB_GONE");
    expect(errOf(await call(b, "tabs.claim", { tab: "T2" })).code).toBe("TAB_GONE");
  });

  it("S2b.5 audit §2 B6: a lease no longer lands on a reused tab id after a changed marker (same marker: resync by id, by design)", async () => {
    const { port } = await start();
    const ext1 = await extension(port, undefined, true, MARK_A);
    const a = await client(port, "A");
    await call(a, "tabs.claim", { tab: "T2" });
    const ext2 = await reconnect(port, ext1, MARK_B, (e) => {
      e.tabs = reusedTabs.map((t) => ({ ...t }));
    });
    await quiet(50);
    expect(errOf(await call(a, "snapshot", { tab: "T2" })).code).toBe("TAB_GONE");
    expect(ext2.reqs("snapshot")).toEqual([]);
  });

  it("S2b.5 dropped marker (A → none) retires", async () => {
    const { port } = await start();
    const ext1 = await extension(port, undefined, true, MARK_A);
    const a = await client(port, "A");
    await call(a, "tabs.claim", { tab: "T2" });
    await reconnect(port, ext1, undefined);
    await a.until(() => events(a, "tabGone").length >= 1);
    expect(events(a, "tabGone").map((f) => (f.params as { tab: string }).tab)).toEqual(["T2"]);
    expect(logs).toContain("extension session changed: 2 handles retired");
    expect(logs.join("\n")).not.toContain(MARK_A);
  });

  it("S2b.5 never a marker (none → none) retires nothing", async () => {
    const { port } = await start();
    const ext1 = await extension(port);
    const a = await client(port, "A");
    const b = await client(port, "B");
    await call(a, "tabs.claim", { tab: "T2" });
    await reconnect(port, ext1, undefined);
    await quiet(50);
    expect(events(a, "tabGone")).toEqual([]);
    expect(errOf(await call(b, "click", { tab: "T2", ref: "e1" })).message).toMatch(HELD("T2", "A"));
    expect(logs.filter((l) => l.startsWith("extension session changed"))).toEqual([]);
  });

  it("S2b.5 none → a marker retires (a change of value is a change)", async () => {
    const { port } = await start();
    const ext1 = await extension(port);
    const a = await client(port, "A");
    await call(a, "tabs.claim", { tab: "T2" });
    await reconnect(port, ext1, MARK_A);
    await a.until(() => events(a, "tabGone").length >= 1);
    expect(events(a, "tabGone").map((f) => f.params)).toEqual([
      { tab: "T2", lastUrl: "http://fixture.test/two", lastTitle: "Fixture Two" },
    ]);
    await quiet(50);
    expect(events(a, "tabGone")).toHaveLength(1);
    expect(errOf(await call(a, "click", { tab: "T2", ref: "e1" })).code).toBe("TAB_GONE");
    expect(logs.join("\n")).not.toContain(MARK_A);
  });

  // ---------------------------------------------------------------- Step 8 S2b.9: handle numbers never reused (#79)

  it("S2b.9: a second daemon on the first's mark never re-mints a handle number; the first's stale handle → TAB_UNKNOWN", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "s2b-mark-"));
    try {
      const first = await start({ handleNumbers: createHandleMark({ dir }) });
      await extension(first.port);
      const a = await client(first.port, "A");
      const ta = await newTab(a);
      const firstHandles = ((await call(a, "listTabs")).result as { tabs: Array<{ tab: string }> }).tabs.map((t) => t.tab);
      expect(firstHandles).toContain(ta.tab);
      for (const p of peers.splice(0)) p.ws.terminate();
      exts.splice(0);
      await host!.close();

      const second = await start({ handleNumbers: createHandleMark({ dir }) });
      const ext = await extension(second.port);
      const b = await client(second.port, "B");
      const secondHandles = ((await call(b, "listTabs")).result as { tabs: Array<{ tab: string }> }).tabs.map((t) => t.tab);
      const num = (h: string) => Number(h.slice(1));
      expect(Math.min(...secondHandles.map(num))).toBeGreaterThan(Math.max(...firstHandles.map(num)));
      const stale = errOf(await call(b, "click", { tab: ta.tab, ref: "e1" }));
      expect(stale.code).toBe("TAB_UNKNOWN");
      expect(ext.reqs("click")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------- daemon.status

  it("daemon.status adds tabs (owner name, url) and lock {holder}", async () => {
    const { port } = await start();
    const ext = await extension(port);
    const a = await client(port, "alpha");
    const ta = await newTab(a, "http://fixture.test/mine");
    ext.hold.add("screenshot");
    send(a, "screenshot", { tab: ta.tab });
    await ext.waitReq("screenshot");
    const st = (await call(a, "daemon.status")).result as Record<string, unknown>;
    expect(st.build).toBe(BUILD);
    expect(st.tabs).toEqual([
      { tab: "T1", tabId: 1, url: "http://fixture.test/one" },
      { tab: "T2", tabId: 2, url: "http://fixture.test/two" },
      { tab: ta.tab, tabId: 101, owner: "alpha" },
    ]);
    expect(st.lock).toEqual({ holder: "alpha" });
  });
});
