// Klipper/Moonraker (/printer/objects/query) -> gemeinsames Statusformat.

export const MOONRAKER_QUERY = '/printer/objects/query?extruder&heater_bed&print_stats&display_status'
  + '&toolhead&virtual_sdcard&gcode_move&fan';

function mapState(state = '') {
  const s = String(state).toLowerCase();
  if (s === 'printing') return 'PRINTING';
  if (s === 'paused') return 'PAUSED';
  if (s === 'error') return 'ERROR';
  if (s === 'complete') return 'FINISHED';
  if (s === 'cancelled') return 'STOPPED';
  return s ? 'IDLE' : 'UNKNOWN';
}

export function normalizeMoonraker(query = {}) {
  const o = query.result?.status || query.status || {};
  const extruder = o.extruder || {};
  const bed = o.heater_bed || {};
  const stats = o.print_stats || {};
  const sd = o.virtual_sdcard || {};
  const move = o.gcode_move || {};
  const progress01 = typeof o.display_status?.progress === 'number' && o.display_status.progress > 0
    ? o.display_status.progress
    : (typeof sd.progress === 'number' ? sd.progress : 0);
  const printing = Number(stats.print_duration) || 0;
  const remaining = progress01 > 0.001 ? Math.max(0, printing / progress01 - printing) : undefined;
  const info = stats.info || {};
  return {
    printer: {
      state: mapState(stats.state),
      temp_nozzle: extruder.temperature,
      target_nozzle: extruder.target,
      temp_bed: bed.temperature,
      target_bed: bed.target,
      axis_z: Array.isArray(o.toolhead?.position) ? o.toolhead.position[2] : undefined,
      speed: typeof move.speed_factor === 'number' ? Math.round(move.speed_factor * 100) : undefined,
      flow: typeof move.extrude_factor === 'number' ? Math.round(move.extrude_factor * 100) : undefined,
      fan_print_pct: typeof o.fan?.speed === 'number' ? Math.round(o.fan.speed * 100) : undefined,
      layer: info.current_layer ?? undefined,
      layer_total: info.total_layer ?? undefined,
    },
    job: stats.filename
      ? {
        file: { display_name: stats.filename, name: stats.filename },
        progress: progress01 * 100,
        time_printing: printing,
        time_remaining: remaining,
      }
      : null,
  };
}

export async function pollMoonraker(client) {
  return normalizeMoonraker(await client.json(MOONRAKER_QUERY));
}
