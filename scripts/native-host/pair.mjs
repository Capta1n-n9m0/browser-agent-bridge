// @ts-check
// Step 15 S4 (#449): the native host's pure logic. The host answers exactly one request, `{type:"pair"}`, from exactly
// one caller, the extension's fixed origin (lib.EXTENSION_ORIGIN, which Chrome passes as the first argument), with
// `{ok:true, token, port}`; anything else gets `{ok:false, error:<fixed code>}`. An error reply never echoes the request
// and never holds the token. Node built-ins and lib.mjs only (it runs from a clone as plain node and is bundled into the
// package). Nothing here reads a file or a stream: the file reader is injected, `host.mjs` does the I/O.
import path from "node:path";
import { EXTENSION_ORIGIN, PORT, TOKEN_FILE, userTokenFile } from "../bridge/lib.mjs";

/** The largest request the host reads; a larger declared length is refused before its body is read. */
export const MAX_REQUEST_BYTES = 4096;
/** How long the host waits for the whole request before it answers "timeout" and exits. */
export const READ_TIMEOUT_MS = 5000;
/** The package's name, which is also the per-user folder's (mirrors `PACKAGE_NAME` in sdk/src/token.ts). */
const PACKAGE_NAME = "browser-agent-bridge";
/**
 * A token the host hands out and the extension accepts: setup writes 64 hex digits; a hand-made one may use the
 * URL-safe and base64 characters, 16 to 256 of them. Anything else (spaces, quotes, control characters) is refused
 * ("bad-token"). `extension/src/pairing.ts` holds the same pattern; a test pins the two together.
 */
export const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{16,256}$/;

/** Every error code the host may send. Fixed strings: no reply carries any input. */
export const ERRORS = Object.freeze(/** @type {const} */ ({
  origin: "forbidden-origin",
  tooLarge: "too-large",
  malformed: "malformed",
  unknownType: "unknown-type",
  timeout: "timeout",
  noToken: "no-token",
  badToken: "bad-token",
}));
/** @typedef {typeof ERRORS[keyof typeof ERRORS]} ErrorCode */
/** @typedef {{ ok: true, token: string, port: number } | { ok: false, error: ErrorCode }} Reply */

/** @param {ErrorCode} error @returns {Reply} */
export const errorReply = (error) => ({ ok: false, error });

/** True only when the caller's origin (the host's first argument) is exactly the extension's. @param {readonly string[]} args */
export const originAllowed = (args) => args[0] === EXTENSION_ORIGIN;

/**
 * One native-messaging frame: a 32-bit length in the given byte order (Chrome uses the machine's), then UTF-8 JSON.
 * @param {unknown} message @param {"LE" | "BE"} endian @returns {Buffer}
 */
export function encodeFrame(message, endian) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const head = Buffer.alloc(4);
  if (endian === "LE") head.writeUInt32LE(body.length, 0);
  else head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

/**
 * Collects one request frame from stdin chunks. `push` answers "need" until the frame is whole, then the body; a
 * declared length of 0 or over `max` is refused as soon as the 4 length bytes are in (the body is never waited for).
 * Bytes after the frame are ignored.
 */
export class FrameReader {
  /** @param {"LE" | "BE"} endian @param {number} [max] */
  constructor(endian, max = MAX_REQUEST_BYTES) {
    this.endian = endian;
    this.max = max;
    /** @type {Buffer} */ this.buf = Buffer.alloc(0);
    this.done = false;
  }
  /**
   * @param {Buffer} chunk
   * @returns {{ state: "need" } | { state: "frame", body: Buffer } | { state: "error", error: ErrorCode }}
   */
  push(chunk) {
    if (this.done) return { state: "need" };
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.buf.length < 4) return { state: "need" };
    const len = this.endian === "LE" ? this.buf.readUInt32LE(0) : this.buf.readUInt32BE(0);
    if (len === 0) return this.finish({ state: "error", error: ERRORS.malformed });
    if (len > this.max) return this.finish({ state: "error", error: ERRORS.tooLarge });
    if (this.buf.length < 4 + len) return { state: "need" };
    return this.finish({ state: "frame", body: this.buf.subarray(4, 4 + len) });
  }
  /** @template T @param {T} r @returns {T} */
  finish(r) {
    this.done = true;
    this.buf = Buffer.alloc(0);
    return r;
  }
}

