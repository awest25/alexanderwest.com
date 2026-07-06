#!/usr/bin/env node
/*
 * Brand icon generator (run manually, NOT part of `npm run build`).
 *
 *   node scripts/gen-icons.mjs
 *
 * Rasterizes the favicon mark — an ink rounded-square tile carrying the
 * white AW signature (public/favicon.svg) — into the bitmap icons
 * browsers/PWAs need. Rendering shells out to rsvg-convert (librsvg;
 * `brew install librsvg`), because the signature is a real vector path,
 * not a shape we can rasterize by hand. The .ico is assembled here from
 * PNG entries (valid in all modern browsers).
 *
 * Emits into public/: favicon.ico (16/32/48), apple-touch-icon.png (180),
 * icon-192.png, icon-512.png. Re-run after any change to favicon.svg.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const FAVICON = join(PUBLIC, "favicon.svg");
const tmp = mkdtempSync(join(tmpdir(), "aw-icons-"));

function render(svgPath, size, out) {
  execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), svgPath, "-o", out]);
}

// Apple touch icon wants a full-bleed opaque square (iOS rounds it itself):
// same tile + mark, but with the corner radius removed.
const touchSvg = join(tmp, "touch.svg");
writeFileSync(touchSvg, readFileSync(FAVICON, "utf8").replace(/ rx="\d+"/, ""));

render(FAVICON, 192, join(PUBLIC, "icon-192.png"));
render(FAVICON, 512, join(PUBLIC, "icon-512.png"));
render(touchSvg, 180, join(PUBLIC, "apple-touch-icon.png"));

// favicon.ico with PNG-encoded 16/32/48 entries
const sizes = [16, 32, 48];
const blobs = sizes.map((s) => {
  const p = join(tmp, `ic-${s}.png`);
  render(FAVICON, s, p);
  return readFileSync(p);
});
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e); // width
  header.writeUInt8(s, e + 1); // height
  header.writeUInt16LE(1, e + 4); // planes
  header.writeUInt16LE(32, e + 6); // bpp
  header.writeUInt32LE(blobs[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += blobs[i].length;
});
writeFileSync(join(PUBLIC, "favicon.ico"), Buffer.concat([header, ...blobs]));
rmSync(tmp, { recursive: true, force: true });
console.log("icons: favicon.ico (16/32/48), apple-touch-icon.png, icon-192.png, icon-512.png");
