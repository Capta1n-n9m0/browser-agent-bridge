/**
 * Step 11 S3 — the pure half of `uploadFiles`'s service-worker leg (phase doc
 * `docs/plans/2026-10-25-step11-file-upload.md` 0.5–0.7 with their Stage 0 notes; decisions.md · 2026-10-25 ·
 * Stage 0: uploads need Chrome's file access (#245) part (b); · Stage 0: the finder runs in an isolated world (#248);
 * · Stage 0: S1 marks the bridge's own refusals explicitly (#246)). Pure: no `chrome.*`, no log call.
 *
 * - `fileAccessRefusal`: the decision on `chrome.extension.isAllowedFileSchemeAccess()`, read before anything
 *   touches the page or attaches. Anything but `true` → `UPLOAD_REFUSED` with `NO_FILE_ACCESS_MESSAGE`.
 * - `UPLOAD_FINDER_SRC`: the closure-free finder, shipped as `String(fn)` (the jsdom tests run exactly it). It runs
 *   in an **isolated world** the session creates (`Page.createIsolatedWorld`), never the page's main world (#248),
 *   so a page-patched prototype is not called. It finds the element carrying this call's upload mark (document,
 *   open shadow roots, same-origin frames — what the content script can mark), removes the mark from every carrier
 *   in the same evaluation, re-checks the input, and returns it (CDP hands back its `objectId`) or a status string.
 * - `setFilesByMark`: the CDP steps in one session — `Page.getFrameTree` → `Page.createIsolatedWorld` →
 *   `Runtime.evaluate` (the finder) → `DOM.setFileInputFiles {files, objectId}` → `Runtime.releaseObject` (in a
 *   `finally`). `UPLOAD_STEP_METHODS` lists them, as `trusted-input.ts` lists trusted input's steps.
 *   The finder's refusals (`REF_STALE` none found, `INTERNAL` several, `BAD_PARAMS` the input changed) are raised
 *   inside the session and marked with `markOwnRefusal`, so `describeDebuggerError` passes them through unprefixed;
 *   a breakdown (no frame id, no context id, the finder threw, an unknown reply) is not marked and keeps the prefix,
 *   as the save leg's `INTERNAL` failures do (#254).
 *
 * Nothing here names a path, a file name or the mark in a message.
 */
import { BridgeError, ErrorCodes } from "./errors.js";
import { markOwnRefusal } from "./debugger-errors.js";
// Type-only (erased): brings the `Window.__agentBridge` augmentation (declared in content/index.ts) into any program
// that includes this file, e.g. the recipes typechecks. Emits nothing.
import type {} from "./content/index.js";
import {
  DIRECTORY_INPUT_MESSAGE,
  DISABLED_INPUT_MESSAGE,
  NOT_FILE_INPUT_MESSAGE,
  SINGLE_FILE_INPUT_MESSAGE,
} from "./content/upload-target.js";

/** #245 (b): the refusal when this extension may not read local files. Fixed; names no path. */
export const NO_FILE_ACCESS_MESSAGE =
  "Chrome does not allow this extension to read local files (chrome://extensions → Browser Agent Bridge → Details → Allow access to file URLs), so the bridge cannot upload. Ask the user.";

/** #245 (b): `allowed` is what `chrome.extension.isAllowedFileSchemeAccess()` resolved to; anything else refuses. */
export function fileAccessRefusal(allowed: unknown): BridgeError | null {
  return allowed === true ? null : new BridgeError(ErrorCodes.UPLOAD_REFUSED, NO_FILE_ACCESS_MESSAGE);
}

/** The finder found no carrier of the mark. */
export const UPLOAD_MARK_GONE_MESSAGE =
  "the file input is no longer in the page (its upload mark was not found); nothing was uploaded";
/** The finder found several carriers. */
export const UPLOAD_MARK_NOT_UNIQUE_MESSAGE = "the upload mark is not unique; nothing was uploaded";

/** The isolated world's name (`Page.createIsolatedWorld`). */
export const UPLOAD_WORLD_NAME = "__bridge_upload";

/** How long the CDP leg may take, from the attach's start to the release. */
export const UPLOAD_CDP_TIMEOUT_MS = 15_000;

export function uploadTimeoutMessage(ms = UPLOAD_CDP_TIMEOUT_MS): string {
  return `File upload timed out after ${ms / 1000}s — the debugger was detached; the page may or may not have received the files`;
}

