import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createFileLogger,
  defaultLogPath,
  legacyStateDirs,
  formatLine,
  redact,
  truncateToTail,
  MAX_LOG_BYTES,
  WITHHELD,
} from "../src/log.js";

const TOKEN = "tok-3f9a1c0e5b7d";

describe("redact", () => {
  it("refuses a string containing ://", () => {
    expect(redact("fetching https://x", TOKEN)).toBe(WITHHELD);
    expect(redact("ws://127.0.0.1:9234", "")).toBe(WITHHELD);
  });

  it("refuses a string containing the token", () => {
    expect(redact(`hello ${TOKEN} there`, TOKEN)).toBe(WITHHELD);
  });

  it("the placeholder contains no part of the original", () => {
    expect(WITHHELD).not.toContain("://");
    expect(WITHHELD).not.toContain(TOKEN);
  });

  it("passes ordinary lines through, and ignores an empty token", () => {
    expect(redact('client + "export-grades.ts" (3 clients)', TOKEN)).toBe('client + "export-grades.ts" (3 clients)');
    expect(redact("listening on 127.0.0.1:9234", "")).toBe("listening on 127.0.0.1:9234");
    expect(redact("listening", undefined)).toBe("listening");
  });
});

describe("formatLine", () => {
  it("is a UTC ISO timestamp without milliseconds, a space, the message", () => {
    const t = Date.UTC(2026, 9, 21, 12, 1, 33, 456);
    expect(formatLine(t, 'client + "export-grades.ts" (3 clients)')).toBe(
      '2026-10-21T12:01:33Z client + "export-grades.ts" (3 clients)',
    );
  });
});

describe("file logger", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("the old state directory is ~/.chrome-agent-bridge (read for the handle mark only)", () => {
    expect(legacyStateDirs("/home/u")).toEqual([path.join("/home/u", ".chrome-agent-bridge")]);
  });
  it("defaults to ~/.browser-agent-bridge/daemon.log", () => {
    expect(defaultLogPath("/home/u")).toBe(path.join("/home/u", ".browser-agent-bridge", "daemon.log"));
  });

  it("creates the directory and appends formatted lines", () => {
    dir = mkdtempSync(path.join(tmpdir(), "bridge-log-"));
    const file = path.join(dir, "nested", "deeper", "daemon.log");
    const t = Date.UTC(2026, 9, 21, 12, 1, 33);
    const log = createFileLogger({ path: file, now: () => t });
    log.log("start pid=1");
    log.log('client + "a" (1 client)');
    const lines = readFileSync(file, "utf8").split("\n");
    expect(lines).toEqual(["2026-10-21T12:01:33Z start pid=1", '2026-10-21T12:01:33Z client + "a" (1 client)', ""]);
  });

  it("appends to an existing file rather than replacing it", () => {
    dir = mkdtempSync(path.join(tmpdir(), "bridge-log-"));
    const file = path.join(dir, "daemon.log");
    writeFileSync(file, "old line\n");
    createFileLogger({ path: file, now: () => 0 }).log("new");
    expect(readFileSync(file, "utf8")).toBe("old line\n1970-01-01T00:00:00Z new\n");
  });

  it("writes the placeholder, never the line, for a URL or the token", () => {
    dir = mkdtempSync(path.join(tmpdir(), "bridge-log-"));
    const file = path.join(dir, "daemon.log");
    const log = createFileLogger({ path: file, now: () => 0 });
    log.setSecret(TOKEN);
    log.log("opened https://example.test/a?sig=1");
    log.log(`token is ${TOKEN}`);
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("://");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("example.test");
    expect(text.split("\n").filter(Boolean)).toEqual([`1970-01-01T00:00:00Z ${WITHHELD}`, `1970-01-01T00:00:00Z ${WITHHELD}`]);
  });

  it("truncates a file over 1 MiB to its last 1 MiB on start, starting at a whole line", () => {
    dir = mkdtempSync(path.join(tmpdir(), "bridge-log-"));
    const file = path.join(dir, "daemon.log");
    const lines: string[] = [];
    for (let i = 0; i < 30000; i++) lines.push(`line ${String(i).padStart(6, "0")} ${"x".repeat(40)}`);
    writeFileSync(file, lines.join("\n") + "\n");
    expect(statSync(file).size).toBeGreaterThan(1.4 * MAX_LOG_BYTES);

    createFileLogger({ path: file, now: () => 0 }).log("after truncation");
    const text = readFileSync(file, "utf8");
    const kept = text.split("\n").filter(Boolean);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_LOG_BYTES + 100);
    expect(kept[0]).toMatch(/^line \d{6} x{40}$/); // no partial first line
    expect(kept.at(-2)).toBe(lines.at(-1)); // the tail is kept
    expect(kept.at(-1)).toBe("1970-01-01T00:00:00Z after truncation");
  });

  it("truncateToTail keeps the last bytes from the first newline and leaves a small file alone", () => {
    dir = mkdtempSync(path.join(tmpdir(), "bridge-log-"));
    const file = path.join(dir, "daemon.log");
    writeFileSync(file, "aaaa\nbbbb\ncccc\n");
    truncateToTail(file, 100);
    expect(readFileSync(file, "utf8")).toBe("aaaa\nbbbb\ncccc\n");
    truncateToTail(file, 8); // last 8 bytes: "bb\ncccc\n" → from the first newline on: "cccc\n"
    expect(readFileSync(file, "utf8")).toBe("cccc\n");
    writeFileSync(file, "aaaa\nbbbb\ncccc\n");
    truncateToTail(file, 10); // the tail starts right after a newline: keep it whole
    expect(readFileSync(file, "utf8")).toBe("bbbb\ncccc\n");
  });

  it("never throws when the path cannot be created (parent is a regular file)", () => {
    dir = mkdtempSync(path.join(tmpdir(), "bridge-log-"));
    const blocker = path.join(dir, "blocker");
    writeFileSync(blocker, "i am a file");
    const file = path.join(blocker, "sub", "daemon.log");
    const log = createFileLogger({ path: file, now: () => 0 });
    expect(() => log.log("anything")).not.toThrow();
    expect(() => log.setSecret(TOKEN)).not.toThrow();
    expect(existsSync(file)).toBe(false);
  });
});
