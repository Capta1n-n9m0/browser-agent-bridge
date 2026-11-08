/**
 * Step 9 S2b: S3.3's `storage.local.set` half (decisions.md · 2026-10-24 · Stricter exit checks for Step 9
 * (#141); · Where S2's and S1.1's checks close after the split (#147)): the safety keys are written only by the
 * toggle module (`safety-state.ts`, through the store `sw.ts` builds) and the options page (`options.ts`).
 *
 * Discriminating against indirection (TypeScript AST over every file in `extension/src`):
 * - every `chrome.storage` reference must be `.local` / `.session` / `.onChanged` (no alias, no element access);
 * - every `chrome.storage.local` reference must be `.get(…)`, `.set(…)` or `.setAccessLevel(…)` called on the
 *   spot (`remove`/`clear` would restore the defaults — armed — and are refused everywhere; an alias or a
 *   method passed as a value is refused);
 * - every `chrome.storage.local.set(…)` call must be one of the five documented sites (the fifth, Step 15 S4: `sw.ts`'s pairing write, `{token, port}` only, in `pairDeps.write`): `sw.ts`'s injection into
 *   `new SafetyStore({set})`, `sw.ts`'s session-marker write (`{[MARKER_KEY]: …}` only), `options.ts`'s
 *   port/token save (`{port, token}` only), `options.ts`'s injection into `writeSafety(…)`;
 * - `SAFETY_KEYS`, `SAFETY_KEY_NAMES`, `toStorageItems`, `writeSafety`, `SafetyStore` are referenced only in
 *   `safety-state.ts`, `options.ts` (`SAFETY_KEY_NAMES`, `writeSafety`) and `sw.ts` (`SafetyStore`, constructed
 *   once); a string naming a key (`safety.armed`, …) appears only in `safety-state.ts`.
 * - (S2b fixer r1, verifier F3) `chrome` is used only as the object of a property access (no alias,
 *   destructuring, argument, parentheses or `globalThis.chrome`), and nothing destructures `storage` or `local`.
 * Each rule is shown failing on an in-memory mutation of a real file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import ts from "typescript";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function sources(): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of walk(SRC)) m.set(relative(SRC, f).replace(/\\/g, "/"), readFileSync(f, "utf8"));
  return m;
}

const flat = (sf: ts.SourceFile, n: ts.Node) => n.getText(sf).replace(/\s+/g, "");

/** Where a key name, an identifier of the store or its setter may be referenced. */
const IDENT_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  SAFETY_KEYS: ["safety-state.ts"],
  SAFETY_KEY_NAMES: ["safety-state.ts", "options.ts"],
  toStorageItems: ["safety-state.ts"],
  writeSafety: ["safety-state.ts", "options.ts"],
  SafetyStore: ["safety-state.ts", "sw.ts"],
};
// Step 11 S3 (2026-10-25): `uploadFolders` added — S2's fourth key (#236) is named in a string in safety-state.ts only.
const KEY_STRING = /safety\.(armed|evaluate|blockList|uploadFolders)\b/;
/**
 * Files where `chrome` may appear other than as the object of a property access (S2b fixer r1, F3). Empty:
 * no such site exists in `extension/src` today; one added later must be listed here with a note.
 */
const CHROME_VALUE_ALLOWED: readonly string[] = [];
const LOCAL_METHODS = new Set(["get", "set", "setAccessLevel"]);

function enclosing<T extends ts.Node>(n: ts.Node, pred: (x: ts.Node) => x is T): T | undefined {
  for (let p = n.parent; p; p = p.parent) if (pred(p)) return p;
  return undefined;
}

