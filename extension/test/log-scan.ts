/**
 * Step 9 S2b: the 0.7 log scan's enumerator (phase doc 0.7's F28 note; S2.3 as #141 words it). Pure over
 * source text, so the test can run it on mutated copies.
 *
 * A log call site is a call expression whose callee is
 * - `console.<anything>` / `console[…]` (every package), or
 * - an injected logger: an identifier `log`, or a property `.log` on anything but `console` — the daemon's
 *   `logger.log` (`daemon/src/log.ts`'s `Logger`, wired in `main.ts`), `options.log` / `this.deps.log` /
 *   `deps.log` (WsHost's and TabLayer's `log?` option), and the local `log` they are copied into
 *   (`handle-mark.ts`, `wsHost.ts`). The rule is by name, so a new logger called `log` anywhere is caught.
 * A `console` used as a value (aliased, passed, spread) is a site too: it would hide later calls.
 * S2b fixer r1 (verifier F2) adds:
 * - `process.stdout` / `process.stderr` in any use (`.write(…)` → the call's text; else "(as a value)"), and
 *   `process` itself used as a value (aliased, passed, destructured), which would hide its streams;
 * - a logger used as a value — `log` / `….log` aliased, passed, returned, a `{ log }` shorthand, destructured
 *   (`const { log } = o`, `{ log: say }`) — the treatment `console` gets; `log.<member>` other than
 *   call/apply/bind is not a site (the extension's network log is an object named `log`: `log.query(…)`);
 * - `.call` / `.apply` / `.bind` on a logger (the invoker call's text; an uncalled invoker is "(as a value)");
 * - a call of a level name on anything but `console` — `deps.warn?.(…)`, `options.error(…)`, a bare `debug(…)`
 *   (warn/info/debug/trace/error): none exists today, so this has no false positive in the tree.
 * THE CONVENTION THE SCAN RELIES ON: an injected logger is named `log` (or a level name) wherever it is
 * declared, passed or called. A logger that leaves those names is caught at the point it leaves (`const say =
 * o.log` is a site), but a function that is a logger under an unrelated name from its origin (a parameter
 * `say: (m) => void` filled by `(m) => logger.log(m)` — the wrapping call is a site, the parameter's calls are
 * not) is followed no further; the sentinel test (`log-sentinel.test.ts`) is the backstop for paths it drives.
 * The site's text is the call's source with every run of whitespace collapsed to one space.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const SCANNED_ROOTS = ["extension/src", "daemon/src", "sdk/src", "mcp/src", "scripts/package"] as const;
/** Single files outside the roots that ship in the npm package (Step 15 S2): the doctor and its helpers, bundled to dist/doctor.js. */
export const SCANNED_FILES = ["scripts/bridge/doctor.ts", "scripts/bridge/lib.mjs"] as const;

export interface LogSite {
  /** Repo-relative, forward slashes. */
  file: string;
  /** The call's source text, whitespace-normalised. */
  call: string;
}

export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isConsole(e: ts.Expression): boolean {
  return ts.isIdentifier(e) && e.text === "console";
}

/** The name an access expression reads: `o.x` → `x`, `o["x"]` → `x`; anything else → undefined. */
function accessName(e: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) return e.argumentExpression.text;
  return undefined;
}
const isAccess = (e: ts.Node): e is ts.PropertyAccessExpression | ts.ElementAccessExpression =>
  ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e);

/** Level names of a logger injected under another name (`deps.warn(…)`): a call is a site; see the header. */
const LEVELS = new Set(["warn", "info", "debug", "trace", "error"]);
const INVOKERS = new Set(["call", "apply", "bind"]);
const STREAMS = new Set(["stdout", "stderr"]);

/** `log`, `….log` / `…["log"]` (not on `console`): the injected-logger convention's expression. */
function isLogExpr(e: ts.Node): boolean {
  if (ts.isIdentifier(e)) return e.text === "log" && !isDeclName(e);
  return isAccess(e) && accessName(e) === "log" && !isConsole(e.expression);
}
/** A call's callee that is a logger: a log expression, or a level name on anything but `console`. */
function isLoggerCallee(e: ts.Node): boolean {
  if (isLogExpr(e)) return true;
  if (ts.isIdentifier(e)) return LEVELS.has(e.text);
  return isAccess(e) && LEVELS.has(accessName(e) ?? "") && !isConsole(e.expression);
}
const calledHere = (e: ts.Node): boolean => ts.isCallExpression(e.parent) && e.parent.expression === e;

/** An identifier in a name position (a declaration, a property name), not an expression. */
function isDeclName(n: ts.Identifier): boolean {
  const p = n.parent;
  if (isAccess(p)) return ts.isPropertyAccessExpression(p) && p.name === n;
  if (
    ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) ||
    ts.isClassDeclaration(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) ||
    ts.isMethodSignature(p) || ts.isPropertyAssignment(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) ||
    ts.isEnumMember(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)
  ) {
    return (p as { name?: ts.Node }).name === n;
  }
  if (ts.isBindingElement(p)) return p.name === n || p.propertyName === n; // the element itself is reported
  return ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p) || ts.isQualifiedName(p) || ts.isTypeReferenceNode(p);
}

