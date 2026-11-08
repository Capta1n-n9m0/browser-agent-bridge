/**
 * Step 9 (Phase E), S2b: the toolbar button's badge and title, and the one log line per press.
 *
 * - `badgeOf` is pure: disarmed → `OFF` red; armed with JavaScript off → `JS` amber; armed → no badge; `OFF`
 *   wins (F37); a state that cannot be read → `OFF` (fail closed) (decisions.md · 2026-10-24 · Badge and
 *   title (#143)). A disarm whose write failed (`"write-failed"`, #174) and an arm whose write was rejected
 *   are `OFF` too, with titles that say so.
 * - `BadgeModel` keeps such a failure visible until the state moves on (a read that says armed, or the next
 *   saved press). A `write-failed` note also ends once storage itself reads disarmed (the OFF was saved
 *   later, e.g. by the options page; S2b verifier F5): the gate's read cannot show that, since a disarm held
 *   in memory masks the stored value (#176). The badge stays `OFF` either way.
 * - `BadgeController` is the thin glue: `press` runs the toggle (the button and the `_execute_action`
 *   shortcut, #142), logs one content-free line, then re-derives the badge from a fresh read; `refresh` is
 *   the worker start's and every safety change's (F42, #144). It never throws synchronously, and a press
 *   never rejects.
 *
 * Nothing here sees a pattern, a URL, a title of a tab or the token: only the two switches (phase doc 0.7).
 */
import type { SafetySwitches } from "./safety.js";
import type { ToggleOutcome } from "./safety-state.js";

export interface Badge {
  text: string;
  color: string;
  title: string;
}

/** What the badge shows: a read state, an unreadable read, or a press whose write failed. */
export type BadgeInput =
  | { kind: "state"; armed: boolean; evaluate: boolean }
  | { kind: "unreadable" }
  | { kind: "write-failed" }
  | { kind: "arm-failed" };

/** A press's result: the toggle's outcome, or `"arm-failed"` when the toggle rejected (a failed arm write). */
export type PressResult = ToggleOutcome | "arm-failed";

/** Badge colours (#143 leaves them to the build): Chrome-style red and amber; the armed colour is unseen. */
export const BADGE_COLORS = Object.freeze({
  off: "#d93025",
  js: "#e37400",
  none: "#5f6368",
});

export const BADGE_TITLES = Object.freeze({
  off: "Browser Agent Bridge — OFF: agents are refused (click to turn on)",
  jsOff: "Browser Agent Bridge — armed, JavaScript off (click to turn off)",
  armed: "Browser Agent Bridge — armed (click to turn off)",
  unreadable: "Browser Agent Bridge — OFF: the safety state cannot be read, so agents are refused (check the options page)",
  writeFailed:
    "Browser Agent Bridge — OFF, but not saved (storage write failed): agents are refused until the extension restarts (click to turn on)",
  armFailed: "Browser Agent Bridge — OFF: turning on failed (storage write failed), agents are still refused (turn it on from the options page)",
});

export function badgeOf(input: BadgeInput): Badge {
  switch (input.kind) {
    case "unreadable":
      return { text: "OFF", color: BADGE_COLORS.off, title: BADGE_TITLES.unreadable };
    case "write-failed":
      return { text: "OFF", color: BADGE_COLORS.off, title: BADGE_TITLES.writeFailed };
    case "arm-failed":
      return { text: "OFF", color: BADGE_COLORS.off, title: BADGE_TITLES.armFailed };
    case "state":
      if (!input.armed) return { text: "OFF", color: BADGE_COLORS.off, title: BADGE_TITLES.off };
      if (!input.evaluate) return { text: "JS", color: BADGE_COLORS.js, title: BADGE_TITLES.jsOff };
      return { text: "", color: BADGE_COLORS.none, title: BADGE_TITLES.armed };
  }
}

const LOG_LINES: Readonly<Record<PressResult, string>> = Object.freeze({
  disarmed: "safety: disarmed by the user",
  armed: "safety: armed by the user",
  ignored: "safety: re-arm ignored (within 1 s of a disarm)",
  "write-failed": "safety: disarm not saved (storage write failed)",
  "arm-failed": "safety: arm failed (storage write failed)",
});

