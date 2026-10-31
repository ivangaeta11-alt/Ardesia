// Dependency-free rasterization of the application mark for Windows PWA icons.
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
function crc32(bytes) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
function chunk(type, bytes) { const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes]))); return Buffer.concat([length, name, bytes, crc]); }
function distance(x, y, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); }
for (const size of [192, 512]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let rgba = [0, 0, 0, 0];
    for (const oy of [.25, .75]) for (const ox of [.25, .75]) {
      const px = (x + ox) * 512 / size, py = (y + oy) * 512 / size;
      const qx = Math.max(112 - px, 0, px - 400), qy = Math.max(112 - py, 0, py - 400);
      if (Math.hypot(qx, qy) > 112) continue;
      let c = [40, 91, 75];
      if ([[[145, 365], [256, 143]], [[256, 143], [367, 365]], [[185, 286], [326, 286]]].some(([a, b]) => distance(px, py, a, b) < 16.5)) c = [246, 241, 230];
      if (distance(px, py, [322, 148], [368, 112]) < 10) c = [216, 185, 123];
      rgba = rgba.map((v, i) => v + (i === 3 ? 255 : c[i]) / 4);
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    for (let i = 0; i < 4; i++) raw[offset + i] = Math.round(rgba[i]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  await writeFile(fileURLToPath(new URL(`./icon-${size}.png`, import.meta.url)), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
