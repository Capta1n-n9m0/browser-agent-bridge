import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, type RegisterToolsOptions, type ToolBridge } from "../src/tools/registry.js";
import { BridgeLink } from "../src/link.js";
import { TabCursor, lostNotice } from "../src/cursor.js";
import { BridgeError, ErrorCodes } from "@bridge/sdk";

type Params = Record<string, unknown>;
type Handler = (method: string, params?: Params, options?: { timeoutMs?: number }) => Promise<unknown>;
type Call = [string, Params | undefined];

/**
 * A fake BridgeClient (as the tools see it): a client is held; `call` goes to `handler`, except
 * `tabs.claim {active:true}`, which the fake answers itself with the human's tab (`human()`, "T1"
 * unless a test changes it) — the daemon's first-touch claim. Every call, claims included, is
 * recorded in `calls` (Step 7 T4: the fake records tab resolution).
 */
function fakeBridge(handler: Handler = async () => ({ ok: true }), status: () => Promise<unknown> = async () => ({})) {
  const calls: Call[] = [];
  let human = "T1";
  const bridge = {
    hasClient: true,
    reason: null as string | null,
    call: vi.fn(async (method: string, params?: Params, options?: { timeoutMs?: number }) => {
      calls.push([method, params]);
      if (method === "tabs.claim" && params?.active === true) return { tab: human };
      return handler(method, params, options);
    }),
    status: vi.fn(status),
  } satisfies ToolBridge;
  return {
    bridge,
    calls,
    /** The calls other than the first-touch claim. */
    work: () => calls.filter(([m, p]) => !(m === "tabs.claim" && p?.active === true)),
    claims: () => calls.filter(([m, p]) => m === "tabs.claim" && p?.active === true).length,
    setHuman(tab: string) {
      human = tab;
    },
  };
}

type ToolHandler = (args: Params, extra: Params) => Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean }>;

function tools(bridge: ToolBridge, cursor?: TabCursor, options?: RegisterToolsOptions) {
  const server = new McpServer({ name: "t", version: "0" });
  registerTools(server, bridge, cursor, options);
  // SDK v1.29.x stores tools under _registeredTools[name].handler
  const registered = (server as unknown as { _registeredTools: Record<string, { handler: ToolHandler; inputSchema?: { shape: Record<string, { safeParse(v: unknown): { success: boolean } }> } }> })._registeredTools;
  return {
    registered,
    run: (name: string, args: Params = {}) => registered[name].handler(args, {}),
  };
}

const textOf = (res: { content: Array<{ text?: string }> }) => res.content[0].text as string;

const heldError = new BridgeError(
  ErrorCodes.TAB_HELD,
  'tab T1 is held by "claude-code #4412" since 10:01:33 — use browser_new_tab, or browser_list_tabs to pick a free tab',
  { owner: "claude-code #4412", since: 0 },
);

describe("registerTools", () => {
  it("registers browser_navigate which calls navigate on the claimed tab and returns text", async () => {
    const f = fakeBridge(async (_m, p) => ({ url: p?.url }));
    const res = await tools(f.bridge).run("browser_navigate", { url: "https://example.com" });
    expect(f.calls).toEqual([
      ["tabs.claim", { active: true }],
      ["navigate", { url: "https://example.com", tab: "T1" }],
    ]);
    expect(textOf(res)).toBe("Navigated active tab to https://example.com");
  });

  // Amended 2026-10-25 (Step 11 S4, #241): 24 tools — browser_upload_file is added.
  // Amended 2026-10-27 (Step 12 S3b): 25 tools — browser_console_messages is added.
  it("registers 25 tools (Step 8 S5 adds browser_use_active_tab, Step 11 S4 browser_upload_file, Step 12 S3b browser_console_messages)", () => {
    const names = Object.keys(tools(fakeBridge().bridge).registered);
    expect(names).toHaveLength(25);
    expect(names).toContain("browser_console_messages");
    expect(names).toContain("browser_use_active_tab");
    expect(names).toContain("browser_upload_file");
  });
});

describe("perception tools", () => {
  it("browser_snapshot renders the snapshot result with formatSnapshot", async () => {
    const f = fakeBridge(async () => ({
      url: "http://x/",
      title: "X",
      elements: [{ ref: "e1", role: "button", name: "Go", depth: 0 }],
      truncated: false,
    }));
    const res = await tools(f.bridge).run("browser_snapshot");
    expect(f.work()).toEqual([["snapshot", { tab: "T1" }]]);
    expect(textOf(res)).toBe('url: http://x/   title: "X"\n- button "Go" [ref=e1]');
  });

  it("browser_screenshot returns image content", async () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const f = fakeBridge(async () => ({ dataUrl: png }));
    const res = await tools(f.bridge).run("browser_screenshot");
    expect(f.work()).toEqual([["screenshot", { fullPage: false, tab: "T1" }]]);
    expect(res.content[0].type).toBe("image");
    expect(res.content[0].mimeType).toBe("image/png");
    expect(res.content[0].data!.startsWith("iVBOR")).toBe(true);
  });
});

describe("action tools", () => {
  it("browser_click forwards the ref to click", async () => {
    const f = fakeBridge();
    await tools(f.bridge).run("browser_click", { ref: "e5" });
    expect(f.work()).toEqual([["click", { ref: "e5", trusted: false, tab: "T1" }]]);
  });

  it("browser_type forwards trusted:false when the flag is omitted", async () => {
    const f = fakeBridge();
    await tools(f.bridge).run("browser_type", { ref: "e5", text: "hi" });
    expect(f.work()).toEqual([["type", { ref: "e5", text: "hi", submit: false, trusted: false, tab: "T1" }]]);
  });

  it("browser_type forwards trusted:true when asked (after focusTab on the same tab, #106)", async () => {
    const f = fakeBridge();
    await tools(f.bridge).run("browser_type", { ref: "e5", text: "hi", submit: true, trusted: true });
    expect(f.work()).toEqual([
      ["focusTab", { tab: "T1" }],
      ["type", { ref: "e5", text: "hi", submit: true, trusted: true, tab: "T1" }],
    ]);
  });

  it("browser_press_key forwards trusted:false when the flag is omitted", async () => {
    const f = fakeBridge();
    await tools(f.bridge).run("browser_press_key", { key: "Enter" });
    expect(f.work()).toEqual([["pressKey", { key: "Enter", trusted: false, tab: "T1" }]]);
  });

  it("browser_press_key forwards trusted:true when asked (after focusTab on the same tab, #106)", async () => {
    const f = fakeBridge();
    await tools(f.bridge).run("browser_press_key", { key: "Enter", trusted: true });
    expect(f.work()).toEqual([
      ["focusTab", { tab: "T1" }],
      ["pressKey", { key: "Enter", trusted: true, tab: "T1" }],
    ]);
  });

  it("the other tab-touching tools send their params plus the tab, with today's result texts", async () => {
    const f = fakeBridge();
    const t = tools(f.bridge);
    expect(textOf(await t.run("browser_scroll", {}))).toBe("Scrolled");
    expect(textOf(await t.run("browser_hover", { ref: "e2" }))).toBe("Hovered e2");
    expect(textOf(await t.run("browser_select_option", { ref: "e3", values: ["a", "b"] }))).toBe("Selected a, b in e3");
    expect(textOf(await t.run("browser_back"))).toBe("Went back");
    expect(textOf(await t.run("browser_forward"))).toBe("Went forward");
    expect(f.work()).toEqual([
      ["scroll", { direction: "down", tab: "T1" }],
      ["hover", { ref: "e2", tab: "T1" }],
      ["selectOption", { ref: "e3", values: ["a", "b"], tab: "T1" }],
      ["back", { tab: "T1" }],
      ["forward", { tab: "T1" }],
    ]);
    expect(f.claims()).toBe(1);
  });
});

