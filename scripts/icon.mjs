// Erzeugt das App-Icon (ICO mit 16/32/48 px als BMP und 256 px als PNG) ohne Grafik-Tools:
// dunkle Kachel, gestapelte Druck-Layer mit orangefarbener oberster Lage, darunter ein
// Fortschrittsbalken – angelehnt an die Overlay-Fussleiste.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ORANGE = [250, 104, 49];
const TILE = [27, 30, 35];
const TRACK = [48, 52, 60];
const LAYER = [233, 234, 236];

// Formen im 256er-Koordinatensystem, spaeter Gezeichnetes liegt oben.
const SHAPES = [
  { x0: 8, y0: 8, x1: 248, y1: 248, r: 54, c: TILE },
  { x0: 53, y0: 142, x1: 203, y1: 161, r: 7, c: LAYER },
  { x0: 69, y0: 118, x1: 187, y1: 137, r: 7, c: LAYER },
  { x0: 85, y0: 94, x1: 171, y1: 113, r: 7, c: LAYER },
  { x0: 101, y0: 70, x1: 155, y1: 89, r: 7, c: ORANGE },
  { x0: 44, y0: 184, x1: 212, y1: 202, r: 9, c: TRACK },
  { x0: 44, y0: 184, x1: 164, y1: 202, r: 9, c: ORANGE },
];

function inRoundRect(x, y, s) {
  if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) return false;
  const cx = Math.min(Math.max(x, s.x0 + s.r), s.x1 - s.r);
  const cy = Math.min(Math.max(y, s.y0 + s.r), s.y1 - s.r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= s.r ** 2;
}

/** RGBA-Pixel (oben links beginnend) mit 4x4-Supersampling. */
export function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const scale = 256 / size;
  const n = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const ux = (x + (sx + 0.5) / n) * scale;
          const uy = (y + (sy + 0.5) / n) * scale;
          let color = null;
          for (const s of SHAPES) if (inRoundRect(ux, uy, s)) color = s.c;
          if (color) { r += color[0]; g += color[1]; b += color[2]; a += 1; }
        }
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
      }
      px[i + 3] = Math.round((a / (n * n)) * 255);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, k) => {
  let c = k;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng(rgba, size) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeBmp(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR- + AND-Maske
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = ((size - 1 - y) * size + x) * 4; // BMP ist von unten nach oben gespeichert
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

export function writeIcon(file) {
  const images = [16, 32, 48, 256].map((size) => {
    const rgba = renderIcon(size);
    return { size, data: size === 256 ? encodePng(rgba, size) : encodeBmp(rgba, size) };
  });
  const dir = Buffer.alloc(6 + images.length * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach((img, i) => {
    const e = 6 + i * 16;
    dir[e] = img.size === 256 ? 0 : img.size;
    dir[e + 1] = img.size === 256 ? 0 : img.size;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(img.data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += img.data.length;
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([dir, ...images.map((i) => i.data)]));
}

// Direkt aufgerufen: Icon + PNG-Varianten fuer Weboberflaeche und Doku erzeugen.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  writeIcon(path.join(root, 'packaging', 'windows', 'app.ico'));
  fs.writeFileSync(path.join(root, 'src', 'web', 'favicon.png'), encodePng(renderIcon(64), 64));
  fs.writeFileSync(path.join(root, 'docs', 'logo.png'), encodePng(renderIcon(256), 256));
  console.log('Icons erzeugt: packaging/windows/app.ico, src/web/favicon.png, docs/logo.png');
}
