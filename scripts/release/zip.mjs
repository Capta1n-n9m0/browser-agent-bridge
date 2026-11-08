// @ts-check
// Step 15 S6: the extension zip for the Web Store and GitHub Releases. Pure: a small zip writer (deflate, forward-slash
// names, a fixed timestamp so the same tree gives the same bytes) and the store manifest (S0 item 1: the store refuses a
// manifest with `key`; the repo keeps `key` for unpacked builds and the fixed ID).
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** @param {Uint8Array} buf */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 2020-01-01 00:00 in DOS time/date. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

/**
 * A zip of the given files (no directory entries; names sorted). Names must be relative with forward slashes.
 * @param {{ name: string, data: Uint8Array }[]} files
 * @returns {Buffer}
 */
export function makeZip(files) {
  const seen = new Set();
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of sorted) {
    if (!f.name || f.name.includes("\\") || f.name.startsWith("/") || f.name.split("/").some((p) => p === ".." || p === "." || p === "")) {
      throw new Error(`bad zip entry name: ${f.name}`);
    }
    if (seen.has(f.name)) throw new Error(`duplicate zip entry: ${f.name}`);
    seen.add(f.name);
    const name = Buffer.from(f.name, "utf8");
    const data = Buffer.from(f.data);
    const deflated = deflateRawSync(data, { level: 9 });
    const [method, body] = deflated.length < data.length ? [8, deflated] : [0, data];
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * The names in a zip's central directory (for tests and the build's own check).
 * @param {Buffer} zip
 * @returns {{ name: string, method: number, offset: number, size: number, compressed: number, crc: number }[]}
 */
export function zipEntries(zip) {
  const endAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error("not a zip");
  const count = zip.readUInt16LE(endAt + 10);
  let p = zip.readUInt32LE(endAt + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const nameLen = zip.readUInt16LE(p + 28);
    const extra = zip.readUInt16LE(p + 30);
    const comment = zip.readUInt16LE(p + 32);
    out.push({
      name: zip.subarray(p + 46, p + 46 + nameLen).toString("utf8"),
      method: zip.readUInt16LE(p + 10),
      crc: zip.readUInt32LE(p + 16),
      compressed: zip.readUInt32LE(p + 20),
      size: zip.readUInt32LE(p + 24),
      offset: zip.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

/**
 * The manifest that goes into the store zip: the repo's, without `key`.
 * @param {string} text extension/manifest.json
 * @returns {string}
 */
export function storeManifest(text) {
  const m = JSON.parse(text);
  delete m.key;
  return JSON.stringify(m, null, 2) + "\n";
}

/**
 * The files a manifest names (service worker, options page, icons, action icons), which the zip must hold.
 * @param {any} m a parsed manifest
 * @returns {string[]}
 */
export function manifestFiles(m) {
  const out = new Set();
  if (m.background?.service_worker) out.add(m.background.service_worker);
  if (m.options_page) out.add(m.options_page);
  if (m.options_ui?.page) out.add(m.options_ui.page);
  for (const v of Object.values(m.icons ?? {})) out.add(v);
  const di = m.action?.default_icon;
  if (typeof di === "string") out.add(di);
  else for (const v of Object.values(di ?? {})) out.add(v);
  if (m.action?.default_popup) out.add(m.action.default_popup);
  return [...out].map((p) => String(p).replace(/^\.?\//, "")).sort();
}

/**
 * Which files of extension/ go into the zip, from a recursive listing of it (forward-slash relative paths): the
 * manifest, the top-level HTML pages, the built scripts and the icons. Never sources, tests, maps or node_modules.
 * @param {string[]} paths
 */
export function extensionZipFiles(paths) {
  return paths
    .filter((p) => p === "manifest.json" || /^[^/]+\.html$/.test(p) || /^dist\/[^/]+\.js$/.test(p) || /^icons\/[^/]+\.png$/.test(p))
    .sort();
}