export function logSitesIn(file: string, text: string): LogSite[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out: LogSite[] = [];
  const site = (call: string) => out.push({ file, call });
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      const consoleCall = isAccess(c) && isConsole(c.expression);
      // `log.call(…)` / `deps.warn.apply(…)` / `log.bind(…)(…)`: the invoker on a logger is the site.
      const invokerCall = isAccess(c) && INVOKERS.has(accessName(c) ?? "") && isLoggerCallee(c.expression);
      if (consoleCall || isLoggerCallee(c) || invokerCall) site(normalize(n.getText(sf)));
    }
    // A `console` used as a value (aliased, passed, spread, destructured): it would hide later calls.
    if (ts.isIdentifier(n) && n.text === "console") {
      const p = n.parent;
      const callee = isAccess(p) && p.expression === n && calledHere(p);
      if (!callee) site(`console (as a value): ${normalize(p.getText(sf))}`);
    }
    // A logger (`log`, `….log`) used as a value: aliased, passed, returned, or its invoker not called on the spot.
    if (isLogExpr(n) && !ts.isShorthandPropertyAssignment(n.parent)) { // a shorthand is reported below, once
      const p = n.parent;
      const called = calledHere(n as ts.Node);
      const viaInvoker = isAccess(p) && p.expression === n && INVOKERS.has(accessName(p) ?? "") && calledHere(p);
      const otherMember = isAccess(p) && p.expression === n && !INVOKERS.has(accessName(p) ?? ""); // `log.query(…)`: another object named log
      if (!called && !viaInvoker && !otherMember) site(`log (as a value): ${normalize(p.getText(sf))}`);
    }
    // Destructuring a logger out of an object: `const { log } = o`, `({ log: say }) => …`.
    if (ts.isBindingElement(n) && ((n.propertyName && ts.isIdentifier(n.propertyName) ? n.propertyName.text : ts.isIdentifier(n.name) ? n.name.text : "") === "log")) {
      site(`log (destructured): ${normalize(n.parent.getText(sf))}`);
    }
    // `{ log }` shorthand in an object literal passes the logger on.
    if (ts.isShorthandPropertyAssignment(n) && n.name.text === "log") site(`log (as a value): ${normalize(n.parent.getText(sf))}`);
    // Process streams: `process.stdout` / `process.stderr` in any use (`.write(…)` is the call's text).
    if (isAccess(n) && STREAMS.has(accessName(n) ?? "") && ts.isIdentifier(n.expression) && n.expression.text === "process") {
      const p = n.parent;
      if (isAccess(p) && p.expression === n && calledHere(p)) site(normalize(p.parent.getText(sf)));
      else site(`process.${accessName(n)} (as a value): ${normalize(p.getText(sf))}`);
    }
    // `process` itself used as a value (aliased, passed, destructured) would hide its streams.
    if (ts.isIdentifier(n) && n.text === "process" && !isDeclName(n)) {
      const p = n.parent;
      if (!(isAccess(p) && p.expression === n)) site(`process (as a value): ${normalize(p.getText(sf))}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|mts|cts|tsx|js|mjs)$/.test(p) && !p.endsWith(".d.ts")) out.push(p);
  }
  return out.sort();
}

/** Every scanned file, repo-relative → text. */
export function scannedSources(): Map<string, string> {
  const m = new Map<string, string>();
  for (const root of SCANNED_ROOTS) {
    for (const f of walk(join(REPO, root))) m.set(relative(REPO, f).replace(/\\/g, "/"), readFileSync(f, "utf8"));
  }
  for (const f of SCANNED_FILES) m.set(f, readFileSync(join(REPO, f), "utf8"));
  return m;
}

export function allLogSites(files: Map<string, string>): LogSite[] {
  return [...files].flatMap(([file, text]) => logSitesIn(file, text));
}

const key = (s: LogSite) => `${s.file} | ${s.call}`;

/** The multiset difference both ways: sites not allowlisted, and allowlist entries no longer found. */
export function compareWithAllowlist(found: readonly LogSite[], allowed: readonly LogSite[]): { unlisted: string[]; stale: string[] } {
  const count = new Map<string, number>();
  for (const a of allowed) count.set(key(a), (count.get(key(a)) ?? 0) + 1);
  const unlisted: string[] = [];
  for (const s of found) {
    const k = key(s);
    const n = count.get(k) ?? 0;
    if (n > 0) count.set(k, n - 1);
    else unlisted.push(k);
  }
  const stale: string[] = [];
  for (const [k, n] of count) for (let i = 0; i < n; i++) stale.push(k);
  return { unlisted, stale };
}
