// Step 8 S5, cross-package: the real daemon host (handles, leases, intercept) in process on
// 127.0.0.1 port 0, the real SDK `connect()`/BridgeClient, BridgeLink, TabCursor and the 23 tools,
// against a fake proto:2 extension over real `ws` (modelled on multi-actor.test.ts, not importing it).
// Shows (a) the cursor staying when the extension's `listTabs` moves `current`, until
// browser_use_active_tab; (b) locator input reaching the extension as `params.locator`; (c) an
// attach-eligible error rendered as report() text plus an image block, the PNG in a temp
// BRIDGE_FAILURES_DIR (never the real ~/.browser-agent-bridge).
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { connect } from "@bridge/sdk";
import { Bridge } from "../../daemon/src/bridge.js";
import { WsHost } from "../../daemon/src/wsHost.js";
import { connectOptions } from "../src/config.js";
import { BridgeLink } from "../src/link.js";
import { TabCursor } from "../src/cursor.js";
import { failedLine, isFailureReport, registerTools } from "../src/tools/registry.js";

const TOKEN = "s5-cross-token-SENTINEL";
const BUILD = "s5-build";
const PLAY = "http://localhost:8080/e2e-playground.html";
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function waitUntil(pred: () => boolean, timeoutMs = 5000): Promise<void> {
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

interface FakeTab {
  id: number;
  title: string;
  url: string;
  windowId: number;
}

/**
 * A proto:2 extension: listTabs marks `human` as `current` (a test moves it); a click whose locator
 * names "Nope" fails with LOCATOR_NOT_FOUND; snapshot, screenshot and networkRequests answer the
 * failure report's reads. Every request is recorded.
 */
class FakeExtension {
  readonly received: Array<{ method: string; params: Record<string, unknown> }> = [];
  tabs: FakeTab[] = [
    { id: 101, title: "Play", url: PLAY, windowId: 1 },
    { id: 102, title: "Other", url: "http://localhost:8080/other.html", windowId: 1 },
  ];
  human = 101;
  private ws: WebSocket | undefined;

  connect(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      this.ws = ws;
      ws.on("message", (raw) => {
        const f = JSON.parse(raw.toString()) as { type?: string; id?: string; method?: string; params?: Record<string, unknown> };
        if (f.type === "welcome") return resolve();
        if (typeof f.id !== "string" || typeof f.method !== "string") return;
        const params = f.params ?? {};
        this.received.push({ method: f.method, params });
        const failure = this.failure(f.method, params);
        if (failure) ws.send(JSON.stringify({ id: f.id, error: failure }));
        else ws.send(JSON.stringify({ id: f.id, result: this.answer(f.method, params) }));
      });
      ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: TOKEN, role: "extension", proto: 2 })));
      ws.on("error", reject);
    });
  }

  close(): void {
    this.ws?.terminate();
  }

  of(method: string): Array<Record<string, unknown>> {
    return this.received.filter((r) => r.method === method).map((r) => r.params);
  }

  private failure(method: string, p: Record<string, unknown>): unknown {
    const loc = p.locator as { name?: unknown } | undefined;
    if (method === "click" && loc?.name === "Nope") {
      return { code: "LOCATOR_NOT_FOUND", message: 'no element matches button "Nope"', data: { candidates: [] } };
    }
    return null;
  }

  private answer(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case "listTabs":
        return {
          tabs: this.tabs.map((t) => ({
            ...t,
            active: t.id === this.human,
            ...(t.id === this.human ? { current: true } : {}),
          })),
        };
      case "snapshot": {
        const t = this.tabs.find((x) => x.id === p.tabId);
        return { url: t?.url ?? "", title: t?.title ?? "", elements: [{ ref: "e1", role: "button", name: "Go", depth: 0 }], truncated: false };
      }
      case "screenshot":
        return { dataUrl: `data:image/png;base64,${PNG_B64}` };
      case "networkRequests":
        return { entries: [], total: 0, pending: 0, recordingSince: Date.now() - 60_000 };
      default:
        return { ok: true };
    }
  }
}

type Result = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<Result>;

