#!/usr/bin/env node
/*
 * Brand icon generator (run manually, NOT part of `npm run build`).
 *
 *   node scripts/gen-icons.mjs
 *
 * Rasterizes the favicon mark — a navy rounded-square tile with a single
 * emerald superellipse blob (the same Ocean Breeze mark as favicon.svg) —
 * into the bitmap icons browsers/PWAs need, with no native dependencies:
 * a tiny supersampled rasterizer + a from-scratch PNG/ICO encoder on
 * Node's built-in zlib. Re-run after any palette change to keep the
 * bitmap icons in sync with public/favicon.svg.
 *
 * Emits into public/: favicon.ico (16/32/48), apple-touch-icon.png (180),
 * icon-192.png, icon-512.png.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

// Ocean Breeze: navy tile (#0f172a), emerald blob (#22c55e).
const NAVY = [0x0f, 0x17, 0x2a];
const GREEN = [0x22, 0xc5, 0x5e];

/* ---- rasterizer ------------------------------------------------- *
 * 4x4 supersampling, premultiplied averaging so the rounded-rect and
 * blob edges anti-alias cleanly against transparency.                */
function render(size, { bleed = false } = {}) {
  const ss = 4;
  const half = size / 2;
  // Apple touch icons want a full-bleed opaque square (iOS rounds it
  // itself); everything else gets the transparent rounded-square tile.
  const r = bleed ? 0 : 0.22 * size; // corner radius, matches favicon.svg rx=22/100
  const a = 0.3 * size; // blob semi-extent → spans ~20%..80% of the tile
  const n = 2.5; // superellipse exponent (squircle blob)
  const px = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sr = 0,
        sg = 0,
        sb = 0,
        sa = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const sx = x + (i + 0.5) / ss;
          const sy = y + (j + 0.5) / ss;
          // rounded-rect signed distance (<=0 is inside the tile)
          const qx = Math.abs(sx - half) - (half - r);
          const qy = Math.abs(sy - half) - (half - r);
          const out =
            Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
            Math.min(Math.max(qx, qy), 0) -
            r;
          if (out > 0) continue; // transparent outside the tile
          const blob =
            (Math.abs(sx - half) / a) ** n + (Math.abs(sy - half) / a) ** n;
          const c = blob <= 1 ? GREEN : NAVY;
          sr += c[0];
          sg += c[1];
          sb += c[2];
          sa += 1;
        }
      }
      const tot = ss * ss;
      const o = (y * size + x) * 4;
      const alpha = sa / tot;
      px[o + 3] = Math.round(alpha * 255);
      if (sa > 0) {
        // straight (un-premultiplied) color from the covered samples
        px[o] = Math.round(sr / sa);
        px[o + 1] = Math.round(sg / sa);
        px[o + 2] = Math.round(sb / sa);
      }
    }
  }
  return px;
}

/* ---- PNG encoder ------------------------------------------------ */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // filter byte 0 (None) prepended to each scanline
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---- ICO (PNG-encoded entries) ---------------------------------- */
function encodeICO(sizes) {
  const pngs = sizes.map((s) => encodePNG(s, render(s)));
  const count = sizes.length;
  const header = Buffer.alloc(6 + 16 * count);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  let offset = 6 + 16 * count;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header[e] = s >= 256 ? 0 : s; // width
    header[e + 1] = s >= 256 ? 0 : s; // height
    header[e + 2] = 0; // palette
    header[e + 3] = 0; // reserved
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([header, ...pngs]);
}

/* ---- emit ------------------------------------------------------- */
const outputs = [
  ["icon-512.png", encodePNG(512, render(512))],
  ["icon-192.png", encodePNG(192, render(192))],
  ["apple-touch-icon.png", encodePNG(180, render(180, { bleed: true }))],
  ["favicon.ico", encodeICO([16, 32, 48])],
];
for (const [name, buf] of outputs) {
  writeFileSync(join(PUBLIC, name), buf);
  console.log(`wrote public/${name} (${buf.length} bytes)`);
}