describe("tab resolution (T4.4)", () => {
  it("a tool call with `tab` passes it through and claims nothing", async () => {
    const f = fakeBridge();
    await tools(f.bridge).run("browser_click", { ref: "e5", tab: "T9" });
    expect(f.calls).toEqual([["click", { ref: "e5", trusted: false, tab: "T9" }]]);
  });

  it("an explicit `tab` does not move the cursor", async () => {
    const f = fakeBridge();
    const t = tools(f.bridge);
    await t.run("browser_click", { ref: "e1" }); // claims T1
    await t.run("browser_click", { ref: "e2", tab: "T9" });
    await t.run("browser_click", { ref: "e3" });
    expect(f.work().map(([, p]) => p?.tab)).toEqual(["T1", "T9", "T1"]);
    expect(f.claims()).toBe(1);
  });

  it("without `tab` the active tab is claimed on first touch and kept, even when the human's tab changes", async () => {
    const f = fakeBridge();
    const t = tools(f.bridge);
    await t.run("browser_hover", { ref: "e0" });
    f.setHuman("T5"); // the human switches tabs
    await t.run("browser_click", { ref: "e1" });
    await t.run("browser_press_key", { key: "Enter" });
    expect(f.calls[0]).toEqual(["tabs.claim", { active: true }]);
    expect(f.claims()).toBe(1);
    expect(f.work().map(([, p]) => p?.tab)).toEqual(["T1", "T1", "T1"]);
  });

  it("concurrent first touches send one claim", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: Call[] = [];
    const bridge: ToolBridge = {
      hasClient: true,
      reason: null,
      call: vi.fn(async (m: string, p?: Params) => {
        calls.push([m, p]);
        if (m === "tabs.claim") {
          await gate;
          return { tab: "T2" };
        }
        return { ok: true };
      }),
      status: vi.fn(async () => ({})),
    };
    const t = tools(bridge);
    const a = t.run("browser_click", { ref: "e1" });
    const b = t.run("browser_hover", { ref: "e2" });
    const c = t.run("browser_press_key", { key: "Enter" });
    release();
    await Promise.all([a, b, c]);
    expect(calls.filter(([m]) => m === "tabs.claim")).toHaveLength(1);
    expect(calls.filter(([m]) => m !== "tabs.claim").map(([, p]) => p?.tab)).toEqual(["T2", "T2", "T2"]);
  });

  it("a TAB_HELD from the first-touch claim is the tool's error and names the owner", async () => {
    const bridge: ToolBridge = {
      hasClient: true,
      reason: null,
      call: vi.fn(async () => {
        throw heldError;
      }),
      status: vi.fn(async () => ({})),
    };
    const err = await tools(bridge).run("browser_snapshot").then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe(ErrorCodes.TAB_HELD);
    expect((err as BridgeError).message).toContain("claude-code #4412");
    expect(bridge.call).toHaveBeenCalledTimes(1); // nothing ran after the failed claim
  });

  it("a TAB_HELD on an explicit tab renders the owner's actor name", async () => {
    const f = fakeBridge(async () => {
      throw heldError;
    });
    await expect(tools(f.bridge).run("browser_click", { ref: "e1", tab: "T1" })).rejects.toThrow('held by "claude-code #4412"');
  });

  it("a failed first-touch claim leaves no cursor: the next call claims again", async () => {
    let n = 0;
    const calls: Call[] = [];
    const bridge: ToolBridge = {
      hasClient: true,
      reason: null,
      call: vi.fn(async (m: string, p?: Params) => {
        calls.push([m, p]);
        if (m === "tabs.claim" && n++ === 0) throw heldError;
        if (m === "tabs.claim") return { tab: "T4" };
        return { ok: true };
      }),
      status: vi.fn(async () => ({})),
    };
    const t = tools(bridge);
    await expect(t.run("browser_click", { ref: "e1" })).rejects.toThrow("claude-code #4412");
    await t.run("browser_click", { ref: "e1" });
    expect(calls).toEqual([
      ["tabs.claim", { active: true }],
      ["tabs.claim", { active: true }],
      ["click", { ref: "e1", trusted: false, tab: "T4" }],
    ]);
  });

  it("TAB_GONE on the cursor's tab passes through and the cursor is kept (no silent move to the human's tab)", async () => {
    const gone = new BridgeError(ErrorCodes.TAB_GONE, "tab T1 was closed — call listTabs to pick another tab", { tab: "T1" });
    const f = fakeBridge(async () => {
      throw gone;
    });
    const t = tools(f.bridge);
    await expect(t.run("browser_click", { ref: "e1" })).rejects.toThrow("tab T1 was closed");
    await expect(t.run("browser_click", { ref: "e1" })).rejects.toThrow("tab T1 was closed");
    expect(f.claims()).toBe(1);
    expect(f.work().map(([, p]) => p?.tab)).toEqual(["T1", "T1"]);
  });

  it("an explicit stale handle's TAB_UNKNOWN passes through", async () => {
    const f = fakeBridge(async () => {
      throw new BridgeError(ErrorCodes.TAB_UNKNOWN, "unknown tab handle T9 — call listTabs");
    });
    await expect(tools(f.bridge).run("browser_snapshot", { tab: "T9" })).rejects.toThrow("unknown tab handle T9 — call listTabs");
    expect(f.claims()).toBe(0);
  });

  it("every tab-touching tool's schema has an optional string `tab`; the others have none", () => {
    const { registered } = tools(fakeBridge().bridge);
    const tabTouching = [
      "browser_navigate", "browser_snapshot", "browser_screenshot", "browser_click", "browser_type",
      "browser_press_key", "browser_scroll", "browser_hover", "browser_select_option", "browser_back",
      "browser_forward", "browser_wait_for", "browser_evaluate", "browser_select_tab", "browser_close_tab",
      "browser_focus_tab", "browser_network_requests", "browser_network_clear",
      // Amended 2026-10-25 (Step 11 S4, #241): the new tab tool.
      "browser_upload_file",
      // Amended 2026-10-27 (Step 12 S3b): the console tool.
      "browser_console_messages",
    ];
    for (const name of Object.keys(registered)) {
      const shape = registered[name].inputSchema?.shape ?? {};
      if (tabTouching.includes(name)) {
        expect(shape.tab, name).toBeDefined();
        expect(shape.tab.safeParse("T3").success, name).toBe(true);
        expect(shape.tab.safeParse(undefined).success, name).toBe(true);
        expect(shape.tab.safeParse(3).success, name).toBe(false); // the numeric form is gone (F3)
      } else {
        expect(shape.tab, name).toBeUndefined();
      }
    }
    expect(tabTouching.filter((n) => registered[n])).toHaveLength(20); // 18 + browser_upload_file (Step 11 S4) + browser_console_messages (Step 12 S3b)
  });
});

