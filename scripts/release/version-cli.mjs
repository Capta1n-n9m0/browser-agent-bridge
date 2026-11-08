// @ts-check
// Step 15 S6: `npm run version:check [-- --tag vX.Y.Z]` and `npm run version:set -- X.Y.Z` (#447). `set` writes the root
// package.json, package-lock.json (root entries only) and extension/manifest.json (its "version" line only); the npm
// package and the .mcpb take the root's version when they are built. Exit 1 on any mismatch.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mcpbManifest } from "../package/mcpb/manifest.mjs";
import { packageManifest } from "../package/manifest.mjs";
import { manifestVersionOf, setJsonVersion, setLockVersion, tagProblem, VERSION_RE, versionMismatches } from "./version.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const at = (/** @type {string[]} */ ...p) => path.join(repo, ...p);
const read = (/** @type {string} */ f) => readFileSync(at(f), "utf8");

/** @param {string} [tag] */
export function checkRepo(tag) {
  const root = JSON.parse(read("package.json"));
  const problems = versionMismatches({
    root,
    lock: JSON.parse(read("package-lock.json")),
    extensionManifest: JSON.parse(read("extension/manifest.json")),
    npmPackage: packageManifest(root, {}),
    mcpb: mcpbManifest(root),
  });
  if (tag) {
    const t = tagProblem(tag, root.version);
    if (t) problems.push(t);
  }
  return { version: /** @type {string} */ (root.version), problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg, value] = process.argv.slice(2);
  if (cmd === "check") {
    const { version, problems } = checkRepo(arg === "--tag" ? value : undefined);
    for (const p of problems) console.error(`version: ${p}`);
    if (problems.length) process.exit(1);
    console.log(`version ${version}: package.json, package-lock.json, extension/manifest.json, npm package and .mcpb agree`);
  } else if (cmd === "set" && arg && VERSION_RE.test(arg)) {
    writeFileSync(at("package.json"), setJsonVersion(read("package.json"), arg));
    writeFileSync(at("package-lock.json"), setLockVersion(read("package-lock.json"), arg));
    writeFileSync(at("extension", "manifest.json"), setJsonVersion(read("extension/manifest.json"), manifestVersionOf(arg)));
    const { problems } = checkRepo();
    for (const p of problems) console.error(`version: ${p}`);
    if (problems.length) process.exit(1);
    console.log(`version set to ${arg}`);
  } else {
    console.error("usage: version-cli.mjs check [--tag vX.Y.Z] | set X.Y.Z[-pre]");
    process.exit(2);
  }
}
