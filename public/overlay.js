// All selectable sections, in the order the builder UI shows them.
const ALL_SECTIONS = [
  'frame', 'brand', 'printerName', 'status', 'file', 'progress', 'time',
  'nozzle', 'bed', 'filament', 'changes', 'tool', 'slots', 'waste', 'layer', 'speed', 'flow', 'z', 'fanHotend', 'fanPrint',
];

const params = new URLSearchParams(window.location.search);
const printerId = params.get('printer') || '';
let layout = params.get('layout') === 'card' ? 'card' : 'bar';
const accent = params.get('accent');
const brand = params.get('brand');
const socialsParam = params.get('socials');

// sections param: comma list. Absent -> show all.
const sectionsParam = params.get('sections');
let activeSections = sectionsParam
  ? new Set(sectionsParam.split(',').map((s) => s.trim()).filter(Boolean))
  : new Set(ALL_SECTIONS);

const POLL_MS = Number(params.get('poll')) || 2000;
const STATUS_URL = `/api/status${printerId ? `?printer=${encodeURIComponent(printerId)}` : ''}`;
const TOOLCHANGE_SECTIONS = ['changes', 'tool', 'slots', 'waste'];

document.body.classList.add(`layout-${layout}`);
if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) {
  document.documentElement.style.setProperty('--accent', accent);
}
if (brand) applyBrand(brand);
if (socialsParam) {
  applySocials(socialsParam === 'none'
    ? []
    : socialsParam.split(',').map((s) => s.trim()).filter(Boolean));
}

// Hide sections that are not requested.
function applySections() {
  document.querySelectorAll('[data-section]').forEach((elem) => {
    const key = elem.getAttribute('data-section');
    elem.classList.toggle('section-off', !activeSections.has(key));
  });
  // Hide a divider if nothing before or after it is visible.
  const brandOn = activeSections.has('brand') || activeSections.has('printerName');
  document.querySelectorAll('[data-divider]').forEach((d) => {
    d.classList.toggle('section-off', !brandOn);
  });
}

const el = {
  printerName: document.querySelector('.printer-name'),
  state: document.getElementById('state'),
  offlineNotice: document.getElementById('offlineNotice'),
  content: document.getElementById('content'),
  filename: document.getElementById('filename'),
  progressFill: document.getElementById('progressFill'),
  progressPct: document.getElementById('progressPct'),
  timeRemaining: document.getElementById('timeRemaining'),
  timeElapsed: document.getElementById('timeElapsed'),
  timeTotal: document.getElementById('timeTotal'),
  doneAt: document.getElementById('doneAt'),
  nozzleTemp: document.getElementById('nozzleTemp'),
  nozzleTarget: document.getElementById('nozzleTarget'),
  bedTemp: document.getElementById('bedTemp'),
  bedTarget: document.getElementById('bedTarget'),
  filamentColor: document.getElementById('filamentColor'),
  statMaterial: document.getElementById('statMaterial'),
  statChanges: document.getElementById('statChanges'),
  statTool: document.getElementById('statTool'),
  slotRail: document.getElementById('slotRail'),
  statLayer: document.getElementById('statLayer'),
  statWaste: document.getElementById('statWaste'),
  statWasteSub: document.getElementById('statWasteSub'),
  statSpeed: document.getElementById('statSpeed'),
  statFlow: document.getElementById('statFlow'),
  statZ: document.getElementById('statZ'),
  statFanHotend: document.getElementById('statFanHotend'),
  statFanPrint: document.getElementById('statFanPrint'),
};

const STATE_LABELS = {
  IDLE: 'Ready', READY: 'Ready', BUSY: 'Busy', PRINTING: 'Printing',
  PAUSED: 'Paused', FINISHED: 'Finished', STOPPED: 'Stopped',
  ERROR: 'Error', ATTENTION: 'Attention', SWAPPING: 'Swapping',
};

const STATE_CLASSES = {
  IDLE: 'state--idle', READY: 'state--idle', BUSY: 'state--printing',
  PRINTING: 'state--printing', PAUSED: 'state--paused', FINISHED: 'state--idle',
  STOPPED: 'state--paused', ERROR: 'state--error', ATTENTION: 'state--error',
  SWAPPING: 'state--swapping',
};

function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) {
    return '--:--';
  }
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

function applyLayout(nextLayout) {
  document.body.classList.remove('layout-bar', 'layout-card');
  layout = nextLayout === 'card' ? 'card' : 'bar';
  document.body.classList.add(`layout-${layout}`);
}

