// Tests for recipes/blackboard/export-file.ts (file names, chunk ranges, hashes).
// *Retired 2026-10-25 (Step 10 S8): was "(file names, chunk ranges, reassembly, hashes) and
// recipes/blackboard/transcript.ts (the MCP leg of SDK-7 read back from a Claude transcript)", because the chunked
// MCP leg is retired (phase doc 0.5, Stage 0 F9, #209): the `assemble` test and the five `parseTranscriptChunks`
// tests left with assemble-mcp.ts, transcript.ts and `assemble()`.*
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  chunkRanges,
  exportFileName,
  isInside,
  MCP_CHUNK_CHARS,
  MCP_MAX_CHARS,
  mcpLegPlan,
  sha256Hex,
  verifyTransfer,
} from "../blackboard/export-file.js";

describe("exportFileName", () => {
  const d = new Date(Date.UTC(2026, 9, 23, 23, 30));
  it("<course>-<UTC date>.json for the SDK leg", () => {
    expect(exportFileName("_5_1", d, { dryRun: false, leg: "sdk" })).toBe("_5_1-2026-10-23.json");
  });
  it("-mcp for the MCP leg, dry- for a dry run", () => {
    expect(exportFileName("_5_1", d, { dryRun: false, leg: "mcp" })).toBe("_5_1-2026-10-23-mcp.json");
    expect(exportFileName("_5_1", d, { dryRun: true, leg: "sdk" })).toBe("dry-_5_1-2026-10-23.json");
  });
  it("refuses a course that is not an id", () => {
    expect(() => exportFileName("../x", d, { dryRun: false, leg: "sdk" })).toThrow();
  });
  // Added 2026-10-23 (S6 fixer r1, #96): a key-named course is filed under its label, never its id.
  it("a lower-case key label names the file (pp1-<date>.json); a dry run takes an id only", () => {
    expect(exportFileName("pp1", d, { dryRun: false, leg: "sdk" })).toBe("pp1-2026-10-23.json");
    expect(exportFileName("pp1", d, { dryRun: false, leg: "mcp" })).toBe("pp1-2026-10-23-mcp.json");
    expect(() => exportFileName("pp1", d, { dryRun: true, leg: "sdk" })).toThrow();
    expect(() => exportFileName("PP1", d, { dryRun: false, leg: "sdk" })).toThrow();
  });
});

describe("the MCP leg's size (S6 fixer r1: chunks ≤ 8000 characters, a pre-registered cap)", () => {
  it("chunks are at most 8000 characters", () => {
    expect(MCP_CHUNK_CHARS).toBeLessThanOrEqual(8000);
  });
  // Re-pinned 2026-10-23 (#102, before the MCP leg's re-run): the cap is 600 000 characters (75 chunks of
  // 8000); was 240 000 (30 chunks), registered in 23b878f.
  it("mcpLegPlan: measurable up to MCP_MAX_CHARS (600 000 characters, 75 chunks), else not measured", () => {
    expect(MCP_CHUNK_CHARS).toBe(8000);
    expect(MCP_MAX_CHARS).toBe(600_000);
    expect(mcpLegPlan(626)).toEqual({ measurable: true, chunks: 1 });
    expect(mcpLegPlan(418_406)).toEqual({ measurable: true, chunks: 53 });
    expect(mcpLegPlan(600_000)).toEqual({ measurable: true, chunks: 75 });
    expect(mcpLegPlan(600_001)).toEqual({ measurable: false, chunks: 76 });
    expect(() => mcpLegPlan(-1)).toThrow();
  });
});

describe("isInside", () => {
  it("is true only for a path under the root", () => {
    expect(isInside("C:\\repo", "C:\\repo\\exports\\a.json")).toBe(true);
    expect(isInside("C:\\repo", "C:\\Users\\me\\.browser-agent-bridge\\failures\\x.png")).toBe(false);
    expect(isInside("C:\\repo", "C:\\repo-other\\x")).toBe(false);
    expect(isInside("/repo", "/repo/a/b")).toBe(true);
    expect(isInside("/repo", "/repo/../etc")).toBe(false);
  });
});

describe("chunks", () => {
  it("chunkRanges covers [0, length) contiguously", () => {
    expect(chunkRanges(0, 10)).toEqual([]);
    expect(chunkRanges(25, 10)).toEqual([
      [0, 10],
      [10, 20],
      [20, 25],
    ]);
    expect(() => chunkRanges(5, 0)).toThrow();
  });
  it("MCP chunks stay under the MCP's 20 000-character output cap", () => {
    expect(MCP_CHUNK_CHARS).toBeLessThan(20_000);
  });
});

describe("verifyTransfer", () => {
  it("passes when length, bytes and sha256 match the page's", () => {
    const text = '{"a":"é"}';
    const sha = createHash("sha256").update(text, "utf8").digest("hex");
    expect(sha256Hex(text)).toBe(sha);
    expect(() => verifyTransfer(text, { length: text.length, bytes: Buffer.byteLength(text), sha256: sha })).not.toThrow();
  });
  it("fails on any mismatch", () => {
    const text = "abc";
    expect(() => verifyTransfer(text, { length: 4, bytes: 3, sha256: sha256Hex(text) })).toThrow(/length/);
    expect(() => verifyTransfer(text, { length: 3, bytes: 4, sha256: sha256Hex(text) })).toThrow(/bytes/);
    expect(() => verifyTransfer(text, { length: 3, bytes: 3, sha256: "0".repeat(64) })).toThrow(/sha256/);
  });
});
