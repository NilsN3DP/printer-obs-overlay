// Ergaenzt den Rohstatus eines Druckers um abgeleitete Werte.
// Reihenfolge: Firmwarefeld > G-Code-Ableitung > nichts. Danach Slotplan und Swapping.
import { modelById } from '../config/models.js';
import { computeLive } from './gcode/live.js';

const SWAP_HOLD_MS = 90_000;

function slotDisplayName(slot) {
  const seen = new Set();
  return [slot?.brand, slot?.name, slot?.material]
    .map((part) => String(part || '').trim())
    .filter((part) => {
      const key = part.toLowerCase();
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' ');
}

export class Enricher {
  /** @param {{metaService: import('./job-meta.js').JobMetaService, globalWaste: () => number}} deps */
  constructor({ metaService, globalWaste = () => 0 }) {
    this.metaService = metaService;
    this.globalWaste = globalWaste;
    this.swapTrackers = new Map();
  }

  /**
   * @param {object} printerCfg  normalisierte Druckerkonfiguration
   * @param {object} state  Rohstatus vom Poller
   */
  enrich(printerCfg, state) {
    if (!state?.printer) return state;
    const job = state.job || null;
    const printer = { ...state.printer };
    const meta = this.metaService.get(printerCfg.id);
    const progress = typeof job?.progress === 'number' ? job.progress : null;

    if (meta && progress != null) {
      const derived = computeLive(meta, progress, {
        wasteGramsPerChange: printerCfg.wasteGramsPerChange || this.globalWaste(),
        timeRemainingSec: job.time_remaining,
      });
      for (const [k, v] of Object.entries(derived)) {
        if (printer[k] === undefined || printer[k] === null) printer[k] = v;
      }
    }

    this.applySlots(printerCfg, printer);
    this.applySwapHeuristic(printerCfg, printer, job, meta);
    if (!printer.filament_display && printer.material) printer.filament_display = printer.material;
    return { ...state, printer, meta: this.metaService.status(printerCfg.id) };
  }

  applySlots(printerCfg, printer) {
    const slots = printerCfg.slots || [];
    if (!slots.length) return;
    printer.filament_slots = slots;
    const active = slots.find((slot) => slot.slot === Number(printer.tool));
    if (active && !active.empty) {
      if (active.material) printer.material = active.material;
      if (active.color) printer.filament_color = active.color;
      printer.filament_display = slotDisplayName(active) || printer.material;
    }
    const highest = Math.max(...slots.filter((s) => !s.empty).map((s) => s.slot), 0);
    printer.tools_total = Math.max(Number(printer.tools_total) || 0, highest) || undefined;
  }

  /**
   * "Swapping": Beim INDX/XL faellt die Duesentemperatur beim Werkzeugwechsel deutlich ab.
   * Ein tiefer Abfall nahe eines Tool-Events setzt den Status fuer bis zu 90 s, bis die
   * Temperatur wieder anliegt. Ein echtes Firmwarefeld hat Vorrang.
   */
  applySwapHeuristic(printerCfg, printer, job, meta) {
    if (printer.swap_in_progress != null) return;
    const actual = Number(printer.temp_nozzle);
    const target = Number(printer.target_nozzle);
    const progress = Number(job?.progress);
    const printing = String(printer.state || '').toUpperCase().includes('PRINT');
    const toolchanger = modelById(printerCfg.model).toolchanger;
    const events = meta?.toolEvents || [];
    const nearToolchange = events.length === 0 || events.some((e) => Math.abs(e.pe - progress) <= 1.25);
    const now = Date.now();
    const previous = this.swapTrackers.get(printerCfg.id) || { active: false, until: 0 };
    const deepDip = toolchanger && printing && target >= 150 && actual > 0 && target - actual >= 12 && nearToolchange;
    const recovered = !Number.isFinite(actual) || !Number.isFinite(target) || target - actual < 6;
    let active = deepDip || (previous.active && !recovered && previous.until > now);
    if (!printing) active = false;
    this.swapTrackers.set(printerCfg.id, { active, until: deepDip ? now + SWAP_HOLD_MS : previous.until });
    printer.swap_in_progress = active;
  }
}