function applyBrand(value) {
  if (!value) return;
  const handle = document.querySelector('.handle');
  const decoded = String(value).slice(0, 32);
  const split = decoded.includes('_') ? decoded.split('_') : [decoded, ''];
  handle.innerHTML = '';
  handle.appendChild(document.createTextNode(split[0]));
  if (split[1]) {
    const accentSpan = document.createElement('span');
    accentSpan.className = 'handle-accent';
    accentSpan.textContent = `_${split.slice(1).join('_')}`;
    handle.appendChild(accentSpan);
  }
}

function applySocials(keys) {
  const activeSocials = new Set(keys || []);
  document.querySelectorAll('[data-social]').forEach((node) => {
    node.classList.toggle('hidden', !activeSocials.has(node.getAttribute('data-social')));
  });
}

async function loadAssignedAppearance() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) return;
    const config = await res.json();
    const printer = (config.printers || []).find((item) => item.id === printerId) || config.printers?.[0];
    const preset = (config.presets || []).find((item) => item.id === printer?.presetId);

    if (!params.has('layout') && preset?.layout) applyLayout(preset.layout);
    if (!sectionsParam && preset?.sections?.length) {
      activeSections = new Set(preset.sections);
    }
    if (!(accent && /^#[0-9a-fA-F]{6}$/.test(accent))) {
      const configuredAccent = preset?.accentColor || config.theme?.accentColor;
      if (/^#[0-9a-fA-F]{6}$/.test(configuredAccent || '')) {
        document.documentElement.style.setProperty('--accent', configuredAccent);
      }
    }
    if (!brand) applyBrand(preset?.brandText || config.theme?.brandText);
    if (!socialsParam) {
      const configuredSocials = preset
        ? preset.socials || []
        : Object.entries(config.theme?.socials || {}).filter(([, value]) => value).map(([key]) => key);
      applySocials(configuredSocials);
    }
    applySections();
  } catch {
    // URL/default appearance remains a safe fallback when config is unavailable.
  } finally {
    document.documentElement.classList.remove('appearance-loading');
  }
}

function applyToolchangeAvailability(hasToolchanges) {
  for (const key of TOOLCHANGE_SECTIONS) {
    document.querySelectorAll(`[data-section="${key}"]`).forEach((node) => {
      node.classList.toggle('data-unavailable', !hasToolchanges);
    });
  }
}

function formatClockFromNow(seconds) {
  if (!Number.isFinite(Number(seconds))) return '--:--';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
    .format(new Date(Date.now() + Math.max(0, Number(seconds)) * 1000));
}

function setState(stateKey) {
  el.state.textContent = STATE_LABELS[stateKey] || stateKey || 'Unknown';
  el.state.className = `state ${STATE_CLASSES[stateKey] || 'state--idle'}`;
  if (!activeSections.has('status')) {
    el.state.classList.add('section-off');
  }
}

function setOffline(message) {
  el.state.textContent = 'Offline';
  el.state.className = 'state state--offline';
  if (!activeSections.has('status')) {
    el.state.classList.add('section-off');
  }
  el.offlineNotice.textContent = message || 'Printer unreachable';
  el.offlineNotice.classList.remove('hidden');
  el.content.classList.add('hidden');
}