/** The finder's non-element answers. */
export type FinderStatus = "none" | "many" | "not-file-input" | "directory" | "disabled" | "single";

/**
 * Closure-free on purpose: shipped as `String(fn)`. The attribute name is a literal (`UPLOAD_MARK_ATTR` of
 * `content/upload-target.ts`; a test pins it). Never throws.
 */
function uploadFinderFn(mark: string, count: number): unknown {
  const found: any[] = [];
  function visit(root: any): void {
    let all: any;
    try {
      all = root.querySelectorAll("*");
    } catch (e) {
      return;
    }
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      try {
        if (el.getAttribute("data-__bridge-upload") === mark) found.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
        const tag = String(el.tagName).toUpperCase();
        if (tag === "IFRAME" || tag === "FRAME") {
          let doc = null;
          try {
            doc = el.contentDocument;
          } catch (e) {
            doc = null;
          }
          if (doc) visit(doc);
        }
      } catch (e) {
        /* a poisoned element must not stop the search */
      }
    }
  }
  try {
    visit(document);
  } catch (e) {
    /* nothing found */
  }
  for (let j = 0; j < found.length; j++) {
    try {
      found[j].removeAttribute("data-__bridge-upload");
    } catch (e) {
      /* best effort */
    }
  }
  if (found.length === 0) return "none";
  if (found.length > 1) return "many";
  const input = found[0];
  try {
    if (String(input.localName) !== "input" || String(input.type).toLowerCase() !== "file") return "not-file-input";
    if (input.hasAttribute("webkitdirectory") || input.webkitdirectory === true) return "directory";
    if (input.disabled) return "disabled";
    if (count > 1 && !input.multiple) return "single";
  } catch (e) {
    return "not-file-input";
  }
  return input;
}

/** The exact source the isolated world runs. */
export const UPLOAD_FINDER_SRC: string = String(uploadFinderFn);

/** The finder as an expression for `Runtime.evaluate`. */
export function uploadFinderExpression(mark: string, count: number): string {
  return `(${UPLOAD_FINDER_SRC})(${JSON.stringify(mark)}, ${JSON.stringify(count)})`;
}

/**
 * The two page functions the handler hands to `chrome.scripting.executeScript` (Chrome ships them as their source,
 * so they must be closure-free, like the finder; `s3-closure-free.test.ts` guards all three).
 */
export const UPLOAD_MARK_PAGE_FN = (r: unknown, n: unknown, m: unknown): unknown =>
  window.__agentBridge!.markUpload(r as string, n as number, m as string);
export const UPLOAD_UNMARK_PAGE_FN = (m: unknown): unknown => window.__agentBridge!.unmarkUpload(m as string);

/**
 * The failure sweep's `executeScript` target: the one document the mark was set in (its `documentId` from the mark
 * call's `InjectionResult`), never the tab, so a tab that navigated since is not scripted at all (Chrome refuses a
 * document it no longer shows). No document id → `null`: no sweep (S3 verifier MINOR 1).
 */
export function uploadSweepTarget(tabId: number, documentId: unknown): { tabId: number; documentIds: string[] } | null {
  return typeof documentId === "string" && documentId !== "" ? { tabId, documentIds: [documentId] } : null;
}

/** A finder status → the marked own refusal it raises inside the session. */
export function finderRefusal(status: FinderStatus): BridgeError {
  switch (status) {
    case "none":
      return markOwnRefusal(new BridgeError(ErrorCodes.REF_STALE, UPLOAD_MARK_GONE_MESSAGE));
    case "many":
      return markOwnRefusal(new BridgeError(ErrorCodes.INTERNAL, UPLOAD_MARK_NOT_UNIQUE_MESSAGE));
    case "not-file-input":
      return markOwnRefusal(new BridgeError(ErrorCodes.BAD_PARAMS, NOT_FILE_INPUT_MESSAGE));
    case "directory":
      return markOwnRefusal(new BridgeError(ErrorCodes.BAD_PARAMS, DIRECTORY_INPUT_MESSAGE));
    case "disabled":
      return markOwnRefusal(new BridgeError(ErrorCodes.BAD_PARAMS, DISABLED_INPUT_MESSAGE));
    case "single":
      return markOwnRefusal(new BridgeError(ErrorCodes.BAD_PARAMS, SINGLE_FILE_INPUT_MESSAGE));
  }
}

