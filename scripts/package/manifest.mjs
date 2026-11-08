// @ts-check
// Step 15 S2: the pure parts of the npm package (#449): its generated package.json and the CLI's choice of command.
// The package is generated into build/npm/ by build.mjs; the root package.json stays private.

export const PACKAGE_NAME = "browser-agent-bridge";
/** decisions.md #450, "For S2": the bundle holds AGPL-3.0-only code and the Apache-2.0 SDK and shared types. */
export const LICENSE_EXPRESSION = "AGPL-3.0-only AND Apache-2.0";
export const PACKAGE_FILES = ["dist", "types", "LICENSE", "LICENSE-APACHE", "LICENSES.md", "THIRD-PARTY-NOTICES.txt", "README.md"];

const SHEBANG = { js: "#!/usr/bin/env node" };
/**
 * The esbuild bundles build.mjs writes to dist/ (repo-relative source → dist file name). `native-host.js` (Step 15 S4)
 * is the path `nativeHostPlan` in scripts/bridge/lib.mjs registers for the package.
 * @type {readonly { in: string, out: string, banner?: { js: string }, external?: string[] }[]}
 */
export const BUNDLE_ENTRIES = [
  { in: "sdk/src/index.ts", out: "index.js" },
  { in: "mcp/src/index.ts", out: "mcp.js", banner: SHEBANG },
  { in: "daemon/src/index.ts", out: "daemon.js", banner: SHEBANG },
  { in: "scripts/bridge/doctor.ts", out: "doctor.js", banner: SHEBANG },
  { in: "scripts/bridge/setup.mjs", out: "setup.js", banner: SHEBANG },
  { in: "scripts/package/cli.mjs", out: "cli.js", banner: SHEBANG, external: ["./mcp.js", "./doctor.js", "./setup.js"] },
  { in: "scripts/native-host/host.mjs", out: "native-host.js" },
];

/**
 * @param {{ version: string }} root the root package.json (its version is the release's)
 * @param {Record<string, string>} dependencies the runtime dependencies left out of the bundles (ws)
 */
export function packageManifest(root, dependencies) {
  return {
    name: PACKAGE_NAME,
    version: root.version,
    description: "Drive your real, logged-in Chrome from an AI agent or a script: an MCP server, a daemon and a TypeScript SDK.",
    license: LICENSE_EXPRESSION,
    repository: { type: "git", url: "git+https://github.com/Capta1n-n9m0/browser-agent-bridge.git" },
    homepage: "https://github.com/Capta1n-n9m0/browser-agent-bridge#readme",
    keywords: ["chrome", "mcp", "browser-automation", "claude", "extension"],
    type: "module",
    main: "dist/index.js",
    types: "types/sdk/src/index.d.ts",
    exports: { ".": { types: "./types/sdk/src/index.d.ts", import: "./dist/index.js" }, "./package.json": "./package.json" },
    bin: { [PACKAGE_NAME]: "dist/cli.js", [`${PACKAGE_NAME}-doctor`]: "dist/doctor.js" },
    files: PACKAGE_FILES,
    engines: { node: ">=20" },
    dependencies,
  };
}

const USAGE = [
  `Usage: ${PACKAGE_NAME} [command]`,
  "  (none) | mcp   run the MCP server on stdio (what Claude starts)",
  "  doctor         one line per part of the install; never prints the token",
  "  setup          create the token, register the MCP entry and the native host (--dry-run shows the plan)",
  "  help           this text",
].join("\n");

/**
 * @param {string[]} args process.argv after the script
 * @returns {{ run: "mcp" | "doctor" | "setup" } | { exit: number, message: string }}
 */
export function cliAction(args) {
  const [cmd] = args;
  if (cmd === undefined || cmd === "mcp") return { run: "mcp" };
  if (cmd === "doctor") return { run: "doctor" };
  if (cmd === "setup") return { run: "setup" };
  if (cmd === "help" || cmd === "--help" || cmd === "-h") return { exit: 0, message: USAGE };
  return { exit: 2, message: `Unknown command.\n${USAGE}` };
}
