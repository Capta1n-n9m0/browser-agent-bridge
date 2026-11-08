// Step 8 S4 — failure reports (phase doc 0.5). When a `Tab` call fails with one of the seven codes
// where the page state helps, the SDK reads the tab once more — a snapshot, a default-mode
// screenshot saved to disk, the tab's last 20 network entries — and sets them on the error it
// rethrows, with `report()` to render them in at most 60 lines.
//
// The fields are optional properties set on the shared `BridgeError` instance — no subclass, no
// prototype patch (decisions.md · 2026-10-23 · Locator rules, the MCP locator schema and the exported
// `BridgeError` (#83) item 3; #86 item 6) — so every `instanceof BridgeError` keeps working and the
// caller gets back the very object that was thrown.
//
// Package-internal: nothing here is exported from `index.ts` (the SDK's eight values stay as pinned).
//
// What the attached screenshot does to the human's screen (measured in Step 7; phase doc 0.5 notes):
// - The default-mode screenshot switches the window to the failed tab for about 1.5 s and back
//   (median 1493 ms in Run 8 SCREEN-1, 1557 ms in Run 9 R9-SCREEN-1); 0.5 accepts that flash.
// - It takes the daemon's visibility lock like any screenshot, so another actor holding the lock can
//   make this attachment end as `LOCK_TIMEOUT` (or as the 5 s cut) in `attachErrors`.
// - A minimized window is refused with `WINDOW_MINIMIZED`, which lands in `attachErrors`.
// - On a window fully covered by other windows `captureVisibleTab` does not return. The 5 s cut ends
//   the SDK's wait, not the extension's switch: the human may see the failed tab in front for up to
//   about 30 s (R9-RESTORE: `TIMEOUT` at 35 119 ms, the previous tab back at +30 026 ms).
// - A failing `screenshot` or `focusTab` with an attach-set code (e.g. `TIMEOUT`) is enriched like any
//   other call, so it attaches a second default-mode screenshot (stage0-audit F25; not special-cased).
//
// The attached snapshot renumbers the tab's refs: a failure report takes a snapshot, and every
// snapshot resets the tab's RefMap exactly like a script's own `snapshot()` (extension
// `content/snapshot.ts`, `refs.reset()`). Refs from before the failure are therefore void. The
// `candidates`/`matches` refs in `error.data` are rewritten to the attached snapshot's refs by role
// AND accessible name, only on a unique hit; any other item loses its `ref`. An item with an empty or
// absent role (every match, a `{text}` candidate of a role-less element) always loses it: the
// snapshot lists only elements with a role, so a name-only hit would be another element. When the
// snapshot did not arrive every such ref is dropped (it may still have renumbered).
//
// Nothing here logs: the report is returned to the caller, never printed.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { BridgeError, type NetworkEntry, type SnapshotResult } from "@bridge/shared";
import type { Timers } from "./client.js";
import { formatRow } from "./format/network.js";
import { formatSnapshot, SNAPSHOT_ELEMENT_CAP } from "./format/snapshot.js";

// The class is declared in `@bridge/shared/error` (re-exported by `@bridge/shared`); augmenting that
// module merges these optional fields into the class's instance type for every SDK consumer.
declare module "@bridge/shared/error" {
  interface BridgeError {
    /**
     * Failure report (SDK `Tab` calls only): the tab's snapshot taken right after the failure. Taking
     * it renumbered the tab's refs, as a script's own `snapshot()` does: refs from before the failure
     * are void; use this snapshot's refs. A `candidates` item in `data` keeps a ref only when exactly one
     * snapshot element has its role and name (rewritten to that element's ref); `matches` carry no role,
     * so they never keep one.
     */
    snapshot?: SnapshotResult;
    /** Failure report: where the PNG of the tab taken right after the failure was written. */
    screenshotPath?: string;
    /** Failure report: the tab's last (up to 20) network entries, oldest first. */
    network?: NetworkEntry[];
    /** Failure report: one line per attachment that could not be taken, e.g. `"screenshot: not attached within 5 s"`. */
    attachErrors?: string[];
    /** Failure report: message, candidates, a snapshot window, the screenshot path, failed requests — ≤ 60 lines. */
    report?: () => string;
  }
}