/** The one log line of a press: a fixed string, never a pattern, URL, title or the token (0.7). */
export function toggleLogLine(r: PressResult): string {
  return LOG_LINES[r];
}

/**
 * Keeps a failed write on the badge until a read says armed or a later press saved its change; a
 * `write-failed` note also ends when the stored switch (unmasked by memory) reads disarmed. An unknown stored
 * value (`undefined`) keeps the note (fail safe: the title then over-warns, never under-warns).
 */
export class BadgeModel {
  private failure: "write-failed" | "arm-failed" | null = null;

  note(r: PressResult): void {
    if (r === "write-failed" || r === "arm-failed") this.failure = r;
    else if (r === "disarmed" || r === "armed") this.failure = null;
    // "ignored": the memory copy is unchanged, so an unsaved disarm is still unsaved.
  }

  inputFor(read: SafetySwitches | "unreadable", storedArmed?: boolean): BadgeInput {
    if (read === "unreadable") return { kind: "unreadable" };
    if (read.armed) {
      this.failure = null;
      return { kind: "state", armed: true, evaluate: read.evaluate };
    }
    if (this.failure === "write-failed" && storedArmed === false) this.failure = null; // the OFF is saved now
    if (this.failure) return { kind: this.failure };
    return { kind: "state", armed: false, evaluate: read.evaluate };
  }
}

/** The three `chrome.action` setters the badge uses (injected so the glue is testable). */
export interface ActionApi {
  setBadgeText(details: { text: string }): unknown;
  setBadgeBackgroundColor(details: { color: string }): unknown;
  setTitle(details: { title: string }): unknown;
}

/** Calls one setter; a synchronous throw or a rejection is swallowed (the badge is never worth a crash). */
function quietly(fn: () => unknown): void {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(() => {});
  } catch {
    // nothing to undo
  }
}

/** Shows a badge. Never throws. */
export function showBadge(api: ActionApi | undefined, b: Badge): void {
  if (!api) return;
  quietly(() => api.setBadgeText({ text: b.text }));
  quietly(() => api.setBadgeBackgroundColor({ color: b.color }));
  quietly(() => api.setTitle({ title: b.title }));
}

export interface BadgeControllerDeps {
  /** `chrome.action`. */
  api: ActionApi | undefined;
  /** The state's switches, read now (`safety.read()`); a rejection means unreadable. */
  read(): Promise<SafetySwitches>;
  /**
   * The stored `armed` switch as `storage.local` holds it, not masked by the memory copy (F5). A rejection
   * means unknown. Absent → always unknown (a `write-failed` note then ends only when a read says armed).
   */
  storedArmed?(): Promise<boolean>;
}

export class BadgeController {
  private readonly model = new BadgeModel();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: BadgeControllerDeps) {}

  /** Re-derives the badge from a fresh read. Serialised: a later refresh is shown after an earlier one. */
  refresh(): Promise<void> {
    const run = this.chain.then(async () => {
      let read: SafetySwitches | "unreadable";
      try {
        const s = await this.deps.read();
        read = { armed: s.armed, evaluate: s.evaluate };
      } catch {
        read = "unreadable";
      }
      let storedArmed: boolean | undefined;
      try {
        storedArmed = this.deps.storedArmed ? await this.deps.storedArmed() : undefined;
      } catch {
        storedArmed = undefined;
      }
      showBadge(this.deps.api, badgeOf(this.model.inputFor(read, storedArmed)));
    });
    this.chain = run.catch(() => {});
    return this.chain;
  }

  /** The button and the shortcut: toggle, one log line, then the badge. Never rejects. */
  async press(toggle: () => Promise<ToggleOutcome>): Promise<PressResult> {
    let r: PressResult;
    try {
      r = await toggle();
    } catch {
      r = "arm-failed"; // the toggle rejects only when an arm's write fails (S2a fixer r1 §3)
    }
    this.model.note(r);
    console.log(toggleLogLine(r));
    await this.refresh();
    return r;
  }
}
