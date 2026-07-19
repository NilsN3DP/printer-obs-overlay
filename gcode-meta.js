import zlib from 'node:zlib';

/**
 * Holt die gerade druckende G-Code-Datei vom Drucker (PrusaLink refs.download)
 * und extrahiert Overlay-Daten ohne Custom-Firmware:
 *   - Slicer-Konfig/Statistik (Material, Farben, total toolchanges, Filamentverbrauch)
 *   - Timeline: Toolwechsel + Layerwechsel, jeweils verankert am M73-Fortschritt
 * computeLive() mappt den Live-Fortschritt (PrusaLink job.progress) auf die Timeline
 * und liefert aktives Tool, Wechsel done/total, Layer done/total und Waste-Schätzung.
 *
 * Unterstützt Text-G-Code und Binary-G-Code (.bgcode: Blöcke, Deflate/Heatshrink,
 * MeatPack) nach dem libbgcode-Format.
 */

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

// PrusaLink liefert waehrend eines Drucks nur sehr langsam (teils <30 KB/s).
// Deshalb kein hartes Gesamt-Timeout, sondern ein Inaktivitaets-Watchdog:
// abgebrochen wird nur, wenn 90 s lang gar keine Daten kommen (Gesamtdeckel 2 h).
export async function downloadFile(host, authHeaders = {}, downloadPath) {
  const url = `http://${host}${downloadPath.startsWith('/') ? '' : '/'}${downloadPath}`;
  const headers = typeof authHeaders === 'string'
    ? (authHeaders ? { 'X-Api-Key': authHeaders } : {})
    : authHeaders;
  const controller = new AbortController();
  let watchdog = setTimeout(() => controller.abort(new Error('Download: 90 s keine Daten')), 90000);
  const feed = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => controller.abort(new Error('Download: 90 s keine Daten')), 90000);
  };
  const overall = setTimeout(() => controller.abort(new Error('Download: 2 h Gesamtlimit')), 120 * 60 * 1000);

  try {
    const res = await (typeof authHeaders === 'function'
      ? authHeaders(url, { signal: controller.signal })
      : fetch(url, { headers, signal: controller.signal }));
    if (!res.ok) {
      throw new Error(`Download ${downloadPath} -> HTTP ${res.status}`);
    }
    const chunks = [];
    for await (const chunk of res.body) {
      feed();
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    // AbortError traegt die eigentliche Ursache im cause/reason
    throw err instanceof Error && err.name === 'AbortError' && controller.signal.reason instanceof Error
      ? controller.signal.reason
      : err;
  } finally {
    clearTimeout(watchdog);
    clearTimeout(overall);
  }
}

// ---------------------------------------------------------------------------
// Binary G-Code (.bgcode) – libbgcode Blockformat
// ---------------------------------------------------------------------------

const BLOCK_FILE_METADATA = 0;
const BLOCK_GCODE = 1;
const BLOCK_SLICER_METADATA = 2;
const BLOCK_PRINTER_METADATA = 3;
const BLOCK_PRINT_METADATA = 4;
const BLOCK_THUMBNAIL = 5;

function heatshrinkDecode(input, windowBits, lookaheadBits, expectedSize) {
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

// MeatPack (Marlin-Schema, wie von libbgcode fuer GCode-Bloecke genutzt)
const MEATPACK_LOOKUP = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', ' ', '\n', 'G', 'X', ''];

function meatpackDecode(buf) {
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
        default: break; // 248 query u.a. – ignorieren
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
      // beide Zeichen folgen als volle Bytes
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

function parseBgcode(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 4) !== 'GCDE') {
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

    // Blockparameter
    let paramSize = 0;
    let encoding = 0;
    if (type === BLOCK_THUMBNAIL) {
      paramSize = 6;
    } else {
      paramSize = 2;
      encoding = buf.readUInt16LE(pos);
    }
    pos += paramSize;

    const data = buf.subarray(pos, pos + dataSize);
    pos += dataSize;
    if (checksumType === 1) pos += 4; // CRC32 ueberspringen

    if (type === BLOCK_THUMBNAIL) continue;

    const raw = decompressBlock(data, compression, uncompressedSize);

    if (type === BLOCK_GCODE) {
      // encoding: 0 = none, 1 = MeatPack, 2 = MeatPack (comments)
      gcodeParts.push(encoding === 0 ? raw.toString('latin1') : meatpackDecode(raw));
    } else if (
      type === BLOCK_FILE_METADATA || type === BLOCK_PRINTER_METADATA
      || type === BLOCK_PRINT_METADATA || type === BLOCK_SLICER_METADATA
    ) {
      // encoding 0 = INI (key = value je Zeile)
      parseIni(raw.toString('latin1'), config);
    }
  }

  return { config, gcodeText: gcodeParts.join('') };
}

function parseIni(text, into) {
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^;\s*/, '');
    const value = line.slice(eq + 1).trim();
    if (key) into[key] = value;
  }
  return into;
}

