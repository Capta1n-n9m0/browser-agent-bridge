// Step 8 S2b.9 — handle numbers are never reused across daemon restarts (decisions.md · 2026-10-23 · A
// new daemon never reuses a handle number; the SDK guards stale `Tab`s (#79); #86 item 4).
//
// Stage 0 F2 measured a stale `T3` from a previous daemon acting on whatever tab the new daemon had
// numbered T3. So the daemon keeps a high-water mark: a file holding one decimal number, the highest
// handle number any daemon may have returned. A new daemon starts above it. Numbers are reserved in
// blocks: before returning a number above the reserved ceiling, the new ceiling is written (temp file +
// rename, synchronously), so the mark on disk always covers every number already handed out.
//
// When the mark cannot be read (it exists but is not a number, or is not a file) or a write fails, the
// numbers continue from a time base — the milliseconds since 2026-01-01T00:00:00Z — so a later start
// lands higher than an earlier one. Logged once each, with no path and no number.
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HandleNumbers } from "./handles.js";

/** The mark's file name, inside the daemon's state directory (`~/.browser-agent-bridge/` in production). */
export const HANDLE_MARK_FILE = "handle-mark";
/** Numbers reserved per write. */
export const HANDLE_BLOCK = 64;
/** The time base's zero. */
export const TIME_BASE_EPOCH_MS = Date.UTC(2026, 0, 1);

export const LOG_UNREADABLE = "handle mark unreadable — handle numbers continue from a start-time base";
export const LOG_NOT_WRITTEN = "handle mark not written — handle numbers continue from a time base";

/** The file operations the mark needs; tests inject failing ones. */
export interface HandleMarkFs {
  /** The file's text; throws (with `code: "ENOENT"` when it does not exist). */
  read(file: string): string;
  /** Replace the file's text atomically; throws on failure. */
  write(file: string, text: string): void;
}

export const realMarkFs: HandleMarkFs = {
  read: (file) => readFileSync(file, "utf8"),
  write: (file, text) => {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, text);
      renameSync(tmp, file);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        // nothing was left behind
      }
      throw err;
    }
  },
};

export interface HandleMarkOptions {
  /** The state directory (must exist; production: the daemon log's directory). */
  dir: string;
  /**
   * Older state directories, read only when `dir` has no mark yet: the highest of their marks is carried over, so the
   * rename (Step 15 S1, `~/.chrome-agent-bridge/` to `~/.browser-agent-bridge/`) never reuses a number. Never written.
   */
  legacyDirs?: string[];
  /** Clock for the time base. Default `Date.now`. */
  now?: () => number;
  /** Numbers reserved per write. Default `HANDLE_BLOCK`. */
  block?: number;
  /** The daemon log (one line per fallback, never a path). */
  log?: (msg: string) => void;
  fs?: HandleMarkFs;
}

export interface HandleMark extends HandleNumbers {
  /** "mark" while every number handed out is covered by the file; "fallback" once the time base is in use. */
  mode(): "mark" | "fallback";
}

/** Milliseconds since 2026-01-01T00:00:00Z, at least 1. */
export function timeBase(nowMs: number): number {
  return Math.max(1, Math.floor(nowMs) - TIME_BASE_EPOCH_MS);
}

function errCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** Reads the mark: a number, 0 when there is no file, or undefined when it cannot be read. */
function readMark(fs: HandleMarkFs, file: string): number | undefined {
  let text: string;
  try {
    text = fs.read(file);
  } catch (err) {
    return errCode(err) === "ENOENT" ? 0 : undefined;
  }
  const t = text.trim();
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : undefined;
}

export function createHandleMark(options: HandleMarkOptions): HandleMark {
  const fs = options.fs ?? realMarkFs;
  const now = options.now ?? Date.now;
  const block = Math.max(1, Math.floor(options.block ?? HANDLE_BLOCK));
  const file = path.join(options.dir, HANDLE_MARK_FILE);
  const log = options.log ?? (() => {});

  let mode: "mark" | "fallback" = "mark";
  let writable = true;
  let next: number;
  /** The highest number the file covers; a number above it needs a write first. */
  let ceiling: number;

  let mark = readMark(fs, file);
  if (mark === 0) {
    for (const old of options.legacyDirs ?? []) {
      const m = readMark(fs, path.join(old, HANDLE_MARK_FILE));
      mark = m === undefined || mark === undefined ? undefined : Math.max(mark, m);
    }
  }
  if (mark === undefined) {
    mode = "fallback";
    next = timeBase(now());
    ceiling = next - 1; // the first number still tries to write, which repairs the file
    log(LOG_UNREADABLE);
  } else {
    next = mark + 1;
    ceiling = mark;
  }

  return {
    next(): number {
      if (writable && next > ceiling) {
        const target = next + block - 1;
        try {
          fs.write(file, `${target}\n`);
          ceiling = target;
        } catch {
          // The file no longer covers what comes next: jump to a time base above everything so far.
          writable = false;
          mode = "fallback";
          next = Math.max(next, timeBase(now()));
          log(LOG_NOT_WRITTEN);
        }
      }
      return next++;
    },
    mode: () => mode,
  };
}