/** The codes whose errors get a failure report (phase doc 0.5), and no others. */
export const ATTACH_CODES: readonly string[] = Object.freeze([
  "LOCATOR_NOT_FOUND",
  "LOCATOR_AMBIGUOUS",
  "REF_STALE",
  "OFFSCREEN",
  "PAGE_ERROR",
  "NAV_FAILED",
  "TIMEOUT",
]);

/** One deadline for all three attachments together. */
export const ATTACH_BUDGET_MS = 5_000;
/** The daemon's lower bound for a call's `timeoutMs`. */
const MIN_CALL_TIMEOUT_MS = 100;
/** How many network entries are asked for and kept. */
export const ATTACH_NETWORK_ENTRIES = 20;
/** `report()`'s hard cap on its total line count, for any input. */
export const REPORT_MAX_LINES = 60;

/** What the client hands a `Tab` when failure reports are on. */
export interface FailureReportConfig {
  timers: Timers;
  env: Record<string, string | undefined>;
  homedir: () => string;
  /** Epoch ms: names the screenshot file and anchors the network ages. */
  now: () => number;
}

export type RawCall = (
  method: string,
  params?: Record<string, unknown>,
  options?: { timeoutMs?: number },
) => Promise<unknown>;

export interface AttachOptions extends FailureReportConfig {
  /** The host's raw call — never a `Tab` method, so an attach failure cannot recurse. */
  call: RawCall;
}

export function isAttachCode(code: unknown): boolean {
  return typeof code === "string" && ATTACH_CODES.includes(code);
}

// ── Step 9: the safety refusals (decisions.md · 2026-10-24 · The JavaScript switch reuses `DISARMED` with
// a scope (#133); phase doc 0.3, 0.5, 0.6). `DISARMED` and `DOMAIN_BLOCKED` are not in `ATTACH_CODES`
// (#120; a report would only be refused too): a `Tab` call rethrows them untouched, with no `report`
// property (the Step 8 attach-set contract, pinned by failure-report.test.ts). Their wording lives here, as
// one plain line, used by `renderReport` and by the MCP (through `@bridge/sdk/report`).
// Step 10 S4b (2026-10-25; decisions.md #202 changed #133; spec §10's Step 10 note): `JS_DISABLED` joins them —
// out of `ATTACH_CODES`, one plain line, the JavaScript-off body. An old (Step 9) extension's
// `DISARMED {scope:"evaluate"}` keeps its Step 9 line, which is the same body under the code that arrived
// (Stage 0 F17).

const DISARMED_ALL_LINE =
  "DISARMED: the user has turned the bridge off in Chrome. Stop and ask the user to turn it back on; do not retry.";
/** The JavaScript-off line's body, after `<CODE>: ` — Step 9's words, unchanged (#164, #202). */
const JS_OFF_BODY =
  "the user has turned JavaScript off for the bridge in Chrome, so evaluate (browser_evaluate) is refused; every other call still works. Ask the user before relying on it; do not retry it.";
const JS_DISABLED_LINE = `JS_DISABLED: ${JS_OFF_BODY}`;
/** An old (Step 9) extension's `DISARMED {scope:"evaluate"}` (F17): byte-identical to Step 9's line. */
const DISARMED_EVALUATE_LINE = `DISARMED: ${JS_OFF_BODY}`;
const DOMAIN_BLOCKED_LINE =
  "DOMAIN_BLOCKED: the user has blocked this site for the bridge in Chrome. Stop and ask the user; do not retry, and do not try to reach the site another way.";
/**
 * Step 11 S2 (2026-10-25; spec §10's Step 11 note; decisions.md #237): `UPLOAD_REFUSED` — out of `ATTACH_CODES`, one
 * plain line naming no path, folder or file (the extension's message names none either; phase doc 0.5, 0.9). Since
 * S4b (decisions.md · 2026-10-25 · S4: the client line for `UPLOAD_REFUSED` names both causes (#263)) it names both
 * causes the extension refuses for — the folder rule, and Chrome's file-URL toggle off (#245 (b)) — in the words of
 * `browser_upload_file`'s description, so the agent sends the user to the right setting.
 */
const UPLOAD_REFUSED_LINE =
  "UPLOAD_REFUSED: the bridge will not upload that file — either it is not in a folder the user allows for uploads in Chrome (extension options → Upload folders), or the user has not turned on \"Allow access to file URLs\" for the extension (chrome://extensions → the extension's Details). Stop and ask the user; do not retry with another path.";

