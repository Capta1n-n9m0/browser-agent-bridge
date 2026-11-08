// `npm run doctor`: one plain line per part, each failed line with its fix (Step 14 S2b, #429, #432). Runs under tsx
// (it reads the SDK's TypeScript). Read-only: it never spawns or hands over a daemon (one hello and `daemon.status`
// over the SDK's own socket), never calls the claude CLI (it reads .claude.json), and never prints a token value:
// tokens and ports are compared by equality only. Since Step 15 S2 it also runs from the installed npm package
// (bundled to dist/doctor.js, mode "package"): the token comes from the SDK's file lookup (the per-user file, then a
// clone's bridge.token) and the daemon from the SDK's path rule, so both modes read what the clients read.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isWelcome } from "@bridge/shared";
import { PROTOCOL_VERSION } from "../../sdk/src/knock.js";
import { resolveDaemonPath } from "../../sdk/src/paths.js";
import { hashDaemon } from "../../sdk/src/spawn.js";
import { findFileToken, findPackageRoot, findWorkspaceRoot, userTokenFile } from "../../sdk/src/token.js";
import { tryConnect, type Connection } from "../../sdk/src/transport.js";
import * as lib from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = findPackageRoot(here);
const mode = pkgRoot ? "package" : "clone";
const repo = pkgRoot ?? findWorkspaceRoot(here) ?? path.resolve(here, "..", "..");
const fsIo = { stat: (f: string) => (existsSync(f) ? statSync(f) : null), list: readdirSync, join: path.join };
const at = (f: string) => path.join(repo, f);
const read = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return null; } };
const same = (a: string | undefined, b: string | undefined): lib.Same =>
  a === undefined ? "none" : a.trim() === (b ?? "").trim() ? "same" : "differs";

const outputs = pkgRoot ? [] : lib.BUILD_OUTPUTS.map((f) => lib.newestMtime(at(f), fsIo));
const inputs = pkgRoot ? [] : lib.BUILD_INPUTS.map((f) => lib.newestMtime(at(f), fsIo)).filter((m): m is number => m !== null);
const tokenHit = findFileToken({ startDir: here });
const tokenFile = tokenHit?.token ?? null;
const daemonFile = (() => { try { return resolveDaemonPath({ startDir: here }); } catch { return null; } })();
const pkgVersion = pkgRoot ? (() => { try { return String(JSON.parse(read(at("package.json")) ?? "{}").version); } catch { return undefined; } })() : undefined;

let cfg: any = {};
try { cfg = JSON.parse(read(lib.claudeConfigPath(process.env, os.homedir())) ?? "{}"); } catch { cfg = null; }
const mcp = cfg ? lib.mcpDecision(cfg, repo, { tokenFile }) : null;
const entryEnv = lib.mcpEntry(cfg)?.env ?? {};
// What the MCP uses: the entry's env wins over the token files and 9234 (sdk/src/token.ts, connect.ts).
const mcpToken: string | null = typeof entryEnv.BRIDGE_TOKEN === "string" ? entryEnv.BRIDGE_TOKEN.trim() : tokenFile;
const mcpPort = String(entryEnv.BRIDGE_PORT ?? lib.PORT);

/** One hello and one daemon.status; a refused port is "down" (nothing is spawned). */
async function probe(): Promise<lib.DaemonFact> {
  if (!mcpToken) return { state: "notoken" };
  let conn: Connection;
  try { conn = await tryConnect(Number(mcpPort), 2000); }
  catch (err) {
    const code = (err as { code?: string }).code;
    return code === "ECONNREFUSED" ? { state: "down" } : { state: "error", detail: code ?? "connect failed" };
  }
  const expected = daemonFile ? await hashDaemon(daemonFile).catch(() => "none") : "none";
  const reply = await new Promise<{ welcome?: boolean; status?: any; closed?: number }>((resolve) => {
    const timer = setTimeout(() => resolve({}), 4000);
    const done = (r: { welcome?: boolean; status?: any; closed?: number }) => { clearTimeout(timer); resolve(r); };
    conn.onClose((code) => done({ closed: code }));
    conn.onMessage((m: any) => {
      if (isWelcome(m)) conn.send({ id: "doctor-1", method: "daemon.status" });
      else if (m?.id === "doctor-1") done({ welcome: true, status: m.result });
    });
    conn.send({ type: "hello", token: mcpToken, role: "client", name: "doctor", build: expected, proto: PROTOCOL_VERSION });
  });
  conn.close();
  if (reply.closed === 4001) return { state: "refused" };
  if (!reply.status) return { state: "error", detail: reply.closed ? `closed ${reply.closed}` : "no daemon.status answer" };
  return { state: "up", buildSame: reply.status.build === expected, extensionConnected: reply.status.extensionConnected === true };
}

const daemon = await probe();
const daemonLog = read(path.join(os.homedir(), ".browser-agent-bridge", "daemon.log")) ?? "";
const lines = lib.doctorLines({
  mode,
  pkgVersion,
  tokenSource: tokenHit?.source ?? null,
  userTokenFile: userTokenFile(process.env),
  node: process.versions.node,
  build: { missing: outputs.some((m) => m === null), stale: lib.buildNeeded(outputs, inputs) },
  token: tokenFile ? "ok" : "missing",
  mcp,
  shellToken: same(process.env.BRIDGE_TOKEN, mcpToken ?? undefined),
  shellPort: same(process.env.BRIDGE_PORT, mcpPort),
  daemon,
  port: mcpPort,
  extensionOlder: pkgRoot ? null : lib.extensionOlder(lib.newestMtime(at("extension/dist/sw.js"), fsIo), lib.lastResyncMs(daemonLog)),
});
for (const l of lines) console.log(lib.formatLine(l));
const failed = lines.filter((l) => l.level === "fail").length;
console.log(failed ? `\n${failed} part(s) failed: each FAIL line names its fix.` : "\nNo part failed.");
process.exitCode = failed ? 1 : 0;
