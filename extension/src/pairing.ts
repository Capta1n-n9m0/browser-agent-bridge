// Step 15 S4 (#449): pairing with the local install through the native host, without a pasted token. Pure: no
// `chrome.*` here — `sw.ts` injects `runtime.sendNativeMessage` and `storage.local`. Only `connect()` in `sw.ts` calls
// `pairOnce`, and only while no token is stored; nothing on the wire triggers or changes it. A token the human typed is
// never overwritten: the store is re-read right before the write. No log call here: `pairLogLine` gives the one fixed
// line per attempt, and no text from Chrome or the host (nor the reply) is ever logged.

/** The host's registered name; equals `NATIVE_HOST_NAME` in scripts/bridge/lib.mjs (a test pins the two). */
export const NATIVE_HOST_NAME = "com.browser_agent_bridge.host";
/** The one request the host answers. */
export const PAIR_REQUEST: Readonly<{ type: "pair" }> = Object.freeze({ type: "pair" });
/** A token accepted from the host: the host's own `TOKEN_RE` (scripts/native-host/pair.mjs; a test pins the two). */
export const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{16,256}$/;
/** The first wait after a failed attempt; each further failure doubles it, up to `PAIR_MAX_RETRY_MS`. */
export const PAIR_FIRST_RETRY_MS = 30_000;
export const PAIR_MAX_RETRY_MS = 30 * 60_000;
/** An attempt whose host does not answer in this time counts as unavailable (the host's own read timeout is 5 s). */
export const PAIR_TIMEOUT_MS = 10_000;

export interface Pairing {
  token: string;
  port: number;
}

/** The host's success reply, exactly `{ok:true, token, port}` with a sane token and port; anything else → null. */
export function validPairReply(reply: unknown): Pairing | null {
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return null;
  const o = reply as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== "ok,port,token" || o.ok !== true) return null;
  if (typeof o.token !== "string" || !TOKEN_RE.test(o.token)) return null;
  if (typeof o.port !== "number" || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535) return null;
  return { token: o.token, port: o.port };
}

/** A host's refusal: `{ok:false, …}`. Its error text is never read further or logged. */
const isRefusal = (reply: unknown): boolean =>
  typeof reply === "object" && reply !== null && (reply as Record<string, unknown>).ok === false;

/**
 * When the next attempt may run: at once on a worker start (a fresh instance), then after each failure at a growing
 * interval (30 s, 60 s, … up to 30 min), so the 25 s keepalive does not start a host process each tick.
 */
export class PairBackoff {
  private failures = 0;
  private nextAt = 0;
  constructor(private readonly now: () => number) {}
  due(): boolean {
    return this.now() >= this.nextAt;
  }
  failed(): void {
    this.failures++;
    this.nextAt = this.now() + Math.min(PAIR_FIRST_RETRY_MS * 2 ** (this.failures - 1), PAIR_MAX_RETRY_MS);
  }
  reset(): void {
    this.failures = 0;
    this.nextAt = 0;
  }
}

export type PairOutcome =
  | "paired" // {token, port} written
  | "not-due" // the back-off holds; nothing asked
  | "host-unavailable" // sendNativeMessage rejected or timed out (no host, forbidden, exited, failed to start)
  | "host-refused" // the host answered {ok:false, …}
  | "invalid-reply" // the host answered something that is not a valid {ok:true, token, port}
  | "token-present" // a token was stored meanwhile (the human typed one): kept, nothing written
  | "store-failed"; // the re-read or the write failed

export interface PairDeps {
  /** `chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, PAIR_REQUEST)`. */
  ask(): Promise<unknown>;
  /** The stored `token` value as `storage.local` holds it (any type). */
  readToken(): Promise<unknown>;
  /** Writes exactly `{token, port}`. */
  write(p: Pairing): Promise<void>;
  /** Resolves after `ms` (the attempt's time bound). */
  delay(ms: number): Promise<void>;
}

/** The stored token counts as empty exactly as `getConfig` in sw.ts reads it (`String(token ?? "")`). */
const storedEmpty = (token: unknown): boolean => String(token ?? "") === "";

/** One pairing attempt, when the back-off allows it. Never throws. */
export async function pairOnce(deps: PairDeps, backoff: PairBackoff): Promise<PairOutcome> {
  if (!backoff.due()) return "not-due";
  const TIMED_OUT = Symbol("timeout");
  let reply: unknown;
  try {
    reply = await Promise.race([deps.ask(), deps.delay(PAIR_TIMEOUT_MS).then(() => TIMED_OUT)]);
  } catch {
    reply = TIMED_OUT;
  }
  if (reply === TIMED_OUT) {
    backoff.failed();
    return "host-unavailable";
  }
  const pairing = validPairReply(reply);
  if (!pairing) {
    backoff.failed();
    return isRefusal(reply) ? "host-refused" : "invalid-reply";
  }
  try {
    if (!storedEmpty(await deps.readToken())) {
      backoff.reset();
      return "token-present";
    }
    await deps.write(pairing);
  } catch {
    backoff.failed();
    return "store-failed";
  }
  backoff.reset();
  return "paired";
}

/** The one fixed log line per attempt (null: no attempt, no line). Never a token, a reply or Chrome's message. */
export function pairLogLine(outcome: PairOutcome): string | null {
  switch (outcome) {
    case "paired":
      return "[bridge] pairing: paired with the local install";
    case "host-unavailable":
      return "[bridge] pairing: no native host answered — run setup, or set the token in the options page";
    case "host-refused":
      return "[bridge] pairing: the native host refused — run setup, or set the token in the options page";
    case "invalid-reply":
      return "[bridge] pairing: the native host's reply was not valid; nothing stored";
    case "token-present":
      return "[bridge] pairing: a token was set meanwhile; kept it";
    case "store-failed":
      return "[bridge] pairing: storage failed; nothing stored";
    case "not-due":
      return null;
  }
}