/**
 * The one plain line for a safety refusal, or null for any other code. `JS_DISABLED` (Step 10 S4b) is the
 * JavaScript-off line whatever its `data`; `UPLOAD_REFUSED` (Step 11 S2) the upload line. `DISARMED` reads by `data.scope`: `"evaluate"` — an old (Step 9)
 * extension's JavaScript-off refusal, the same body; anything else (`"all"`, absent or invalid) — the kill
 * switch, the stricter reading. Never names a URL, a title or a pattern.
 */
export function safetyRefusalLine(code: unknown, data: unknown): string | null {
  if (code === "DOMAIN_BLOCKED") return DOMAIN_BLOCKED_LINE;
  if (code === "JS_DISABLED") return JS_DISABLED_LINE;
  if (code === "UPLOAD_REFUSED") return UPLOAD_REFUSED_LINE;
  if (code !== "DISARMED") return null;
  const scope = typeof data === "object" && data !== null ? (data as { scope?: unknown }).scope : undefined;
  return scope === "evaluate" ? DISARMED_EVALUATE_LINE : DISARMED_ALL_LINE;
}

function firstLine(text: string): string {
  const nl = text.indexOf("\n");
  return (nl >= 0 ? text.slice(0, nl) : text).trim();
}

function describeFailure(err: unknown): string {
  if (err instanceof BridgeError) return `${err.code} ${firstLine(err.message)}`;
  if (err instanceof Error) return firstLine(err.message);
  return firstLine(String(err));
}

/** The failures directory: `BRIDGE_FAILURES_DIR` if set and non-empty, else `<home>/.browser-agent-bridge/failures`. */
export function failuresDir(env: Record<string, string | undefined>, homedir: () => string): string {
  const fromEnv = env.BRIDGE_FAILURES_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv;
  return path.join(homedir(), ".browser-agent-bridge", "failures");
}

/** `<iso>-<handle>.png`, with `:` and `.` of the ISO time replaced by `-` (Windows forbids `:`). */
export function screenshotFileName(now: number, handle: string): string {
  const iso = new Date(now).toISOString().replace(/[:.]/g, "-");
  return `${iso}-${handle.replace(/[^A-Za-z0-9_-]/g, "_")}.png`;
}

function decodePng(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  return Buffer.from(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, "base64");
}

type What = "snapshot" | "screenshot" | "network";

/**
 * Enriches `error` in place when its code is in `ATTACH_CODES` (and it is not enriched already); any
 * other error is left untouched with no call made. The three attachments run concurrently under one
 * `ATTACH_BUDGET_MS` deadline on `opts.timers`; at the cut every unfinished one gets an
 * `attachErrors` line and its late result is ignored (a late screenshot is not left on disk). Never
 * throws, never waits past the deadline.
 */
export async function attachContext(error: BridgeError, handle: string, opts: AttachOptions): Promise<void> {
  try {
    if (!isAttachCode(error.code) || Object.prototype.hasOwnProperty.call(error, "report")) return;
    await enrich(error, handle, opts);
  } catch {
    // Best-effort by contract: an attach problem never replaces the caller's error.
  }
}

