// G-Code (Text oder Binary) -> Overlay-Metadaten:
//   - Slicer-Konfiguration/Statistik (Material, Farben, total toolchanges, Verbrauch)
//   - Timeline aus Tool- und Layerwechseln, jeweils verankert an M73 P (Fortschritt)
//     und M73 R (Restminuten) des Slicers.
import { isBgcode, parseBgcode } from './bgcode.js';

export function parseGcodeText(text, config) {
  const toolEvents = []; // { tool, p (int %), r (Restminuten), seq }
  const layerEvents = []; // { p, r, seq }
  let layerCount = 0;
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
        // INDX-Wechsel (Autofeeder-Gcode); S<slot> ist 0-basiert
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

  // Events mit gleichem Integer-Prozent gleichmaessig verteilen, damit der Vergleich
  // mit dem Float-Fortschritt von PrusaLink monoton bleibt.
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

const splitList = (v) => (v == null ? [] : String(v).split(';').map((s) => s.trim()));
const numberList = (v) => (v == null ? [] : String(v).split(/[,;]/).map(parseFloat).filter(Number.isFinite));

/** Waste je Wechsel aus Multitool-Ramming (Volumen x Dichte des abgelegten Tools). */
function rammingWasteByChange(config, toolEvents) {
  const enabled = String(config.filament_multitool_ramming ?? '').split(/[,;]/).map((v) => v.trim() === '1');
  const volumes = numberList(config.filament_multitool_ramming_volume);
  const densities = numberList(config.filament_density);
  if (!volumes.length || !enabled.some(Boolean)) return null;
  const perChange = [];
  for (let i = 1; i < toolEvents.length; i++) {
    const oldTool = toolEvents[i - 1].tool;
    const on = enabled[oldTool] ?? enabled[0] ?? false;
    const volume = volumes[oldTool] ?? volumes[0];
    const density = densities[oldTool] ?? densities[0] ?? 1.24;
    perChange.push(on && Number.isFinite(volume) ? (volume * density) / 1000 : 0);
  }
  return perChange.some((g) => g > 0) ? perChange : null;
}

/** Datei-Buffer -> Meta (erkennt Text- vs. Binary-G-Code selbst). */
export function parseFile(buf) {
  let config = {};
  let gcodeText;
  if (isBgcode(buf)) {
    ({ config, gcodeText } = parseBgcode(buf));
  } else {
    gcodeText = buf.toString('latin1');
  }
  const timeline = parseGcodeText(gcodeText, config);

  const materials = splitList(config.filament_type);
  const colors = splitList(config.filament_colour ?? config.extruder_colour);

  const totalFromConfig = Number(config['total toolchanges']);
  const changesTotal = Number.isFinite(totalFromConfig) && totalFromConfig >= 0
    ? totalFromConfig
    : Math.max(0, timeline.toolEvents.length - 1);

  // Waste gesamt – Prioritaet:
  //   1. expliziter Slicer-Wert (wipe tower / purge [g]), wenn > 0
  //   2. Multitool-Ramming: Volumen pro Wechsel x Dichte (INDX-Blobs)
  //   3. (live) Config-Fallback wasteGramsPerChange
  let wasteTotalG = null;
  for (const [key, value] of Object.entries(config)) {
    if (/(wipe|purge).*\[g\]/i.test(key)) {
      const n = parseFloat(value);
      if (Number.isFinite(n)) wasteTotalG = (wasteTotalG ?? 0) + n;
    }
  }
  if (!(wasteTotalG > 0)) wasteTotalG = null;

  let wasteByChange = changesTotal > 0 ? rammingWasteByChange(config, timeline.toolEvents) : null;
  if (wasteByChange) {
    const rammingTotal = wasteByChange.reduce((sum, g) => sum + g, 0);
    if (wasteTotalG == null) {
      wasteTotalG = rammingTotal;
    } else if (rammingTotal > 0) {
      // Expliziter Gesamtwert bleibt die Wahrheit; Ramming dient nur als Verteilungsschluessel.
      const scale = wasteTotalG / rammingTotal;
      wasteByChange = wasteByChange.map((g) => g * scale);
    }
  }

  const totalUsedG = parseFloat(config['total filament used [g]']);
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

/** Kurzfassung fuer die Datei-Analyse im Dashboard. */
export function summarizeMeta(meta, fileName = 'upload') {
  const uses = new Map();
  for (const event of meta.toolEvents || []) uses.set(event.tool, (uses.get(event.tool) || 0) + 1);
  const grams = (value) => {
    if (value == null) return null;
    const factor = Math.abs(value) < 1 ? 1000 : 10;
    return Math.round(value * factor) / factor;
  };
  return {
    fileName,
    toolsTotal: meta.toolsTotal || uses.size || null,
    changesTotal: meta.changesTotal || 0,
    layerTotal: meta.layerTotal || 0,
    wasteTotalG: grams(meta.wasteTotalG),
    totalUsedG: grams(meta.totalUsedG),
    materials: meta.materials || [],
    colors: meta.colors || [],
    toolUseCounts: [...uses.entries()].sort((a, b) => a[0] - b[0]).map(([tool0, count]) => ({ tool: tool0 + 1, count })),
    firstEvents: (meta.toolEvents || []).slice(0, 20).map((e) => ({
      tool: e.tool + 1,
      progress: Math.round((e.pe ?? e.p ?? 0) * 100) / 100,
    })),
    indxDetected: (meta.toolEvents || []).length > 0
      && /M8600|filament_multitool/i.test(JSON.stringify(meta.config || {})),
  };
}