/**
 * The request: exactly `{"type":"pair"}`. Not JSON, not a plain object, or another key → "malformed"; another type →
 * "unknown-type". @param {Buffer} body @returns {{ ok: true } | { ok: false, error: ErrorCode }}
 */
export function parseRequest(body) {
  let msg;
  try {
    msg = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return { ok: false, error: ERRORS.malformed };
  }
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return { ok: false, error: ERRORS.malformed };
  const keys = Object.keys(msg);
  if (keys.length !== 1 || keys[0] !== "type" || typeof msg.type !== "string") return { ok: false, error: ERRORS.malformed };
  return msg.type === "pair" ? { ok: true } : { ok: false, error: ERRORS.unknownType };
}

/** @typedef {(file: string) => string} ReadFile */

/** The first `package.json` that parses above `start`, as [folder, parsed]; null at the root. @param {string} start @param {ReadFile} readFile */
function firstPackage(start, readFile) {
  for (let dir = path.resolve(start); ; ) {
    try {
      const pkg = JSON.parse(readFile(path.join(dir, "package.json")));
      if (typeof pkg === "object" && pkg !== null) return /** @type {[string, any]} */ ([dir, pkg]);
    } catch {
      // missing or unparsable: keep walking
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * A clone's root, where its `bridge.token` may be; null inside the installed package (whose first `package.json` is
 * `browser-agent-bridge` without `workspaces`, so a project's own `bridge.token` is never read) or when no workspace
 * root is above. Mirrors `findPackageRoot` / `findWorkspaceRoot` in sdk/src/token.ts.
 * @param {string} start @param {ReadFile} readFile @returns {string | null}
 */
export function cloneRoot(start, readFile) {
  let at = firstPackage(start, readFile);
  if (at && at[1].name === PACKAGE_NAME && !("workspaces" in at[1])) return null;
  while (at) {
    if ("workspaces" in at[1]) return at[0];
    const up = path.dirname(at[0]);
    if (up === at[0]) return null;
    at = firstPackage(up, readFile);
  }
  return null;
}

/** BRIDGE_PORT when it is a whole number 1-65535, else 9234 (the SDK's default). @param {string | undefined} raw */
export function pairPort(raw) {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 65535 ? n : PORT;
}

/**
 * The token and port, in the ruled order (#449, as the SDK reads it): `BRIDGE_TOKEN`, the per-user file, then a
 * clone's `bridge.token` (never inside the package). Only called once the origin and the request passed.
 * @param {{ env: Record<string, string | undefined>, platform: string, startDir: string, readFile: ReadFile }} f
 * @returns {Reply}
 */
export function lookupPairing(f) {
  const read = (/** @type {string} */ file) => {
    try {
      return f.readFile(file).trim();
    } catch {
      return "";
    }
  };
  let token = f.env.BRIDGE_TOKEN?.trim() ?? "";
  if (!token) {
    const user = userTokenFile(f.env, f.platform);
    if (user) token = read(user);
  }
  if (!token) {
    const root = cloneRoot(f.startDir, f.readFile);
    if (root) token = read(path.join(root, TOKEN_FILE));
  }
  if (!token) return errorReply(ERRORS.noToken);
  if (!TOKEN_RE.test(token)) return errorReply(ERRORS.badToken);
  return { ok: true, token, port: pairPort(f.env.BRIDGE_PORT) };
}

/**
 * The one reply. The origin is checked first and the token lookup runs only after both checks pass, so a wrong caller
 * or a bad request never causes a token read.
 * @param {readonly string[]} args the host's arguments (argv after the script)
 * @param {{ ok: true } | { ok: false, error: ErrorCode } | null} request the parsed request; null: not read (wrong origin)
 * @param {() => Reply} lookup
 * @returns {Reply}
 */
export function respond(args, request, lookup) {
  if (!originAllowed(args)) return errorReply(ERRORS.origin);
  if (!request) return errorReply(ERRORS.malformed);
  if (!request.ok) return errorReply(request.error);
  return lookup();
}
