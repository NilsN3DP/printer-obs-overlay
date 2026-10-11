// OctoPrint (/api/printer + /api/job) -> gemeinsames Statusformat.

function mapState(text = '') {
  const upper = String(text).toUpperCase();
  if (upper.includes('PRINT')) return 'PRINTING';
  if (upper.includes('PAUS')) return 'PAUSED';
  if (upper.includes('ERROR') || upper.includes('FAIL')) return 'ERROR';
  if (upper.includes('OPERATIONAL') || upper.includes('READY')) return 'IDLE';
  if (upper.includes('CANCEL')) return 'STOPPED';
  return upper || 'UNKNOWN';
}

export function normalizeOctoPrint(printerResp = {}, jobResp = {}) {
  const temps = printerResp.temperature || {};
  const tool0 = temps.tool0 || {};
  const bed = temps.bed || {};
  const file = jobResp.job?.file || {};
  return {
    printer: {
      state: mapState(printerResp.state?.text || jobResp.state),
      temp_nozzle: tool0.actual,
      target_nozzle: tool0.target,
      temp_bed: bed.actual,
      target_bed: bed.target,
    },
    job: file.name || file.display
      ? {
        file: { display_name: file.display || file.name, name: file.name },
        progress: jobResp.progress?.completion ?? 0,
        time_printing: jobResp.progress?.printTime ?? undefined,
        time_remaining: jobResp.progress?.printTimeLeft ?? undefined,
      }
      : null,
  };
}

export async function pollOctoPrint(client) {
  const [printerResp, jobResp] = await Promise.all([
    client.json('/api/printer'),
    client.json('/api/job').catch(() => ({})),
  ]);
  return normalizeOctoPrint(printerResp, jobResp);
}
