// The daemon's log (phase-doc decision 0.8, spec §9.2): the daemon is spawned with no stdio, so this
// file is its only voice. Append-only, synchronous, truncated to the last 1 MiB on start. Counts and
// ids only — never a URL, header value, body or the token; `redact` is the last line of defence and
// withholds a whole line rather than trying to clean it. A logger that cannot write is a silent
// no-op: it never throws and never falls back to stdout/stderr.
import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** 1 MiB: the size the log is cut back to on start. */
export const MAX_LOG_BYTES = 1024 * 1024;

/** Written instead of a line that contained a URL or the token. Contains nothing of the original. */
export const WITHHELD = "[line withheld: contained a URL or the token]";

export interface Logger {
  log(message: string): void;
  /** The token, once known; any later line containing it is withheld. */
  setSecret(token: string): void;
}

/** The state directory's name before the rename (Step 15 S1, #444); only its handle mark is read, once. */
export function legacyStateDirs(home: string = homedir()): string[] {
  return [path.join(home, ".chrome-agent-bridge")];
}

/** `~/.browser-agent-bridge/daemon.log`. */
export function defaultLogPath(home: string = homedir()): string {
  return path.join(home, ".browser-agent-bridge", "daemon.log");
}

/** The text itself, or `WITHHELD` when it contains `://` or the (non-empty) token. */
export function redact(text: string, token: string | undefined): string {
  if (text.includes("://")) return WITHHELD;
  if (token && text.includes(token)) return WITHHELD;
  return text;
}

/** `2026-10-21T12:01:33Z <message>` — UTC, whole seconds. */
export function formatLine(epochMs: number, message: string): string {
  const stamp = new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `${stamp} ${message}`;
}

/**
 * If `file` is larger than `maxBytes`, keep only its last `maxBytes`, starting at a whole line: when
 * the cut falls inside a line, everything up to and including the next newline is dropped too.
 */
export function truncateToTail(file: string, maxBytes: number = MAX_LOG_BYTES): void {
  const size = statSync(file).size;
  if (size <= maxBytes) return;
  const start = size - maxBytes;
  // Read one byte before the cut as well, to know whether the tail already starts a line.
  const buf = Buffer.alloc(maxBytes + 1);
  const fd = openSync(file, "r");
  let read = 0;
  try {
    while (read < buf.length) {
      const n = readSync(fd, buf, read, buf.length - read, start - 1 + read);
      if (n === 0) break;
      read += n;
    }
  } finally {
    closeSync(fd);
  }
  const data = buf.subarray(0, read);
  let tail = data.subarray(1);
  if (data[0] !== 0x0a) {
    const nl = tail.indexOf(0x0a);
    tail = nl === -1 ? Buffer.alloc(0) : tail.subarray(nl + 1);
  }
  writeFileSync(file, tail);
}

export interface FileLoggerOptions {
  /** Default `defaultLogPath()`. Tests inject a temp path. */
  path?: string;
  /** Clock for timestamps. Default `Date.now`. */
  now?: () => number;
  /** Start-time cap. Default `MAX_LOG_BYTES`. */
  maxBytes?: number;
}

export function createFileLogger(options: FileLoggerOptions = {}): Logger {
  const file = options.path ?? defaultLogPath();
  const now = options.now ?? Date.now;
  let secret = "";
  let usable = true;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    usable = false;
  }
  if (usable) {
    try {
      truncateToTail(file, options.maxBytes ?? MAX_LOG_BYTES);
    } catch {
      // no file yet, or unreadable — appending below will tell
    }
  }
  return {
    log(message: string): void {
      if (!usable) return;
      try {
        appendFileSync(file, formatLine(now(), redact(message, secret)) + "\n");
      } catch {
        // a log that cannot be written must never take the daemon down
      }
    },
    setSecret(token: string): void {
      secret = token;
    },
  };
}