const FINDER_STATUSES: ReadonlySet<string> = new Set(["none", "many", "not-file-input", "directory", "disabled", "single"]);

/** The CDP methods of one upload, in order (the release runs in a `finally`). */
export const UPLOAD_STEP_METHODS = [
  "Page.getFrameTree",
  "Page.createIsolatedWorld",
  "Runtime.evaluate",
  "DOM.setFileInputFiles",
  "Runtime.releaseObject",
] as const;

export type CdpSend = (method: string, params: { [key: string]: unknown }) => Promise<unknown>;

/** A breakdown of the leg: an unmarked `INTERNAL`, so it reaches the wire prefixed (#254's rule). */
function breakdown(what: string): BridgeError {
  return new BridgeError(ErrorCodes.INTERNAL, `file upload: ${what}; nothing was uploaded`);
}

/**
 * The CDP steps of one upload, run inside one debugger session (the caller attaches, races the deadline and
 * detaches). Returns the number of paths handed to `DOM.setFileInputFiles` after it returned ok (#247): not proof
 * that the page took them.
 */
export async function setFilesByMark(send: CdpSend, mark: string, paths: readonly string[]): Promise<number> {
  const tree = (await send("Page.getFrameTree", {})) as { frameTree?: { frame?: { id?: unknown } } } | undefined;
  const frameId = tree?.frameTree?.frame?.id;
  if (typeof frameId !== "string" || frameId === "") throw breakdown("no main frame");
  const world = (await send("Page.createIsolatedWorld", { frameId, worldName: UPLOAD_WORLD_NAME })) as
    | { executionContextId?: unknown }
    | undefined;
  const contextId = world?.executionContextId;
  if (typeof contextId !== "number") throw breakdown("no isolated world");
  const res = (await send("Runtime.evaluate", {
    expression: uploadFinderExpression(mark, paths.length),
    contextId,
    returnByValue: false,
    awaitPromise: false,
  })) as { result?: { type?: string; subtype?: string; value?: unknown; objectId?: string }; exceptionDetails?: unknown } | undefined;
  if (!res || res.exceptionDetails !== undefined) throw breakdown("the finder failed");
  const r = res.result;
  if (r?.type === "string" && typeof r.value === "string" && FINDER_STATUSES.has(r.value)) {
    throw finderRefusal(r.value as FinderStatus);
  }
  if (r?.type !== "object" || r.subtype !== "node" || typeof r.objectId !== "string") throw breakdown("the finder's reply was not an element");
  const objectId = r.objectId;
  try {
    await send("DOM.setFileInputFiles", { files: [...paths], objectId });
  } finally {
    try {
      await send("Runtime.releaseObject", { objectId });
    } catch {
      /* best effort: the detach releases it anyway */
    }
  }
  return paths.length;
}

// ── Step 12 S5a: `uploadFiles {chooser: true}` — the native file chooser (phase doc
// `docs/plans/2026-10-27-step12-phase-f.md` 0.7 with its Stage 0 note; decisions.md #325, #336; spec §10's Step 12 S5a
// note). The target is an element whose click opens the page's file chooser. On the call's own session: Page.enable →
// interception on → the clicker (isolated world, `userGesture`) → `Page.fileChooserOpened` → the chooser's own input
// rules → `DOM.setFileInputFiles {files, backendNodeId}`; interception off and `Page.disable` on every path. A refusal
// after the click is thrown, so the use ends with an error and the session is detached (the keeper, #347): the chooser
// is never ended by `files: []` (Stage 0 m2 E8). Pure: no `chrome.*`, no log call; no path or mark in a message.

/** How long the call waits for `Page.fileChooserOpened` after the click's reply (#325). */
export const CHOOSER_WAIT_MS = 5_000;

/** No chooser opened within the bound. Fixed; names no path. */
export const CHOOSER_TIMEOUT_MESSAGE =
  "No file chooser opened within 5s of the click — target an element whose click opens the page's file chooser; nothing was uploaded";
/** The event carried no `backendNodeId` (a page picker such as `showOpenFilePicker`, Stage 0 m2 E2). */
export const CHOOSER_NO_INPUT_MESSAGE =
  "the file chooser that opened belongs to no file input (a page file picker such as showOpenFilePicker); the bridge cannot fill it; nothing was uploaded";

