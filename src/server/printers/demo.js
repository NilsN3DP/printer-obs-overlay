// Simulierter INDX-Druck, damit Overlay und Dashboard ohne echten Drucker testbar sind.
// Ein Zyklus dauert 10 Minuten; alle ~20 % wird das Tool gewechselt, inkl. kurzem "Swapping".

const MATERIALS = ['PLA', 'PETG', 'PLA', 'ASA'];
const CYCLE_S = 600;

export function demoStatus(nowMs = Date.now()) {
  const seconds = Math.floor(nowMs / 1000);
  const t = seconds % CYCLE_S;
  const progress = (t / CYCLE_S) * 100;
  const tool = Math.floor(progress / 20) % 4;
  const sinceChange = (t % (CYCLE_S / 5));
  const swapping = sinceChange < 6 && progress > 1;
  return {
    printer: {
      state: 'PRINTING',
      temp_nozzle: swapping ? 196 : 214.6 + Math.sin(seconds / 8) * 1.4,
      target_nozzle: 215,
      temp_bed: 59.4 + Math.sin(seconds / 11) * 0.6,
      target_bed: 60,
      material: MATERIALS[tool],
      tool: tool + 1,
      tools_total: 4,
      filament_changes: Math.floor(progress / 20),
      filament_changes_total: 4,
      layer: Math.floor(progress * 3),
      layer_total: 300,
      waste_g: Math.round(Math.floor(progress / 20) * 0.022 * 1000) / 1000,
      waste_total_g: 0.088,
      swap_in_progress: swapping,
      speed: 100,
      flow: 95,
      axis_z: Math.round(progress * 1.8 * 100) / 100,
      fan_hotend: 8200,
      fan_print: 5400,
    },
    job: {
      file: { display_name: 'demo-indx-4farben.bgcode', name: 'DEMO.BGC' },
      progress,
      time_printing: t,
      time_remaining: CYCLE_S - t,
    },
  };
}
