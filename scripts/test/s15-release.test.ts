// Step 15 S6: one version everywhere (#447), the tag rule, the changelog section, and the extension zip (no `key`, S0
// item 1; forward slashes; every file the manifest names).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { LIFECYCLE_NAMES } from "../bridge/lib.mjs";
import { checkRepo } from "../release/version-cli.mjs";
import {
  changelogSection, isPrerelease, manifestVersionOf, setJsonVersion, setLockVersion, tagProblem, VERSION_RE, versionMismatches,
} from "../release/version.mjs";
import { crc32, extensionZipFiles, makeZip, manifestFiles, storeManifest, zipEntries } from "../release/zip.mjs";

const repo = path.join(__dirname, "..", "..");
const read = (f: string) => readFileSync(path.join(repo, f), "utf8");

describe("the repo's versions agree", () => {
  it("package.json, package-lock.json, extension/manifest.json, the npm package and the .mcpb carry one version", () => {
    const { version, problems } = checkRepo();
    expect(problems).toEqual([]);
    expect(version).toMatch(VERSION_RE);
  });
  it("the release scripts are not npm lifecycle names", () => {
    const scripts = Object.keys(JSON.parse(read("package.json")).scripts);
    for (const s of ["release:build", "version:check", "version:set"]) expect(scripts).toContain(s);
    for (const s of scripts) expect(LIFECYCLE_NAMES).not.toContain(s);
    expect(scripts).not.toContain("version");
  });
});

describe("versionMismatches", () => {
  const good = () => ({
    root: { version: "0.2.0" },
    lock: { version: "0.2.0", packages: { "": { version: "0.2.0" } } },
    extensionManifest: { version: "0.2.0" },
    npmPackage: { version: "0.2.0" },
    mcpb: { version: "0.2.0" },
  });
  it("none when all agree", () => expect(versionMismatches(good())).toEqual([]));
  it("names each place that differs", () => {
    for (const [key, field] of [["extensionManifest", "extension/manifest.json"], ["npmPackage", "npm package"], ["mcpb", ".mcpb"]] as const) {
      const s = good();
      s[key] = { version: "0.1.0" };
      const out = versionMismatches(s);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain(field);
    }
    const s = good();
    s.lock.packages[""].version = "0.1.0";
    expect(versionMismatches(s)[0]).toContain('packages[""]');
  });
  it("a prerelease keeps the bare X.Y.Z in the Chrome manifest", () => {
    const s = good();
    for (const k of ["root", "npmPackage", "mcpb"] as const) s[k] = { version: "0.2.0-rc.1" };
    s.lock = { version: "0.2.0-rc.1", packages: { "": { version: "0.2.0-rc.1" } } };
    expect(versionMismatches(s)).toEqual([]);
    s.extensionManifest = { version: "0.2.0-rc.1" };
    expect(versionMismatches(s)).toHaveLength(1);
  });
  it("refuses a root version that is not X.Y.Z[-pre]", () => {
    const s = good();
    for (const k of ["root", "npmPackage", "mcpb"] as const) s[k] = { version: "0.2" };
    s.lock = { version: "0.2", packages: { "": { version: "0.2" } } };
    s.extensionManifest = { version: "0.2" };
    expect(versionMismatches(s).join()).toContain("not X.Y.Z");
  });
  it("helpers", () => {
    expect(manifestVersionOf("1.2.3-beta.4")).toBe("1.2.3");
    expect(isPrerelease("1.2.3-beta.4")).toBe(true);
    expect(isPrerelease("1.2.3")).toBe(false);
    for (const bad of ["01.2.3", "1.2", "v1.2.3", "1.2.3+build"]) expect(bad).not.toMatch(VERSION_RE);
  });
});

describe("tagProblem", () => {
  it("the tag is v + the version, exactly", () => {
    expect(tagProblem("v0.2.0", "0.2.0")).toBeNull();
    expect(tagProblem("v0.2.0-rc.1", "0.2.0-rc.1")).toBeNull();
    expect(tagProblem("0.2.0", "0.2.0")).toMatch(/start with v/);
    expect(tagProblem("v0.2.1", "0.2.0")).toMatch(/does not match/);
  });
});

describe("setting the version", () => {
  it("setJsonVersion changes the version line only, keeping the manifest's formatting and other fields", () => {
    const text = read("extension/manifest.json");
    const out = setJsonVersion(text, "9.8.7");
    expect(JSON.parse(out).version).toBe("9.8.7");
    const { version: _a, ...restIn } = JSON.parse(text);
    const { version: _b, ...restOut } = JSON.parse(out);
    expect(restOut).toEqual(restIn);
    expect(out.split("\n").length).toBe(text.split("\n").length);
    expect(() => setJsonVersion("{}", "1.0.0")).toThrow();
  });
  it("setLockVersion touches the root entries only", () => {
    const lock = { name: "x", version: "0.1.0", packages: { "": { version: "0.1.0" }, "node_modules/ws": { version: "8.0.0" } } };
    const out = JSON.parse(setLockVersion(JSON.stringify(lock), "0.2.0"));
    expect(out.version).toBe("0.2.0");
    expect(out.packages[""].version).toBe("0.2.0");
    expect(out.packages["node_modules/ws"].version).toBe("8.0.0");
  });
});

