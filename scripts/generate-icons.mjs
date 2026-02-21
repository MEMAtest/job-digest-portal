#!/usr/bin/env node
/**
 * Generate PWA icon PNGs from scratch using raw PNG encoding.
 * Creates a gradient circle on a solid background matching the brand.
 * No external dependencies required.
 */
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function createPNG(size) {
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2, cy = size / 2, r = size * 0.47;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= r) {
        // Gradient from #4f46e5 (top-left) to #0f172a (bottom-right)
        const t = Math.min(1, Math.max(0, (dx + dy) / (2 * r) + 0.5));
        pixels[i]     = Math.round(79 * (1 - t) + 15 * t);   // R
        pixels[i + 1] = Math.round(70 * (1 - t) + 23 * t);   // G
        pixels[i + 2] = Math.round(229 * (1 - t) + 42 * t);  // B
        pixels[i + 3] = 255;

        // Draw the star/compass shape in white
        const nx = (x - cx) / r, ny = (y - cy) / r;
        const starDist = Math.abs(nx) + Math.abs(ny);
        if (starDist < 0.55) {
          // Inner diamond/star
          const alpha = Math.max(0, 1 - starDist / 0.55);
          const blend = Math.min(1, alpha * 2);
          pixels[i]     = Math.round(pixels[i] * (1 - blend * 0.75) + 255 * blend * 0.75);
          pixels[i + 1] = Math.round(pixels[i + 1] * (1 - blend * 0.75) + 255 * blend * 0.75);
          pixels[i + 2] = Math.round(pixels[i + 2] * (1 - blend * 0.75) + 255 * blend * 0.75);
        }

        // Anti-alias circle edge
        if (dist > r - 1.5) {
          const aa = Math.max(0, (r - dist) / 1.5);
          pixels[i + 3] = Math.round(255 * aa);
        }
      } else {
        // Background: #f4f6fb
        pixels[i]     = 0xf4;
        pixels[i + 1] = 0xf6;
        pixels[i + 2] = 0xfb;
        pixels[i + 3] = 255;
      }
    }
  }
  return encodePNG(size, size, pixels);
}

function encodePNG(w, h, rgba) {
  // Build raw image data with filter byte per row
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: none
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1);
  }

  const compressed = deflateSync(Buffer.from(raw));

  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const chunks = [
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ];

  return Buffer.concat([sig, ...chunks]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData) >>> 0, 0);
  return Buffer.concat([len, typeB, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return crc ^ 0xFFFFFFFF;
}

// Generate both icon sizes
for (const size of [192, 512]) {
  const png = createPNG(size);
  const outPath = join(ROOT, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`Created ${outPath} (${png.length} bytes)`);
}