/** Is this `chrome.storage.local.set(…)` call one of the five documented sites? */
function allowedSet(rel: string, call: ts.CallExpression, sf: ts.SourceFile): boolean {
  const arg = call.arguments[0];
  const literalKeys = (o: ts.Expression | undefined): string[] | null =>
    o && ts.isObjectLiteralExpression(o) && call.arguments.length === 1
      ? o.properties.map((p) => (p.name ? flat(sf, p.name) : "<spread>"))
      : null;
  if (rel === "sw.ts") {
    // (1) the store's injection: `new SafetyStore({ …, set: (items) => chrome.storage.local.set(items), … })`
    const prop = enclosing(call, ts.isPropertyAssignment);
    const ctor = prop && ts.isObjectLiteralExpression(prop.parent) && ts.isNewExpression(prop.parent.parent) ? prop.parent.parent : undefined;
    if (prop && flat(sf, prop.name) === "set" && ctor && flat(sf, ctor.expression) === "SafetyStore" && ts.isArrowFunction(prop.initializer)) {
      const fn = prop.initializer;
      if (fn.body === call && fn.parameters.length === 1 && call.arguments.length === 1 && flat(sf, call.arguments[0]!) === flat(sf, fn.parameters[0]!.name)) return true;
    }
    // (2) the session marker: `{ [MARKER_KEY]: marker }` only
    const keys = literalKeys(arg);
    if (keys && keys.length === 1 && keys[0] === "[MARKER_KEY]") return true;
    // (5) Step 15 S4 (#449): the pairing write, `{ token, port }` only, inside the injected `write` of `pairDeps`
    const pairProp = enclosing(call, ts.isPropertyAssignment);
    const pairDeps = pairProp && ts.isObjectLiteralExpression(pairProp.parent) && ts.isVariableDeclaration(pairProp.parent.parent) ? pairProp.parent.parent : undefined;
    if (keys && [...keys].sort().join(",") === "port,token" && pairProp && flat(sf, pairProp.name) === "write" && pairDeps && flat(sf, pairDeps.name) === "pairDeps") return true;
    return false;
  }
  if (rel === "options.ts") {
    // (3) the port/token save
    const keys = literalKeys(arg);
    if (keys && [...keys].sort().join(",") === "port,token") return true;
    // (4) the injection into writeSafety: `writeSafety((items) => chrome.storage.local.set(items), change)`
    const fn = call.parent;
    if (ts.isArrowFunction(fn) && fn.body === call && fn.parameters.length === 1 && call.arguments.length === 1 && flat(sf, call.arguments[0]!) === flat(sf, fn.parameters[0]!.name)) {
      const outer = fn.parent;
      if (ts.isCallExpression(outer) && flat(sf, outer.expression) === "writeSafety" && outer.arguments[0] === fn) return true;
    }
    return false;
  }
  return false;
}

