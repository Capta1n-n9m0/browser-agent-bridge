// Step 15 S3 — when a welcome carries another build than the daemon file this client would spawn, is the running
// daemon stale (hand it over: the build-id upgrade, daemon/CLAUDE.md) or the current daemon of another install (a
// clone beside the npm package, or two package versions)? Without this, a clone client and a package client on one
// port shut each other's daemon down at every connect(). The rule, from the daemon's record
// (`~/.browser-agent-bridge/daemon-<port>.json`, written by the daemon right after its bind, daemon/src/daemon-record.ts):
//
//   no record, or a record of another build (a pre-S3 daemon)         → hand over (as before)
//   the record names our own daemon file (npm run build changed it)   → hand over (as before)
//   the record's file is gone or no longer hashes to the running build → hand over (that install moved on)
//   either install's version unknown                                  → hand over (as before)
//   the other install is older than ours                              → hand over (an upgrade)
//   the other install is the same version or newer                    → use the running daemon as it is
//
// So at most one side of a pair ever hands over, and a newer daemon is never replaced by an older one. Proto is
// still checked by the knock before this runs. Never throws: any doubt is a handover, today's behaviour.
import { readFileSync } from "node:fs";
import path from "node:path";
import { findPackageRoot, findWorkspaceRoot, PACKAGE_NAME } from "./token.js";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;
type ReadFile = (file: string) => string;

export interface RecordFacts {
  build: string;
  path: string;
}

/** The record's two fields this reader uses, or null when it is not a well-formed record. */
export function parseDaemonRecord(text: string): RecordFacts | null {
  try {
    const r: unknown = JSON.parse(text);
    if (typeof r !== "object" || r === null) return null;
    const { build, path: p } = r as { build?: unknown; path?: unknown };
    return typeof build === "string" && typeof p === "string" ? { build, path: p } : null;
  } catch {
    return null;
  }
}

/** `x.y.z` compared numerically (a pre-release tail is ignored); null when either is not a version. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const parse = (v: string | null | undefined) => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v ?? "");
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export interface AdoptFacts {
  /** The build the welcome carried. */
  running: string;
  record: RecordFacts | null;
  mine: { path: string; version: string | null };
  /** The hash of `record.path` now; null when it cannot be read. */
  recordHash: string | null;
  recordVersion: string | null;
}

export function adoptDecision(f: AdoptFacts, platform: NodeJS.Platform = process.platform): "adopt" | "handover" {
  const r = f.record;
  if (!r || r.build !== f.running) return "handover";
  const p = platform === "win32" ? path.win32 : path.posix;
  const norm = (x: string) => (platform === "win32" ? p.normalize(x).toLowerCase() : p.normalize(x));
  if (norm(r.path) === norm(f.mine.path)) return "handover";
  if (f.recordHash !== f.running) return "handover";
  const cmp = compareVersions(f.recordVersion, f.mine.version);
  return cmp !== null && cmp >= 0 ? "adopt" : "handover";
}

/** `<home>/.browser-agent-bridge` from env alone (USERPROFILE on Windows, HOME elsewhere — what `os.homedir` reads). */
export function stateDirFromEnv(env: Env, platform: NodeJS.Platform = process.platform): string | null {
  const p = platform === "win32" ? path.win32 : path.posix;
  const home = (platform === "win32" ? env.USERPROFILE : env.HOME)?.trim();
  return home ? p.join(home, `.${PACKAGE_NAME}`) : null;
}

const readUtf8: ReadFile = (f) => readFileSync(f, "utf8");

/** The version of the install a daemon file belongs to: its package's, else its clone's root; null if neither. */
export function installVersion(daemonPath: string, readFile: ReadFile = readUtf8): string | null {
  const dir = path.dirname(daemonPath);
  const root = findPackageRoot(dir, readFile) ?? findWorkspaceRoot(dir, readFile);
  if (root === null) return null;
  try {
    const v = (JSON.parse(readFile(path.join(root, "package.json"))) as { version?: unknown }).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** The knock's `adoptDaemon` over the real files: true means "use the running daemon as it is". */
export function makeAdoptDaemon(
  env: Env,
  hashDaemon: (file: string) => Promise<string>,
  readFile: ReadFile = readUtf8,
  platform: NodeJS.Platform = process.platform,
): (o: { port: number; build: string; daemonPath: string }) => Promise<boolean> {
  return async ({ port, build, daemonPath }) => {
    try {
      const dir = stateDirFromEnv(env, platform);
      if (!dir) return false;
      let record: RecordFacts | null = null;
      try {
        record = parseDaemonRecord(readFile(path.join(dir, `daemon-${port}.json`)));
      } catch {
        return false;
      }
      if (!record || record.build !== build) return false;
      const recordHash = await hashDaemon(record.path).catch(() => null);
      return (
        adoptDecision(
          {
            running: build,
            record,
            mine: { path: daemonPath, version: installVersion(daemonPath, readFile) },
            recordHash,
            recordVersion: installVersion(record.path, readFile),
          },
          platform,
        ) === "adopt"
      );
    } catch {
      return false;
    }
  };
}
