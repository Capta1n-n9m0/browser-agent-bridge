// @ts-check
// Step 15 S5: the Claude Desktop extension's manifest.json (MCPB), generated from the root package.json so its version
// is the release's (#447). Pure. `manifest_version` 0.3: the schema in @anthropic-ai/mcpb 2.1.2 (dist/
// mcpb-manifest-v0.3.schema.json); 0.4 only adds the `uv` server type, which a Node server does not need.
import { LICENSE_EXPRESSION, PACKAGE_NAME } from "../manifest.mjs";

export const MCPB_MANIFEST_VERSION = "0.3";
const REPO_URL = "https://github.com/Capta1n-n9m0/browser-agent-bridge";
/** Where the MCP server sits inside the bundle: the npm package's own layout (build/npm/), so the SDK finds the package. */
export const MCPB_ENTRY = "dist/mcp.js";

/** @param {{ version: string }} root the root package.json */
export function mcpbManifest(root) {
  return {
    manifest_version: MCPB_MANIFEST_VERSION,
    name: PACKAGE_NAME,
    display_name: "Browser Agent Bridge",
    version: root.version,
    description: "Lets Claude drive your real, logged-in Chrome through the Browser Agent Bridge extension.",
    long_description: "Browser Agent Bridge connects Claude to the Chrome you already use, with your logins, through a small"
      + " Chrome extension and a local helper that listens on 127.0.0.1 only. Install the Browser Agent Bridge extension in"
      + " Chrome as well. On its first start this server makes a private token in your user folder and registers a native"
      + " messaging host that only that extension may call, so the extension pairs by itself. The extension's toolbar button"
      + " turns the bridge off at any time.",
    author: { name: "Browser Agent Bridge contributors", url: REPO_URL },
    repository: { type: "git", url: `${REPO_URL}.git` },
    homepage: REPO_URL,
    documentation: `${REPO_URL}/blob/main/docs/setup.md`,
    support: `${REPO_URL}/issues`,
    icon: "icon.png",
    server: {
      type: "node",
      entry_point: MCPB_ENTRY,
      mcp_config: { command: "node", args: [`\${__dirname}/${MCPB_ENTRY}`] },
    },
    tools_generated: true,
    keywords: ["chrome", "browser", "automation", "mcp"],
    license: LICENSE_EXPRESSION,
    compatibility: { platforms: ["darwin", "win32"], runtimes: { node: ">=20.0.0" } },
  };
}
