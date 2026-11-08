#!/usr/bin/env node
// Objective checks for the cleanup pass (`.claude/skills/cleanup-pass/SKILL.md`).
//
// Reports, never fails: dead paths in living docs, counts the docs state against the code,
// "Superseded" notes inside CLAUDE.md files, status text outside the root CLAUDE.md, the same
// gotcha in two CLAUDE.md files, decision numbers cited but not recorded, and files over their
// word budget. The judgement calls are left to the cleaner that reads this output.
//
// Usage: node scripts/doc-check.mjs [--files a.md,b.md]   (default: every living doc)

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => relative(ROOT, p).split("\\").join("/");
const read = (r) => readFileSync(join(ROOT, r), "utf8");
const words = (s) => s.split(/\s+/).filter(Boolean).length;

// Records that are frozen once written: they name files that were later moved or removed.
const FROZEN = [/^docs\/plans\/.*-steps\//, /^docs\/decisions-archive\//, /^docs\/cleanup\//, /^node_modules\//,
  /\/node_modules\//, /^\.git\//, /^docs\/specs\//, /-asbuilt\.md$/, /-open-decisions-review\.md$/];
// Records whose paths may name files since moved or removed: checked for everything but dead paths.
const PATH_RECORDS = [/^docs\/decisions\.md$/, /^docs\/history\.md$/];
// Moved to tag `archive/dev-history` on 2026-11-08 (decisions.md #446): a citation of these is not a dead path.
const ARCHIVED = [/^(docs\/)?plans\/20\d\d-(0[6-9]|10)-/, /^docs\/plans\/handoffs\.md/, /^docs\/decisions-archive\//,
  /^docs\/cleanup\//, /^docs\/progress-and-roadmap\.md/, /^recipes\/(s\d|t5|fe|bgf|tsconfig\.)/, /^recipes\/test\/s\d/];
// Entries #1–#442 live in the archive tag; only later numbers are checked against docs/decisions.md.
const ARCHIVED_DECISIONS_MAX = 442;
// Word budgets (decisions.md · 2026-10-25 · Lean procedures … (#230)). Above budget is a finding.
const BUDGET = [
  [/^CLAUDE\.md$/, 3000], [/^(extension|daemon|sdk|mcp|shared|recipes)\/CLAUDE\.md$/, 3500], [/\/src\/.*CLAUDE\.md$/, 1200],
  [/^docs\/agent-rules\.md$/, 2500], [/^\.claude\/skills\/.*\.md$/, 1200],
  [/^docs\/plans\/next-session-prompt\.md$/, 400], [/^docs\/decisions\.md$/, 10000],
];
const PKG_DIRS = ["extension", "daemon", "sdk", "mcp", "shared", "recipes", "test-fixtures", "docs", "scripts", ".claude"];
const PATH_RE = new RegExp("`((?:" + PKG_DIRS.map((d) => d.replace(".", "\\.")).join("|") + ")/[\\w.\\-/]*)`", "g");
const LINK_RE = /\]\(([^)#\s]+)(?:#[^)]*)?\)/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const r = rel(p);
    if (FROZEN.some((re) => re.test(r + "/")) || name === "node_modules" || name === ".git" || name === "dist") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".md")) out.push(r);
  }
  return out;
}

// A phase doc whose Status says Closed is a record, not a living doc.
const closed = (r, text) => /^docs\/plans\//.test(r) && /\*\*Status:\*\*\s*\**\s*(Closed|Complete)/.test(text.slice(0, 600));

const argFiles = process.argv.includes("--files") ? process.argv[process.argv.indexOf("--files") + 1].split(",") : null;
const files = (argFiles ?? walk(ROOT)).filter((r) => !FROZEN.some((re) => re.test(r)));
const living = files.filter((r) => !closed(r, read(r)));
// The active phase doc and the kickoff name files a stage will create: reported apart, not as dead.
const planning = (r) => /^docs\/plans\//.test(r);
const out = {};
const add = (k, line) => (out[k] ??= []).push(line);

// 1. Dead paths and links.
for (const r of living.filter((r) => !PATH_RECORDS.some((re) => re.test(r)))) {
  const text = read(r);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    // A dated note saying a file was retired names it on purpose.
    if (/\b(is|are|was|were) retired\b/i.test(line)) return;
    const cands = [...line.matchAll(PATH_RE)].map((m) => [m[1], true]).concat([...line.matchAll(LINK_RE)].map((m) => [m[1], false]));
    for (const [tok, rootRel] of cands) {
      if (/^(https?:|mailto:)/.test(tok) || /[*{}<>…]|\.\.\.|YYYY|<|N\b|\/dist\//.test(tok)) continue;
      const clean = tok.replace(/[.,:;)]+$/, "").replace(/:\d+(-\d+)?$/, "");
      if (ARCHIVED.some((re) => re.test(clean))) continue;
      const target = rootRel ? join(ROOT, clean) : join(ROOT, dirname(r), clean);
      if (!existsSync(target) && !existsSync(join(ROOT, clean)))
        add(planning(r) ? "Paths a plan names that do not exist yet (planned, or dead)" : "Dead paths", `${r}:${i + 1}  ${clean}`);
    }
  });
}

