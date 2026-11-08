// The daemon's process lifecycle (Stage D3; spec §9, phase-doc decisions 0.5–0.8). `index.ts` calls
// `runDaemon` with the real process; tests call it with a fake host, exit and signal registration.
//
// The daemon has no stdio (it is spawned with `stdio: "ignore"`): everything goes to the log, and
// nothing here writes to stdout or stderr. The bind is the lock (spec §9.3): one `listen()`, and
// `EADDRINUSE` means another daemon won — log and exit 0, never a second attempt.
import path from "node:path";
import { resolveToken as sdkResolveToken } from "@bridge/sdk/token";
import { Bridge } from "./bridge.js";
import { buildHash } from "./build.js";
import { createHandleMark } from "./handle-mark.js";
import { writeDaemonRecord } from "./daemon-record.js";
import { IdleTimer, MAX_IDLE_MS } from "./idle.js";
import type { Logger } from "./log.js";
import type { ClientInfo } from "./registry.js";
import { WsHost, type HostStats, type WsHostOptions } from "./wsHost.js";

export const DEFAULT_PORT = 9234;
export const DEFAULT_IDLE_MS = 600_000;
export { MAX_IDLE_MS };
/** Close code for a daemon going away on a signal or the idle timer (RFC 6455 "going away"). */
export const CLOSE_GOING_AWAY = 1001;

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;
type TimerHandle = ReturnType<typeof setTimeout>;

/** What `runDaemon` needs from the host — `WsHost` satisfies it. */
export interface DaemonHost {
  listen(): Promise<number>;
  shutdown(code: number): Promise<void>;
  stats(): HostStats;
  readonly registry: {
    count(): number;
    list(): ClientInfo[];
    onCountChange(cb: (count: number) => void): () => void;
  };
}

export interface DaemonDeps {
  env: Env;
  /** The entry's own path (`process.argv[1]`); its sha256 is the build identity. */
  argv1: string;
  pid?: number;
  logger: Logger;
  exit: (code: number) => void;
  /** `process.on` — signals and the fatal handlers. */
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  /** Default: a real `WsHost` over a new `Bridge` (binds 127.0.0.1). */
  createHost?: (options: WsHostOptions) => DaemonHost;
  /** Default: the sdk's `resolveToken({ env })`. */
  resolveToken?: (env: Env) => string;
  setTimeout?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout?: (handle: TimerHandle) => void;
  /**
   * The state directory holding the handle high-water mark (Step 8 S2b.9, decisions.md #79). `index.ts`
   * passes the daemon log's directory (`~/.browser-agent-bridge/`). Absent → no mark file: handle numbers
   * start at T1 per process, so a test that runs `runDaemon` never touches the real directory.
   */
  stateDir?: string;
  /** Older state directories whose handle mark is carried over when `stateDir` has none (the rename, Step 15 S1). */
  legacyStateDirs?: string[];
}

/** A TCP port 1–65535 written as plain digits, else null. */
export function parsePort(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_PORT;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : null;
}

/**
 * A whole number of ms from 1 to `MAX_IDLE_MS` written as plain digits, else null. Above that, Node's
 * `setTimeout` would warn and fire after 1 ms — the daemon would idle out at once.
 */