// ---------------------------------------------------------------------------
// Text-G-Code: Timeline (M73/T/Layer) + Footer-Konfig
// ---------------------------------------------------------------------------

function parseGcodeText(text, config) {
  const toolEvents = []; // { tool, p (int %), r (remaining minutes), seq }
  let layerCount = 0;
  const layerEvents = []; // { p (int %), seq }
  let lastP = 0;
  let lastR = null;
  let seq = 0;

  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = len;
    const line = text.slice(start, end);
    start = end + 1;
    if (!line) continue;

    const c0 = line.charCodeAt(0);
    if (c0 === 77 /* M */) {
      if (line.startsWith('M73')) {
        const m = /P(\d+)/.exec(line);
        if (m) lastP = Number(m[1]);
        const r = /(?:^|\s)R(\d+(?:\.\d+)?)/.exec(line);
        if (r) lastR = Number(r[1]);
      } else if (line.startsWith('M8600')) {
        // INDX-Autofeeder-Wechsel (CFW-Gcode); S<slot> 0-basiert
        const m = /S(\d+)/.exec(line);
        if (m) toolEvents.push({ tool: Number(m[1]), p: lastP, r: lastR, seq: seq++ });
      }
    } else if (c0 === 84 /* T */) {
      const m = /^T(\d+)/.exec(line);
      if (m) toolEvents.push({ tool: Number(m[1]), p: lastP, r: lastR, seq: seq++ });
    } else if (c0 === 59 /* ; */) {
      if (line.startsWith(';LAYER_CHANGE')) {
        layerCount++;
        layerEvents.push({ p: lastP, r: lastR, seq: seq++ });
      } else {
        const eq = line.indexOf('=');
        if (eq > 1) {
          const key = line.slice(1, eq).trim();
          const value = line.slice(eq + 1).trim();
          if (key && !key.includes(' G')) config[key] = value;
        }
      }
    }
  }

  // Feinaufloesung: Events mit gleichem Integer-Prozentwert gleichmaessig verteilen,
  // damit der Vergleich mit dem Float-Fortschritt von PrusaLink monoton bleibt.
  const spread = (events) => {
    let i = 0;
    while (i < events.length) {
      let j = i;
      while (j < events.length && events[j].p === events[i].p) j++;
      const n = j - i;
      for (let k = 0; k < n; k++) events[i + k].pe = events[i + k].p + k / n;
      i = j;
    }
  };
  spread(toolEvents);
  spread(layerEvents);

  return { toolEvents, layerEvents, layerTotal: layerCount };
}

// ---------------------------------------------------------------------------
// Oeffentliche API
// ---------------------------------------------------------------------------

/** Datei-Buffer -> Meta (erkennt Text- vs. Binary-G-Code selbst). */
export function parseFile(buf) {
  let config = {};
  let gcodeText;
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'GCDE') {
    const parsed = parseBgcode(buf);
    config = parsed.config;
    gcodeText = parsed.gcodeText;
  } else {
    gcodeText = buf.toString('latin1');
  }
  const timeline = parseGcodeText(gcodeText, config);

  const splitList = (v) => (v == null ? [] : String(v).split(';').map((s) => s.trim()));
  const materials = splitList(config.filament_type);
  const colors = splitList(config.filament_colour ?? config.extruder_colour);

  const totalFromConfig = Number(config['total toolchanges']);
  const changesTotal = Number.isFinite(totalFromConfig) && totalFromConfig >= 0
    ? totalFromConfig
    : Math.max(0, timeline.toolEvents.length - 1);

  // Waste gesamt, in dieser Reihenfolge:
  //   1. expliziter Slicer-Wert (wipe tower / purge Gramm), wenn > 0
  //   2. Multitool-Ramming: Volumen pro Wechsel (mm3) x Dichte -> g pro Wechsel (INDX-Blobs)
  let wasteTotalG = null;
  for (const [key, value] of Object.entries(config)) {
    if (/(wipe|purge).*\[g\]/i.test(key)) {
      const n = parseFloat(value);
      if (Number.isFinite(n)) wasteTotalG = (wasteTotalG ?? 0) + n;
    }
  }
  if (!(wasteTotalG > 0)) wasteTotalG = null;
  const totalUsedG = parseFloat(config['total filament used [g]']);

  // INDX-Ramming ist pro Filament/Slot konfiguriert. Statt den Mittelwert mit
  // allen Wechseln zu multiplizieren, ordnen wir jedem Wechsel das Volumen des
  // abgelegten Tools zu. Das liefert auch einen belastbaren Live-Zwischenstand.
  let wasteByChange = null;
  if (changesTotal > 0) {
    const nums = (v) => (v == null ? [] : String(v).split(/[,;]/).map(parseFloat).filter(Number.isFinite));
    const rammingEnabled = String(config.filament_multitool_ramming ?? '').split(/[,;]/)
      .map((v) => v.trim() === '1');
    const volumes = nums(config.filament_multitool_ramming_volume);
    const densities = nums(config.filament_density);
    if (volumes.length && rammingEnabled.some(Boolean)) {
      wasteByChange = [];
      for (let i = 1; i < timeline.toolEvents.length; i++) {
        const oldTool = timeline.toolEvents[i - 1].tool;
        const enabled = rammingEnabled[oldTool] ?? rammingEnabled[0] ?? false;
        const volume = volumes[oldTool] ?? volumes[0];
        const density = densities[oldTool] ?? densities[0] ?? 1.24;
        wasteByChange.push(enabled && Number.isFinite(volume) ? volume * density / 1000 : 0);
      }
      if (!wasteByChange.some((g) => g > 0)) wasteByChange = null;
    }
  }

  if (wasteByChange) {
    const rammingTotal = wasteByChange.reduce((sum, grams) => sum + grams, 0);
    if (wasteTotalG == null) {
      wasteTotalG = rammingTotal;
    } else if (rammingTotal > 0) {
      // Ein expliziter Purge-/Wipe-Gesamtwert bleibt die Wahrheit; die
      // slotbezogenen Ramming-Mengen dienen dann nur als Verteilungsschlüssel.
      const scale = wasteTotalG / rammingTotal;
      wasteByChange = wasteByChange.map((grams) => grams * scale);
    }
  }

  return {
    materials,
    colors,
    toolsTotal: Math.max(materials.length, colors.length,
      timeline.toolEvents.reduce((m, e) => Math.max(m, e.tool + 1), 0)) || null,
    changesTotal,
    wasteTotalG,
    wasteByChange,
    totalUsedG: Number.isFinite(totalUsedG) ? totalUsedG : null,
    toolEvents: timeline.toolEvents,
    layerEvents: timeline.layerEvents,
    layerTotal: timeline.layerTotal,
    config,
  };
}