// 2. Counts the docs state, against the code.
const count = (file, re) => (read(file).match(re) ?? []).length;
const codesSrc = read("shared/src/codes.ts");
const codes = [...codesSrc.matchAll(/export const \w+_CODES = \[([\s\S]*?)\] as const/g)]
  .reduce((n, m) => n + (m[1].match(/"[A-Z_]+"/g) ?? []).length, 0);
const actual = {
  tools: count("mcp/src/tools/registry.ts", /reg\.tool\(/g),
  "router methods": count("extension/src/sw.ts", /router\.on\(/g),
  codes,
};
add("Counts in the code", Object.entries(actual).map(([k, v]) => `${k}: ${v}`).join(" · "));
const CLAIM_FILES = living.filter((r) => /(^|\/)CLAUDE\.md$|^README\.md$|^docs\/setup\.md$/.test(r));
for (const r of CLAIM_FILES) {
  read(r).split("\n").forEach((line, i) => {
    for (const [k, v] of Object.entries(actual)) {
      const re = new RegExp(`\\b(\\d+) (?:MCP )?${k.replace(" ", " ")}\\b`, "g");
      for (const m of line.matchAll(re)) if (+m[1] !== v && !/\b(was|before|until|after)\b/i.test(line))
        add("Counts that differ from the code", `${r}:${i + 1}  says ${m[1]} ${k}, code has ${v}`);
    }
    for (const m of line.matchAll(/(\d{3,5}) (?:tests|passed)\b/g)) add("Test counts stated (check against the last `npm test`)", `${r}:${i + 1}  ${m[0]}`);
  });
}

// 3. CLAUDE.md files: no history notes; one home per gotcha.
const claudes = files.filter((r) => /(^|\/)CLAUDE\.md$/.test(r));
const headlines = new Map();
for (const r of claudes) {
  read(r).split("\n").forEach((line, i) => {
    if (/\*(Superseded|Corrected|Updated|Note) \d{4}-\d\d-\d\d/.test(line)) add("History notes inside CLAUDE.md files", `${r}:${i + 1}`);
    const h = line.match(/^- \*\*(.+?)\*\*/);
    if (h) {
      const key = h[1].toLowerCase().replace(/\W+/g, " ").trim();
      if (headlines.has(key)) add("Same gotcha in two places", `${r}:${i + 1} and ${headlines.get(key)}  "${h[1].slice(0, 70)}"`);
      else headlines.set(key, `${r}:${i + 1}`);
    }
  });
}

// 4. Status text outside the root CLAUDE.md.
for (const r of living) {
  if (r === "CLAUDE.md") continue;
  read(r).split("\n").forEach((line, i) => {
    if (/^#+ Current state\b/i.test(line) || /^\*\*Resume:?\*\*/.test(line)) add("Status text outside CLAUDE.md", `${r}:${i + 1}  ${line.slice(0, 80)}`);
  });
}

// 5. Decision numbers cited but not recorded.
const recorded = new Set();
const decisionFiles = ["docs/decisions.md", ...(existsSync(join(ROOT, "docs/decisions-archive"))
  ? readdirSync(join(ROOT, "docs/decisions-archive")).map((f) => `docs/decisions-archive/${f}`) : [])];
for (const f of decisionFiles) for (const m of read(f).matchAll(/^### .*\(#(\d+)\)\s*$/gm)) recorded.add(+m[1]);
// Numbers far above the newest entry are not decisions (a colour, an issue in another project).
const newest = Math.max(0, ...recorded);
for (const r of living) {
  read(r).split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/#(\d{1,4})\b/g)) if (!recorded.has(+m[1]) && +m[1] > ARCHIVED_DECISIONS_MAX && +m[1] <= newest + 20)
      add("Decision numbers with no entry", `${r}:${i + 1}  #${m[1]}`);
  });
}

// 6. Word budgets.
for (const r of files) {
  const b = BUDGET.find(([re]) => re.test(r));
  if (b) { const n = words(read(r)); if (n > b[1]) add("Over word budget", `${r}  ${n} words (budget ${b[1]})`); }
}

for (const [k, lines] of Object.entries(out)) {
  console.log(`\n## ${k} (${lines.length})`);
  for (const l of lines.slice(0, 60)) console.log(`- ${l}`);
  if (lines.length > 60) console.log(`- … ${lines.length - 60} more`);
}
console.log(`\nChecked ${living.length} living docs (${files.length - living.length} closed phase docs skipped for paths and status).`);