export function parseIdleMs(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_IDLE_MS;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_IDLE_MS ? n : null;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function clients(n: number): string {
  return `${n} client${n === 1 ? "" : "s"}`;
}

export async function runDaemon(deps: DaemonDeps): Promise<void> {
  const { env, logger } = deps;
  let exiting = false;
  let host: DaemonHost | undefined;
  let idle: IdleTimer | undefined;

  const exitOnce = (code: number, why: string): void => {
    if (exiting) return;
    exiting = true;
    idle?.dispose();
    let counts = "";
    if (host) {
      const s = host.stats();
      counts = ` clients=${s.clients} extensionEvents=${s.extensionEvents} ignoredClientFrames=${s.ignoredClientFrames}`;
    }
    logger.log(`exit ${code} (${why})${counts}`);
    deps.exit(code);
  };

  const fatal = (err: unknown): void => {
    logger.log(`fatal: ${errorName(err)}`);
    exitOnce(1, "fatal");
  };
  deps.on("uncaughtException", fatal);
  deps.on("unhandledRejection", fatal);

  const pid = deps.pid ?? process.pid;
  logger.log(`start pid=${pid}`);

  const port = parsePort(env.BRIDGE_PORT);
  if (port === null) {
    logger.log("BRIDGE_PORT is not a port number (1-65535)");
    exitOnce(1, "bad BRIDGE_PORT");
    return;
  }

  let idleMs = parseIdleMs(env.BRIDGE_DAEMON_IDLE_MS);
  if (idleMs === null) {
    logger.log(`BRIDGE_DAEMON_IDLE_MS is not a whole number of ms from 1 to ${MAX_IDLE_MS}; using ${DEFAULT_IDLE_MS}`);
    idleMs = DEFAULT_IDLE_MS;
  }

  let token: string;
  try {
    token = (deps.resolveToken ?? ((e: Env) => sdkResolveToken({ env: e })))(env);
  } catch (err) {
    // resolveToken's message names the two places to look and never contains a token value.
    logger.log(err instanceof Error ? err.message : "No bridge token");
    exitOnce(1, "no token");
    return;
  }
  logger.setSecret(token);

  let build: string;
  try {
    build = buildHash(path.resolve(deps.argv1));
  } catch (err) {
    logger.log(`cannot hash the daemon entry for its build id: ${errorCode(err) ?? errorName(err)}`);
    exitOnce(1, "no build id");
    return;
  }
  logger.log(`config pid=${pid} port=${port} idleMs=${idleMs} build=${build}`);

  const options: WsHostOptions = {
    port,
    token,
    build,
    // Every shutdown — a signal, the idle timer, or a client's `daemon.shutdown` (4002) — ends here.
    onShutdown: (code) => exitOnce(0, `shutdown ${code}`),
    // Step 7: resync lines; Step 8 S2b: session-change, codeless-error and handle-mark lines (handles,
    // methods, counts — never a URL, title or the session marker).
    log: (msg) => logger.log(msg),
  };
  if (deps.stateDir !== undefined) {
    options.handleNumbers = createHandleMark({
      dir: deps.stateDir,
      legacyDirs: deps.legacyStateDirs,
      log: (msg) => logger.log(msg),
    });
  }
  host = (deps.createHost ?? ((o) => new WsHost(new Bridge(), o)))(options);
  const live = host;

  const stop = (why: string): void => {
    if (exiting) return;
    logger.log(`${why} — shutting down`);
    live.shutdown(CLOSE_GOING_AWAY).catch((err: unknown) => {
      logger.log(`shutdown failed: ${errorName(err)}`);
      exitOnce(0, why);
    });
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) deps.on(sig, () => stop(sig));

  try {
    const bound = await live.listen();
    logger.log(`listening on 127.0.0.1:${bound}`);
    // Step 15 S3: written synchronously before any connection is served, so a client's welcome always finds
    // the record of the daemon that sent it (sdk/src/adopt.ts). No path in the log line.
    if (deps.stateDir !== undefined) {
      try {
        writeDaemonRecord(deps.stateDir, bound, { build, path: path.resolve(deps.argv1), pid });
      } catch {
        logger.log("daemon record not written — clients of another install may hand this daemon over");
      }
    }
  } catch (err) {
    if (errorCode(err) === "EADDRINUSE") {
      logger.log(`port ${port} in use — another daemon owns it`);
      exitOnce(0, "port in use");
    } else {
      logger.log(`cannot listen on port ${port}: ${errorCode(err) ?? errorName(err)}`);
      exitOnce(1, "listen failed");
    }
    return;
  }
  if (exiting) return;

  const idleMsFinal = idleMs;
  idle = new IdleTimer({
    ms: idleMsFinal,
    onIdle: () => stop(`idle for ${idleMsFinal} ms with no clients`),
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
  });

  const known = new Map<string, string>(live.registry.list().map((c) => [c.id, c.name]));
  live.registry.onCountChange((count) => {
    const now = new Map(live.registry.list().map((c) => [c.id, c.name]));
    for (const [id, name] of now) if (!known.has(id)) logger.log(`client + ${JSON.stringify(name)} (${clients(count)})`);
    for (const [id, name] of known) if (!now.has(id)) logger.log(`client - ${JSON.stringify(name)} (${clients(count)})`);
    known.clear();
    for (const [id, name] of now) known.set(id, name);
    idle?.update(count);
  });
  // Armed at start: a spawned daemon nobody connects to must still go away.
  idle.update(live.registry.count());
}
