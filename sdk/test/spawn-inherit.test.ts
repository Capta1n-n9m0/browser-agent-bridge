// Step 8 S3.5 — does `spawnDaemon` hand the spawned process an inherited pipe? (decisions.md ·
// 2026-10-23 · The inherited-handles check runs in S3 as S3.5 (#77), as amended by #85 item 2.)
//
// A child node process (no tsx layer: Node strips spawn.ts's types itself) whose stdout is a pipe
// this test reads calls `spawnDaemon` on a stand-in long-lived script — never the real daemon, port 0,
// a dummy token — and exits. Check (A): with spawnDaemon's own options the reader sees end-of-file
// within 2 s of the child's exit while the stand-in is still alive. Positive control (B): the same
// harness with the stand-in forced to `stdio: "inherit"` must NOT see end-of-file within 2 s while
// the stand-in lives; without it a broken harness would pass (stage0-audit F15).
import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WINDOW_MS = 2_000;
const SPAWN_TS = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/spawn.ts")).href;

const STAND_IN = `
import { writeFileSync } from "node:fs";
writeFileSync(process.env.S35_PIDFILE, String(process.pid));
setInterval(() => {}, 1 << 30);
`;

const CHILD = `
import { spawn } from "node:child_process";
import { spawnDaemon } from ${JSON.stringify(SPAWN_TS)};
const deps = process.env.S35_MODE === "inherit"
  ? { spawn: (cmd, args, opts) => spawn(cmd, args, { ...opts, stdio: "inherit" }) }
  : {};
spawnDaemon({ daemonPath: process.env.S35_STANDIN, port: 0, token: "s35-dummy-token" }, deps);
process.stdout.write("spawned\\n");
`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await wait(20);
  }
  return cond();
}

let dir: string | null = null;
let standInPid: number | null = null;

afterEach(async () => {
  if (standInPid !== null && alive(standInPid)) process.kill(standInPid);
  standInPid = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

interface Measured {
  /** ms from the child's exit to EOF on its stdout (negative: EOF came first); null = no EOF in the window. */
  eofAfterExitMs: number | null;
  /** The stand-in was alive at the moment of EOF, or at the end of the window when there was none. */
  standInAlive: boolean;
  /** EOF arrived after the stand-in was killed (control only). */
  eofAfterKill: boolean | null;
  stdout: string;
}

async function run(mode: "default" | "inherit"): Promise<Measured> {
  dir = mkdtempSync(path.join(os.tmpdir(), "bridge-s35-"));
  const standIn = path.join(dir, "stand-in.mjs");
  const childScript = path.join(dir, "child.mjs");
  const pidFile = path.join(dir, "stand-in.pid");
  writeFileSync(standIn, STAND_IN);
  writeFileSync(childScript, CHILD);

  const env: NodeJS.ProcessEnv = { ...process.env, S35_MODE: mode, S35_STANDIN: standIn, S35_PIDFILE: pidFile };
  delete env.BRIDGE_TOKEN;
  // Node strips types by default only from 22.18 / 23.6; on an older 22.x the child would fail to import spawn.ts.
  const strip = (process.features as { typescript?: unknown }).typescript ? [] : ["--experimental-strip-types"];
  const child = spawn(process.execPath, [...strip, childScript], { stdio: ["ignore", "pipe", "inherit"], env });
  let stdout = "";
  let exitAt: number | null = null;
  let eofAt: number | null = null;
  let aliveAtEof: boolean | null = null;
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  child.stdout.on("end", () => {
    eofAt = Date.now();
    if (standInPid !== null) aliveAtEof = alive(standInPid);
  });
  child.on("exit", () => (exitAt = Date.now()));

  expect(await until(() => exitAt !== null, 10_000)).toBe(true);
  expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== "", 5_000)).toBe(true);
  standInPid = Number(readFileSync(pidFile, "utf8"));
  if (eofAt !== null && aliveAtEof === null) aliveAtEof = alive(standInPid);

  await until(() => eofAt !== null, Math.max(0, exitAt! + WINDOW_MS - Date.now()));
  const inWindow = eofAt !== null && eofAt <= exitAt! + WINDOW_MS;
  const standInAlive = inWindow ? aliveAtEof === true : alive(standInPid);
  const measured: Measured = {
    eofAfterExitMs: inWindow ? eofAt! - exitAt! : null,
    standInAlive,
    eofAfterKill: null,
    stdout,
  };

  // Kill the stand-in by its recorded pid only, and prove it is gone.
  process.kill(standInPid);
  expect(await until(() => !alive(standInPid!), 5_000)).toBe(true);
  if (!inWindow) measured.eofAfterKill = await until(() => eofAt !== null, 5_000);
  console.log(`[S3.5] ${mode}: ${JSON.stringify(measured)}`);
  return measured;
}

describe("S3.5 — spawnDaemon inherits no pipe (#77, #85 item 2)", () => {
  it("(B) positive control: a stand-in forced to stdio:inherit holds the pipe — no EOF within 2 s while it lives", async () => {
    const m = await run("inherit");
    expect(m.stdout).toBe("spawned\n");
    expect(m.eofAfterExitMs).toBeNull();
    expect(m.standInAlive).toBe(true);
    expect(m.eofAfterKill).toBe(true);
  }, 30_000);

  it("(A) the check: with spawnDaemon's own options, EOF within 2 s of the child's exit while the stand-in lives", async () => {
    const m = await run("default");
    expect(m.stdout).toBe("spawned\n");
    expect(m.eofAfterExitMs).not.toBeNull();
    expect(m.eofAfterExitMs!).toBeLessThanOrEqual(WINDOW_MS);
    expect(m.standInAlive).toBe(true);
  }, 30_000);
});
