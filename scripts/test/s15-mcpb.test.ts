// Step 15 S5: the `.mcpb` manifest validates against the official schema (@anthropic-ai/mcpb, pinned), carries the
// release's version and points at the package's MCP bundle; the brand icons are PNGs of the right size.
import { readFileSync } from "node:fs";
import { v0_3 } from "@anthropic-ai/mcpb";
import { describe, expect, it } from "vitest";
import { BUNDLE_ENTRIES, LICENSE_EXPRESSION } from "../package/manifest.mjs";
import { MCPB_ENTRY, MCPB_MANIFEST_VERSION, mcpbManifest } from "../package/mcpb/manifest.mjs";

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

describe("the brand icons", () => {
  const dims = (rel: string) => {
    const png = readFileSync(new URL(rel, import.meta.url));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };
  it("the .mcpb icon is a 512x512 PNG", () => {
    expect(dims("../../assets/brand/icon-512.png")).toEqual([512, 512]);
  });
  it("the extension icons are square PNGs of the sizes the manifest names", () => {
    const m = JSON.parse(readFileSync(new URL("../../extension/manifest.json", import.meta.url), "utf8"));
    for (const s of [16, 32, 48, 128]) {
      expect(m.icons[s]).toBe(`icons/icon-${s}.png`);
      expect(dims(`../../extension/${m.icons[s]}`)).toEqual([s, s]);
    }
    expect(m.action.default_icon).toEqual(m.icons);
  });
});