describe("cursor lost to a daemon restart", () => {
  it("the next untargeted call re-claims and its result gets one notice line, once", async () => {
    const f = fakeBridge();
    const cursor = new TabCursor(f.bridge);
    const t = tools(f.bridge, cursor);
    await t.run("browser_click", { ref: "e1" });
    cursor.markLost();
    f.setHuman("T6");
    const res = await t.run("browser_click", { ref: "e2" });
    expect(textOf(res)).toBe(`${lostNotice("T6")}\nClicked e2`);
    expect(textOf(await t.run("browser_click", { ref: "e3" }))).toBe("Clicked e3");
    expect(f.claims()).toBe(2);
  });

  it("puts the notice in its own text item before a screenshot's image", async () => {
    const f = fakeBridge(async () => ({ dataUrl: "data:image/png;base64,AAAA" }));
    const cursor = new TabCursor(f.bridge);
    const t = tools(f.bridge, cursor);
    await t.run("browser_screenshot");
    cursor.markLost();
    const res = await t.run("browser_screenshot");
    expect(res.content).toEqual([
      { type: "text", text: lostNotice("T1") },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);
  });

  it("a first-ever claim gives no notice", async () => {
    const f = fakeBridge();
    const cursor = new TabCursor(f.bridge);
    cursor.markLost();
    expect(textOf(await tools(f.bridge, cursor).run("browser_click", { ref: "e1" }))).toBe("Clicked e1");
  });

  it("an explicit-tab call after the loss neither re-claims nor takes the notice", async () => {
    const f = fakeBridge();
    const cursor = new TabCursor(f.bridge);
    const t = tools(f.bridge, cursor);
    await t.run("browser_click", { ref: "e1" });
    cursor.markLost();
    expect(textOf(await t.run("browser_click", { ref: "e2", tab: "T3" }))).toBe("Clicked e2");
    expect(f.claims()).toBe(1);
    expect(textOf(await t.run("browser_click", { ref: "e3" }))).toBe(`${lostNotice("T1")}\nClicked e3`);
  });

  it("if the call after the re-claim fails, the notice moves to the next result", async () => {
    let fail = false;
    const f = fakeBridge(async () => {
      if (fail) throw new Error("boom");
      return { ok: true };
    });
    const cursor = new TabCursor(f.bridge);
    const t = tools(f.bridge, cursor);
    await t.run("browser_click", { ref: "e1" });
    cursor.markLost();
    fail = true;
    await expect(t.run("browser_click", { ref: "e2" })).rejects.toThrow("boom");
    fail = false;
    expect(textOf(await t.run("browser_click", { ref: "e3" }))).toBe(`${lostNotice("T1")}\nClicked e3`);
    expect(textOf(await t.run("browser_click", { ref: "e4" }))).toBe("Clicked e4");
  });
});

describe("tab tools", () => {
  it("browser_list_tabs prints `T3* [owner] Title — url`, `*` from `current`", async () => {
    const f = fakeBridge(async () => ({
      tabs: [
        { id: 11, tab: "T1", title: "Inbox", url: "https://mail.test/", active: true },
        { id: 12, tab: "T3", title: "Playground", url: "http://localhost:8080/e2e-playground.html", active: true, current: true, owner: "claude-code #4412" },
        { id: 13, tab: "T4", title: "Export", url: "http://localhost:8080/export", active: false, owner: "export-grades.ts" },
      ],
    }));
    const res = await tools(f.bridge).run("browser_list_tabs");
    expect(textOf(res)).toBe(
      [
        "T1  Inbox — https://mail.test/",
        "T3* [claude-code #4412] Playground — http://localhost:8080/e2e-playground.html",
        "T4  [export-grades.ts] Export — http://localhost:8080/export",
      ].join("\n"),
    );
    expect(f.calls).toEqual([["listTabs", undefined]]); // free: no claim
  });

  it("browser_select_tab sends tabs.claim {tab} — never selectTab or focusTab — and moves the cursor", async () => {
    const f = fakeBridge(async (m, p) => (m === "tabs.claim" ? { tab: p?.tab } : { ok: true }));
    const t = tools(f.bridge);
    const res = await t.run("browser_select_tab", { tab: "T5" });
    expect(textOf(res)).toBe("Selected tab T5 (now this session's tab; not brought on screen — browser_focus_tab shows it)");
    await t.run("browser_click", { ref: "e1" });
    expect(f.calls).toEqual([
      ["tabs.claim", { tab: "T5" }],
      ["click", { ref: "e1", trusted: false, tab: "T5" }],
    ]);
    expect(f.calls.some(([m]) => m === "selectTab" || m === "focusTab")).toBe(false);
  });

  it("browser_select_tab of a tab held by another actor fails with the owner's name and keeps the cursor", async () => {
    const f = fakeBridge(async (m) => {
      if (m === "tabs.claim") throw heldError;
      return { ok: true };
    });
    const t = tools(f.bridge);
    await t.run("browser_click", { ref: "e1" }); // cursor T1
    await expect(t.run("browser_select_tab", { tab: "T7" })).rejects.toThrow('held by "claude-code #4412"');
    await t.run("browser_click", { ref: "e2" });
    expect(f.work().filter(([m]) => m === "click").map(([, p]) => p?.tab)).toEqual(["T1", "T1"]);
  });

  it("browser_select_tab and browser_close_tab without `tab` return a tool error and call nothing", async () => {
    const f = fakeBridge();
    const t = tools(f.bridge);
    const sel = await t.run("browser_select_tab", {});
    expect(sel.isError).toBe(true);
    expect(textOf(sel)).toBe("browser_select_tab needs tab: a handle from browser_list_tabs");
    const close = await t.run("browser_close_tab", {});
    expect(close.isError).toBe(true);
    expect(textOf(close)).toBe("browser_close_tab needs tab: a handle from browser_list_tabs");
    expect(f.calls).toEqual([]);
  });

  it("browser_close_tab sends closeTab {tab} and leaves the cursor alone", async () => {
    const f = fakeBridge();
    const t = tools(f.bridge);
    await t.run("browser_click", { ref: "e1" }); // cursor T1
    expect(textOf(await t.run("browser_close_tab", { tab: "T1" }))).toBe("Closed tab T1");
    await t.run("browser_click", { ref: "e2" });
    expect(f.work()).toEqual([
      ["click", { ref: "e1", trusted: false, tab: "T1" }],
      ["closeTab", { tab: "T1" }],
      ["click", { ref: "e2", trusted: false, tab: "T1" }],
    ]);
    expect(f.claims()).toBe(1);
  });

  it("browser_focus_tab sends focusTab on the cursor (claimed on first touch) or on `tab`", async () => {
    const f = fakeBridge();
    const t = tools(f.bridge);
    expect(textOf(await t.run("browser_focus_tab", {}))).toBe("Focused tab T1");
    expect(textOf(await t.run("browser_focus_tab", { tab: "T8" }))).toBe("Focused tab T8");
    await t.run("browser_click", { ref: "e1" });
    expect(f.calls).toEqual([
      ["tabs.claim", { active: true }],
      ["focusTab", { tab: "T1" }],
      ["focusTab", { tab: "T8" }],
      ["click", { ref: "e1", trusted: false, tab: "T1" }], // focusing T8 did not move the cursor
    ]);
  });

  // Step 8 S5 (phase doc 0.6): these two replaced "sends newTab {url, active:true}" and "without a url
  // still passes active:true" — with no cursor yet the new tab now opens in the background (F26).
  it("browser_new_tab with no cursor yet opens in the background (no listTabs) and the new tab becomes this session's tab", async () => {
    const f = fakeBridge(async (m) => (m === "newTab" ? { id: 412, tab: "T5" } : { ok: true }));
    const t = tools(f.bridge);
    const res = await t.run("browser_new_tab", { url: "http://localhost:8080/e2e-playground.html" });
    expect(textOf(res)).toBe("Opened tab T5 (in the background — browser_focus_tab shows it)");
    await t.run("browser_click", { ref: "e1" });
    expect(f.calls).toEqual([
      ["newTab", { url: "http://localhost:8080/e2e-playground.html", active: false }],
      ["click", { ref: "e1", trusted: false, tab: "T5" }],
    ]);
  });

  it("browser_new_tab without a url and no cursor passes active:false", async () => {
    const f = fakeBridge(async () => ({ id: 412, tab: "T5" }));
    await tools(f.bridge).run("browser_new_tab", {});
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0][0]).toBe("newTab");
    expect(f.calls[0][1]).toMatchObject({ active: false });
  });
});

describe("wait tool", () => {
  it("browser_wait_for forwards text to waitFor", async () => {
    const f = fakeBridge();
    await tools(f.bridge).run("browser_wait_for", { text: "Welcome" });
    expect(f.work()).toEqual([["waitFor", { text: "Welcome", tab: "T1" }]]);
  });

  it("browser_wait_for forwards seconds unchanged", async () => {
    const f = fakeBridge();
    const res = await tools(f.bridge).run("browser_wait_for", { seconds: 2 });
    expect(f.work()).toEqual([["waitFor", { seconds: 2, tab: "T1" }]]);
    expect(textOf(res)).toBe("Waited 2s");
  });

  it("browser_wait_for forwards networkIdle + idleMs", async () => {
    const f = fakeBridge(async () => ({ ok: true, idleAfterMs: 812 }));
    const res = await tools(f.bridge).run("browser_wait_for", { networkIdle: true, idleMs: 800 });
    expect(f.work()).toEqual([["waitFor", { networkIdle: true, idleMs: 800, tab: "T1" }]]);
    expect(textOf(res)).toBe("Network idle for 800ms");
  });

  it("browser_wait_for networkIdle reports the default idleMs", async () => {
    const res = await tools(fakeBridge().bridge).run("browser_wait_for", { networkIdle: true });
    expect(textOf(res)).toBe("Network idle for 500ms");
  });

  it("browser_wait_for accepts the networkIdle schema and rejects a bad idleMs", () => {
    const shape = tools(fakeBridge().bridge).registered["browser_wait_for"].inputSchema!.shape;
    expect(shape.networkIdle.safeParse(true).success).toBe(true);
    expect(shape.idleMs.safeParse(800).success).toBe(true);
    expect(shape.idleMs.safeParse(50).success).toBe(false);
    expect(shape.idleMs.safeParse(20000).success).toBe(false);
    expect(shape.idleMs.safeParse(undefined).success).toBe(true);
  });
});

