// The real `spawnDaemon` (phase-doc decision 0.8) and `hashDaemon` (decision 0.5).
// The spawn itself is covered by E2E (MUX rows); the unit test only pins the options.
import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface SpawnDaemonOptions {
  daemonPath: string;
  port: number;
  token: string;
}

interface ChildLike {
  unref(): void;
  on(event: "error", listener: (err: Error) => void): unknown;
}

export interface SpawnDeps {
  spawn?: (command: string, args: string[], options: Record<string, unknown>) => ChildLike;
  execPath?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

/**
 * Starts the daemon detached, with no stdio (it logs to `~/.browser-agent-bridge/daemon.log`), and
 * lets this process exit without waiting for it. `process.execPath` so the real node binary runs
 * even when an nvm-windows shim launched us. Spawning twice is safe: the bind is the lock.
 */
export function spawnDaemon(opts: SpawnDaemonOptions, deps: SpawnDeps = {}): void {
  const spawn = deps.spawn ?? (nodeSpawn as unknown as NonNullable<SpawnDeps["spawn"]>);
  const child = spawn(deps.execPath ?? process.execPath, [opts.daemonPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...(deps.env ?? process.env), BRIDGE_TOKEN: opts.token, BRIDGE_PORT: String(opts.port) },
  });
  // An async spawn failure (ENOENT, EACCES) must not crash the caller; the knock keeps going and,
  // if no daemon ever answers, gives up naming the log.
  child.on("error", () => {});
  child.unref();
}

/** sha256 (hex) of the daemon file — the build identity the daemon reports in `welcome`. */
export async function hashDaemon(daemonPath: string): Promise<string> {
  return createHash("sha256").update(await readFile(daemonPath)).digest("hex");
}