/** The CDP methods of one chooser upload that succeeds, in order (the last two run in a `finally`). */
export const CHOOSER_STEP_METHODS = [
  "Page.enable",
  "Page.setInterceptFileChooserDialog",
  "Page.getFrameTree",
  "Page.createIsolatedWorld",
  "Runtime.evaluate",
  "DOM.describeNode",
  "DOM.setFileInputFiles",
  "Page.setInterceptFileChooserDialog",
  "Page.disable",
] as const;

/**
 * Closure-free on purpose (shipped as `String(fn)`, as the finder): finds this call's upload mark (document, open
 * shadow roots, same-origin frames), removes it from every carrier, and clicks the one element carrying it. Runs in
 * the session's isolated world under `userGesture`, so the page's own patched prototypes are not called. Never throws.
 */
function chooserClickFn(mark: string): string {
  const found: any[] = [];
  function visit(root: any): void {
    let all: any;
    try {
      all = root.querySelectorAll("*");
    } catch (e) {
      return;
    }
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      try {
        if (el.getAttribute("data-__bridge-upload") === mark) found.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
        const tag = String(el.tagName).toUpperCase();
        if (tag === "IFRAME" || tag === "FRAME") {
          let doc = null;
          try {
            doc = el.contentDocument;
          } catch (e) {
            doc = null;
          }
          if (doc) visit(doc);
        }
      } catch (e) {
        /* a poisoned element must not stop the search */
      }
    }
  }
  try {
    visit(document);
  } catch (e) {
    /* nothing found */
  }
  for (let j = 0; j < found.length; j++) {
    try {
      found[j].removeAttribute("data-__bridge-upload");
    } catch (e) {
      /* best effort */
    }
  }
  if (found.length === 0) return "none";
  if (found.length > 1) return "many";
  const el = found[0];
  try {
    if (typeof el.click === "function") el.click();
    else el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
  } catch (e) {
    return "failed";
  }
  return "clicked";
}

/** The exact source the isolated world runs for the click. */
export const CHOOSER_CLICK_SRC: string = String(chooserClickFn);

export function chooserClickExpression(mark: string): string {
  return `(${CHOOSER_CLICK_SRC})(${JSON.stringify(mark)})`;
}

/**
 * The content-script call that marks the chooser's target (no file-input rule: the input is known from the event).
 * Closure-free: Chrome ships it as source into the content script's isolated world, where `__agentBridge` lives. A
 * missing ref answers the content script's own `REF_STALE` marker (read by `unwrapResult`).
 */
export const CHOOSER_MARK_PAGE_FN = (r: unknown, m: unknown): unknown => {
  const el = typeof r === "string" && typeof m === "string" && m !== "" ? window.__agentBridge!.refs.get(r) : undefined;
  if (!el) return { __bridgeError: "REF_STALE:ref " + String(r) + " not found — call browser_snapshot to re-snapshot" };
  el.setAttribute("data-__bridge-upload", m as string);
  return { ok: true };
};

/** `Page.fileChooserOpened`'s params as far as they are read. */
export interface ChooserEvent {
  backendNodeId?: unknown;
  mode?: unknown;
}

/**
 * One call's wait for `Page.fileChooserOpened`: the listener feeds it, the call arms it right before the click (an
 * event before that is someone else's and ignored), and the first event after the arm is kept. Never logs the event.
 */
export class ChooserWaiter {
  private armed = false;
  private closed = false;
  private event: ChooserEvent | undefined;
  private resolve: ((e: ChooserEvent | undefined) => void) | null = null;

  arm(): void {
    if (!this.closed) this.armed = true;
  }

  feed(params: unknown): void {
    if (!this.armed || this.closed || this.event) return;
    this.event = params !== null && typeof params === "object" ? (params as ChooserEvent) : {};
    this.resolve?.(this.event);
  }

  /** The event, or undefined after `ms` (or once closed). */
  wait(ms: number): Promise<ChooserEvent | undefined> {
    if (this.event || this.closed) return Promise.resolve(this.event);
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(undefined), ms);
      const done = (e: ChooserEvent | undefined): void => {
        clearTimeout(timer);
        this.resolve = null;
        resolve(e);
      };
      this.resolve = done;
    });
  }

  close(): void {
    this.closed = true;
    this.resolve?.(this.event);
  }
}

/** One chooser call per tab at a time (#336). */
export class ChooserTabs {
  private readonly busy = new Set<number>();
  /** False when the tab already has a chooser call in flight. */
  take(tabId: number): boolean {
    if (this.busy.has(tabId)) return false;
    this.busy.add(tabId);
    return true;
  }
  release(tabId: number): void {
    this.busy.delete(tabId);
  }
}