describe("browser_status", () => {
  const daemonStatus = (extensionConnected: boolean) => ({
    build: "abc123def456",
    uptime: 42_400,
    extensionConnected,
    clients: [
      { id: "c1", name: "claude-code #4242", since: 1 },
      { id: "c2", name: "export-grades.ts", since: 2 },
    ],
    port: 9234,
  });

  it("reports the stored reason without calling anything when there is no daemon", async () => {
    const bridge = {
      hasClient: false,
      reason: "a pre-Step-6 bridge server holds port 9234 — end the old session",
      call: vi.fn(async () => ({})),
      status: vi.fn(async () => ({})),
    };
    const res = await tools(bridge).run("browser_status");
    expect(textOf(res)).toBe(
      "Daemon: not connected\nProblem: a pre-Step-6 bridge server holds port 9234 — end the old session",
    );
    expect(bridge.call).not.toHaveBeenCalled();
    expect(bridge.status).not.toHaveBeenCalled();
  });

  it("reports the daemon, its clients by name, and the extension not connected", async () => {
    const f = fakeBridge(async () => ({ tabs: [] }), async () => daemonStatus(false));
    const res = await tools(f.bridge).run("browser_status");
    expect(textOf(res)).toBe(
      [
        "Daemon: connected on 127.0.0.1:9234 (build abc123def456, up 42s)",
        "Clients (2): claude-code #4242, export-grades.ts",
        "Extension: not connected — is Chrome open with the Browser Agent Bridge extension enabled and its token/port set?",
      ].join("\n"),
    );
    expect(f.bridge.call).not.toHaveBeenCalled();
  });

  it("includes the client names and the human's tab (`current`) by handle when connected", async () => {
    const f = fakeBridge(
      async (m) => {
        expect(m).toBe("listTabs");
        return {
          tabs: [
            // active in its own window, but not the human's tab: must not be named (#43)
            { id: 1, tab: "T1", title: "Other", url: "https://other.test/", active: true },
            { id: 7, tab: "T3", title: "Playground", url: "http://localhost:8080/e2e-playground.html", active: true, current: true },
          ],
        };
      },
      async () => daemonStatus(true),
    );
    const out = textOf(await tools(f.bridge).run("browser_status"));
    expect(out).toMatch(/Clients \(2\): claude-code #4242, export-grades\.ts/);
    expect(out).toMatch(/extension: connected/i);
    // Step 8 S5: the `Active tab:` line is unchanged; a `Cursor:` line now follows it (was `.at(-1)`).
    expect(out.split("\n")).toContain("Active tab: [T3] Playground — http://localhost:8080/e2e-playground.html");
    expect(out.split("\n").at(-1)).toBe("Cursor: none yet — the first tab tool claims the human's active tab");
    expect(f.claims()).toBe(0); // status claims nothing
  });
});

describe("browser_evaluate", () => {
  function evalTool(handler: Handler) {
    const f = fakeBridge(handler);
    const calls: Array<[string, unknown, unknown]> = [];
    f.bridge.call.mockImplementation(async (m: string, p?: Params, o?: { timeoutMs?: number }) => {
      if (m === "tabs.claim") return { tab: "T1" };
      calls.push([m, p, o]);
      return handler(m, p, o);
    });
    return { run: (args: Params) => tools(f.bridge).run("browser_evaluate", args), calls };
  }

  it("sends the default timeout and returns the description as text", async () => {
    const t = evalTool(async () => ({ kind: "json", value: 2, description: "2", truncated: false }));
    const res = await t.run({ expression: "1+1" });
    expect(t.calls).toEqual([["evaluate", { expression: "1+1", timeoutMs: 10_000, tab: "T1" }, { timeoutMs: 15_000 }]]);
    expect(textOf(res)).toBe("2");
  });

  it("gives the server 5s more than the page timeout", async () => {
    const t = evalTool(async () => ({ kind: "undefined", description: "undefined", truncated: false }));
    await t.run({ expression: "x", timeoutMs: 30_000 });
    expect(t.calls).toEqual([["evaluate", { expression: "x", timeoutMs: 30_000, tab: "T1" }, { timeoutMs: 35_000 }]]);
  });

  it("appends a hint when the output was truncated", async () => {
    const t = evalTool(async () => ({ kind: "json", value: [1], description: "[1]", truncated: true }));
    const out = textOf(await t.run({ expression: "big" }));
    expect(out.startsWith("[1]")).toBe(true);
    expect(out.endsWith("(output truncated — narrow the expression, e.g. pick fields or slice the array)")).toBe(true);
  });

  it("appends a hint for a DOM node result", async () => {
    const t = evalTool(async () => ({ kind: "node", description: "<body>", truncated: false }));
    const out = textOf(await t.run({ expression: "document.body" }));
    expect(out.startsWith("<body>")).toBe(true);
    expect(out.endsWith("(DOM node — use browser_snapshot refs to act on it)")).toBe(true);
  });

  it("propagates a bridge error as a thrown error", async () => {
    const t = evalTool(async () => {
      throw new Error("Error: boom\n    at <anonymous>:1:5");
    });
    await expect(t.run({ expression: "throw new Error('boom')" })).rejects.toThrow(/Error: boom/);
  });
});

describe("network tools", () => {
  const T0 = 1_700_000_000_000;
  const entry = (over: Params = {}) => ({
    id: "1042",
    tabId: 412,
    url: "http://localhost:8080/e2e-playground.html",
    method: "GET",
    type: "main_frame",
    startedAt: T0,
    endedAt: T0 + 4,
    durationMs: 4,
    status: 200,
    responseSize: 13_106,
    ...over,
  });

  it("browser_network_requests with no tab queries this session's tab and keeps the 'active tab' label (NET-1)", async () => {
    vi.useFakeTimers({ now: T0 + 1500 });
    try {
      const f = fakeBridge(async () => ({ entries: [entry({ tab: "T1" })], total: 1, pending: 0, recordingSince: T0 - 3_595_000 }));
      const res = await tools(f.bridge).run("browser_network_requests", {});
      expect(f.calls).toEqual([
        ["tabs.claim", { active: true }],
        ["networkRequests", { tab: "T1" }],
      ]);
      expect(textOf(res).split("\n")).toEqual([
        "Network — active tab: showing 1 of 1 (recording since 59m56s ago; 0 pending)",
        "[1042]  1.5s ago   GET     200  document    4ms  12.8 KB  http://localhost:8080/e2e-playground.html",
        "Use filter/types/failedOnly to narrow, limit to widen, id for one request's headers and body.",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('browser_network_requests maps tab:"active" to the cursor like an omitted tab', async () => {
    const f = fakeBridge(async () => ({ entries: [], total: 0, pending: 0, recordingSince: Date.now() }));
    const res = await tools(f.bridge).run("browser_network_requests", { tab: "active", limit: 5 });
    expect(f.work()).toEqual([["networkRequests", { tab: "T1", limit: 5 }]]);
    expect(textOf(res)).toMatch(/^No requests recorded for active tab /);
  });

  it('browser_network_requests passes "all" and a handle through, labelled as asked, the all-scope column by handle', async () => {
    const f = fakeBridge(async (_m, p) =>
      p?.tab === "all"
        ? { entries: [entry({ tab: "T3" }), entry({ id: "7", tabId: -1 })], total: 2, pending: 0, recordingSince: Date.now() }
        : { entries: [entry({ tab: "T3" })], total: 1, pending: 0, recordingSince: Date.now() },
    );
    const t = tools(f.bridge);
    const all = textOf(await t.run("browser_network_requests", { tab: "all", filter: "/api/", types: ["xhr"], failedOnly: true, limit: 10, includeHeaders: true }));
    const one = textOf(await t.run("browser_network_requests", { tab: "T3" }));
    expect(f.calls).toEqual([
      ["networkRequests", { tab: "all", filter: "/api/", types: ["xhr"], failedOnly: true, limit: 10, includeHeaders: true }],
      ["networkRequests", { tab: "T3" }],
    ]);
    expect(all.split("\n")[0]).toMatch(/^Network — all tabs: showing 2 of 2 /);
    expect(all).toContain("tab:T3 ");
    expect(all).toContain("tab:-1");
    expect(all).not.toContain("tab:412");
    expect(one.split("\n")[0]).toMatch(/^Network — tab T3: showing 1 of 1 /);
  });

  it("browser_network_requests passes an id lookup through without claiming, rendered with formatEntry", async () => {
    const f = fakeBridge(async () => ({ entries: [entry({ id: "1043", type: "xmlhttprequest" })], total: 1, pending: 0, recordingSince: 1 }));
    const res = await tools(f.bridge).run("browser_network_requests", { id: "1043" });
    expect(f.calls).toEqual([["networkRequests", { id: "1043" }]]);
    expect(textOf(res).split("\n")[0]).toBe("[1043] GET http://localhost:8080/e2e-playground.html");
  });

  it("browser_network_requests propagates a bridge error", async () => {
    const f = fakeBridge(async () => {
      throw new Error("Invalid regex filter: /(/ — Unterminated group");
    });
    await expect(tools(f.bridge).run("browser_network_requests", { filter: "/(/" })).rejects.toThrow(/Invalid regex filter/);
  });

  it("browser_network_clear clears this session's tab and reports the count", async () => {
    const f = fakeBridge(async () => ({ cleared: 7 }));
    const res = await tools(f.bridge).run("browser_network_clear", {});
    expect(f.calls).toEqual([
      ["tabs.claim", { active: true }],
      ["networkClear", { tab: "T1" }],
    ]);
    expect(textOf(res)).toBe("Cleared 7 requests.");
  });

  it('browser_network_clear passes "all" and a handle through, and maps "active" to the cursor', async () => {
    const f = fakeBridge(async () => ({ cleared: 0 }));
    const t = tools(f.bridge);
    await t.run("browser_network_clear", { tab: "all" });
    await t.run("browser_network_clear", { tab: "T4" });
    await t.run("browser_network_clear", { tab: "active" });
    expect(f.calls).toEqual([
      ["networkClear", { tab: "all" }],
      ["networkClear", { tab: "T4" }],
      ["tabs.claim", { active: true }],
      ["networkClear", { tab: "T1" }],
    ]);
  });

  it("browser_network_clear's TAB_HELD for the all scope names the owner", async () => {
    const f = fakeBridge(async () => {
      throw heldError;
    });
    await expect(tools(f.bridge).run("browser_network_clear", { tab: "all" })).rejects.toThrow("claude-code #4412");
  });
});

describe("no daemon (connect() failing)", () => {
  const REASON = "Extension not connected — is Chrome open and the Browser Agent Bridge extension enabled? (waited 15000 ms on port 9234)";

  /** Minimal valid arguments for every tool except browser_status. */
  const ARGS: Record<string, Params> = {
    browser_navigate: { url: "https://example.com" },
    browser_snapshot: {},
    browser_screenshot: {},
    browser_click: { ref: "e1" },
    browser_type: { ref: "e1", text: "hi" },
    browser_press_key: { key: "Enter" },
    browser_scroll: {},
    browser_hover: { ref: "e1" },
    browser_select_option: { ref: "e1", values: ["a"] },
    browser_back: {},
    browser_forward: {},
    browser_list_tabs: {},
    browser_select_tab: { tab: "T1" },
    browser_focus_tab: {},
    browser_new_tab: {},
    browser_close_tab: { tab: "T1" },
    browser_wait_for: { seconds: 1 },
    browser_evaluate: { expression: "1" },
    browser_download: { url: "https://example.com/f.pdf", path: "/nonexistent-dir-for-test/f.pdf" },
    browser_network_requests: {},
    browser_network_clear: {},
    browser_use_active_tab: {},
    // Step 11 S4 (#241): a real file (this test file), so the preflight passes and the call reaches the link.
    browser_upload_file: { ref: "e1", paths: [fileURLToPath(import.meta.url)] },
    browser_console_messages: {},
  };

  async function linkWithFailingConnect() {
    const connect = vi.fn(async () => {
      throw new BridgeError(ErrorCodes.NOT_CONNECTED, REASON);
    });
    const link = new BridgeLink({
      connect,
      timers: { setTimeout: () => 0, clearTimeout: () => {} },
    });
    link.start();
    await new Promise<void>((r) => setImmediate(r));
    return { link, connect };
  }

  // Amended 2026-10-25 (Step 11 S4, #241): 24 tools.
  // Amended 2026-10-27 (Step 12 S3b): 25 tools.
  it("registers all 25 tools and a tool call carries the stored reason", async () => {
    const { link, connect } = await linkWithFailingConnect();
    const t = tools(link);
    expect(Object.keys(t.registered)).toHaveLength(25);
    expect(connect).toHaveBeenCalledTimes(1);
    await expect(t.run("browser_snapshot")).rejects.toThrow(REASON);
    expect(textOf(await t.run("browser_status"))).toBe(`Daemon: not connected\nProblem: ${REASON}`);
  });

  it("every tool except browser_status surfaces the stored reason", async () => {
    const { link } = await linkWithFailingConnect();
    const t = tools(link);
    const names = Object.keys(t.registered).filter((n) => n !== "browser_status");
    expect(names.sort()).toEqual(Object.keys(ARGS).sort());
    for (const name of names) {
      const err = await Promise.resolve(t.run(name, ARGS[name])).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, name).toBeInstanceOf(BridgeError);
      expect((err as BridgeError).message, name).toBe(REASON);
    }
  });
});

// ── Step 8 S5 — the cursor tools, locator input, wait bounds, asRef, failure reports ──────────────

const ME = "claude-code #4242";
const PLAY = "http://localhost:8080/e2e-playground.html";

interface Row {
  tab: string;
  title?: string;
  url?: string;
  current?: boolean;
  owner?: string;
}

/** A `listTabs` answer from rows (ids derived from the handle). */
function listing(rows: Row[]) {
  return {
    tabs: rows.map((r) => ({
      id: Number(r.tab.slice(1)) + 100,
      tab: r.tab,
      title: r.title ?? `Title ${r.tab}`,
      url: r.url ?? PLAY,
      active: r.current === true,
      ...(r.current ? { current: true } : {}),
      ...(r.owner ? { owner: r.owner } : {}),
    })),
  };
}

const connectedStatus = async () => ({
  build: "b",
  uptime: 1000,
  extensionConnected: true,
  clients: [{ id: "c1", name: ME, since: 1 }],
  port: 9234,
});

describe("S5 — the cursor does not follow the human; browser_use_active_tab moves it", () => {
  it("the cursor stays when listTabs (and the claim) move the human's active tab; only browser_use_active_tab moves it", async () => {
    let rows: Row[] = [{ tab: "T1", current: true, owner: ME }, { tab: "T7" }];
    const f = fakeBridge(async (m) => (m === "listTabs" ? listing(rows) : { ok: true }), connectedStatus);
    const t = tools(f.bridge, undefined, { actorName: ME });
    await t.run("browser_click", { ref: "e1" }); // first touch → T1
    // The human switches to T7: listTabs says so and a fresh claim would say so.
    rows = [{ tab: "T1", owner: ME }, { tab: "T7", current: true }];
    f.setHuman("T7");
    await t.run("browser_status");
    await t.run("browser_list_tabs");
    await t.run("browser_click", { ref: "e2" });
    expect(f.work().filter(([m]) => m === "click").map(([, p]) => p?.tab)).toEqual(["T1", "T1"]);
    expect(f.claims()).toBe(1);

    const res = await t.run("browser_use_active_tab", {});
    expect(textOf(res)).toBe("Now using T7 (the human's active tab) as this session's tab");
    await t.run("browser_click", { ref: "e3" });
    expect(f.work().filter(([m]) => m === "click").map(([, p]) => p?.tab)).toEqual(["T1", "T1", "T7"]);
    expect(f.claims()).toBe(2);
  });

  it("browser_use_active_tab sends exactly tabs.claim {active:true} and takes no arguments", async () => {
    const f = fakeBridge();
    const { registered, run } = tools(f.bridge);
    expect(Object.keys(registered["browser_use_active_tab"].inputSchema?.shape ?? {})).toEqual([]);
    await run("browser_use_active_tab", {});
    expect(f.calls).toEqual([["tabs.claim", { active: true }]]);
  });

  it("browser_use_active_tab's TAB_HELD propagates and leaves the cursor where it was", async () => {
    let refuse = false;
    const f = fakeBridge();
    const inner = f.bridge.call.getMockImplementation()!;
    f.bridge.call.mockImplementation(async (m: string, p?: Params, o?: { timeoutMs?: number }) => {
      if (refuse && m === "tabs.claim") throw heldError;
      return inner(m, p, o);
    });
    const t = tools(f.bridge);
    await t.run("browser_click", { ref: "e1" }); // T1
    refuse = true;
    await expect(t.run("browser_use_active_tab", {})).rejects.toThrow('held by "claude-code #4412"');
    await t.run("browser_click", { ref: "e2" });
    expect(f.calls.filter(([m]) => m === "click").map(([, p]) => p?.tab)).toEqual(["T1", "T1"]);
  });

  it("browser_use_active_tab clears a pending lost-cursor notice (it is a mover, like select_tab)", async () => {
    const f = fakeBridge();
    const cursor = new TabCursor(f.bridge);
    const t = tools(f.bridge, cursor);
    await t.run("browser_click", { ref: "e1" });
    cursor.markLost();
    f.setHuman("T4");
    await t.run("browser_use_active_tab", {});
    expect(cursor.tab).toBe("T4");
    expect(textOf(await t.run("browser_click", { ref: "e2" }))).toBe("Clicked e2");
  });
});

describe("S5 — browser_status's Cursor and Human's active tab lines", () => {
  async function status(rows: Row[], before?: (t: ReturnType<typeof tools>) => Promise<void>, human = "T1") {
    const f = fakeBridge(async (m) => (m === "listTabs" ? listing(rows) : { ok: true }), connectedStatus);
    f.setHuman(human);
    const t = tools(f.bridge, undefined, { actorName: ME });
    if (before) await before(t);
    const lines = textOf(await t.run("browser_status")).split("\n");
    return { lines, f };
  }
  const touch = (t: ReturnType<typeof tools>) => t.run("browser_click", { ref: "e1" }).then(() => {});

  it("no cursor: `Cursor: none yet …`, no Human's line, and status claims nothing", async () => {
    const { lines, f } = await status([{ tab: "T1", title: "Play", current: true }]);
    expect(lines.slice(3)).toEqual([
      `Active tab: [T1] Play — ${PLAY}`,
      "Cursor: none yet — the first tab tool claims the human's active tab",
    ]);
    expect(f.claims()).toBe(0);
  });

  it("cursor on the human's tab, held by me: Cursor line, no Human's line", async () => {
    const { lines } = await status([{ tab: "T1", title: "Play", current: true, owner: ME }], touch);
    expect(lines.slice(3)).toEqual([`Active tab: [T1] Play — ${PLAY}`, `Cursor: T1 "Play" — ${PLAY} (held by me)`]);
  });

  it("the human moved to another tab: the Human's active tab line appears, Active tab is unchanged", async () => {
    const { lines } = await status(
      [{ tab: "T3", title: "Play", owner: ME }, { tab: "T7", title: "Gmail", url: "https://mail.test/", current: true }],
      touch,
      "T3",
    );
    expect(lines.slice(3)).toEqual([
      "Active tab: [T7] Gmail — https://mail.test/",
      `Cursor: T3 "Play" — ${PLAY} (held by me)`,
      `Human's active tab: T7 "Gmail" — not mine; call browser_use_active_tab to work there`,
    ]);
  });

  it("the human's tab held by another actor says so; the cursor's tab held by another says so", async () => {
    const { lines } = await status(
      [{ tab: "T3", title: "Play", owner: "export.ts" }, { tab: "T7", title: "Gmail", current: true, owner: "claude-code #9" }],
      touch,
      "T3",
    );
    expect(lines.slice(4)).toEqual([
      `Cursor: T3 "Play" — ${PLAY} (held by export.ts)`,
      `Human's active tab: T7 "Gmail" — held by claude-code #9, not mine`,
    ]);
  });

  it("an unheld cursor tab says (not held); a closed one says (not open any more)", async () => {
    const a = await status([{ tab: "T1", title: "Play", current: true }], touch);
    expect(a.lines.at(-1)).toBe(`Cursor: T1 "Play" — ${PLAY} (not held)`);
    const b = await status([{ tab: "T2", title: "Other", current: true }], touch);
    expect(b.lines.slice(4)).toEqual([
      "Cursor: T1 (not open any more)",
      `Human's active tab: T2 "Other" — not mine; call browser_use_active_tab to work there`,
    ]);
  });

  it("no human tab: no Human's line", async () => {
    const { lines } = await status([{ tab: "T1", title: "Play", owner: ME }], touch);
    expect(lines.slice(3)).toEqual(["Active tab: none", `Cursor: T1 "Play" — ${PLAY} (held by me)`]);
  });
});

describe("S5 — browser_new_tab's activation rule (0.6)", () => {
  function newTabBridge(rows: () => Row[] | Error) {
    return fakeBridge(async (m) => {
      if (m === "listTabs") {
        const r = rows();
        if (r instanceof Error) throw r;
        return listing(r);
      }
      if (m === "newTab") return { id: 905, tab: "T5" };
      return { ok: true };
    });
  }

  it("active:true when the cursor's tab is the human's active tab; the result text is unchanged", async () => {
    const f = newTabBridge(() => [{ tab: "T1", current: true, owner: ME }]);
    const t = tools(f.bridge);
    await t.run("browser_click", { ref: "e1" }); // cursor T1
    const res = await t.run("browser_new_tab", { url: PLAY });
    expect(textOf(res)).toBe("Opened tab T5");
    expect(f.work()).toEqual([
      ["click", { ref: "e1", trusted: false, tab: "T1" }],
      ["listTabs", undefined],
      ["newTab", { url: PLAY, active: true }],
    ]);
    await t.run("browser_click", { ref: "e2" });
    expect(f.work().at(-1)).toEqual(["click", { ref: "e2", trusted: false, tab: "T5" }]);
  });

  it("active:false when the human looks at another tab; it still moves the cursor", async () => {
    const f = newTabBridge(() => [{ tab: "T1", owner: ME }, { tab: "T7", current: true }]);
    const t = tools(f.bridge);
    await t.run("browser_click", { ref: "e1" });
    const res = await t.run("browser_new_tab", { url: PLAY });
    expect(textOf(res)).toBe("Opened tab T5 (in the background — browser_focus_tab shows it)");
    expect(f.work().find(([m]) => m === "newTab")).toEqual(["newTab", { url: PLAY, active: false }]);
    await t.run("browser_click", { ref: "e2" });
    expect(f.work().at(-1)).toEqual(["click", { ref: "e2", trusted: false, tab: "T5" }]);
    expect(f.calls.some(([m]) => m === "focusTab")).toBe(false);
  });

  it("active:false when listTabs fails (the human's view is not changed on doubt)", async () => {
    const f = newTabBridge(() => new Error("listTabs down"));
    const t = tools(f.bridge);
    await t.run("browser_click", { ref: "e1" });
    const res = await t.run("browser_new_tab", {});
    expect(textOf(res)).toBe("Opened tab T5 (in the background — browser_focus_tab shows it)");
    expect(f.work().find(([m]) => m === "newTab")![1]).toMatchObject({ active: false });
  });

  it("active:false after the cursor was lost to a daemon restart (no listTabs needed)", async () => {
    const f = newTabBridge(() => [{ tab: "T1", current: true }]);
    const cursor = new TabCursor(f.bridge);
    const t = tools(f.bridge, cursor);
    await t.run("browser_click", { ref: "e1" });
    cursor.markLost();
    await t.run("browser_new_tab", {});
    expect(f.work().filter(([m]) => m === "listTabs")).toEqual([]);
    expect(f.work().find(([m]) => m === "newTab")![1]).toMatchObject({ active: false });
  });
});

describe("S5 — locator input on the actions", () => {
  it("browser_click with a locator sends {locator} and no ref key, and describes the locator", async () => {
    const f = fakeBridge();
    const res = await tools(f.bridge).run("browser_click", { locator: { role: "button", name: "Sign in" } });
    expect(f.work()).toEqual([["click", { locator: { role: "button", name: "Sign in" }, trusted: false, tab: "T1" }]]);
    expect("ref" in (f.work()[0][1] as Params)).toBe(false);
    expect(textOf(res)).toBe('Clicked button "Sign in"');
  });

  it("with a ref the params have no locator key and today's text", async () => {
    const f = fakeBridge();
    const res = await tools(f.bridge).run("browser_click", { ref: "e5" });
    expect("locator" in (f.work()[0][1] as Params)).toBe(false);
    expect(textOf(res)).toBe("Clicked e5");
  });

  it("type, hover, select_option and scroll take a locator; texts describe it (text, css, #nth)", async () => {
    const f = fakeBridge();
    const t = tools(f.bridge);
    expect(textOf(await t.run("browser_type", { locator: { role: "textbox", name: "Email" }, text: "x@y.com" }))).toBe(
      'Typed into textbox "Email"',
    );
    expect(textOf(await t.run("browser_hover", { locator: { text: "Menu", nth: 1 } }))).toBe('Hovered text "Menu" #1');
    expect(textOf(await t.run("browser_select_option", { locator: { css: "#size" }, values: ["L"] }))).toBe(
      "Selected L in css #size",
    );
    expect(textOf(await t.run("browser_scroll", { locator: { role: "heading" } }))).toBe("Scrolled to heading");
    expect(f.work()).toEqual([
      ["type", { locator: { role: "textbox", name: "Email" }, text: "x@y.com", submit: false, trusted: false, tab: "T1" }],
      ["hover", { locator: { text: "Menu", nth: 1 }, tab: "T1" }],
      ["selectOption", { locator: { css: "#size" }, values: ["L"], tab: "T1" }],
      ["scroll", { locator: { role: "heading" }, direction: "down", tab: "T1" }],
    ]);
  });

  it("both ref and locator, or neither, is a tool error naming both fields, with no call (not even a claim)", async () => {
    const f = fakeBridge();
    const t = tools(f.bridge);
    for (const name of ["browser_click", "browser_hover"]) {
      const both = await t.run(name, { ref: "e1", locator: { text: "Go" } });
      expect(both.isError, name).toBe(true);
      expect(textOf(both)).toBe(`${name} takes ref or locator, not both`);
      const neither = await t.run(name, {});
      expect(neither.isError, name).toBe(true);
      expect(textOf(neither)).toBe(`${name} needs ref (from browser_snapshot) or locator`);
    }
    const both = await t.run("browser_type", { ref: "e1", locator: { text: "Go" }, text: "hi" });
    expect(both.isError).toBe(true);
    const sel = await t.run("browser_select_option", { values: ["a"] });
    expect(sel.isError).toBe(true);
    const scroll = await t.run("browser_scroll", { ref: "e1", locator: { text: "Go" } });
    expect(scroll.isError).toBe(true);
    expect(f.calls).toEqual([]);
  });

  it("a malformed locator is a tool error with the SDK's friendly text, no call", async () => {
    const f = fakeBridge();
    const t = tools(f.bridge);
    const nameOnly = await t.run("browser_click", { locator: { name: "Sign in" } });
    expect(nameOnly.isError).toBe(true);
    expect(textOf(nameOnly)).toBe(
      'browser_click locator: a locator with "name" needs "role" — use {text} or add role (e.g. {role: "button", name: …})',
    );
    const two = await t.run("browser_click", { locator: { text: "a", css: "b" } });
    expect(textOf(two)).toBe(
      "browser_click locator: not a locator — use one of {role, name?}, {text} or {css} (each may add nth; role and text may add exact)",
    );
    const negative = await t.run("browser_click", { locator: { css: "b", nth: -1 } });
    expect(negative.isError).toBe(true);
    expect(f.calls).toEqual([]);
  });

  it("the locator schema accepts the shapes and rejects a negative or fractional nth", () => {
    const shape = tools(fakeBridge().bridge).registered["browser_click"].inputSchema!.shape;
    expect(shape.ref.safeParse(undefined).success).toBe(true);
    expect(shape.locator.safeParse({ role: "button", name: "Go", exact: true, nth: 0 }).success).toBe(true);
    expect(shape.locator.safeParse({ css: "#a", nth: -1 }).success).toBe(false);
    expect(shape.locator.safeParse({ css: "#a", nth: 1.5 }).success).toBe(false);
    expect(shape.locator.safeParse(undefined).success).toBe(true);
  });

  it("browser_scroll with neither ref nor locator still scrolls the page", async () => {
    const f = fakeBridge();
    expect(textOf(await tools(f.bridge).run("browser_scroll", { direction: "up" }))).toBe("Scrolled");
    expect(f.work()).toEqual([["scroll", { direction: "up", tab: "T1" }]]);
  });

  it("an explicit tab with a locator acts there and does not move the cursor", async () => {
    const f = fakeBridge();
    const t = tools(f.bridge);
    await t.run("browser_click", { ref: "e1" }); // T1
    await t.run("browser_click", { locator: { text: "Go" }, tab: "T9" });
    await t.run("browser_click", { ref: "e2" });
    expect(f.work().map(([, p]) => p?.tab)).toEqual(["T1", "T9", "T1"]);
    expect(f.work()[1][1]).toEqual({ locator: { text: "Go" }, trusted: false, tab: "T9" });
    expect(f.claims()).toBe(1);
  });

  it("browser_press_key keeps its schema: no ref, no locator", () => {
    const shape = tools(fakeBridge().bridge).registered["browser_press_key"].inputSchema!.shape;
    expect(Object.keys(shape).sort()).toEqual(["key", "tab", "trusted"]);
  });
});

describe("S5 — browser_wait_for: locator, state, and the call's own bound", () => {
  function waitBridge() {
    const f = fakeBridge();
    const opts: Array<{ timeoutMs?: number } | undefined> = [];
    const inner = f.bridge.call.getMockImplementation()!;
    f.bridge.call.mockImplementation(async (m: string, p?: Params, o?: { timeoutMs?: number }) => {
      if (m === "waitFor") opts.push(o);
      return inner(m, p, o);
    });
    return { f, opts };
  }

  it("a locator wait sends waitFor {locator, state, tab} and nothing else, with timeoutMs 15000", async () => {
    const { f, opts } = waitBridge();
    const t = tools(f.bridge);
    const res = await t.run("browser_wait_for", { locator: { text: "Loading" }, state: "hidden" });
    expect(textOf(res)).toBe('Waited for text "Loading" to be hidden');
    const res2 = await t.run("browser_wait_for", { locator: { role: "button", name: "Go" } });
    expect(textOf(res2)).toBe('Waited for button "Go" to be visible');
    expect(f.work()).toEqual([
      ["waitFor", { locator: { text: "Loading" }, state: "hidden", tab: "T1" }],
      ["waitFor", { locator: { role: "button", name: "Go" }, state: "visible", tab: "T1" }],
    ]);
    expect(Object.keys(f.work()[0][1]!).sort()).toEqual(["locator", "state", "tab"]);
    expect(opts).toEqual([{ timeoutMs: 15_000 }, { timeoutMs: 15_000 }]);
  });

  it("each wait kind gets its own call bound: seconds s*1000+5000, text and networkIdle 15000", async () => {
    const { f, opts } = waitBridge();
    const t = tools(f.bridge);
    await t.run("browser_wait_for", { seconds: 60 });
    await t.run("browser_wait_for", { seconds: 2 });
    await t.run("browser_wait_for", { text: "Welcome" });
    await t.run("browser_wait_for", { networkIdle: true });
    expect(opts).toEqual([{ timeoutMs: 65_000 }, { timeoutMs: 7_000 }, { timeoutMs: 15_000 }, { timeoutMs: 15_000 }]);
  });

  it("locator with text/seconds/networkIdle, or state without locator, is a tool error with no call", async () => {
    const { f } = waitBridge();
    const t = tools(f.bridge);
    for (const extra of [{ text: "a" }, { seconds: 1 }, { networkIdle: true }, { idleMs: 800 }]) {
      const r = await t.run("browser_wait_for", { locator: { text: "Go" }, ...extra });
      expect(r.isError, JSON.stringify(extra)).toBe(true);
      expect(textOf(r)).toBe("browser_wait_for: locator waits alone — drop text, seconds, networkIdle and idleMs");
    }
    const r = await t.run("browser_wait_for", { state: "hidden", text: "x" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("browser_wait_for: state is only used with locator");
    const bad = await t.run("browser_wait_for", { locator: { name: "Go" } });
    expect(bad.isError).toBe(true);
    expect(f.calls).toEqual([]);
  });
});

describe("S5 — browser_evaluate {asRef}", () => {
  it("with asRef the call carries asRef:true and the ref comes back as a line", async () => {
    const f = fakeBridge(async () => ({ kind: "node", description: "<button>", truncated: false, ref: "e12" }));
    const res = await tools(f.bridge).run("browser_evaluate", { expression: "document.querySelector('button')", asRef: true });
    expect(f.work()).toEqual([
      ["evaluate", { expression: "document.querySelector('button')", timeoutMs: 10_000, asRef: true, tab: "T1" }],
    ]);
    expect(textOf(res).split("\n")).toEqual([
      "<button>",
      "[ref=e12] — pass it as ref to browser_click etc.",
      "(DOM node — use browser_snapshot refs to act on it)",
    ]);
  });

  it("with asRef and a non-element result: a note, not an error", async () => {
    const f = fakeBridge(async () => ({ kind: "json", value: 2, description: "2", truncated: false }));
    const res = await tools(f.bridge).run("browser_evaluate", { expression: "1+1", asRef: true });
    expect(res.isError).toBeUndefined();
    expect(textOf(res)).toBe("2\n(no ref: the result is not an element)");
  });

  it("without asRef (or asRef:false) the params carry no asRef key", async () => {
    const f = fakeBridge(async () => ({ kind: "json", value: 2, description: "2", truncated: false }));
    await tools(f.bridge).run("browser_evaluate", { expression: "1+1" });
    await tools(f.bridge).run("browser_evaluate", { expression: "1+1", asRef: false });
    const evals = f.work().filter(([m]) => m === "evaluate");
    expect(evals).toHaveLength(2);
    for (const [, p] of evals) expect("asRef" in p!).toBe(false);
  });
});

describe("S5 — failure reports: report() text plus an image block for the attach codes", () => {
  const PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "bridge-s5-failures-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const reports = (): RegisterToolsOptions => ({
    failureReports: {
      timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      env: { BRIDGE_FAILURES_DIR: dir },
      homedir: () => path.join(dir, "home-not-used"),
      now: () => Date.UTC(2026, 9, 23, 12, 0, 0),
    },
  });

  /** A bridge where `method` throws `err`, and the attach calls answer. */
  function failing(method: string, err: unknown, screenshot: unknown = { dataUrl: `data:image/png;base64,${PNG_B64}` }) {
    return fakeBridge(async (m) => {
      if (m === method) throw err;
      if (m === "snapshot") return { url: PLAY, title: "Play", elements: [{ ref: "e1", role: "button", name: "Go", depth: 0 }], truncated: false };
      if (m === "screenshot") {
        if (screenshot instanceof Error) throw screenshot;
        return screenshot;
      }
      if (m === "networkRequests") return { entries: [] };
      return { ok: true };
    });
  }

  const notFound = () => new BridgeError(ErrorCodes.LOCATOR_NOT_FOUND, 'no element matches button "Nope"', { candidates: [] });

  it("an attach-eligible error is returned without isError, with report() text and the screenshot as an image", async () => {
    const f = failing("click", notFound());
    const res = await tools(f.bridge, undefined, reports()).run("browser_click", { locator: { role: "button", name: "Nope" } });
    expect("isError" in res).toBe(false); // decision S6b: Claude Code 2.1.309 drops images from isError results (S6b-probe-record.md outcome A)
    expect(res.content).toHaveLength(2);
    expect(res.content[0].type).toBe("text");
    expect(res.content[0].text).toContain("LOCATOR_NOT_FOUND");
    expect(res.content[0].text).toContain('no element matches button "Nope"');
    expect(res.content[1]).toEqual({ type: "image", data: PNG_B64, mimeType: "image/png" });
    expect(f.work().map(([m, p]) => [m, p?.tab])).toEqual([
      ["click", "T1"],
      ["snapshot", "T1"],
      ["screenshot", "T1"],
      ["networkRequests", "T1"],
    ]);
    expect(readdirSync(dir)).toHaveLength(1); // the PNG went to BRIDGE_FAILURES_DIR
  });

  it("an explicit tab attaches on that tab; the lost-cursor notice comes after the report", async () => {
    const f = failing("hover", new BridgeError(ErrorCodes.REF_STALE, "ref e9 is stale — take a new snapshot"));
    const res = await tools(f.bridge, undefined, reports()).run("browser_hover", { ref: "e9", tab: "T4" });
    expect("isError" in res).toBe(false); // decision S6b: Claude Code 2.1.309 drops images from isError results (S6b-probe-record.md outcome A)
    expect(f.work().slice(1).map(([, p]) => p?.tab)).toEqual(["T4", "T4", "T4"]);

    const g = failing("click", notFound());
    const cursor = new TabCursor(g.bridge);
    const t = tools(g.bridge, cursor, reports());
    await t.run("browser_hover", { ref: "e1" }); // cursor T1
    cursor.markLost();
    const res2 = await t.run("browser_click", { ref: "e1" });
    // decision S6b (S6b-probe-record.md outcome A): a report without isError keeps its code line first,
    // so the notice moves to its last line (was: the notice was line 1 of the report's text; S6b verifier F1).
    expect(res2.content[0].text!.split("\n")[0]).toBe('LOCATOR_NOT_FOUND: no element matches button "Nope"');
    expect(res2.content[0].text!.split("\n").at(-1)).toBe(lostNotice("T1"));
    expect(res2.content.map((c) => c.type)).toEqual(["text", "image"]);
  });

  it("no image block when the screenshot could not be taken (the report says why)", async () => {
    const f = failing("click", notFound(), new BridgeError(ErrorCodes.WINDOW_MINIMIZED, "the window is minimized"));
    const res = await tools(f.bridge, undefined, reports()).run("browser_click", { ref: "e1" });
    expect(res.isError).toBe(true);
    expect(res.content.map((c) => c.type)).toEqual(["text"]);
    expect(res.content[0].text).toContain("screenshot: WINDOW_MINIMIZED");
  });

  it("a non-attach code (TAB_HELD) is thrown with today's text, no image, no attach calls", async () => {
    const f = failing("click", heldError);
    await expect(tools(f.bridge, undefined, reports()).run("browser_click", { ref: "e1", tab: "T1" })).rejects.toThrow(
      heldError.message,
    );
    expect(f.work().map(([m]) => m)).toEqual(["click"]);
  });

  it("the MCP's own code gate: a non-attach error that already carries report() is still thrown, not rendered", async () => {
    const held = new BridgeError(ErrorCodes.TAB_HELD, heldError.message, heldError.data);
    held.report = () => "should not be shown";
    const f = failing("click", held);
    await expect(tools(f.bridge, undefined, reports()).run("browser_click", { ref: "e1", tab: "T1" })).rejects.toBe(held);
  });

  it("a plain Error, and an attach code on the 'all' network scope, are rethrown unchanged", async () => {
    const f = failing("click", new Error("boom"));
    await expect(tools(f.bridge, undefined, reports()).run("browser_click", { ref: "e1" })).rejects.toThrow("boom");
    const timeout = new BridgeError(ErrorCodes.TIMEOUT, "networkRequests timed out");
    const g = failing("networkRequests", timeout);
    await expect(tools(g.bridge, undefined, reports()).run("browser_network_requests", { tab: "all" })).rejects.toBe(timeout);
    expect(g.work().map(([m]) => m)).toEqual(["networkRequests"]);
  });

  it("a multi-line message keeps its lines in a Full message block after report(); a short one-line message adds none", async () => {
    const msg = "TypeError: Cannot read properties of null (reading 'x')\n    at <anonymous>:1:15\n    at foo (<anonymous>:3:1)";
    const err = new BridgeError(ErrorCodes.PAGE_ERROR, msg);
    const f = failing("evaluate", err);
    const res = await tools(f.bridge, undefined, reports()).run("browser_evaluate", { expression: "null.x" });
    expect("isError" in res).toBe(false); // decision S6b: Claude Code 2.1.309 drops images from isError results (S6b-probe-record.md outcome A)
    const shown = res.content[0].text!;
    const rendered = err.report!();
    expect(shown.startsWith(rendered)).toBe(true);
    expect(shown).toContain(`\nFull message:\n${msg}`);
    for (const line of msg.split("\n")) expect(shown.split("\n")).toContain(line);

    const g = failing("click", notFound());
    const res2 = await tools(g.bridge, undefined, reports()).run("browser_click", { ref: "e1" });
    expect(res2.content[0].text).not.toContain("Full message:");
  });

  it("an attach code whose attach step left no report() is rethrown unchanged, with no image", async () => {
    const err = notFound();
    const f = failing("click", err);
    const attach = vi.fn(async () => undefined);
    const p = tools(f.bridge, undefined, { ...reports(), attach }).run("browser_click", { ref: "e1" });
    await expect(p).rejects.toBe(err);
    await expect(p).rejects.toThrow('no element matches button "Nope"');
    expect(attach).toHaveBeenCalledTimes(1);
    expect(err.report).toBeUndefined();
    expect(f.work().map(([m]) => m)).toEqual(["click"]);
  });

  it("validation errors never attach", async () => {
    const f = failing("click", notFound());
    const res = await tools(f.bridge, undefined, reports()).run("browser_click", {});
    expect(res.content).toHaveLength(1);
    expect(f.calls).toEqual([]);
  });

  // S6b (S6b-probe-record.md outcome A): Claude Code 2.1.309 drops images from isError results, so a
  // report with a screenshot is a non-error result whose first line states the code and whose last
  // line says the call failed; without a screenshot it stays isError text-only.
  const failedLine = (code: string) =>
    `The call failed (${code}). This result is not flagged as an error only so that the screenshot reaches you (some MCP clients, Claude Code 2.1.309 among them, drop images from error results).`;

  it("S6b: with a screenshot the report is a non-error result — report text plus the failure line, then the image", async () => {
    const err = notFound();
    const f = failing("click", err);
    const res = await tools(f.bridge, undefined, reports()).run("browser_click", { locator: { role: "button", name: "Nope" } });
    expect("isError" in res).toBe(false);
    expect(res).toEqual({
      content: [
        { type: "text", text: `${err.report!()}\n${failedLine("LOCATOR_NOT_FOUND")}` },
        { type: "image", data: PNG_B64, mimeType: "image/png" },
      ],
    });
    expect(res.content[0].text!.split("\n")[0]).toBe('LOCATOR_NOT_FOUND: no element matches button "Nope"');
  });

  it("S6b: a multi-line message keeps Full message, then the failure line last", async () => {
    const msg = "TypeError: boom\n    at <anonymous>:1:15";
    const err = new BridgeError(ErrorCodes.PAGE_ERROR, msg);
    const f = failing("evaluate", err);
    const res = await tools(f.bridge, undefined, reports()).run("browser_evaluate", { expression: "x" });
    expect("isError" in res).toBe(false);
    expect(res.content[0].text).toBe(`${err.report!()}\nFull message:\n${msg}\n${failedLine("PAGE_ERROR")}`);
  });

  it("S6b: without a screenshot the report is still isError, text only, with no failure line", async () => {
    const err = notFound();
    const f = failing("click", err, new BridgeError(ErrorCodes.WINDOW_MINIMIZED, "the window is minimized"));
    const res = await tools(f.bridge, undefined, reports()).run("browser_click", { ref: "e1" });
    expect(res).toEqual({ isError: true, content: [{ type: "text", text: err.report!() }] });
  });

  it("S6b: a re-claimed cursor's notice is the last line of a failure report's text (code line first, no extra item); a normal result's placement is unchanged", async () => {
    const err = notFound();
    const g = failing("click", err);
    const cursor = new TabCursor(g.bridge);
    const t = tools(g.bridge, cursor, reports());
    await t.run("browser_hover", { ref: "e1" }); // cursor T1
    cursor.markLost();
    const res = await t.run("browser_click", { ref: "e1" });
    expect("isError" in res).toBe(false);
    expect(res).toEqual({
      content: [
        { type: "text", text: `${err.report!()}\n${failedLine("LOCATOR_NOT_FOUND")}\n${lostNotice("T1")}` },
        { type: "image", data: PNG_B64, mimeType: "image/png" },
      ],
    });
    expect(res.content).toHaveLength(2);
    const lines = res.content[0].text!.split("\n");
    expect(lines[0]).toBe('LOCATOR_NOT_FOUND: no element matches button "Nope"');
    expect(lines.at(-1)).toBe(lostNotice("T1"));

    // The no-image report: still isError, one text item, the notice its last line (S6b verifier F1: a second
    // text item in an error result was never measured to survive Claude Code's flattening).
    const err2 = notFound();
    const h = failing("click", err2, new BridgeError(ErrorCodes.WINDOW_MINIMIZED, "the window is minimized"));
    const cursor2 = new TabCursor(h.bridge);
    const t2 = tools(h.bridge, cursor2, reports());
    await t2.run("browser_hover", { ref: "e1" });
    cursor2.markLost();
    const res2 = await t2.run("browser_click", { ref: "e1" });
    expect(res2).toEqual({ isError: true, content: [{ type: "text", text: `${err2.report!()}\n${lostNotice("T1")}` }] });
    expect(res2.content).toHaveLength(1);
    const lines2 = res2.content[0].text!.split("\n");
    expect(lines2[0]).toBe('LOCATOR_NOT_FOUND: no element matches button "Nope"');
    expect(lines2.at(-1)).toBe(lostNotice("T1"));

    // A normal result: the notice still prefixes the first text item.
    cursor.markLost();
    expect(await t.run("browser_hover", { ref: "e1" })).toEqual({
      content: [{ type: "text", text: `${lostNotice("T1")}\nHovered e1` }],
    });
  });
});
