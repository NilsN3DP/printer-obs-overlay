// Binary G-Code (.bgcode, libbgcode-Blockformat): Bloecke lesen, entpacken
// (Deflate, Heatshrink 11/4 und 12/4) und MeatPack-kodierten G-Code dekodieren.
import zlib from 'node:zlib';

const BLOCK_FILE_METADATA = 0;
const BLOCK_GCODE = 1;
const BLOCK_SLICER_METADATA = 2;
const BLOCK_PRINTER_METADATA = 3;
const BLOCK_PRINT_METADATA = 4;
const BLOCK_THUMBNAIL = 5;

export function heatshrinkDecode(input, windowBits, lookaheadBits, expectedSize) {
  const out = Buffer.alloc(expectedSize);
  let outPos = 0;
  let bitPos = 0;
  const totalBits = input.length * 8;
  const readBits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((input[bitPos >> 3] >> (7 - (bitPos & 7))) & 1);
      bitPos++;
    }
    return v;
  };
  while (outPos < expectedSize && bitPos < totalBits) {
    if (readBits(1)) {
      if (bitPos + 8 > totalBits) break;
      out[outPos++] = readBits(8);
    } else {
      if (bitPos + windowBits + lookaheadBits > totalBits) break;
      const dist = readBits(windowBits) + 1;
      const count = readBits(lookaheadBits) + 1;
      for (let i = 0; i < count && outPos < expectedSize; i++) {
        out[outPos] = out[outPos - dist];
        outPos++;
      }
    }
  }
  if (outPos !== expectedSize) {
    throw new Error(`heatshrink: erwartet ${expectedSize} Bytes, bekam ${outPos}`);
  }
  return out;
}

function decompressBlock(data, compression, uncompressedSize) {
  switch (compression) {
    case 0:
      return data;
    case 1:
      try {
        return zlib.inflateSync(data);
      } catch {
        return zlib.inflateRawSync(data);
      }
    case 2:
      return heatshrinkDecode(data, 11, 4, uncompressedSize);
    case 3:
      return heatshrinkDecode(data, 12, 4, uncompressedSize);
    default:
      throw new Error(`Unbekannte Kompression ${compression}`);
  }
}

// MeatPack (Marlin-Schema, wie von libbgcode fuer G-Code-Bloecke genutzt)
const MEATPACK_LOOKUP = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', ' ', '\n', 'G', 'X', ''];

export function meatpackDecode(buf) {
  const out = [];
  let packing = false;
  let noSpaces = false;
  let i = 0;
  const table = () => {
    const t = MEATPACK_LOOKUP.slice();
    if (noSpaces) t[11] = 'E';
    return t;
  };
  let lut = table();
  while (i < buf.length) {
    const b = buf[i];
    if (b === 0xff && i + 2 < buf.length && buf[i + 1] === 0xff) {
      const cmd = buf[i + 2];
      i += 3;
      switch (cmd) {
        case 251: packing = true; break;
        case 250: packing = false; break;
        case 249: packing = false; noSpaces = false; lut = table(); break;
        case 247: noSpaces = true; lut = table(); break;
        case 246: noSpaces = false; lut = table(); break;
        default: break; // 248 (Query) u. a. ignorieren
      }
      continue;
    }
    if (!packing) {
      out.push(String.fromCharCode(b));
      i++;
      continue;
    }
    const low = b & 0x0f;
    const high = (b >> 4) & 0x0f;
    i++;
    if (low === 0x0f && high === 0x0f) {
      if (i < buf.length) out.push(String.fromCharCode(buf[i++]));
      if (i < buf.length) out.push(String.fromCharCode(buf[i++]));
    } else if (low === 0x0f) {
      if (i < buf.length) out.push(String.fromCharCode(buf[i++]));
      out.push(lut[high]);
    } else if (high === 0x0f) {
      out.push(lut[low]);
      if (i < buf.length) out.push(String.fromCharCode(buf[i++]));
    } else {
      out.push(lut[low], lut[high]);
    }
  }
  return out.join('');
}

export function parseIni(text, into) {
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^;\s*/, '');
    const value = line.slice(eq + 1).trim();
    if (key) into[key] = value;
  }
  return into;
}

export function isBgcode(buf) {
  return buf.length >= 4 && buf.toString('latin1', 0, 4) === 'GCDE';
}

/** .bgcode -> { config, gcodeText } */
export function parseBgcode(buf) {
  if (buf.length < 10 || !isBgcode(buf)) {
    throw new Error('Kein Binary-G-Code (GCDE-Magic fehlt)');
  }
  const checksumType = buf.readUInt16LE(8);
  let pos = 10;
  const config = {};
  const gcodeParts = [];

  while (pos + 8 <= buf.length) {
    const type = buf.readUInt16LE(pos);
    const compression = buf.readUInt16LE(pos + 2);
    const uncompressedSize = buf.readUInt32LE(pos + 4);
    pos += 8;
    let dataSize = uncompressedSize;
    if (compression !== 0) {
      dataSize = buf.readUInt32LE(pos);
      pos += 4;
    }

    let encoding = 0;
    if (type === BLOCK_THUMBNAIL) {
      pos += 6;
    } else {
      encoding = buf.readUInt16LE(pos);
      pos += 2;
    }

    const data = buf.subarray(pos, pos + dataSize);
    pos += dataSize;
    if (checksumType === 1) pos += 4; // CRC32 ueberspringen

    if (type === BLOCK_THUMBNAIL) continue;

    const raw = decompressBlock(data, compression, uncompressedSize);
    if (type === BLOCK_GCODE) {
      // encoding: 0 = keine, 1 = MeatPack, 2 = MeatPack mit Kommentaren
      gcodeParts.push(encoding === 0 ? raw.toString('latin1') : meatpackDecode(raw));
    } else if (
      type === BLOCK_FILE_METADATA || type === BLOCK_PRINTER_METADATA
      || type === BLOCK_PRINT_METADATA || type === BLOCK_SLICER_METADATA
    ) {
      parseIni(raw.toString('latin1'), config);
    }
  }

  return { config, gcodeText: gcodeParts.join('') };
}
