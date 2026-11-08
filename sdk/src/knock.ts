// The knock: the SDK side of the daemon lifecycle (phase-doc 0.7, spec §9). A pure async state
// machine over an injected `io`, so every timeout is measured by the injected clock.
//
//   knock → ECONNREFUSED ─► spawn (once per cycle) ─► knock every 250 ms, ≤ 10 s ─► hello
//         → connected ─► hello ─► welcome (≤ 2 s, else VERSION: a pre-Step-6 server holds the port)
//              build == expected ? done
//              : first mismatch → daemon.shutdown ─► wait close ─► knock until refused ─► spawn ─► …
//              : mismatch after our own handover → VERSION (one handover per connect())
//              : mismatch with handover disabled (a reconnect after 4002) → VERSION
//
// The 10 s budget runs from the first knock and starts again at the handover (the handover
// re-enters the "knock until refused → spawn" branch of 0.7, which carries its own ≤ 10 s).
import { BridgeError, ErrorCodes, isWelcome, type HelloMessage, type WelcomeMessage } from "@bridge/shared";
import type { Connection } from "./transport.js";

export const PROTOCOL_VERSION = 2;
export const KNOCK_LIMIT_MS = 10_000;
export const KNOCK_INTERVAL_MS = 250;
export const WELCOME_TIMEOUT_MS = 2_000;
/** Floor for one attempt's handshake timeout when little of the budget is left. */
export const MIN_HANDSHAKE_MS = 100;
export const DAEMON_LOG = "~/.browser-agent-bridge/daemon.log";
/** Close code the daemon uses for a bad token, an unknown role or a malformed hello. */
export const CLOSE_BAD_HELLO = 4001;

export interface KnockIo {
  /**
   * Opens a socket to 127.0.0.1:<port>; rejects with an error whose `code` is e.g. ECONNREFUSED.
   * `timeoutMs` bounds the opening handshake (a holder that accepts TCP but never answers the
   * upgrade); a handshake timeout rejects with code ETIMEDOUT.
   */
  tryConnect(port: number, timeoutMs?: number): Promise<Connection>;
  spawnDaemon(opts: { daemonPath: string; port: number; token: string }): void | Promise<void>;
  hashDaemon(daemonPath: string): Promise<string>;
  /** Resolves after `ms`; an aborted sleep may stay pending forever (nothing awaits it then). */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Milliseconds on the same clock `sleep` advances. */
  now(): number;
}

export interface KnockOptions {
  port: number;
  token: string;
  name: string;
  daemonPath: string;
  io: KnockIo;
  /**
   * Default true. False on a reconnect after 4002: another client deliberately replaced the
   * daemon, so a build mismatch there is VERSION, never a second handover (decision #10's purpose:
   * no handing the daemon back and forth across clients). Spawning on a refused port still happens.
   */
  allowHandover?: boolean;
}

export interface Knocked {
  conn: Connection;
  welcome: WelcomeMessage;
}

type HelloOutcome =
  | { kind: "welcome"; welcome: WelcomeMessage }
  | { kind: "closed"; code: number; reason: string }
  | { kind: "timeout" };

function errorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * Sends hello and waits ≤ 2 s (injected clock) for a welcome or a close. The message listener
 * unsubscribes itself synchronously at the welcome, so every frame behind it — even one in the
 * same TCP read, e.g. `extensionStatus` — goes to the transport's buffer for the client.
 */
async function sayHello(conn: Connection, hello: HelloMessage, io: KnockIo): Promise<HelloOutcome> {
  const state: { outcome: HelloOutcome | null } = { outcome: null };
  let settle!: (o: HelloOutcome) => void;
  const answered = new Promise<HelloOutcome>((resolve) => {
    settle = (o) => {
      if (state.outcome) return;
      state.outcome = o;
      resolve(o);
    };
  });
  let offMessage: (() => void) | null = null;
  let welcomed = false;
  offMessage = conn.onMessage((m) => {
    if (welcomed || !isWelcome(m)) return;
    welcomed = true;
    offMessage?.();
    settle({ kind: "welcome", welcome: m });
  });
  if (welcomed) offMessage();
  const offClose = conn.onClose((code, reason) => settle({ kind: "closed", code, reason }));
  try {
    conn.send(hello);
    if (state.outcome) return state.outcome;
    const abort = new AbortController();
    const timeout = io.sleep(WELCOME_TIMEOUT_MS, abort.signal).then((): HelloOutcome => ({ kind: "timeout" }));
    const outcome = await Promise.race([answered, timeout]);
    abort.abort();
    return outcome;
  } finally {
    offMessage();
    offClose();
  }
}

/** Sends `daemon.shutdown` and waits for the socket to close (any code; 4002 expected). */
async function handOver(conn: Connection, io: KnockIo, deadline: number): Promise<boolean> {
  const state = { closed: false };
  let markClosed!: () => void;
  const closed = new Promise<boolean>((resolve) => {
    markClosed = () => {
      state.closed = true;
      resolve(true);
    };
  });
  const off = conn.onClose(() => markClosed());
  try {
    conn.send({ id: "handover", method: "daemon.shutdown" });
    if (state.closed) return true;
    const abort = new AbortController();
    const timeout = io.sleep(Math.max(0, deadline - io.now()), abort.signal).then(() => false);
    const result = await Promise.race([closed, timeout]);
    abort.abort();
    return result;
  } finally {
    off();
  }
}

function giveUp(port: number, handedOver: boolean, detail: string): BridgeError {
  const since = handedOver ? "of asking the old daemon to step down (daemon.shutdown)" : "of the first knock";
  return new BridgeError(
    ErrorCodes.NOT_CONNECTED,
    `Could not reach the bridge daemon on 127.0.0.1:${port} within ${KNOCK_LIMIT_MS / 1000} s ${since} ` +
      `(${detail}) — see ${DAEMON_LOG}`,
  );
}

