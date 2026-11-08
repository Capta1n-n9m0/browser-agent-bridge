#!/usr/bin/env node
// @ts-check
// Step 15 S4 (#449): the native messaging host `com.browser_agent_bridge.host`. Chrome starts it for one
// `runtime.sendNativeMessage` from the extension; it answers once and exits. Thin I/O around ./pair.mjs: the caller's
// origin (the first argument) is checked before anything is read, then one framed request is read (4 KiB cap, 5 s
// timeout), then the token lookup runs. stdout carries the one reply frame only; nothing is written to stderr (an
// uncaught error exits 1 silently). Node built-ins and lib.mjs only: it runs from a clone as `node host.mjs`, and
// scripts/package/build.mjs bundles it to the package's dist/native-host.js.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ERRORS, FrameReader, READ_TIMEOUT_MS, encodeFrame, lookupPairing, originAllowed, parseRequest, respond } from "./pair.mjs";

process.on("uncaughtException", () => process.exit(1));

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const endian = os.endianness();
/** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
let sent = false;

/** @param {Parameters<typeof respond>[1]} request */
function answer(request) {
  if (sent) return;
  sent = true;
  clearTimeout(timer);
  const reply = respond(args, request, () =>
    lookupPairing({ env: process.env, platform: process.platform, startDir: here, readFile: (f) => readFileSync(f, "utf8") }));
  process.stdout.write(encodeFrame(reply, endian), () => process.exit(0));
}

if (!originAllowed(args)) answer(null); // refused before stdin is read and before any token lookup
else {
  timer = setTimeout(() => answer({ ok: false, error: ERRORS.timeout }), READ_TIMEOUT_MS);
  const reader = new FrameReader(endian);
  process.stdin.on("data", (chunk) => {
    const r = reader.push(chunk);
    if (r.state === "frame") answer(parseRequest(r.body));
    else if (r.state === "error") answer({ ok: false, error: r.error });
  });
  process.stdin.on("end", () => answer({ ok: false, error: ERRORS.malformed }));
  process.stdin.on("error", () => answer({ ok: false, error: ERRORS.malformed }));
}