describe("Step 8 S5 — the MCP cursor and tools over the real daemon and SDK", () => {
  let root: string;
  let failures: string;
  let daemonPath: string;
  let port: number;
  let ext: FakeExtension;
  const links: BridgeLink[] = [];
  const hosts: WsHost[] = [];

  beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "bridge-s5-cross-"));
    failures = path.join(root, "failures");
    daemonPath = path.join(root, "daemon.js");
    writeFileSync(daemonPath, "// not run: the daemon is in process");
    ext = new FakeExtension();
    const bridge = new Bridge();
    const h = new WsHost(bridge, { port: 0, token: TOKEN, build: BUILD });
    hosts.push(h);
    port = await h.listen();
    await ext.connect(port);
    await waitUntil(() => bridge.isConnected());
  });

  afterEach(async () => {
    for (const l of links.splice(0)) l.stop();
    ext.close();
    for (const h of hosts.splice(0)) await h.shutdown(1001);
    rmSync(root, { recursive: true, force: true });
  });

  async function actor(pid: number) {
    const cursor = new TabCursor({ call: (m, p) => link.call(m, p) });
    const link: BridgeLink = new BridgeLink({
      connect: () =>
        connect({
          ...connectOptions(pid),
          port,
          env: { BRIDGE_TOKEN: TOKEN, BRIDGE_DAEMON: daemonPath },
          io: { hashDaemon: async () => BUILD, spawnDaemon: async () => {} },
        }),
      retryMs: 50,
      onClient: (c) => cursor.adopt(c),
    });
    links.push(link);
    link.start();
    const server = new McpServer({ name: "t", version: "0" });
    registerTools(server, link, cursor, {
      actorName: connectOptions(pid).name,
      failureReports: {
        timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
        env: { BRIDGE_FAILURES_DIR: failures },
        homedir: () => path.join(root, "home-not-used"),
        now: Date.now,
      },
    });
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: Handler }> })._registeredTools;
    await waitUntil(() => link.hasClient);
    return {
      raw: (tool: string, args: Record<string, unknown> = {}) => tools[tool].handler(args, {}),
      run: async (tool: string, args: Record<string, unknown> = {}) => {
        const res = await tools[tool].handler(args, {});
        // A failure report with a screenshot has no isError (decision S6b); it is still a failure.
        if (res.isError || isFailureReport(res)) throw new Error(`tool error: ${res.content[0].text}`);
        return res.content[0].text as string;
      },
    };
  }

  it("(a) the cursor stays when listTabs moves `current`; browser_status shows the divergence; browser_use_active_tab moves it", async () => {
    const a = await actor(2001);
    await a.run("browser_click", { ref: "e1" }); // first touch claims the human's tab (101)
    expect(ext.of("click").map((p) => p.tabId)).toEqual([101]);

    ext.human = 102; // the human switches tabs
    const status = (await a.run("browser_status")).split("\n");
    const play = status.find((l) => l.startsWith("Cursor: "))!;
    expect(play).toMatch(/^Cursor: T\d+ "Play" — http:\/\/localhost:8080\/e2e-playground\.html \(held by me\)$/);
    expect(status.at(-1)).toMatch(/^Human's active tab: T\d+ "Other" — not mine; call browser_use_active_tab to work there$/);

    await a.run("browser_click", { ref: "e2" });
    expect(ext.of("click").map((p) => p.tabId)).toEqual([101, 101]); // did not follow

    expect(await a.run("browser_use_active_tab")).toMatch(/^Now using T\d+ \(the human's active tab\) as this session's tab$/);
    await a.run("browser_click", { ref: "e3" });
    expect(ext.of("click").map((p) => p.tabId)).toEqual([101, 101, 102]);
    const after = (await a.run("browser_status")).split("\n");
    expect(after.at(-1)).toMatch(/^Cursor: T\d+ "Other" — .* \(held by me\)$/); // no Human's line any more
  });

  it("(b) locator input reaches the extension as params.locator, with no ref", async () => {
    const a = await actor(2002);
    expect(await a.run("browser_click", { locator: { role: "button", name: "Go", nth: 0 } })).toBe('Clicked button "Go" #0');
    expect(await a.run("browser_wait_for", { locator: { text: "Saved" }, state: "hidden" })).toBe(
      'Waited for text "Saved" to be hidden',
    );
    expect(ext.of("click")).toEqual([{ locator: { role: "button", name: "Go", nth: 0 }, trusted: false, tabId: 101 }]);
    expect(ext.of("waitFor")).toEqual([{ locator: { text: "Saved" }, state: "hidden", tabId: 101 }]);
  });

  it("(c) an attach-eligible error comes back as report() text plus an image block", async () => {
    const a = await actor(2003);
    const res = await a.raw("browser_click", { locator: { role: "button", name: "Nope" } });
    expect("isError" in res).toBe(false); // decision S6b: Claude Code 2.1.309 drops images from isError results (S6b-probe-record.md outcome A)
    expect(isFailureReport(res)).toBe(true);
    expect(res.content.map((c) => c.type)).toEqual(["text", "image"]);
    const report = res.content[0].text!;
    expect(report.split("\n")[0]).toBe('LOCATOR_NOT_FOUND: no element matches button "Nope"');
    expect(report).toContain(`Screenshot: ${failures}`);
    expect(report.split("\n").at(-1)).toBe(failedLine("LOCATOR_NOT_FOUND"));
    expect(res.content[1]).toEqual({ type: "image", data: PNG_B64, mimeType: "image/png" });
    // The report's reads went to the failed tab through the daemon.
    expect(ext.of("snapshot").map((p) => p.tabId)).toEqual([101]);
    expect(ext.of("screenshot").map((p) => p.tabId)).toEqual([101]);
    expect(ext.of("networkRequests").map((p) => p.tabId)).toEqual([101]);
    expect(readdirSync(failures)).toHaveLength(1);
  });
});
