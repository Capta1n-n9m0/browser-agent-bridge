import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connect } from "@bridge/sdk";
import { connectOptions } from "./config.js";
import { BridgeLink } from "./link.js";
import { TabCursor } from "./cursor.js";
import { registerTools } from "./tools/registry.js";
import { installLifecycle, isProcessAlive } from "./lifecycle.js";

async function main(): Promise<void> {
  // Connect to the bridge daemon (connect() starts or hands it over as needed), but never let a
  // failure crash the MCP server: the tools are registered regardless, every tool error and
  // browser_status carry the reason, and the link retries every 5 s — also after an established
  // connection closes with a code other than 4002 (decisions.md · 2026-10-22 #15). The client is held
  // whether or not the extension is up (`requireExtension: false`, decision #27).
  // The tab cursor (Step 7 T4) sees every client the link adopts: a second one, or a 4002 reconnect
  // of the current one, means the daemon restarted and the cursor's handle is lost.
  // (`link` is only called once a tool runs, after it exists.)
  const cursor = new TabCursor({ call: (method, params) => link.call(method, params) });
  const link: BridgeLink = new BridgeLink({
    connect: () => connect(connectOptions()),
    onClient: (client) => cursor.adopt(client),
    onChange: (reason) => {
      if (reason === null) console.error("[chrome-bridge] connected to the bridge daemon");
      else console.error(`[chrome-bridge] bridge daemon unavailable (retrying every 5 s): ${reason}`);
    },
  });
  link.start();

  const server = new McpServer({ name: "browser-agent-bridge", version: "0.1.0" });
  registerTools(server, link, cursor, { actorName: connectOptions().name });

  // Exit with the session. The daemon outlives it on purpose; this process only closes its client.
  installLifecycle({
    stdin: process.stdin,
    stdout: process.stdout,
    signals: process,
    parentPid: process.ppid,
    currentParentPid: () => process.ppid,
    isAlive: isProcessAlive,
    exit: (code) => process.exit(code),
    shutdown: async (reason) => {
      console.error(`[chrome-bridge] shutting down: ${reason}`);
      link.stop();
      await server.close().catch(() => {});
    },
  });

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[chrome-bridge] fatal:", err);
  process.exit(1);
});