async function enrich(error: BridgeError, handle: string, opts: AttachOptions): Promise<void> {
  const capturedAt = opts.now();
  const attachErrors: string[] = [];
  const settled = new Set<What>();
  let cut = false;
  let snapshot: SnapshotResult | undefined;
  let screenshotPath: string | undefined;
  let network: NetworkEntry[] | undefined;

  // All three calls are sent at once, at the start of the budget, so each may take all of it; the
  // daemon's own deadline then also ends a visibility-lock wait.
  const timeoutMs = Math.max(MIN_CALL_TIMEOUT_MS, ATTACH_BUDGET_MS);
  const tab = { tab: handle };

  const run = async (what: What, task: () => Promise<void>): Promise<void> => {
    try {
      await task();
    } catch (err) {
      if (!cut) attachErrors.push(`${what}: ${describeFailure(err)}`);
    } finally {
      settled.add(what);
    }
  };

  const tasks = Promise.all([
    run("snapshot", async () => {
      const r = (await opts.call("snapshot", { ...tab }, { timeoutMs })) as SnapshotResult | null;
      if (!r || !Array.isArray(r.elements)) throw new Error("the snapshot result had no elements");
      if (!cut) snapshot = r;
    }),
    run("screenshot", async () => {
      const r = (await opts.call("screenshot", { ...tab }, { timeoutMs })) as { dataUrl?: unknown } | null;
      if (cut) return;
      if (!r || typeof r.dataUrl !== "string") throw new Error("the screenshot result had no image");
      const dir = failuresDir(opts.env, opts.homedir);
      const file = path.join(dir, screenshotFileName(capturedAt, handle));
      await mkdir(dir, { recursive: true });
      if (cut) return;
      await writeFile(file, decodePng(r.dataUrl));
      if (cut) {
        // The write was already under way at the cut: the report will not name it, so remove it.
        await rm(file, { force: true }).catch(() => {});
        return;
      }
      screenshotPath = file;
    }),
    run("network", async () => {
      const r = (await opts.call("networkRequests", { ...tab, limit: ATTACH_NETWORK_ENTRIES }, { timeoutMs })) as {
        entries?: unknown;
      } | null;
      if (!r || !Array.isArray(r.entries)) throw new Error("the network result had no entries");
      if (!cut) network = (r.entries as NetworkEntry[]).slice(-ATTACH_NETWORK_ENTRIES);
    }),
  ]);

  let timer: unknown;
  const deadline = new Promise<void>((resolve) => {
    timer = opts.timers.setTimeout(resolve, ATTACH_BUDGET_MS);
  });
  await Promise.race([tasks, deadline]);
  opts.timers.clearTimeout(timer);
  cut = true;
  for (const what of ["snapshot", "screenshot", "network"] as const) {
    if (!settled.has(what)) attachErrors.push(`${what}: not attached within ${ATTACH_BUDGET_MS / 1000} s`);
  }

  // The snapshot call was always sent, so the tab's refs may have been renumbered even when it did
  // not arrive: rewrite the data's refs to the snapshot's, or drop them.
  remapRefs(error.data, snapshot);
  if (snapshot !== undefined) error.snapshot = snapshot;
  if (screenshotPath !== undefined) error.screenshotPath = screenshotPath;
  if (network !== undefined) error.network = network;
  error.attachErrors = attachErrors;
  let home: string | undefined;
  try {
    home = opts.homedir();
  } catch {
    // No home known: the Screenshot line then prints the absolute path.
  }
  const input: ReportInput = {
    code: String(error.code),
    message: error.message,
    data: error.data,
    snapshot,
    screenshotPath,
    home,
    network,
    attachErrors,
    refsWithheld: snapshot === undefined,
    now: capturedAt,
  };
  error.report = () => renderReport(input);
}

// ── report() ───────────────────────────────────────────────────────────────────────────────────

export interface ReportInput {
  code: string;
  message: string;
  data?: unknown;
  snapshot?: SnapshotResult;
  screenshotPath?: string;
  /** The home folder (the injected `homedir`): a screenshot path under it prints as `~`. */
  home?: string;
  network?: NetworkEntry[];
  attachErrors: string[];
  /** The snapshot was asked for but did not arrive: the data's refs were dropped (they may be renumbered). */
  refsWithheld?: boolean;
  /** Epoch ms the network ages are measured from. */
  now: number;
}

/**
 * `p` with a leading `home` folder shown as `~` (display only). A Windows home (drive letter) matches
 * case-insensitively (ASCII letters only) and either separator, and prints `~\…`; any other home matches exactly and prints `~/…`.
 * A path not strictly inside `home` is returned unchanged.
 */
