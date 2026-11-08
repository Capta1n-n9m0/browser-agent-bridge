// @ts-check
// Step 15 S6: one version everywhere (#447). The root package.json holds the release's version; the extension manifest
// and package-lock.json carry copies; the generated npm package (package/manifest.mjs) and the .mcpb
// (package/mcpb/manifest.mjs) take it from the root. Pure helpers here; version-cli.mjs does the file I/O
// (`npm run version:check`, `npm run version:set -- 0.2.0`).

/** X.Y.Z with an optional prerelease (`-rc.1`); no build metadata, no leading zeros. */
export const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/**
 * Chrome's manifest `version` takes one to four dot-separated integers, so a prerelease cannot go there.
 * @param {string} version a VERSION_RE version
 */
export const manifestVersionOf = (version) => version.split("-")[0];

/** @param {string} version */
export const isPrerelease = (version) => version.includes("-");

/**
 * Every place that carries the version, against the root's.
 * @param {{ root: { version: string }, lock: { version?: string, packages?: Record<string, { version?: string }> },
 *   extensionManifest: { version?: string }, npmPackage: { version?: string }, mcpb: { version?: string } }} s
 * @returns {string[]} one line per mismatch (empty when all agree)
 */
export function versionMismatches(s) {
  const v = s.root.version;
  const out = [];
  if (!VERSION_RE.test(v)) out.push(`package.json: "${v}" is not X.Y.Z or X.Y.Z-pre`);
  /** @type {(where: string, got: string | undefined, expected: string) => void} */
  const want = (where, got, expected) => { if (got !== expected) out.push(`${where}: "${got}", want "${expected}"`); };
  want("package-lock.json version", s.lock.version, v);
  want('package-lock.json packages[""].version', s.lock.packages?.[""]?.version, v);
  want("extension/manifest.json version", s.extensionManifest.version, manifestVersionOf(v));
  want("generated npm package version", s.npmPackage.version, v);
  want("generated .mcpb manifest version", s.mcpb.version, v);
  return out;
}

/**
 * A `v*` tag must name the root version exactly.
 * @param {string} tag e.g. "v0.2.0"
 * @param {string} version the root version
 * @returns {string | null} the problem, or null
 */
export function tagProblem(tag, version) {
  if (!tag.startsWith("v")) return `tag "${tag}" does not start with v`;
  if (tag.slice(1) !== version) return `tag "${tag}" does not match package.json version "${version}"`;
  return null;
}

/**
 * Replace the first top-level `"version": "…"` in a JSON text, keeping every other byte (the manifest's formatting and
 * its other fields, which other stages edit).
 * @param {string} text
 * @param {string} version
 */
export function setJsonVersion(text, version) {
  const re = /^(\s*"version"\s*:\s*)"[^"]*"/m;
  if (!re.test(text)) throw new Error("no \"version\" field");
  return text.replace(re, `$1"${version}"`);
}

/**
 * package-lock.json: the top-level version and packages[""].version (the root project), nothing else.
 * @param {string} text
 * @param {string} version
 */
export function setLockVersion(text, version) {
  const lock = JSON.parse(text);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  return JSON.stringify(lock, null, 2) + "\n";
}

/**
 * The changelog section for a version: the lines under `## [X.Y.Z]` or `## X.Y.Z` (anything may follow on the heading
 * line, such as a date) up to the next `## ` heading. Null when there is none or it is empty.
 * @param {string} text CHANGELOG.md
 * @param {string} version
 */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`^##\\s+\\[?v?${esc}\\]?(\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join("\n").trim();
  return body || null;
}
