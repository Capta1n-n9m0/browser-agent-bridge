// connect(): the SDK entry point. Token → port → daemon path → hash → knock → BridgeClient, then
// wait for the extension (spec §9.7) unless `requireExtension: false`. Every configuration failure
// rejects before any socket.
import { BridgeError, ErrorCodes } from "@bridge/shared";
import { BridgeClient, onClientFailure, realTimers, type Timers } from "./client.js";
import { makeAdoptDaemon } from "./adopt.js";
import { knock, type KnockIo } from "./knock.js";
import { resolveDaemonPath } from "./paths.js";
import { hashDaemon, spawnDaemon } from "./spawn.js";
import { resolveToken } from "./token.js";
import { tryConnect } from "./transport.js";

export const DEFAULT_PORT = 9234;
export const DEFAULT_WAIT_FOR_EXTENSION_MS = 15_000;
/** Today's text from the MCP's `Bridge` (daemon/src/bridge.ts), kept as the exact prefix. */
export const EXTENSION_NOT_CONNECTED =
  "Extension not connected — is Chrome open and the Browser Agent Bridge extension enabled?";

export interface ConnectOptions {
  /** The actor name the daemon logs and lists (e.g. "export-grades.ts", "claude-code #1234"). */
  name: string;
  /** How long to wait for the extension after the welcome. Default 15 000. */
  waitForExtensionMs?: number;
  /**
   * Default true: wait up to `waitForExtensionMs` for the extension, then reject with NOT_CONNECTED.
   * False: resolve as soon as the daemon welcomes the client, whatever the extension's state;
   * `waitForExtensionMs` is then unused, and calls fail with the daemon's own NOT_CONNECTED while the
   * extension is down (`extensionConnected` follows it). The MCP uses false (decisions.md ·
   * 2026-10-22 #27).
   */
  requireExtension?: boolean;
  /** Overrides `BRIDGE_PORT`. Every client on a machine must use the same port. */
  port?: number;
  /** Default `process.env`. */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Where the workspace-root walk starts. Default: the SDK module's own directory. */
  startDir?: string;
  /**
   * Default true: when a `Tab` call (or a client method mirroring one) fails with
   * `LOCATOR_NOT_FOUND LOCATOR_AMBIGUOUS REF_STALE OFFSCREEN PAGE_ERROR NAV_FAILED TIMEOUT`, the SDK
   * attaches a snapshot, a screenshot path (`BRIDGE_FAILURES_DIR`, else
   * `~/.browser-agent-bridge/failures/`) and the tab's last 20 network entries to the error within 5 s,
   * with `error.report()`. The default-mode screenshot shows the tab for about 1.5 s. The attached
   * snapshot renumbers the tab's refs, as a script's own `snapshot()` does: after a failure, refs from
   * before it are void — use the refs in `error.snapshot` (the `candidates`/`matches` refs in
   * `error.data` are rewritten to them by role and name, or dropped when the item has no role or no
   * single element matches — every match loses its ref). False turns it
   * off (hot loops): errors are rethrown untouched with no extra call.
   */
  failureReports?: boolean;
  /** Test seams. */
  io?: Partial<KnockIo>;
  timers?: Timers;
}

function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
  });
}

export const realKnockIo: KnockIo = {
  tryConnect,
  spawnDaemon: (opts) => spawnDaemon(opts),
  hashDaemon,
  sleep: realSleep,
  now: () => performance.now(),
};

/**
 * The port: the `port` option, else `BRIDGE_PORT`, else 9234. Keeps the pre-Step-6 server's
 * validation (an integer 1–65535) and its error text.
 */
function resolvePort(env: Record<string, string | undefined>, override: number | undefined): number {
  const raw = override !== undefined ? String(override) : (env.BRIDGE_PORT ?? String(DEFAULT_PORT));
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`BRIDGE_PORT must be a valid port number, got: "${raw}"`);
  }
  return port;
}

function asNotConnected(err: unknown): BridgeError {
  if (err instanceof BridgeError) return err;
  return new BridgeError(ErrorCodes.NOT_CONNECTED, err instanceof Error ? err.message : String(err));
}

/**
 * Connects to the daemon (spawning or handing it over as needed) and, unless
 * `requireExtension: false`, waits for the extension.
 */
export async function connect(options: ConnectOptions): Promise<BridgeClient> {
  const env = options.env ?? process.env;
  const timers = options.timers ?? realTimers;
  const waitMs = options.waitForExtensionMs ?? DEFAULT_WAIT_FOR_EXTENSION_MS;
  const requireExtension = options.requireExtension ?? true;

  let token: string;
  let port: number;
  let daemonPath: string;
  try {
    token = resolveToken({ env, startDir: options.startDir });
    port = resolvePort(env, options.port);
    daemonPath = resolveDaemonPath({ env, startDir: options.startDir });
  } catch (err) {
    throw asNotConnected(err);
  }

  // The adopt check reads the daemon record under the home named by `env` (never os.homedir), so a test's env
  // reads no real record.
  const io: KnockIo = { ...realKnockIo, adoptDaemon: makeAdoptDaemon(env, realKnockIo.hashDaemon), ...options.io };
  const client = new BridgeClient({
    // A reconnect after 4002 never hands the daemon over (decision #10's purpose; see knock.ts).
    knock: ({ reconnect }) =>
      knock({ port, token, name: options.name, daemonPath, io, allowHandover: !reconnect }),
    timers,
    failureReports: options.failureReports ?? true,
    env,
  });
  try {
    await client.connect();
  } catch (err) {
    throw asNotConnected(err);
  }

  if (requireExtension && !client.extensionConnected) {
    try {
      // Resolves on an `extensionStatus {connected:true}` or on a 4002 reconnect whose welcome says
      // the extension is up; rejects at once with the client's own error if it fails meanwhile
      // (a non-4002 close or a failed reconnect), else after `waitMs` with today's text.
      await new Promise<void>((resolve, reject) => {
        const offs: (() => void)[] = [];
        const done = () => {
          timers.clearTimeout(timer);
          for (const off of offs) off();
        };
        const timer = timers.setTimeout(() => {
          done();
          reject(
            new BridgeError(
              ErrorCodes.NOT_CONNECTED,
              `${EXTENSION_NOT_CONNECTED} (waited ${waitMs} ms on port ${port})`,
            ),
          );
        }, waitMs);
        const check = () => {
          if (!client.extensionConnected) return;
          done();
          resolve();
        };
        offs.push(client.on("event", check));
        offs.push(client.on("reconnected", check));
        offs.push(
          onClientFailure(client, (err) => {
            done();
            reject(err);
          }),
        );
      });
    } catch (err) {
      client.close();
      throw err;
    }
  }
  return client;
}
