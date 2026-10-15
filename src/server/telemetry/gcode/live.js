// Live-Fortschritt (0-100, Float) auf die G-Code-Timeline abbilden und daraus aktives
// Tool, Wechsel done/total, Layer done/total und die Abfallmenge ableiten.

const roundGrams = (g) => (g < 1 ? Math.round(g * 1000) / 1000 : Math.round(g * 10) / 10);

/**
 * @param {object} meta  Ergebnis von parseFile()
 * @param {number} progress  Druckfortschritt 0-100
 * @param {{wasteGramsPerChange?: number, timeRemainingSec?: number}} opts
 */
export function computeLive(meta, progress, opts = {}) {
  if (!meta || typeof progress !== 'number') return {};
  const remainingSeconds = opts.timeRemainingSec == null ? Number.NaN : Number(opts.timeRemainingSec);
  const progressBucket = Math.floor(Math.max(0, progress));
  const passed = (event) => {
    if (event.p < progressBucket) return true;
    if (event.p > progressBucket) return false;
    if (Number.isFinite(remainingSeconds) && Number.isFinite(event.r)) {
      // M73 R ist minutenbasiert; eine halbe Minute Toleranz gegen Flattern an der Rundungsgrenze.
      return remainingSeconds <= event.r * 60 + 30;
    }
    return event.pe <= progress;
  };

  const passedTools = meta.toolEvents.filter(passed);
  const current = passedTools[passedTools.length - 1] ?? meta.toolEvents[0];
  const tool0 = current ? current.tool : null;
  const changesDone = Math.max(0, passedTools.length - 1);
  let layerNow = 0;
  for (const e of meta.layerEvents) {
    if (passed(e)) layerNow++;
    else break;
  }

  const result = {};
  if (tool0 != null) {
    result.tool = tool0 + 1; // 1-basiert wie das Firmwarefeld
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
    const exact = Array.isArray(meta.wasteByChange)
      ? meta.wasteByChange.slice(0, changesDone).reduce((sum, g) => sum + g, 0)
      : null;
    const wasteG = exact ?? wasteTotalG * (changesDone / meta.changesTotal);
    result.waste_g = roundGrams(wasteG);
    result.waste_total_g = roundGrams(wasteTotalG);
    if (meta.totalUsedG) result.waste_pct = Math.round((wasteTotalG / meta.totalUsedG) * 100);
  }
  return result;
}
