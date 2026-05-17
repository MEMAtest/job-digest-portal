#!/usr/bin/env node
/**
 * Generate PWA icon PNGs from scratch using raw PNG encoding.
 * Creates the Make Money badge: black app tile, purple brush arc,
 * rough white M, and lime growth arrow.
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

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x / Math.max(1, size - 1));
      const dy = (y / Math.max(1, size - 1));
      const vignette = Math.min(1, Math.hypot(dx - 0.5, dy - 0.48) * 1.45);
      const glow = Math.max(0, 1 - Math.hypot(dx - 0.72, dy - 0.2) * 4.8);

      pixels[i] = Math.round(8 + 9 * (1 - vignette) + 14 * glow);
      pixels[i + 1] = Math.round(9 + 10 * (1 - vignette) + 24 * glow);
      pixels[i + 2] = Math.round(15 + 18 * (1 - vignette) + 4 * glow);
      pixels[i + 3] = 255;
    }
  }

  drawTexture(pixels, size);
  drawArc(pixels, size, size * 0.5, size * 0.5, size * 0.37, 210, 35, size * 0.052, [67, 36, 232, 242]);
  drawArc(pixels, size, size * 0.5, size * 0.5, size * 0.32, 216, 24, size * 0.017, [67, 36, 232, 205]);
  drawLine(pixels, size, 0.19, 0.75, 0.38, 0.28, 0.105, [5, 6, 8, 210]);
  drawLine(pixels, size, 0.38, 0.28, 0.50, 0.62, 0.105, [5, 6, 8, 210]);
  drawLine(pixels, size, 0.50, 0.62, 0.66, 0.30, 0.105, [5, 6, 8, 210]);
  drawLine(pixels, size, 0.66, 0.30, 0.77, 0.74, 0.105, [5, 6, 8, 210]);
  drawLine(pixels, size, 0.18, 0.74, 0.37, 0.27, 0.072, [248, 250, 252, 255]);
  drawLine(pixels, size, 0.37, 0.27, 0.49, 0.61, 0.07, [248, 250, 252, 255]);
  drawLine(pixels, size, 0.49, 0.61, 0.65, 0.30, 0.07, [248, 250, 252, 255]);
  drawLine(pixels, size, 0.65, 0.30, 0.76, 0.72, 0.07, [248, 250, 252, 255]);
  drawLine(pixels, size, 0.61, 0.51, 0.80, 0.31, 0.062, [163, 255, 18, 255]);
  drawPolygon(pixels, size, [[0.77, 0.30], [0.77, 0.45], [0.89, 0.19], [0.62, 0.29]], [163, 255, 18, 255]);
  drawLine(pixels, size, 0.21, 0.79, 0.73, 0.76, 0.017, [248, 250, 252, 155]);
  drawSplatters(pixels, size);

  return encodePNG(size, size, pixels);
}

function drawTexture(pixels, size) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = pseudoNoise(x, y);
      if (n > 0.986) blendPixel(pixels, size, x, y, [255, 255, 255, 22]);
      if (n < 0.018) blendPixel(pixels, size, x, y, [0, 0, 0, 34]);
    }
  }
}

function drawArc(pixels, size, cx, cy, radius, startDeg, endDeg, width, rgba) {
  const start = (startDeg * Math.PI) / 180;
  const end = (endDeg * Math.PI) / 180;
  const sweep = end < start ? end + Math.PI * 2 - start : end - start;
  const steps = Math.max(12, Math.round((radius * sweep) / 4));
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const angle = start + (sweep * i) / steps;
    const next = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    if (prev) drawLinePixels(pixels, size, prev[0], prev[1], next[0], next[1], width, rgba);
    prev = next;
  }
}

function drawLine(pixels, size, x1, y1, x2, y2, width, rgba) {
  drawLinePixels(pixels, size, x1 * size, y1 * size, x2 * size, y2 * size, width * size, rgba);
}

function drawLinePixels(pixels, size, x1, y1, x2, y2, width, rgba) {
  const pad = width + 3;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - pad));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x1, x2) + pad));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - pad));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y1, y2) + pad));
  const radius = width / 2;
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy || 1;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / len2));
      const px = x1 + t * vx;
      const py = y1 + t * vy;
      const dist = Math.hypot(x - px, y - py);
      const alpha = Math.max(0, Math.min(1, radius + 0.9 - dist));
      if (alpha > 0) blendPixel(pixels, size, x, y, [rgba[0], rgba[1], rgba[2], Math.round(rgba[3] * alpha)]);
    }
  }
}

function drawPolygon(pixels, size, points, rgba) {
  const scaled = points.map(([x, y]) => [x * size, y * size]);
  const xs = scaled.map(([x]) => x);
  const ys = scaled.map(([, y]) => y);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(...ys)));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, scaled)) blendPixel(pixels, size, x, y, rgba);
    }
  }
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0], yi = points[i][1];
    const xj = points[j][0], yj = points[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function drawSplatters(pixels, size) {
  const dots = [
    [0.13, 0.58, 0.012, [67, 36, 232, 210]],
    [0.21, 0.27, 0.009, [67, 36, 232, 190]],
    [0.85, 0.50, 0.011, [67, 36, 232, 205]],
    [0.72, 0.19, 0.01, [163, 255, 18, 190]],
    [0.86, 0.35, 0.009, [163, 255, 18, 175]],
  ];
  for (const [cx, cy, r, rgba] of dots) {
    drawCircle(pixels, size, cx * size, cy * size, r * size, rgba);
  }
}

function drawCircle(pixels, size, cx, cy, radius, rgba) {
  const minX = Math.max(0, Math.floor(cx - radius - 1));
  const maxX = Math.min(size - 1, Math.ceil(cx + radius + 1));
  const minY = Math.max(0, Math.floor(cy - radius - 1));
  const maxY = Math.min(size - 1, Math.ceil(cy + radius + 1));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const alpha = Math.max(0, Math.min(1, radius + 0.8 - Math.hypot(x - cx, y - cy)));
      if (alpha > 0) blendPixel(pixels, size, x, y, [rgba[0], rgba[1], rgba[2], Math.round(rgba[3] * alpha)]);
    }
  }
}

function blendPixel(pixels, size, x, y, rgba) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  const alpha = rgba[3] / 255;
  const baseAlpha = pixels[i + 3] / 255;
  const outAlpha = alpha + baseAlpha * (1 - alpha);
  if (outAlpha <= 0) return;

  pixels[i] = Math.round((rgba[0] * alpha + pixels[i] * baseAlpha * (1 - alpha)) / outAlpha);
  pixels[i + 1] = Math.round((rgba[1] * alpha + pixels[i + 1] * baseAlpha * (1 - alpha)) / outAlpha);
  pixels[i + 2] = Math.round((rgba[2] * alpha + pixels[i + 2] * baseAlpha * (1 - alpha)) / outAlpha);
  pixels[i + 3] = Math.round(outAlpha * 255);
}

function pseudoNoise(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
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