describe("changelogSection", () => {
  const text = "# Changelog\n\n## [0.2.0] - 2026-11-20\n\n- one\n- two\n\n## 0.1.0\n\n- old\n";
  it("returns the lines under the version's heading, up to the next one", () => {
    expect(changelogSection(text, "0.2.0")).toBe("- one\n- two");
    expect(changelogSection(text, "0.1.0")).toBe("- old");
  });
  it("null for a missing or empty section; no prefix match", () => {
    expect(changelogSection(text, "0.3.0")).toBeNull();
    expect(changelogSection(text, "0.1")).toBeNull();
    expect(changelogSection("## 0.2.0\n\n## 0.1.0\n- x", "0.2.0")).toBeNull();
  });
});

describe("the extension zip", () => {
  it("storeManifest drops key and nothing else", () => {
    const text = read("extension/manifest.json");
    const m = JSON.parse(storeManifest(text));
    expect(m).not.toHaveProperty("key");
    const { key: _k, ...rest } = JSON.parse(text);
    expect(m).toEqual(rest);
  });
  it("extensionZipFiles keeps the manifest, pages, dist scripts and icons, never sources or maps", () => {
    const listing = ["manifest.json", "options.html", "offscreen.html", "build.mjs", "package.json", "tsconfig.json", "CLAUDE.md",
      "dist/sw.js", "dist/sw.js.map", "icons/icon-16.png", "icons/source.svg", "src/sw.ts", "test/a.test.ts"];
    expect(extensionZipFiles(listing)).toEqual(["dist/sw.js", "icons/icon-16.png", "manifest.json", "offscreen.html", "options.html"]);
  });
  it("manifestFiles lists the service worker, options page and every icon", () => {
    expect(manifestFiles({
      background: { service_worker: "dist/sw.js" }, options_page: "options.html",
      icons: { 16: "icons/a.png", 48: "icons/b.png" }, action: { default_icon: { 16: "icons/a.png", 32: "icons/c.png" } },
    })).toEqual(["dist/sw.js", "icons/a.png", "icons/b.png", "icons/c.png", "options.html"]);
  });
  it("every file the real manifest names exists in extension/ and is picked for the zip", () => {
    const ext = path.join(repo, "extension");
    const listing = [
      ...readdirSync(ext).filter((f) => statSync(path.join(ext, f)).isFile()),
      ...["icons"].flatMap((d) => readdirSync(path.join(ext, d)).map((f) => `${d}/${f}`)),
      "dist/sw.js", // built, not in git; the release build checks the real dist/
    ];
    const picked = extensionZipFiles(listing);
    for (const f of manifestFiles(JSON.parse(read("extension/manifest.json")))) expect(picked, f).toContain(f);
  });
  it("makeZip writes forward-slash entries that inflate back to the input", () => {
    const files = [
      { name: "manifest.json", data: Buffer.from(storeManifest(read("extension/manifest.json"))) },
      { name: "dist/sw.js", data: Buffer.from("console.log(1);\n".repeat(200)) },
      { name: "icons/x.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    ];
    const zip = makeZip(files);
    const entries = zipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(["dist/sw.js", "icons/x.png", "manifest.json"]);
    for (const e of entries) {
      const nameLen = zip.readUInt16LE(e.offset + 26);
      const extra = zip.readUInt16LE(e.offset + 28);
      const start = e.offset + 30 + nameLen + extra;
      const body = zip.subarray(start, start + e.compressed);
      const data = e.method === 8 ? inflateRawSync(body) : body;
      const want = files.find((f) => f.name === e.name)!.data;
      expect(Buffer.compare(data, want)).toBe(0);
      expect(e.crc).toBe(crc32(want));
      expect(e.size).toBe(want.length);
    }
    expect(JSON.parse(files[0].data.toString())).not.toHaveProperty("key");
    expect(makeZip(files).equals(zip)).toBe(true); // the same input gives the same bytes
  });
  it("makeZip refuses backslashes, absolute or dotted names, and duplicates", () => {
    for (const name of ["dist\\sw.js", "/abs.js", "../up.js", "a//b", "./a"]) {
      expect(() => makeZip([{ name, data: Buffer.from("x") }])).toThrow(/bad zip entry/);
    }
    expect(() => makeZip([{ name: "a", data: Buffer.from("x") }, { name: "a", data: Buffer.from("y") }])).toThrow(/duplicate/);
  });
  it("crc32 matches the standard check value", () => expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926));
});
