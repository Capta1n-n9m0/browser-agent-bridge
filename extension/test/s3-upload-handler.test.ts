// @vitest-environment jsdom
/**
 * Step 11 S3 — S3.2, S3.3 and #245 (b) (phase doc `docs/plans/2026-10-25-step11-file-upload.md` 0.5–0.7 with their
 * notes; decisions.md #245, #246, #247, #248, #254):
 * - the file-access decision (`fileAccessRefusal`) and its fixed message;
 * - the CDP step list of `setFilesByMark` (frame tree → isolated world → finder → `DOM.setFileInputFiles {files,
 *   objectId}` → release), the release in a `finally`;
 * - the wire text of every refusal raised inside the session, pinned through the shipped `withDebugger`
 *   (`uploadByMark`): the finder's refusals are marked own refusals (unprefixed), breakdowns, raw Chrome errors and
 *   the timeout keep `[chrome.debugger] `;
 * - the handler over a stubbed `chrome` and the real content script in jsdom: the gate's effect check before the
 *   attach, the file-access check before any page call, and the mark removed on every path (success, CDP error, not
 *   found, timeout, disarm, attach failure).
 * Fixture-like paths under a reserved folder only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ErrorCodes } from "@bridge/shared";
import "../src/content/index.js";
import { BridgeError, toWireError } from "../src/errors.js";
import { describeDebuggerError } from "../src/debugger-errors.js";
import { debuggerSessions, uploadByMark } from "../src/debugger.js";
import { DISARMED_ALL } from "../src/safety-state.js";
import {
  NO_FILE_ACCESS_MESSAGE,
  UPLOAD_CDP_TIMEOUT_MS,
  UPLOAD_MARK_GONE_MESSAGE,
  UPLOAD_MARK_NOT_UNIQUE_MESSAGE,
  UPLOAD_STEP_METHODS,
  UPLOAD_WORLD_NAME,
  fileAccessRefusal,
  finderRefusal,
  setFilesByMark,
  uploadSweepTarget,
  uploadFinderExpression,
  uploadTimeoutMessage,
} from "../src/upload-files.js";
import {
  DIRECTORY_INPUT_MESSAGE,
  DISABLED_INPUT_MESSAGE,
  NOT_FILE_INPUT_MESSAGE,
  SINGLE_FILE_INPUT_MESSAGE,
  UPLOAD_MARK_ATTR,
} from "../src/content/upload-target.js";
import { UPLOAD_PATHS_MESSAGE, UPLOAD_TARGET_REQUIRED_MESSAGE, checkUploadParams, uploadFiles } from "../src/handlers/upload.js";
import type { HandlerSafety } from "../src/safety-call.js";
import { FakeUploadCdp } from "./s3-upload-helpers.js";

const P1 = String.raw`C:\Wave\Up\a.txt`;
const P2 = String.raw`C:\Wave\Up\b.txt`;
const marks = () => document.querySelectorAll(`[${UPLOAD_MARK_ATTR}]`).length;
const refOf = (el: Element) => window.__agentBridge!.refs.add(el);

let cdp: FakeUploadCdp;
let log: string[];
let fileAccess: unknown;
/** The document the stub tab shows; a "navigation" changes it. */
let currentDoc: string;
let targets: { tabId: number; documentIds?: string[] }[];
/** Step 11b S0F-b: the worker's `fetch` of each path's file: URL; a URL listed here is missing (rejects). */
let missingUrls: Set<string>;

