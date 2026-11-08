// Step 15 S3 — the daemon record: which daemon file is serving a port. Written once, right after the bind, as
// `<stateDir>/daemon-<port>.json` = {build, path, pid}. The SDK reads it when a welcome carries another build than
// the one it would spawn, to tell a stale daemon (hand it over) from the current daemon of another install (a
// clone beside the npm package: use it, never hand it back and forth) — sdk/src/adopt.ts. A record is a hint, not
// a lock: the bind is the lock (daemon/CLAUDE.md), and a record whose build differs from the running one is
// ignored by the reader, so a stale or missing record only means "hand over", today's behaviour.
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface DaemonRecord {
  /** The sha256 build id the daemon sends in every welcome. */
  build: string;
  /** The absolute path of the daemon entry that is running (its `process.argv[1]`). */
  path: string;
  pid: number;
}

/** `daemon-<port>.json` in the state directory. */
export function daemonRecordFile(dir: string, port: number): string {
  return path.join(dir, `daemon-${port}.json`);
}

/** Writes the record atomically (temp file + rename); throws on failure, leaving no temp file behind. */
export function writeDaemonRecord(dir: string, port: number, record: DaemonRecord): void {
  const file = daemonRecordFile(dir, port);
  const tmp = `${file}.${record.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(record) + "\n");
    renameSync(tmp, file);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing was left behind
    }
    throw err;
  }
}
