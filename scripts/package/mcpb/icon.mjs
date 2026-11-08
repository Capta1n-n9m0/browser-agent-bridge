// @ts-check
// Step 15 S5: a generated placeholder icon for the `.mcpb` (a white bridge on blue), until S8 makes the real icons.
// Pure: a size in, PNG bytes out (8-bit RGB, no filter), Node built-ins only.
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** @param {number} [size] @returns {Buffer} */
export function placeholderIcon(size = 512) {
  const u = size / 16;
  /** @param {number} x @param {number} y */
  const white = (x, y) => (y >= 6 * u && y < 7.5 * u && x >= 2 * u && x < 14 * u) // the deck
    || ((x >= 4 * u && x < 5.5 * u) || (x >= 10.5 * u && x < 12 * u)) && y >= 4 * u && y < 12 * u; // two towers
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3); // filter byte 0
    for (let x = 0; x < size; x++) {
      const [r, g, b] = white(x, y) ? [255, 255, 255] : [31, 79, 209];
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB; compression, filter, interlace 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