beforeEach(() => {
  missingUrls = new Set();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    log.push("probe");
    if (missingUrls.has(url)) throw new TypeError("Failed to fetch");
    return { status: 200, body: null };
  }));
  document.body.innerHTML = "";
  log = [];
  currentDoc = "DOC-1";
  targets = [];
  cdp = new FakeUploadCdp();
  fileAccess = true;
  vi.stubGlobal("chrome", {
    tabs: { get: vi.fn(async (id: number) => (log.push("tabs.get"), { id, url: "http://localhost:8080/e2e-playground.html", discarded: false })) },
    extension: { isAllowedFileSchemeAccess: vi.fn(async () => (log.push("fileAccess"), fileAccess)) },
    scripting: {
      executeScript: vi.fn(
        async (o: { target: { tabId: number; documentIds?: string[] }; files?: string[]; func?: (...a: unknown[]) => unknown; args?: unknown[] }) => {
          targets.push(o.target);
          // As Chrome does: a target naming a document the tab no longer shows is refused, and nothing runs.
          if (o.target.documentIds && !o.target.documentIds.includes(currentDoc)) throw new Error("No document with id");
          if (o.files) {
            log.push("inject");
            return [];
          }
          const result = o.func!(...(o.args ?? []));
          const r = result as { ok?: boolean; removed?: number } | null;
          log.push(r && "removed" in r ? "page:unmark" : r && (r as { __bridgeError?: string }).__bridgeError ? "page:refused" : "page:mark");
          return [{ result, documentId: currentDoc, frameId: 0 }];
        },
      ),
    },
    debugger: {
      attach: vi.fn(async () => void log.push("attach")),
      detach: vi.fn(async () => void log.push("detach")),
      sendCommand: vi.fn(async (_t: unknown, method: string, params: Record<string, unknown>) => {
        log.push(method);
        return cdp.send(method, params);
      }),
    },
  });
});
afterEach(() => {
  debuggerSessions.refuse(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeCall(o: { refuseAt?: number } = {}) {
  let n = 0;
  const call = {
    effect: vi.fn(async () => {
      log.push("effect");
      if (++n === o.refuseAt) throw new BridgeError(ErrorCodes.DISARMED, DISARMED_ALL.message, { scope: "all" });
    }),
  };
  return call as unknown as HandlerSafety;
}

async function wire(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return toWireError(e);
  }
  throw new Error("expected a rejection");
}

describe("#245 (b) — the file-access decision", () => {
  it("true → go ahead; anything else → UPLOAD_REFUSED with one fixed message naming no path", () => {
    expect(fileAccessRefusal(true)).toBeNull();
    for (const v of [false, undefined, null, "true", 1, {}]) {
      expect(toWireError(fileAccessRefusal(v))).toEqual({ code: ErrorCodes.UPLOAD_REFUSED, message: NO_FILE_ACCESS_MESSAGE });
    }
    expect(NO_FILE_ACCESS_MESSAGE).toBe(
      "Chrome does not allow this extension to read local files (chrome://extensions → Browser Agent Bridge → Details → Allow access to file URLs), so the bridge cannot upload. Ask the user.",
    );
    expect(NO_FILE_ACCESS_MESSAGE).not.toMatch(/[A-Za-z]:\\|\\/);
  });
});

describe("S3.3 — the CDP step list (as trusted-input.ts lists its steps)", () => {
  it("frame tree → isolated world → the finder in it → DOM.setFileInputFiles {files, objectId} → release", async () => {
    document.body.innerHTML = `<input id="f" type="file" multiple ${UPLOAD_MARK_ATTR}="m-1">`;
    expect(await setFilesByMark(cdp.send, "m-1", [P1, P2])).toBe(2);
    expect(cdp.methods()).toEqual([...UPLOAD_STEP_METHODS]);
    expect(cdp.calls).toEqual([
      { method: "Page.getFrameTree", params: {} },
      { method: "Page.createIsolatedWorld", params: { frameId: "FRAME-1", worldName: UPLOAD_WORLD_NAME } },
      { method: "Runtime.evaluate", params: { expression: uploadFinderExpression("m-1", 2), contextId: 77, returnByValue: false, awaitPromise: false } },
      { method: "DOM.setFileInputFiles", params: { files: [P1, P2], objectId: "n1" } },
      { method: "Runtime.releaseObject", params: { objectId: "n1" } },
    ]);
    expect(cdp.objects.get("n1")).toBe(document.getElementById("f"));
    expect(marks()).toBe(0);
  });

  it("the finder never runs in the page's main world: every Runtime.evaluate names the isolated world's contextId", async () => {
    document.body.innerHTML = `<input type="file" ${UPLOAD_MARK_ATTR}="m-2">`;
    await setFilesByMark(cdp.send, "m-2", [P1]);
    const evals = cdp.calls.filter((c) => c.method === "Runtime.evaluate");
    expect(evals).toHaveLength(1);
    expect(evals[0]!.params.contextId).toBe(77);
  });

  it("a failing DOM.setFileInputFiles still releases the object, and its error propagates", async () => {
    document.body.innerHTML = `<input type="file" ${UPLOAD_MARK_ATTR}="m-3">`;
    cdp.fail["DOM.setFileInputFiles"] = "Not allowed";
    await expect(setFilesByMark(cdp.send, "m-3", [P1])).rejects.toThrow("Not allowed");
    expect(cdp.methods().slice(-2)).toEqual(["DOM.setFileInputFiles", "Runtime.releaseObject"]);
  });

  it("a finder refusal stops before DOM.setFileInputFiles", async () => {
    await expect(setFilesByMark(cdp.send, "m-4", [P1])).rejects.toMatchObject({ code: ErrorCodes.REF_STALE });
    expect(cdp.methods()).toEqual(["Page.getFrameTree", "Page.createIsolatedWorld", "Runtime.evaluate"]);
  });
});

describe("refusals raised inside the session: wire text pinned through withDebugger (#246)", () => {
  it("each finder status maps to its code, and describeDebuggerError passes it unchanged (marked)", () => {
    const rows = [
      ["none", ErrorCodes.REF_STALE, UPLOAD_MARK_GONE_MESSAGE],
      ["many", ErrorCodes.INTERNAL, UPLOAD_MARK_NOT_UNIQUE_MESSAGE],
      ["not-file-input", ErrorCodes.BAD_PARAMS, NOT_FILE_INPUT_MESSAGE],
      ["directory", ErrorCodes.BAD_PARAMS, DIRECTORY_INPUT_MESSAGE],
      ["disabled", ErrorCodes.BAD_PARAMS, DISABLED_INPUT_MESSAGE],
      ["single", ErrorCodes.BAD_PARAMS, SINGLE_FILE_INPUT_MESSAGE],
    ] as const;
    for (const [status, code, message] of rows) {
      expect(describeDebuggerError(finderRefusal(status), "File upload"), status).toEqual({ code, message });
    }
  });

  it("through uploadByMark (attach → steps → detach): REF_STALE and INTERNAL reach the wire unprefixed", async () => {
    expect(await wire(uploadByMark(5, "m-5", [P1]))).toEqual({ code: ErrorCodes.REF_STALE, message: UPLOAD_MARK_GONE_MESSAGE });
    expect(log.at(-1)).toBe("detach");
    document.body.innerHTML = `<input type="file" ${UPLOAD_MARK_ATTR}="m-6"><input type="file" ${UPLOAD_MARK_ATTR}="m-6">`;
    expect(await wire(uploadByMark(5, "m-6", [P1]))).toEqual({ code: ErrorCodes.INTERNAL, message: UPLOAD_MARK_NOT_UNIQUE_MESSAGE });
    document.body.innerHTML = `<input type="file" ${UPLOAD_MARK_ATTR}="m-7">`;
    expect(await wire(uploadByMark(5, "m-7", [P1, P2]))).toEqual({ code: ErrorCodes.BAD_PARAMS, message: SINGLE_FILE_INPUT_MESSAGE });
    expect(marks()).toBe(0);
  });

  it("a breakdown, a raw Chrome error and the timeout keep the [chrome.debugger] prefix", async () => {
    cdp.reply["Page.getFrameTree"] = {};
    expect(await wire(uploadByMark(5, "m-8", [P1]))).toEqual({ code: ErrorCodes.INTERNAL, message: "[chrome.debugger] file upload: no main frame; nothing was uploaded" });
    cdp.reply = {};
    document.body.innerHTML = `<input type="file" ${UPLOAD_MARK_ATTR}="m-9">`;
    cdp.fail["DOM.setFileInputFiles"] = "Not allowed";
    expect(await wire(uploadByMark(5, "m-9", [P1]))).toEqual({ code: "DEBUGGER_ATTACH", message: "[chrome.debugger] Not allowed" });
    cdp.fail = {};
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    cdp.hang = new Set(["Runtime.evaluate"]);
    const pending = wire(uploadByMark(5, "m-10", [P1]));
    await vi.advanceTimersByTimeAsync(UPLOAD_CDP_TIMEOUT_MS);
    expect(await pending).toEqual({ code: ErrorCodes.TIMEOUT, message: `[chrome.debugger] ${uploadTimeoutMessage()}` });
    expect(uploadTimeoutMessage()).toBe("File upload timed out after 15s — the debugger was detached; the page may or may not have received the files");
    expect(log.at(-1)).toBe("detach");
  });

  it("the gate's effect check runs before the attach; a refusal there attaches nothing", async () => {
    const call = fakeCall({ refuseAt: 1 });
    expect(await wire(uploadByMark(5, "m-11", [P1], call))).toMatchObject({ code: ErrorCodes.DISARMED });
    expect(log).toEqual(["effect"]);
  });
});

describe("the handler — order, the file-access check, and the mark removed on every path", () => {
  const setup = (html: string, id = "f") => {
    document.body.innerHTML = html;
    return { tabId: 5, ref: refOf(document.getElementById(id)!), paths: [P1] };
  };

  it("params only, no page call: a target is required, 1–20 non-empty paths, not both ref and locator", () => {
    expect(() => checkUploadParams({ paths: [P1] })).toThrow(UPLOAD_TARGET_REQUIRED_MESSAGE);
    for (const paths of [undefined, [], "x", [""], [1], Array(21).fill(P1)]) {
      expect(() => checkUploadParams({ ref: "e1", paths }), JSON.stringify(paths)).toThrow(UPLOAD_PATHS_MESSAGE);
    }
    expect(() => checkUploadParams({ ref: "e1", locator: { css: "x" }, paths: [P1] })).toThrow("pass exactly one of ref / locator");
    expect(checkUploadParams({ ref: "e1", paths: [P1, P2] })).toEqual([P1, P2]);
  });

  it("success: tab → file access → effect → inject → effect → mark → effect → attach → steps → detach; {files}; no mark left", async () => {
    const p = setup(`<label id="l" for="f">Pick</label><input id="f" type="file" multiple hidden>`, "l");
    p.paths = [P1, P2];
    expect(await uploadFiles(p, fakeCall())).toEqual({ files: 2 });
    expect(log).toEqual([
      "tabs.get",
      "fileAccess",
      "probe",
      "probe",
      "effect",
      "inject",
      "effect",
      "page:mark",
      "effect",
      "attach",
      ...UPLOAD_STEP_METHODS,
      "detach",
    ]);
    expect(cdp.calls.find((c) => c.method === "DOM.setFileInputFiles")!.params.files).toEqual([P1, P2]);
    expect(marks()).toBe(0);
  });

  it("a locator target answers the same {files} (no cap flag below the cap)", async () => {
    document.body.innerHTML = `<input id="f" type="file">`;
    expect(await uploadFiles({ tabId: 5, locator: { css: "#f" }, paths: [P1] }, fakeCall())).toEqual({ files: 1 });
    expect(marks()).toBe(0);
  });

  it("file access off (or unreadable): UPLOAD_REFUSED before any page call, mark or attach", async () => {
    const p = setup(`<input id="f" type="file">`);
    for (const v of [false, undefined]) {
      log = [];
      fileAccess = v;
      expect(await wire(uploadFiles(p, fakeCall()))).toEqual({ code: ErrorCodes.UPLOAD_REFUSED, message: NO_FILE_ACCESS_MESSAGE });
      expect(log).toEqual(["tabs.get", "fileAccess"]);
    }
    (chrome.extension.isAllowedFileSchemeAccess as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("x"));
    expect(await wire(uploadFiles(p, fakeCall()))).toEqual({ code: ErrorCodes.UPLOAD_REFUSED, message: NO_FILE_ACCESS_MESSAGE });
    expect(marks()).toBe(0);
  });

  it("S0F-b (#288 3c): a missing file → BAD_PARAMS naming its index, after the file-access check and before any effect, page call, mark or attach", async () => {
    const p = setup(`<input id="f" type="file" multiple>`);
    p.paths = [P1, P2];
    missingUrls.add("file:///C:/Wave/Up/b.txt");
    expect(await wire(uploadFiles(p, fakeCall()))).toEqual({
      code: ErrorCodes.BAD_PARAMS,
      message: "upload: paths[1] does not exist (or Chrome cannot read it); nothing was uploaded",
    });
    expect(log).toEqual(["tabs.get", "fileAccess", "probe", "probe"]);
    expect(marks()).toBe(0);
    log = [];
    fileAccess = false; // file access off: refused UPLOAD_REFUSED before any probe
    expect(await wire(uploadFiles(p, fakeCall()))).toMatchObject({ code: ErrorCodes.UPLOAD_REFUSED });
    expect(log).toEqual(["tabs.get", "fileAccess"]);
  });

  it("a webkitdirectory input (#247) and a non-file target → BAD_PARAMS with no attach and no mark", async () => {
    for (const html of [`<input id="f" type="file" webkitdirectory>`, `<button id="f">Upload</button>`]) {
      log = [];
      const p = setup(html);
      const err = (await wire(uploadFiles(p, fakeCall()))) as { code: string };
      expect(err.code).toBe(ErrorCodes.BAD_PARAMS);
      expect(log).not.toContain("attach");
      expect(marks()).toBe(0);
    }
  });

  it("a CDP error (Page.createIsolatedWorld fails): the error stands, the mark is swept", async () => {
    const p = setup(`<input id="f" type="file">`);
    cdp.fail["Page.createIsolatedWorld"] = "boom";
    expect(await wire(uploadFiles(p, fakeCall()))).toEqual({ code: "DEBUGGER_ATTACH", message: "[chrome.debugger] boom" });
    expect(log.slice(-2)).toEqual(["detach", "page:unmark"]);
    expect(marks()).toBe(0);
  });

  it("a CDP error (DOM.setFileInputFiles fails): the error stands, the object released, nothing left marked", async () => {
    const p = setup(`<input id="f" type="file">`);
    cdp.fail["DOM.setFileInputFiles"] = "Not allowed";
    expect(await wire(uploadFiles(p, fakeCall()))).toEqual({ code: "DEBUGGER_ATTACH", message: "[chrome.debugger] Not allowed" });
    expect(log.slice(-4)).toEqual(["DOM.setFileInputFiles", "Runtime.releaseObject", "detach", "page:unmark"]);
    expect(marks()).toBe(0);
  });

  it("the failure sweep targets the document the mark was set in, never the tab (verifier S3 MINOR 1)", async () => {
    const p = setup(`<input id="f" type="file">`);
    cdp.fail["Page.createIsolatedWorld"] = "boom";
    await wire(uploadFiles(p, fakeCall()));
    expect(targets.at(-1)).toEqual({ tabId: 5, documentIds: ["DOC-1"] });
    expect(marks()).toBe(0);
  });

  it("a tab navigated after the mark: the sweep names the old document, so the new page is never scripted", async () => {
    const p = setup(`<input id="f" type="file">`);
    cdp.before["Page.createIsolatedWorld"] = () => {
      currentDoc = "DOC-2";
      throw new Error("boom");
    };
    expect(await wire(uploadFiles(p, fakeCall()))).toEqual({ code: "DEBUGGER_ATTACH", message: "[chrome.debugger] boom" });
    expect(targets.at(-1)).toEqual({ tabId: 5, documentIds: ["DOC-1"] });
    expect(log).not.toContain("page:unmark");
  });

  it("uploadSweepTarget: a document id → that document only; no id → no sweep", () => {
    expect(uploadSweepTarget(5, "DOC-1")).toEqual({ tabId: 5, documentIds: ["DOC-1"] });
    for (const v of [undefined, null, "", 7, {}]) expect(uploadSweepTarget(5, v), String(v)).toBeNull();
  });

  it("not found: the page removed the input after the mark → REF_STALE; nothing left marked", async () => {
    const p = setup(`<input id="f" type="file">`);
    cdp.before["Page.getFrameTree"] = () => document.getElementById("f")!.remove();
    expect(await wire(uploadFiles(p, fakeCall()))).toEqual({ code: ErrorCodes.REF_STALE, message: UPLOAD_MARK_GONE_MESSAGE });
    expect(marks()).toBe(0);
  });

  it("timeout: TIMEOUT, the debugger detached, the mark swept (the finder never ran)", async () => {
    const p = setup(`<input id="f" type="file">`);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    cdp.hang = new Set(["Page.createIsolatedWorld"]);
    const pending = wire(uploadFiles(p, fakeCall()));
    await vi.advanceTimersByTimeAsync(UPLOAD_CDP_TIMEOUT_MS);
    expect(await pending).toMatchObject({ code: ErrorCodes.TIMEOUT });
    expect(log.slice(-2)).toEqual(["detach", "page:unmark"]);
    expect(marks()).toBe(0);
  });

  it("disarm mid-session (the registry detaches it): DISARMED, the mark swept", async () => {
    const p = setup(`<input id="f" type="file">`);
    cdp.before["Page.createIsolatedWorld"] = async () => {
      await debuggerSessions.detachAll(DISARMED_ALL, async () => {});
      throw new Error("Detached while handling command.");
    };
    expect(await wire(uploadFiles(p, fakeCall()))).toEqual({ code: ErrorCodes.DISARMED, message: DISARMED_ALL.message, data: { scope: "all" } });
    expect(marks()).toBe(0);
    expect(cdp.methods()).not.toContain("DOM.setFileInputFiles");
  });

  it("disarm at the effect check before the attach: DISARMED, no attach, the mark swept", async () => {
    const p = setup(`<input id="f" type="file">`);
    expect(await wire(uploadFiles(p, fakeCall({ refuseAt: 3 })))).toMatchObject({ code: ErrorCodes.DISARMED });
    expect(log).not.toContain("attach");
    expect(log.at(-1)).toBe("page:unmark");
    expect(marks()).toBe(0);
  });

  it("attach failure (DevTools open): DEBUGGER_DEVTOOLS, the mark swept", async () => {
    const p = setup(`<input id="f" type="file">`);
    (chrome.debugger.attach as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Another debugger is already attached to the tab with id: 5."));
    expect(await wire(uploadFiles(p, fakeCall()))).toMatchObject({ code: "DEBUGGER_DEVTOOLS" });
    expect(marks()).toBe(0);
  });
});
