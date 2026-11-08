import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { connect, type BridgeClient } from "@bridge/sdk";
// The real daemon host and Bridge, in process on 127.0.0.1 port 0: the NOT_CONNECTED reply, the
// welcome and `daemon.status` are the daemon's own, not a fake's.
import { Bridge } from "../../daemon/src/bridge.js";
import { WsHost } from "../../daemon/src/wsHost.js";
import { actorName, connectOptions } from "../src/config.js";
import { BridgeLink, type LinkTimers } from "../src/link.js";
import { registerTools } from "../src/tools/registry.js";

/**
 * Step 6 D5b (decisions.md · 2026-10-22 #27): with Chrome closed the MCP holds a daemon client at
 * once, reports the extension as down, fails tool calls with the daemon's own text, and does not
 * churn the client; when the extension comes up the same client serves the next call.
 */

const TOKEN = "d5b-test-token-SENTINEL";
const BUILD = "d5b-build";
const BASELINE_NOT_CONNECTED =
  "Extension not connected — is Chrome open and the Browser Agent Bridge extension enabled?";

/** Manual timers: the link's 5 s tick fires only when the test says so. */
function manualTimers() {
  let nextId = 1;
  const queue: Array<{ id: number; fn: () => void; ms: number }> = [];
  const timers: LinkTimers = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      queue.push({ id, fn, ms });
      return id;
    },
    clearTimeout: (h) => {
      const i = queue.findIndex((t) => t.id === h);
      if (i >= 0) queue.splice(i, 1);
    },
  };
  return {
    timers,
    pending: () => queue.map((t) => t.ms),
    fire: () => {
      const t = queue.shift();
      if (!t) throw new Error("no timer pending");
      t.fn();
    },
  };
}

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

const flush = () => new Promise<void>((r) => setTimeout(r, 20));

type Handler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>;
function tool(server: McpServer, name: string): Handler {
  return (server as unknown as { _registeredTools: Record<string, { handler: Handler }> })._registeredTools[name]
    .handler;
}
const textOf = (res: unknown) => (res as { content: Array<{ text: string }> }).content[0].text;

/** What the fake extension answers `snapshot` with: a T3 (data, not text) result. */
const SNAPSHOT = { url: "", title: "t", elements: [{ ref: "e1", role: "button", name: "Go", depth: 0 }], truncated: false };

/**
 * A fake extension; answers `snapshot` with `SNAPSHOT`.
 * 2026-10-22 (Step 7 T4): was a `{text, count}` answer — T3 made the extension return data and T4
 * renders it in the MCP with `formatSnapshot`, so the fake answers the T3 shape and the expected text
 * below is the formatter's rendering of it (header line added).
 * 2026-10-22 (decisions.md #52, applying #42/#41): was a v1 hello (no role) answering only `snapshot` —
 * a no-proto extension now gets VERSION for tab methods, and a Step 7 daemon resolves a call with no
 * `tab` through `listTabs` (and resyncs from it on hello), so the fake says proto:2 and answers it.
 */
function fakeExtension(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("message", (raw) => {
      const f = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (f.type === "welcome") resolve(ws);
      else if (typeof f.id === "string" && f.method === "listTabs") {
        ws.send(JSON.stringify({ id: f.id, result: { tabs: [{ id: 1, title: "t", url: "", active: true, current: true }] } }));
      } else if (typeof f.id === "string" && f.method === "snapshot") {
        ws.send(JSON.stringify({ id: f.id, result: SNAPSHOT }));
      }
    });
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: TOKEN, role: "extension", proto: 2 })));
    ws.on("error", reject);
  });
}

describe("connectOptions() — the MCP's connect() options", () => {
  it("names the actor and does not wait for the extension", () => {
    expect(connectOptions(4321)).toEqual({ name: "claude-code #4321", requireExtension: false });
    expect(connectOptions()).toEqual({ name: actorName(), requireExtension: false });
  });
});

describe("MCP over a real SDK client with the extension down (D5b)", () => {
  let root: string;
  let daemonPath: string;
  let host: WsHost | undefined;
  let link: BridgeLink | undefined;
  let ext: WebSocket | undefined;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "bridge-d5b-"));
    daemonPath = path.join(root, "daemon.js");
    writeFileSync(daemonPath, "// not run: the daemon is in process");
  });

  afterEach(async () => {
    link?.stop();
    link = undefined;
    ext?.terminate();
    ext = undefined;
    await host?.shutdown(1001);
    host = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it("browser_status reports the extension down, a tool fails with the daemon's text, no churn, then works on the same client", async () => {
    host = new WsHost(new Bridge(), { port: 0, token: TOKEN, build: BUILD });
    const port = await host.listen();

    const spawnDaemon = vi.fn(async () => {
      throw new Error("the test never spawns a daemon");
    });
    const clients: BridgeClient[] = [];
    const t = manualTimers();
    link = new BridgeLink({
      connect: async () => {
        const c = await connect({
          ...connectOptions(),
          port,
          env: { BRIDGE_TOKEN: TOKEN, BRIDGE_DAEMON: daemonPath },
          io: { hashDaemon: async () => BUILD, spawnDaemon },
        });
        clients.push(c);
        return c;
      },
      timers: t.timers,
    });
    link.start();
    await waitUntil(() => link!.hasClient);
    expect(clients).toHaveLength(1);
    expect(link.reason).toBeNull();

    const server = new McpServer({ name: "t", version: "0" });
    registerTools(server, link);

    // (i) browser_status: the daemon is connected, the extension is not, and there is no Problem line.
    const status = textOf(await tool(server, "browser_status")({}, {}));
    expect(status).toMatch(new RegExp(`^Daemon: connected on 127\\.0\\.0\\.1:${port} \\(build ${BUILD}, up \\d+s\\)$`, "m"));
    expect(status).toContain(
      "Extension: not connected — is Chrome open with the Browser Agent Bridge extension enabled and its token/port set?",
    );
    expect(status).not.toContain("Problem:");

    // (ii) a tool call fails at once with the daemon's baseline text.
    await expect(tool(server, "browser_snapshot")({}, {})).rejects.toThrow(BASELINE_NOT_CONNECTED);
    await expect(tool(server, "browser_snapshot")({}, {})).rejects.toMatchObject({ message: BASELINE_NOT_CONNECTED });

    // (iii) the NOT_CONNECTED error's probe and the 5 s tick keep the same client.
    await flush();
    expect(clients).toHaveLength(1);
    expect(link.hasClient).toBe(true);
    expect(link.reason).toBeNull();
    expect(host.registry.count()).toBe(1);
    expect(t.pending()).toEqual([5000]);
    t.fire();
    await flush();
    expect(clients).toHaveLength(1);
    expect(link.hasClient).toBe(true);
    expect(host.registry.count()).toBe(1);
    expect(spawnDaemon).not.toHaveBeenCalled();

    // (iv) the extension comes up: the same client gets the event and serves the next call.
    ext = await fakeExtension(port);
    await waitUntil(() => clients[0].extensionConnected);
    const snap = textOf(await tool(server, "browser_snapshot")({}, {}));
    expect(snap).toBe('url:    title: "t"\n- button "Go" [ref=e1]');
    expect(clients).toHaveLength(1);
    expect(host.registry.count()).toBe(1);
  });
});