const ONE_BUILD =
  "Every client on a machine must point at one daemon build (BRIDGE_DAEMON is a development override).";

/** The daemon's close reason, made safe to show: never the token, never more than one short line. */
function safeReason(reason: string, token: string): string {
  let r = reason.replace(/[\r\n]+/g, " ").trim();
  if (token) r = r.split(token).join("<token>");
  return r.slice(0, 123);
}

/**
 * Runs the knock and resolves with an open, welcomed connection whose build matches the daemon
 * file this client would spawn. The returned connection carries no listeners of the knock's.
 */
export async function knock(options: KnockOptions): Promise<Knocked> {
  const { port, token, name, daemonPath, io } = options;
  const allowHandover = options.allowHandover ?? true;
  const expected = await io.hashDaemon(daemonPath);
  const hello: HelloMessage = { type: "hello", token, role: "client", name, build: expected, proto: PROTOCOL_VERSION };

  let deadline = io.now() + KNOCK_LIMIT_MS;
  let spawned = false; // in the current cycle (reset by the handover)
  let handedOverFrom: string | null = null; // the build this connect() shut down
  let draining = false; // the last answer came from the build we shut down
  let last = "nothing answered";

  for (;;) {
    let conn: Connection | null = null;
    try {
      conn = await io.tryConnect(port, Math.max(MIN_HANDSHAKE_MS, deadline - io.now()));
    } catch (err) {
      const code = errorCode(err);
      draining = false;
      last = `last error: ${code ?? "connect failed"}`;
      if (code === "ECONNREFUSED" && !spawned) {
        spawned = true;
        try {
          await io.spawnDaemon({ daemonPath, port, token });
        } catch {
          // A failed spawn, or a daemon that lost the bind race to another starter's: keep knocking.
        }
      }
    }

    if (conn) {
      draining = false;
      const outcome = await sayHello(conn, hello, io);
      if (outcome.kind === "timeout") {
        conn.close();
        throw new BridgeError(
          ErrorCodes.VERSION,
          `No welcome from 127.0.0.1:${port} within ${WELCOME_TIMEOUT_MS / 1000} s after hello: a pre-Step-6 ` +
            `bridge server holds port ${port}. End the old Claude session (or stop the old ` +
            "`node …/server/dist/index.js`) and try again.",
        );
      }
      if (outcome.kind === "closed") {
        if (outcome.code === CLOSE_BAD_HELLO) {
          const reason = safeReason(outcome.reason, token);
          throw new BridgeError(
            ErrorCodes.NOT_CONNECTED,
            `The bridge daemon on port ${port} rejected the token or the hello (close 4001` +
              `${reason ? `: "${reason}"` : ""}). The token must match ` +
              "bridge.token at the workspace root / BRIDGE_TOKEN, and the token in the extension's Options.",
          );
        }
        last = `the daemon closed the socket during hello (${outcome.code})`;
      } else {
        const { welcome } = outcome;
        if (welcome.proto !== PROTOCOL_VERSION) {
          conn.close();
          throw new BridgeError(
            ErrorCodes.VERSION,
            `The bridge daemon on port ${port} speaks protocol v${welcome.proto}; this client speaks ` +
              `v${PROTOCOL_VERSION}. Rebuild (\`npm run build\`) so the daemon and its clients match.`,
          );
        }
        if (welcome.build === expected) return { conn, welcome };

        if (!allowHandover) {
          // A reconnect after 4002: someone else replaced the daemon on purpose. Never hand it back.
          conn.close();
          throw new BridgeError(
            ErrorCodes.VERSION,
            `The bridge daemon on port ${port} was replaced by build ${welcome.build}, but this client expects ` +
              `build ${expected}; after a daemon restart (4002) this client does not hand the daemon over. ` +
              ONE_BUILD,
          );
        }

        if (handedOverFrom === null) {
          // First mismatch: ask the stale daemon to step down, then start a fresh cycle.
          handedOverFrom = welcome.build;
          deadline = io.now() + KNOCK_LIMIT_MS;
          spawned = false;
          if (!(await handOver(conn, io, deadline))) {
            conn.close();
            throw giveUp(port, true, `daemon build ${welcome.build} did not close after daemon.shutdown`);
          }
          last = "handed the old daemon over";
          continue;
        }

        conn.close();
        if (!spawned && welcome.build === handedOverFrom) {
          // The daemon we shut down is still draining: knock until the port is refused.
          draining = true;
          last = "the old daemon was still answering after daemon.shutdown";
        } else {
          throw new BridgeError(
            ErrorCodes.VERSION,
            `The bridge daemon on port ${port} runs build ${welcome.build}, but this client expects build ` +
              `${expected}, and it already handed the daemon over once in this connect(). ` +
              ONE_BUILD,
          );
        }
      }
    }

    if (io.now() >= deadline) {
      if (draining && handedOverFrom !== null) {
        // Still the old build 10 s after it was asked to step down: another client on that build
        // most likely started it again. A second handover is forbidden, so this is a build conflict.
        throw new BridgeError(
          ErrorCodes.VERSION,
          `The bridge daemon on port ${port} still runs build ${handedOverFrom} ${KNOCK_LIMIT_MS / 1000} s after ` +
            `this client asked it to step down; this client expects build ${expected}. Another client on ` +
            `build ${handedOverFrom} has probably started it again. ` +
            ONE_BUILD,
        );
      }
      throw giveUp(port, handedOverFrom !== null, `${spawned ? "started a daemon; " : ""}${last}`);
    }
    await io.sleep(KNOCK_INTERVAL_MS);
  }
}