function render(data) {
  if (!data.connected) {
    setOffline(data.error);
    return;
  }

  el.offlineNotice.classList.add('hidden');
  el.content.classList.remove('hidden');

  const printer = data.printer || {};
  const job = data.job || {};

  setState(printer.swap_in_progress ? 'SWAPPING' : printer.state);

  const fileName = job.file?.display_name || job.file?.name || '—';
  el.filename.textContent = fileName;
  el.filename.title = fileName;

  const progress = typeof job.progress === 'number' ? job.progress : 0;
  el.progressFill.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  el.progressPct.textContent = `${Math.round(progress)}%`;

  el.timeRemaining.textContent = formatDuration(job.time_remaining);
  el.timeElapsed.textContent = formatDuration(job.time_printing);
  const totalTime = Number(job.time_printing) + Number(job.time_remaining);
  el.timeTotal.textContent = Number.isFinite(totalTime) ? formatDuration(totalTime) : '--:--';
  el.doneAt.textContent = formatClockFromNow(job.time_remaining);

  el.nozzleTemp.textContent = `${Math.round(printer.temp_nozzle ?? 0)}°C`;
  el.nozzleTarget.textContent = `/ ${Math.round(printer.target_nozzle ?? 0)}°C`;

  el.bedTemp.textContent = `${Math.round(printer.temp_bed ?? 0)}°C`;
  el.bedTarget.textContent = `/ ${Math.round(printer.target_bed ?? 0)}°C`;

  el.statMaterial.textContent = printer.filament_display || printer.material || '–';
  el.statMaterial.title = printer.filament_display || printer.material || '';
  if (printer.filament_color) {
    el.filamentColor.style.background = printer.filament_color;
    el.filamentColor.classList.remove('hidden');
  } else {
    el.filamentColor.classList.add('hidden');
  }

  const changesDone = printer.filament_changes;
  const changesTotal = printer.filament_changes_total;
  const hasToolchanges = Number(changesTotal) > 0 || Number(changesDone) > 0;
  applyToolchangeAvailability(hasToolchanges);
  if (changesTotal != null) {
    el.statChanges.textContent = `${changesDone ?? 0} / ${changesTotal}`;
  } else {
    el.statChanges.textContent = changesDone ?? '–';
  }

  if (printer.tool != null) {
    el.statTool.textContent = printer.swap_in_progress ? `T${printer.tool} ↻` : `T${printer.tool}`;
  } else {
    el.statTool.textContent = '–';
  }

  renderSlots(printer.filament_slots || [], printer.tool);

  const wasteFill = printer.waste_fill;
  const wasteCap = printer.waste_capacity;
  if (wasteCap != null && wasteCap > 0) {
    // Custom-Firmware: Wastebin-Pellets live vom Drucker
    el.statWaste.textContent = `${Math.min(100, Math.round((wasteFill / wasteCap) * 100))}%`;
    el.statWasteSub.textContent = `${wasteFill} / ${wasteCap}`;
  } else if (printer.waste_g != null) {
    // Stock-Firmware: Schaetzung aus den G-Code-Metadaten
    el.statWaste.textContent = `${printer.waste_g} g`;
    el.statWasteSub.textContent = printer.waste_total_g != null ? `/ ${printer.waste_total_g} g` : '';
  } else {
    el.statWaste.textContent = '–';
    el.statWasteSub.textContent = '';
  }

  if (printer.layer != null && printer.layer_total != null) {
    el.statLayer.textContent = `${printer.layer} / ${printer.layer_total}`;
  } else {
    el.statLayer.textContent = '–';
  }

  el.statSpeed.textContent = `${printer.speed ?? '–'}%`;
  el.statFlow.textContent = `${printer.flow ?? '–'}%`;
  el.statZ.textContent = `${(printer.axis_z ?? 0).toFixed(2)} mm`;
  el.statFanHotend.textContent = `${printer.fan_hotend ?? '–'} RPM`;
  el.statFanPrint.textContent = `${printer.fan_print ?? '–'} RPM`;
}

function renderSlots(slots, activeTool) {
  el.slotRail.innerHTML = '';
  if (!slots.length) {
    el.slotRail.textContent = '–';
    return;
  }
  for (const slot of slots) {
    const item = document.createElement('span');
    item.className = 'slot-item';
    item.classList.toggle('active', Number(slot.slot) === Number(activeTool));
    item.classList.toggle('empty', Boolean(slot.empty));
    item.title = slot.empty
      ? `Slot ${slot.slot}: leer`
      : [slot.brand, slot.name, slot.material].filter(Boolean).join(' ') || `Slot ${slot.slot}`;
    const cap = document.createElement('i');
    cap.style.background = slot.color || '#555';
    const number = document.createElement('b');
    number.textContent = slot.slot;
    item.append(cap, number);
    el.slotRail.appendChild(item);
  }
}

async function loadPrinterName() {
  try {
    const res = await fetch('/api/printers', { cache: 'no-store' });
    const list = await res.json();
    const match = list.find((p) => p.id === printerId) || list[0];
    el.printerName.textContent = match ? match.name : '—';
  } catch {
    el.printerName.textContent = '—';
  }
}

async function poll() {
  try {
    const res = await fetch(STATUS_URL, { cache: 'no-store' });
    const data = await res.json();
    render(data);
  } catch {
    setOffline('Overlay server unreachable');
  }
}

async function bootstrap() {
  applySections();
  applyToolchangeAvailability(false);
  await loadAssignedAppearance();
  loadPrinterName();
  poll();
  setInterval(poll, POLL_MS);
}

bootstrap();