export function homeAsTilde(p: string, home: string | undefined): string {
  if (home === undefined || home === "") return p;
  const win = /^[A-Za-z]:[\\/]/.test(home);
  // Fold ASCII A-Z only: `toLowerCase()` would turn U+0130 into two code units and shift the slice below.
  const norm = (s: string) => (win ? s.replace(/\//g, "\\").replace(/[A-Z]/g, (c) => c.toLowerCase()) : s);
  const h = norm(home).replace(/[\\/]+$/, "");
  const sep = win ? "\\" : "/";
  if (h === "" || !norm(p).startsWith(h + sep)) return p;
  const rest = p.slice(h.length + 1);
  return `~${sep}${win ? rest.replace(/\//g, "\\") : rest}`;
}

const MAX_MESSAGE_CHARS = 300;
const MAX_CANDIDATES_SHOWN = 5;
const MAX_MATCHES_SHOWN = 8;
const MAX_FAILED_SHOWN = 5;
const MAX_ATTACH_ERRORS_SHOWN = 5;

/** Whitespace (newlines included) collapsed to single spaces, capped at `max` characters. */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

/** A line cut at `max` characters, its spacing kept (the formatters' columns stay aligned). */
function capLine(line: string, max: number): string {
  return line.length > max ? line.slice(0, max) + "…" : line;
}

interface Named {
  ref?: unknown;
  role?: unknown;
  name?: unknown;
}

function asNamedList(value: unknown): Named[] {
  return Array.isArray(value) ? value.filter((v): v is Named => typeof v === "object" && v !== null) : [];
}

function namedLine(n: Named): string {
  const role = typeof n.role === "string" && n.role !== "" ? `${n.role} ` : "";
  const name = typeof n.name === "string" ? n.name : "";
  const ref = typeof n.ref === "string" ? ` [ref=${n.ref}]` : "";
  return `  - ${oneLine(`${role}${JSON.stringify(name)}`, 160)}${ref}`;
}

/**
 * Whether snapshot element `e` is the element item `n` names: same non-empty role and same name. An
 * item with no role never is — the snapshot lists only elements with a role, so a name-only hit is a
 * different element (a `<p>` match vs a same-named button).
 */
function sameElement(n: Named, e: { role?: unknown; name?: unknown }): boolean {
  if (typeof n.role !== "string" || n.role === "" || e.role !== n.role) return false;
  return typeof n.name === "string" && e.name === n.name;
}

/**
 * Rewrites, in place, the `ref` of every `data.candidates` / `data.matches` item to the ref of the one
 * element of `snapshot` with the same role and name, and deletes the `ref` of an item with zero or
 * several such elements, or with an empty or absent role (so every match: matches carry no role).
 * With no snapshot, every such `ref` is deleted.
 * The attached snapshot reset the tab's refs, so the refs the failing call returned are void.
 */
export function remapRefs(data: unknown, snapshot: SnapshotResult | undefined): void {
  if (typeof data !== "object" || data === null) return;
  const d = data as Record<string, unknown>;
  for (const key of ["candidates", "matches"]) {
    for (const item of asNamedList(d[key])) {
      const hits = snapshot === undefined ? [] : snapshot.elements.filter((e) => sameElement(item, e));
      if (hits.length === 1) item.ref = hits[0]!.ref;
      else delete item.ref;
    }
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function isFailed(e: NetworkEntry): boolean {
  return (typeof e.error === "string" && e.error !== "") || (typeof e.status === "number" && e.status >= 400);
}

/**
 * The window `[start, end)` of `n` element lines around `anchor`, in `avail` output lines that also
 * hold the "… N lines above/below" markers.
 */
function windowOf(n: number, anchor: number, avail: number): [number, number] {
  if (n <= avail) return [0, n];
  const place = (k: number): [number, number] => {
    let start = Math.max(0, anchor - Math.floor((k - 1) / 2));
    const end = Math.min(n, start + k);
    start = Math.max(0, end - k);
    return [start, end];
  };
  // One marker if the window touches an end of the list, else two.
  let [start, end] = place(Math.max(1, avail - 1));
  if (start > 0 && end < n) [start, end] = place(Math.max(1, avail - 2));
  return [start, end];
}

/** The text of `error.report()`: never more than `REPORT_MAX_LINES` lines, whatever the input. */
export function renderReport(input: ReportInput): string {
  // Step 9: a safety refusal is one plain line, whatever else the input carries (#133).
  const safety = safetyRefusalLine(input.code, input.data);
  if (safety !== null) return safety;
  const head: string[] = [`${input.code}: ${oneLine(input.message, MAX_MESSAGE_CHARS)}`];
  const data = (typeof input.data === "object" && input.data !== null ? input.data : {}) as Record<string, unknown>;
  const candidates = asNamedList(data.candidates);
  const matches = asNamedList(data.matches);
  const anchors: string[] = [];

  // Candidates and matches first: they are what a script fixes its locator from.
  if (candidates.length > 0) {
    head.push(`Nearest candidates:`);
    for (const c of candidates.slice(0, MAX_CANDIDATES_SHOWN)) head.push(namedLine(c));
    if (candidates.length > MAX_CANDIDATES_SHOWN) head.push(`  … and ${candidates.length - MAX_CANDIDATES_SHOWN} more`);
    for (const c of candidates) if (typeof c.ref === "string") anchors.push(c.ref);
  } else if (input.code === "LOCATOR_NOT_FOUND" && Array.isArray(data.candidates)) {
    head.push("No candidates near the locator.");
  }
  if (matches.length > 0) {
    head.push(`Matches (${matches.length}${matches.length >= 20 ? ", the extension sends at most 20" : ""}):`);
    for (const m of matches.slice(0, MAX_MATCHES_SHOWN)) head.push(namedLine(m));
    if (matches.length > MAX_MATCHES_SHOWN) head.push(`  … and ${matches.length - MAX_MATCHES_SHOWN} more`);
    for (const m of matches) if (typeof m.ref === "string") anchors.push(m.ref);
  }
  // Anchors: only candidate/match refs (rewritten to the attached snapshot's), never the failing
  // call's own ref — the attached snapshot re-minted that number for whatever element it reached.

  const tail: string[] = [];
  if (input.screenshotPath !== undefined) tail.push(`Screenshot: ${homeAsTilde(input.screenshotPath, input.home)}`);
  if (input.network !== undefined) {
    const failed = input.network.filter(isFailed);
    if (failed.length === 0) {
      const n = input.network.length;
      tail.push(`Network: no failed requests among the tab's last ${n} ${n === 1 ? "entry" : "entries"}.`);
    } else {
      tail.push(`Failed requests (${failed.length} of the tab's last ${input.network.length}):`);
      for (const e of failed.slice(-MAX_FAILED_SHOWN)) {
        tail.push(`  ${capLine(formatRow(e, input.now, false).replace(/\s*\n\s*/g, " "), 400)}`);
      }
      if (failed.length > MAX_FAILED_SHOWN) tail.push(`  … and ${failed.length - MAX_FAILED_SHOWN} more (older)`);
    }
  }
  if (input.refsWithheld === true) {
    tail.push(
      "Refs withheld: the report's snapshot did not arrive but may still have renumbered the tab's refs — take a new snapshot before using any ref.",
    );
  }
  if (input.attachErrors.length > 0) {
    tail.push("Not attached:");
    for (const a of input.attachErrors.slice(0, MAX_ATTACH_ERRORS_SHOWN)) tail.push(`  - ${oneLine(a, 300)}`);
    if (input.attachErrors.length > MAX_ATTACH_ERRORS_SHOWN) {
      tail.push(`  … and ${input.attachErrors.length - MAX_ATTACH_ERRORS_SHOWN} more`);
    }
  }

  const body: string[] = [];
  const snap = input.snapshot;
  if (snap !== undefined) {
    // Rendered by the SDK's own formatter, without its truncation footer: `truncated` is also true
    // at exactly 800 elements with nothing left out (stage0-audit F35), so the note below says only
    // that the cap was reached.
    const lines = formatSnapshot({ ...snap, truncated: false })
      .split("\n")
      .map((l) => capLine(l, 400));
    const header = lines[0] ?? "";
    const elements = lines.slice(1);
    const note = snap.truncated
      ? [`  (the snapshot reached its ${SNAPSHOT_ELEMENT_CAP}-element cap; there may be more elements past it)`]
      : [];
    const renumbered = "Refs: this snapshot renumbered the tab's refs — refs from before the failure are void; use the refs shown.";
    const avail = REPORT_MAX_LINES - head.length - tail.length - 2 - note.length;
    if (avail >= 1) {
      let anchor = 0;
      for (const ref of anchors) {
        // `remapRefs` left only refs of the snapshot's same-role, same-name element, so a lookup by ref suffices.
        const at = snap.elements.findIndex((e) => e.ref === ref);
        if (at >= 0) {
          anchor = at;
          break;
        }
      }
      const [start, end] = windowOf(elements.length, anchor, avail);
      body.push(renumbered, header);
      if (start > 0) body.push(`  … ${plural(start, "line")} above`);
      body.push(...elements.slice(start, end));
      if (end < elements.length) body.push(`  … ${plural(elements.length - end, "line")} below`);
      body.push(...note);
    } else {
      body.push(renumbered, "Snapshot: attached, not shown (no room left in the report)");
    }
  }

  const all = [...head, ...body, ...tail].join("\n").split("\n");
  if (all.length > REPORT_MAX_LINES) {
    return [...all.slice(0, REPORT_MAX_LINES - 1), `… report cut at ${REPORT_MAX_LINES} lines`].join("\n");
  }
  return all.join("\n");
}