/**
 * Live-Fortschritt (0-100 float) auf die Timeline mappen.
 * Liefert nur Felder, die sich ableiten lassen; Rest bleibt undefined.
 * opts.wasteGramsPerChange: Fallback-Schaetzung (g pro Toolwechsel), wenn der
 * Slicer keine Wipe-/Purge-Gramm in die Datei schreibt.
 */
export function computeLive(meta, progress, opts = {}) {
  if (!meta || typeof progress !== 'number') return {};
  const remainingSeconds = opts.timeRemainingSec == null ? Number.NaN : Number(opts.timeRemainingSec);
  const progressBucket = Math.floor(Math.max(0, progress));
  const passed = (event) => {
    if (event.p < progressBucket) return true;
    if (event.p > progressBucket) return false;
    if (Number.isFinite(remainingSeconds) && Number.isFinite(event.r)) {
      // M73 R ist minutenbasiert. Eine halbe Minute Toleranz verhindert
      // Flattern an der Rundungsgrenze der PrusaLink-Restzeit.
      return remainingSeconds <= event.r * 60 + 30;
    }
    return event.pe <= progress;
  };
  const passedTools = meta.toolEvents.filter(passed);
  const currentToolEvent = passedTools[passedTools.length - 1] ?? meta.toolEvents[0];
  const tool0 = currentToolEvent ? currentToolEvent.tool : null;

  const changesDone = Math.max(0, passedTools.length - 1);
  let layerNow = 0;
  for (const e of meta.layerEvents) {
    if (passed(e)) layerNow++; else break;
  }

  const result = {};
  if (tool0 != null) {
    result.tool = tool0 + 1; // 1-basiert wie CFW-Feld
    if (meta.toolsTotal) result.tools_total = meta.toolsTotal;
    const material = meta.materials[tool0];
    if (material) result.material = material;
    const color = meta.colors[tool0];
    if (color) result.filament_color = color.startsWith('#') ? color : `#${color}`;
  }
  if (meta.changesTotal > 0 || changesDone > 0) {
    result.filament_changes = changesDone;
    result.filament_changes_total = meta.changesTotal;
  }
  if (meta.layerTotal > 0) {
    result.layer = layerNow;
    result.layer_total = meta.layerTotal;
  }
  let wasteTotalG = meta.wasteTotalG;
  if (wasteTotalG == null && opts.wasteGramsPerChange > 0 && meta.changesTotal > 0) {
    wasteTotalG = opts.wasteGramsPerChange * meta.changesTotal;
  }
  if (wasteTotalG != null && meta.changesTotal > 0) {
    const exactChanges = Array.isArray(meta.wasteByChange)
      ? meta.wasteByChange.slice(0, changesDone).reduce((sum, grams) => sum + grams, 0)
      : null;
    const wasteG = exactChanges ?? wasteTotalG * (changesDone / meta.changesTotal);
    const roundGrams = (grams) => grams < 1
      ? Math.round(grams * 1000) / 1000
      : Math.round(grams * 10) / 10;
    result.waste_g = roundGrams(wasteG);
    result.waste_total_g = roundGrams(wasteTotalG);
    if (meta.totalUsedG) {
      result.waste_pct = Math.round((wasteTotalG / meta.totalUsedG) * 100);
    }
  }
  return result;
}