/** Every violation of the writer rules, as `file: what`. */
export function writerViolations(files: Map<string, string>): string[] {
  const out: string[] = [];
  let storeConstructions = 0;
  for (const [rel, text] of files) {
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const visit = (n: ts.Node): void => {
      // chrome.storage → .local / .session / .onChanged only
      if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && flat(sf, n.expression) === "chrome") {
        const name = ts.isPropertyAccessExpression(n) ? n.name.text : flat(sf, n.argumentExpression);
        if (name === "storage" || name === '"storage"' || name === "'storage'") {
          const p = n.parent;
          if (ts.isElementAccessExpression(n) || !ts.isPropertyAccessExpression(p) || !["local", "session", "onChanged"].includes(p.name.text)) {
            out.push(`${rel}: chrome.storage used other than .local/.session/.onChanged: ${flat(sf, p)}`);
          }
        }
      }
      // chrome.storage.local → .get/.set/.setAccessLevel, called on the spot
      const isLocal =
        (ts.isPropertyAccessExpression(n) && n.name.text === "local" && flat(sf, n.expression) === "chrome.storage") ||
        (ts.isElementAccessExpression(n) && flat(sf, n.expression) === "chrome.storage");
      if (isLocal) {
        const p = n.parent;
        if (ts.isElementAccessExpression(n) || !ts.isPropertyAccessExpression(p) || !LOCAL_METHODS.has(p.name.text)) {
          out.push(`${rel}: chrome.storage.local used other than get/set/setAccessLevel: ${flat(sf, p)}`);
        } else if (!(ts.isCallExpression(p.parent) && p.parent.expression === p)) {
          out.push(`${rel}: chrome.storage.local.${p.name.text} passed as a value`);
        } else if (p.name.text === "set" && !allowedSet(rel, p.parent, sf)) {
          out.push(`${rel}: chrome.storage.local.set at an undocumented site: ${flat(sf, p.parent)}`);
        }
      }
      // S2b fixer r1 (verifier F3): `chrome` only as the object of a property access — no alias, destructuring,
      // argument, parenthesised or reached through another object (`globalThis.chrome`). Type positions
      // (`chrome.tabs.Tab` is a QualifiedName) are not values.
      if (ts.isIdentifier(n) && n.text === "chrome" && !CHROME_VALUE_ALLOWED.includes(rel)) {
        const p = n.parent;
        const objectOfAccess = (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n;
        const typePosition = ts.isQualifiedName(p) || ts.isTypeQueryNode(p) || ts.isTypeReferenceNode(p);
        const declName =
          (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isPropertySignature(p) || ts.isPropertyAssignment(p) || ts.isImportSpecifier(p) || ts.isModuleDeclaration(p)) &&
          (p as { name?: ts.Node }).name === n;
        if (!objectOfAccess && !typePosition && !declName) out.push(`${rel}: chrome used other than as the object of a property access: ${flat(sf, p)}`);
      }
      // …and no destructuring of `storage` or `local` (`const { storage } = chrome`, `{ local: l }`, nested).
      if (ts.isBindingElement(n)) {
        const key = n.propertyName ? n.propertyName.getText(sf) : ts.isIdentifier(n.name) ? n.name.text : "";
        if (key === "storage" || key === "local") out.push(`${rel}: ${key} destructured: ${flat(sf, n.parent)}`);
      }
      if (ts.isIdentifier(n) && Object.prototype.hasOwnProperty.call(IDENT_ALLOWED, n.text) && !IDENT_ALLOWED[n.text]!.includes(rel)) {
        out.push(`${rel}: ${n.text} referenced`);
      }
      if (ts.isNewExpression(n) && flat(sf, n.expression) === "SafetyStore" && rel === "sw.ts") storeConstructions++;
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && KEY_STRING.test(n.text) && rel !== "safety-state.ts") {
        out.push(`${rel}: a safety key name in a string`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  if (files.has("sw.ts") && storeConstructions !== 1) out.push(`sw.ts: new SafetyStore( ${storeConstructions} times, not once`);
  return out;
}

/**
 * Step 11 S3 (S3.4): every object literal with an `uploadFolders` member passed straight to a call (a change handed
 * to `save`/`writeSafety`/`toStorageItems`/a setter), one entry per site, as the file's name. `Object.freeze` (the
 * defaults) is not a write. Only the options page's Save of the Upload folders box may appear.
 */
export function uploadFoldersWriters(files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [rel, text] of files) {
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && flat(sf, n.expression) !== "Object.freeze") {
        for (const a of n.arguments) {
          if (
            ts.isObjectLiteralExpression(a) &&
            a.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText(sf) === "uploadFolders")
          ) {
            out.push(rel);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

describe("S3.3 — the safety keys are written only by the toggle module and the options page", () => {
  const files = sources();

  it("the scan sees the writers", () => {
    expect(files.has("safety-state.ts")).toBe(true);
    expect(files.has("options.ts")).toBe(true);
    expect(files.has("sw.ts")).toBe(true);
  });

  it("no violation in extension/src", () => {
    expect(writerViolations(files)).toEqual([]);
  });

  it("exactly the five documented storage.local.set sites exist", () => {
    const n = [...files.values()].reduce((a, t) => a + (t.replace(/\/\*[\s\S]*?\*\//g, "").match(/chrome\.storage\.local\.set\(/g) ?? []).length, 0);
    expect(n).toBe(5);
  });

  const mutate = (rel: string, extra: string): Map<string, string> => {
    const m = new Map(files);
    m.set(rel, files.get(rel)! + "\n" + extra + "\n");
    return m;
  };

  const mutations: Array<[string, string, string, RegExp]> = [
    ["a handler writes a key directly", "handlers/tabs.ts", 'void chrome.storage.local.set({ "safety.armed": true });', /undocumented site|key name in a string/],
    ["a handler writes through an alias", "handlers/tabs.ts", "const area = chrome.storage.local; void area.set({});", /other than get\/set/],
    ["a handler aliases chrome.storage", "handlers/tabs.ts", "const st = chrome.storage; void st;", /chrome\.storage used other than/],
    ["element access", "handlers/tabs.ts", 'void chrome.storage["local"].get(null);', /chrome\.storage used other than/],
    ["set passed as a value", "handlers/tabs.ts", "const w = [chrome.storage.local.set]; void w;", /passed as a value/],
    ["remove restores the defaults (armed)", "handlers/tabs.ts", 'void chrome.storage.local.remove("x");', /other than get\/set/],
    ["a handler imports the setter", "handlers/tabs.ts", 'import { writeSafety } from "../safety-state.js"; void writeSafety;', /writeSafety referenced/],
    ["a handler uses the key table", "network-state.ts", 'import { SAFETY_KEYS } from "./safety-state.js"; void SAFETY_KEYS;', /SAFETY_KEYS referenced/],
    ["a key name built in a template", "handlers/evaluate.ts", "const k = `safety.armed`; void k;", /key name in a string/],
    ["sw.ts writes a safety item outside the store", "sw.ts", "void chrome.storage.local.set({ x: 1 });", /undocumented site/],
    ["sw.ts builds a second store", "sw.ts", "const second = new SafetyStore({} as never); void second;", /not once/],
    ["options.ts writes other items", "options.ts", "void chrome.storage.local.set({ port: 1, token: \"\", other: 2 });", /undocumented site/],
    ["S4: sw.ts writes {token, port} outside pairDeps.write", "sw.ts", "void chrome.storage.local.set({ token: \"t\", port: 1 });", /undocumented site/],
    ["S4: another object's write of {token, port}", "sw.ts", "const otherDeps = { write: () => chrome.storage.local.set({ token: \"t\", port: 1 }) }; void otherDeps;", /undocumented site/],
    ["S4: pairDeps.write writes more", "sw.ts", "const pairDeps = { write: () => chrome.storage.local.set({ token: \"t\", port: 1, \"safety.armed\": true }) }; void pairDeps;", /undocumented site|key name in a string/],
    ["W8: chrome aliased", "handlers/tabs.ts", "const c = chrome; void c.storage.local.set({});", /chrome used other than as the object/],
    ["W9: storage destructured from chrome", "handlers/tabs.ts", "const { storage: __s } = chrome; void __s.local.set({});", /storage destructured/],
    ["W12: local destructured, nested", "handlers/tabs.ts", "const { storage: { local: __l } } = chrome; void __l.set({});", /local destructured/],
    ["local destructured from chrome.storage", "handlers/tabs.ts", "const { local } = chrome.storage; void local.set({});", /local destructured/],
    ["chrome passed as an argument", "handlers/tabs.ts", "const f = (x: unknown) => x; f(chrome);", /chrome used other than as the object/],
    ["chrome through globalThis", "handlers/tabs.ts", "void globalThis.chrome.storage.local.set({});", /chrome used other than as the object/],
  ];
  for (const [name, rel, extra, re] of mutations) {
    it(`mutation caught: ${name}`, () => {
      expect(files.has(rel), rel).toBe(true);
      const v = writerViolations(mutate(rel, extra));
      expect(v.some((x) => re.test(x)), v.join("\n")).toBe(true);
    });
  }

  // Step 11 S3 (S3.4; phase doc 0.4 Writers): only the options page writes `safety.uploadFolders`.
  it("S3.4: an `uploadFolders` member reaches writeSafety/toStorageItems only from options.ts (one site, the box's Save)", () => {
    expect(uploadFoldersWriters(files)).toEqual(["options.ts"]);
  });

  const folderMutations: Array<[string, string, string, string]> = [
    ["the toggle writes the folders", "safety-state.ts", "toStorageItems({ armed: true })", "toStorageItems({ armed: true, uploadFolders: \"\" })"],
    ["options.ts's switch also writes the folders", "options.ts", "{ armed: armedEl.checked }", "{ armed: armedEl.checked, uploadFolders: \"\" }"],
  ];
  for (const [name, rel, from, to] of folderMutations) {
    it(`S3.4 mutation caught: ${name}`, () => {
      const src = files.get(rel)!;
      const mutated = src.replace(from, to);
      expect(mutated, from).not.toBe(src);
      const m = new Map(files);
      m.set(rel, mutated);
      const w = uploadFoldersWriters(m);
      expect(w.filter((x) => x === "options.ts").length > 1 || w.some((x) => x !== "options.ts")).toBe(true);
    });
  }

  it("S3.4 mutation caught: a handler writes safety.uploadFolders directly", () => {
    const v = writerViolations(mutate("handlers/tabs.ts", 'void chrome.storage.local.set({ "safety.uploadFolders": "" });'));
    expect(v.some((x) => /undocumented site|key name in a string/.test(x)), v.join("\n")).toBe(true);
  });

  it("mutation caught: the store's injection replaced by a wrapper that writes more", () => {
    const sw = files.get("sw.ts")!;
    const mutated = sw.replace("set: (items) => chrome.storage.local.set(items),", "set: (items) => chrome.storage.local.set({ ...items, extra: 1 }),");
    expect(mutated).not.toBe(sw);
    const m = new Map(files);
    m.set("sw.ts", mutated);
    expect(writerViolations(m).some((x) => /undocumented site/.test(x))).toBe(true);
  });
});