export interface ChooserDeps {
  send: CdpSend;
  waiter: Pick<ChooserWaiter, "arm" | "wait">;
  /** The call's gate re-check (`HandlerSafety.effect`), run after the event and before the input is read (S5a V2). */
  effect?: () => Promise<void>;
}

const ownRefusal = (code: string, message: string): BridgeError => markOwnRefusal(new BridgeError(code, message));

/** `DOM.describeNode`'s attribute list (`[name, value, name, value, …]`) → its names, lower-cased. */
function attributeNames(node: { attributes?: unknown }): Set<string> {
  const out = new Set<string>();
  const a = node.attributes;
  if (Array.isArray(a)) for (let i = 0; i < a.length; i += 2) if (typeof a[i] === "string") out.add((a[i] as string).toLowerCase());
  return out;
}

/**
 * The CDP steps of one chooser upload, inside one debugger session (the caller attaches, races the 15 s bound and
 * detaches or keeps the session). Returns the number of paths handed to `DOM.setFileInputFiles` after it returned ok
 * (#247). The interception off and `Page.disable` run in a `finally` on every path; a failure of either is swallowed
 * (a failed command drops a kept session, S4b).
 */
export async function setFilesByChooser(deps: ChooserDeps, mark: string, paths: readonly string[]): Promise<number> {
  const { send } = deps;
  let intercepting = false;
  try {
    await send("Page.enable", {});
    intercepting = true;
    await send("Page.setInterceptFileChooserDialog", { enabled: true });
    const tree = (await send("Page.getFrameTree", {})) as { frameTree?: { frame?: { id?: unknown } } } | undefined;
    const frameId = tree?.frameTree?.frame?.id;
    if (typeof frameId !== "string" || frameId === "") throw breakdown("no main frame");
    const world = (await send("Page.createIsolatedWorld", { frameId, worldName: UPLOAD_WORLD_NAME })) as
      | { executionContextId?: unknown }
      | undefined;
    const contextId = world?.executionContextId;
    if (typeof contextId !== "number") throw breakdown("no isolated world");
    deps.waiter.arm();
    const res = (await send("Runtime.evaluate", {
      expression: chooserClickExpression(mark),
      contextId,
      userGesture: true,
      returnByValue: true,
      awaitPromise: false,
    })) as { result?: { value?: unknown }; exceptionDetails?: unknown } | undefined;
    const status = res && res.exceptionDetails === undefined ? res.result?.value : undefined;
    if (status === "none" || status === "many") throw finderRefusal(status);
    if (status !== "clicked") throw breakdown("the click failed");
    const ev = await deps.waiter.wait(CHOOSER_WAIT_MS);
    if (!ev) throw ownRefusal(ErrorCodes.TIMEOUT, CHOOSER_TIMEOUT_MESSAGE);
    // S5a V2: the wait makes the set depend on page timing; the gate is read again before the event's input is touched.
    // A refusal here ends the chooser as every refusal after the click does (the `finally`, then the session dropped),
    // and passes through `withDebugger` unprefixed, as the gate's refusal before the use does.
    try {
      await deps.effect?.();
    } catch (err) {
      throw err instanceof Error ? markOwnRefusal(err) : err;
    }
    const backendNodeId = ev.backendNodeId;
    if (typeof backendNodeId !== "number") throw ownRefusal(ErrorCodes.BAD_PARAMS, CHOOSER_NO_INPUT_MESSAGE);
    if (paths.length > 1 && ev.mode !== "selectMultiple") throw finderRefusal("single");
    const desc = (await send("DOM.describeNode", { backendNodeId })) as { node?: { attributes?: unknown } } | undefined;
    if (!desc?.node) throw breakdown("no node description");
    const attrs = attributeNames(desc.node);
    if (attrs.has("webkitdirectory")) throw finderRefusal("directory");
    if (attrs.has("disabled")) throw finderRefusal("disabled");
    await send("DOM.setFileInputFiles", { files: [...paths], backendNodeId });
    return paths.length;
  } finally {
    if (intercepting) {
      try {
        await send("Page.setInterceptFileChooserDialog", { enabled: false });
      } catch {
        /* the use's failed command drops the session; interception ends with it (m2 E4 (ii)) */
      }
    }
    try {
      await send("Page.disable", {});
    } catch {
      /* as above */
    }
  }
}
