// Step 15 S5: the `.mcpb` manifest validates against the official schema (@anthropic-ai/mcpb, pinned), carries the
// release's version and points at the package's MCP bundle; the placeholder icon is a well-formed 512 px PNG.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { v0_3 } from "@anthropic-ai/mcpb";
import { describe, expect, it } from "vitest";
import { BUNDLE_ENTRIES, LICENSE_EXPRESSION } from "../package/manifest.mjs";
import { MCPB_ENTRY, MCPB_MANIFEST_VERSION, mcpbManifest } from "../package/mcpb/manifest.mjs";
import { placeholderIcon } from "../package/mcpb/icon.mjs";

const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

describe("the .mcpb manifest", () => {
  const m = mcpbManifest(root);
  it("passes the official 0.3 schema", () => {
    const r = v0_3.McpbManifestSchema.safeParse(m);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(m.manifest_version).toBe(MCPB_MANIFEST_VERSION);
  });
  it("has the release's version, the package's license and name", () => {
    expect(m.version).toBe(root.version);
    expect(m.license).toBe(LICENSE_EXPRESSION);
    expect(m.name).toBe("browser-agent-bridge");
  });
  it("runs the package's MCP bundle with Node, from the bundle's own folder", () => {
    expect(BUNDLE_ENTRIES.map((e) => `dist/${e.out}`)).toContain(MCPB_ENTRY);
    expect(m.server).toEqual({ type: "node", entry_point: MCPB_ENTRY, mcp_config: { command: "node", args: ["${__dirname}/dist/mcp.js"] } });
    expect(m.compatibility.platforms).toEqual(["darwin", "win32"]);
  });
  it("carries no env (no token in the bundle's config)", () => {
    expect(JSON.stringify(m)).not.toMatch(/BRIDGE_TOKEN|"env"/);
  });
});

describe("placeholderIcon", () => {
  it("is a 512x512 RGB PNG whose chunks check out", () => {
    const png = placeholderIcon(512);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(2);
    // IDAT holds 512 rows of 1 + 512*3 bytes
    const idatLen = png.readUInt32BE(33);
    expect(png.toString("ascii", 37, 41)).toBe("IDAT");
    expect(inflateSync(png.subarray(41, 41 + idatLen)).length).toBe(512 * (1 + 512 * 3));
    expect(png.toString("ascii", png.length - 8, png.length - 4)).toBe("IEND");
  });
});
