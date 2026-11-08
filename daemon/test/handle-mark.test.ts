import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHandleMark, timeBase, HANDLE_MARK_FILE, HANDLE_BLOCK, realMarkFs, type HandleMarkFs } from "../src/handle-mark.js";
import { HandleTable } from "../src/handles.js";

/**
 * Step 8 S2b.9 (decisions.md · 2026-10-23 · A new daemon never reuses a handle number (#79); #86 item 4):
 * the high-water mark, always in an injected temp directory — never `~/.browser-agent-bridge/` itself.
 */

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "s2b-handle-mark-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const markOf = (dir: string) => readFileSync(path.join(dir, HANDLE_MARK_FILE), "utf8");
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

describe("handle mark: the high-water mark file", () => {
  it("no file → numbering starts at 1, and the reserved ceiling is on disk before the first number is returned", () => {
    const dir = tempDir();
    const marks = createHandleMark({ dir, now: () => NOW });
    expect(existsSync(path.join(dir, HANDLE_MARK_FILE))).toBe(false); // reading writes nothing
    expect(marks.next()).toBe(1);
    expect(markOf(dir)).toBe(`${HANDLE_BLOCK}\n`);
    expect(marks.mode()).toBe("mark");
  });

  it("reserves in blocks: one write per block, the next block written before its first number is returned", () => {
    const dir = tempDir();
    const writes: string[] = [];
    const fs: HandleMarkFs = { read: realMarkFs.read, write: (f, t) => (writes.push(t), realMarkFs.write(f, t)) };
    const marks = createHandleMark({ dir, block: 4, fs });
    expect([marks.next(), marks.next(), marks.next(), marks.next()]).toEqual([1, 2, 3, 4]);
    expect(writes).toEqual(["4\n"]);
    expect(marks.next()).toBe(5);
    expect(writes).toEqual(["4\n", "8\n"]);
    expect(markOf(dir)).toBe("8\n");
  });

  it("the write is atomic: no temp file is left beside the mark", () => {
    const dir = tempDir();
    const marks = createHandleMark({ dir, block: 2 });
    for (let i = 0; i < 7; i++) marks.next();
    expect(readdirSync(dir)).toEqual([HANDLE_MARK_FILE]);
  });

  it("a second table started against the first's mark never re-mints a number the first minted", () => {
    const dir = tempDir();
    const first = new HandleTable({ numbers: createHandleMark({ dir, block: 4 }) });
    const minted1 = [first.mint(10), first.mint(11), first.mint(12), first.mint(13), first.mint(14)]; // crosses a block
    expect(minted1).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    const second = new HandleTable({ numbers: createHandleMark({ dir, block: 4 }) });
    const minted2 = [second.mint(10), second.mint(11)];
    expect(minted2).toEqual(["T9", "T10"]);
    for (const h of minted1) expect(second.resolve(h)).toEqual({ kind: "unknown" });
  });

  it("an unreadable mark (not a number) → a start-time base from the injected clock; logged once, no path", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, HANDLE_MARK_FILE), "garbage\n");
    const lines: string[] = [];
    const marks = createHandleMark({ dir, now: () => NOW, log: (m) => lines.push(m) });
    expect(marks.mode()).toBe("fallback");
    expect(marks.next()).toBe(timeBase(NOW));
    expect(marks.next()).toBe(timeBase(NOW) + 1);
    expect(lines).toEqual(["handle mark unreadable — handle numbers continue from a start-time base"]);
    for (const l of lines) expect(l).not.toContain(dir);
    // The first write repairs the file, so a later start continues above every number minted here.
    expect(Number(markOf(dir))).toBeGreaterThanOrEqual(timeBase(NOW) + 1);
    const later = createHandleMark({ dir, now: () => NOW });
    expect(later.mode()).toBe("mark");
    expect(later.next()).toBeGreaterThan(timeBase(NOW) + 1);
  });

  it("an unreadable mark (a directory) and a failed write → the time base, no further writes", () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, HANDLE_MARK_FILE));
    const lines: string[] = [];
    const marks = createHandleMark({ dir, now: () => NOW, log: (m) => lines.push(m) });
    expect(marks.mode()).toBe("fallback");
    const n1 = marks.next();
    expect(n1).toBeGreaterThanOrEqual(timeBase(NOW));
    expect(marks.next()).toBe(n1 + 1);
    expect(lines).toEqual([
      "handle mark unreadable — handle numbers continue from a start-time base",
      "handle mark not written — handle numbers continue from a time base",
    ]);
  });

  it("a write failure mid-run → the numbers jump to a time base above everything minted so far; logged once", () => {
    const dir = tempDir();
    let t = NOW;
    let fail = false;
    const writes: string[] = [];
    const fs: HandleMarkFs = {
      read: realMarkFs.read,
      write: (f, text) => {
        if (fail) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        writes.push(text);
        realMarkFs.write(f, text);
      },
    };
    const lines: string[] = [];
    const marks = createHandleMark({ dir, block: 2, now: () => t, fs, log: (m) => lines.push(m) });
    expect([marks.next(), marks.next()]).toEqual([1, 2]);
    fail = true;
    t = NOW + 5_000;
    const n = marks.next(); // 3 would need a new block: the write fails
    expect(n).toBe(timeBase(NOW + 5_000));
    expect(marks.next()).toBe(n + 1);
    expect(marks.next()).toBe(n + 2);
    expect(writes).toEqual(["2\n"]);
    expect(lines).toEqual(["handle mark not written — handle numbers continue from a time base"]);
    expect(marks.mode()).toBe("fallback");
  });

  it("no mark yet → the old state directory's mark is carried over (the rename, Step 15 S1); never written there", () => {
    const dir = tempDir();
    const old = tempDir();
    writeFileSync(path.join(old, HANDLE_MARK_FILE), "128\n");
    const marks = createHandleMark({ dir, legacyDirs: [old], block: 4 });
    expect(marks.next()).toBe(129);
    expect(markOf(dir)).toBe("132\n");
    expect(markOf(old)).toBe("128\n");
    expect(marks.mode()).toBe("mark");
  });

  it("a mark of its own wins over the old directory's; no old mark → starts at 1", () => {
    const dir = tempDir();
    const old = tempDir();
    writeFileSync(path.join(old, HANDLE_MARK_FILE), "500\n");
    writeFileSync(path.join(dir, HANDLE_MARK_FILE), "7\n");
    expect(createHandleMark({ dir, legacyDirs: [old] }).next()).toBe(8);
    const fresh = tempDir();
    expect(createHandleMark({ dir: fresh, legacyDirs: [tempDir()] }).next()).toBe(1);
  });

  it("an unreadable old mark with no mark of its own → the time base, as an unreadable mark", () => {
    const dir = tempDir();
    const old = tempDir();
    writeFileSync(path.join(old, HANDLE_MARK_FILE), "garbage");
    const logs: string[] = [];
    const marks = createHandleMark({ dir, legacyDirs: [old], now: () => NOW, log: (m) => logs.push(m) });
    expect(marks.next()).toBe(timeBase(NOW));
    expect(marks.mode()).toBe("fallback");
    expect(logs).toHaveLength(1);
  });

  it("timeBase: ms since 2026-01-01T00:00:00Z, at least 1, larger for a later start", () => {
    expect(timeBase(Date.UTC(2026, 0, 1))).toBe(1);
    expect(timeBase(0)).toBe(1);
    expect(timeBase(Date.UTC(2026, 0, 1) + 1234)).toBe(1234);
    expect(timeBase(NOW + 1)).toBeGreaterThan(timeBase(NOW));
  });
});

describe("HandleTable with injected numbers", () => {
  it("default (no numbers option) is today's T1, T2, …", () => {
    const t = new HandleTable();
    expect([t.mint(5), t.mint(6)]).toEqual(["T1", "T2"]);
  });

  it("takes each new number from the injected source, once per new live tab", () => {
    let n = 40;
    const t = new HandleTable({ numbers: { next: () => ++n } });
    expect([t.mint(5), t.mint(6), t.mint(5)]).toEqual(["T41", "T42", "T41"]);
  });
});
