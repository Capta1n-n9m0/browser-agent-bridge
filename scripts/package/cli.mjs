// Step 15 S2: the package's main bin (`npx browser-agent-bridge [command]`). Bundled to dist/cli.js; the MCP server
// and the doctor are separate bundles beside it, loaded on demand. It prints only fixed texts.
import { cliAction } from "./manifest.mjs";

const action = cliAction(process.argv.slice(2));
if ("run" in action) {
  await import(action.run === "mcp" ? "./mcp.js" : "./doctor.js");
} else {
  (action.exit === 0 ? process.stdout : process.stderr).write(action.message + "\n");
  process.exitCode = action.exit;
}
