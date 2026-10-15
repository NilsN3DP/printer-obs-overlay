// OBS-Overlay: holt das Erscheinungsbild (Preset/Theme) und bekommt Live-Daten per
// Server-Sent Events. Faellt bei Verbindungsproblemen automatisch auf Polling zurueck.
import { DEFAULT_ACCENT, SECTION_KEYS, TOOLCHANGE_KEYS } from '../shared/sections.js';

const params = new URLSearchParams(location.search);
const HEX = /^#[0-9a-f]{6}$/i;
const $ = (id) => document.getElementById(id);

const STATE = {
  IDLE: ['Ready', 'idle'], READY: ['Ready', 'idle'], BUSY: ['Busy', 'printing'], PRINTING: ['Printing', 'printing'],
  PAUSED: ['Paused', 'paused'], FINISHED: ['Finished', 'idle'], STOPPED: ['Stopped', 'paused'],
  ERROR: ['Error', 'error'], ATTENTION: ['Attention', 'error'], SWAPPING: ['Swapping', 'swapping'],
};

let printerId = params.get('printer') || '';
let activeSections = new Set(SECTION_KEYS);
let brandEmpty = false; // weder Name noch Logo noch Social-Symbole -> Block ausblenden
let frameOn = true; // Eckrahmen global abschaltbar (Branding)
let toolchangerOn = true; // Toolchanger-Funktionen unter System eingeschaltet?
const editMode = params.get('edit') === '1';
const CARD_DEFAULT = { x: 1.25, y: 2.22 }; // 24 px Abstand bei 1920 x 1080

// ---------- Darstellung ----------

const list = (value) => (value === 'none' ? [] : String(value).split(',').map((s) => s.trim()).filter(Boolean));

async function loadAppearance() {
  let config = null;
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (res.ok) config = await res.json();
  } catch {
    // ohne Config gelten URL-Parameter und Standardwerte
  }
  const printers = config?.printers || [];
  const printer = printers.find((p) => p.id === printerId) || printers[0];
  if (!printerId && printer) printerId = printer.id;
  const presetId = params.get('preset') || printer?.presetId;
  const preset = (config?.presets || []).find((p) => p.id === presetId);
  const theme = config?.theme || {};

  const layout = params.get('layout') || preset?.layout || 'bar';
  document.body.classList.toggle('layout-card', layout === 'card');
  const scale = Math.min(3, Math.max(0.5, Number(params.get('scale') || preset?.scale || 1) || 1));
  document.documentElement.style.setProperty('--card-scale', String(scale));
  const position = params.get('position') || preset?.position || 'tl';
  const offset = (key, presetKey, fallback) => {
    const raw = params.has(key) ? params.get(key) : preset?.[presetKey];
    const n = Number(raw);
    return raw != null && raw !== '' && Number.isFinite(n) ? n : fallback;
  };
  placeCard(position, offset('ox', 'offsetX', CARD_DEFAULT.x), offset('oy', 'offsetY', CARD_DEFAULT.y));
  frameOn = params.has('frame') ? params.get('frame') !== '0' : theme.showFrame !== false;
  toolchangerOn = config ? config.toolchangerEnabled === true : true;

  activeSections = new Set(params.has('sections') ? list(params.get('sections'))
    : preset?.sections?.length ? preset.sections : SECTION_KEYS);

  const accent = [params.get('accent'), preset?.accentColor, theme.accentColor].find((c) => HEX.test(c || '')) || DEFAULT_ACCENT;
  document.documentElement.style.setProperty('--accent', accent);

  const brandText = params.get('brand') ?? (preset?.brandText || theme.brandText || '');
  renderBrand(brandText);
  const socials = params.has('socials') ? list(params.get('socials')) : (preset?.socials ?? theme.socials ?? []);
  brandEmpty = !brandText.trim() && !theme.logoUrl && !socials.length;
  document.querySelectorAll('[data-social]').forEach((n) => n.classList.toggle('hidden', !socials.includes(n.dataset.social)));

  const logo = $('brandLogo');
  logo.classList.toggle('hidden', !theme.logoUrl);
  if (theme.logoUrl) logo.src = theme.logoUrl;

  $('printerName').textContent = printer?.name || '';
  applySections();
  document.documentElement.classList.remove('is-loading');
}

// ---------- Karte: Position und Verschieben ----------

/** Karte an einer Ecke verankern; Abstaende in Prozent der Bildbreite/-hoehe. */
function placeCard(anchor, x, y) {
  const style = document.documentElement.style;
  const left = anchor.endsWith('l');
  const top = anchor.startsWith('t');
  style.setProperty('--card-left', left ? `${x}vw` : 'auto');
  style.setProperty('--card-right', left ? 'auto' : `${x}vw`);
  style.setProperty('--card-top', top ? `${y}vh` : 'auto');
  style.setProperty('--card-bottom', top ? 'auto' : `${y}vh`);
  style.setProperty('--card-origin', `${top ? 'top' : 'bottom'} ${left ? 'left' : 'right'}`);
}

/**
 * Im Bearbeitungsmodus (Vorschau im Dashboard) laesst sich die Karte ziehen. Beim Loslassen
 * wird die naechste Ecke zum Anker, damit die Karte beim Wachsen im Bild bleibt; das
 * Ergebnis geht per postMessage an das Dashboard.
 */
function enableCardDrag() {
  const panel = $('panel');
  const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));
  const round = (v) => Math.round(v * 100) / 100;
  let start = null;
  panel.addEventListener('pointerdown', (e) => {
    if (!document.body.classList.contains('layout-card') || e.button !== 0) return;
    const r = panel.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, w: r.width, h: r.height };
    try {
      panel.setPointerCapture(e.pointerId);
    } catch {
      // ohne Capture funktioniert das Ziehen trotzdem, solange der Zeiger auf der Karte bleibt
    }
    document.body.classList.add('dragging');
    e.preventDefault();
  });
  panel.addEventListener('pointermove', (e) => {
    if (!start) return;
    const left = clamp(start.left + e.clientX - start.x, 0, innerWidth - start.w);
    const top = clamp(start.top + e.clientY - start.y, 0, innerHeight - start.h);
    placeCard('tl', (left / innerWidth) * 100, (top / innerHeight) * 100);
  });
  const finish = () => {
    if (!start) return;
    start = null;
    document.body.classList.remove('dragging');
    const r = panel.getBoundingClientRect();
    const anchor = `${(r.top + r.bottom) / 2 < innerHeight / 2 ? 't' : 'b'}${(r.left + r.right) / 2 < innerWidth / 2 ? 'l' : 'r'}`;
    const x = round(((anchor.endsWith('l') ? r.left : innerWidth - r.right) / innerWidth) * 100);
    const y = round(((anchor.startsWith('t') ? r.top : innerHeight - r.bottom) / innerHeight) * 100);
    placeCard(anchor, x, y);
    window.parent?.postMessage({ type: 'printer-overlay:card', position: anchor, offsetX: x, offsetY: y }, '*');
  };
  panel.addEventListener('pointerup', finish);
  panel.addEventListener('pointercancel', finish);
}

if (editMode) {
  document.body.classList.add('edit-mode');
  enableCardDrag();
}

function renderBrand(text) {
  const handle = $('handle');
  handle.textContent = '';
  const value = String(text).slice(0, 32);
  const cut = value.indexOf('_');
  handle.append(cut > 0 ? value.slice(0, cut) : value);
  if (cut > 0) {
    const accent = document.createElement('span');
    accent.className = 'accent';
    accent.textContent = value.slice(cut);
    handle.append(accent);
  }
}

function applySections() {
  document.querySelectorAll('[data-section]').forEach((n) => n.classList.toggle('section-off', !activeSections.has(n.dataset.section)));
  if (brandEmpty) document.querySelector('[data-section="brand"]').classList.add('section-off');
  if (!frameOn) document.querySelectorAll('[data-section="frame"]').forEach((n) => n.classList.add('section-off'));
  const identityOn = (activeSections.has('brand') && !brandEmpty) || activeSections.has('printerName');
  document.querySelector('.identity').classList.toggle('section-off', !identityOn);
  document.querySelector('[data-divider]').classList.toggle('section-off', !identityOn);
}

// ---------- Formatierung ----------

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function duration(seconds) {
  const s = num(seconds);
  if (s === null) return '--:--';
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(t % 60).padStart(2, '0')}s`;
}

function clockIn(seconds) {
  const s = num(seconds);
  if (s === null) return '--:--';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(Date.now() + Math.max(0, s) * 1000);
}

const temp = (v) => (num(v) === null ? '–' : `${Math.round(v)}°C`);
const pct = (v) => (num(v) === null ? '–' : `${Math.round(v)}%`);

function set(id, text) {
  const node = $(id);
  if (node.textContent !== text) node.textContent = text;
}

// ---------- Rendering ----------

function render(data) {
  const online = Boolean(data?.connected && data.printer);
  $('offline').classList.toggle('hidden', online);
  $('job').classList.toggle('hidden', !online);
  $('metrics').classList.toggle('hidden', !online);
  if (!online) {
    set('offlineText', data?.error || 'Printer unreachable');
    return;
  }

  const p = data.printer;
  const job = data.job || {};
  const [label, cls] = STATE[p.swap_in_progress ? 'SWAPPING' : String(p.state || '').toUpperCase()] || [p.state || 'Unknown', 'idle'];
  const stateNode = $('state');
  stateNode.textContent = label;
  stateNode.className = `state state--${cls}${activeSections.has('status') ? '' : ' section-off'}`;

  const file = job.file?.display_name || job.file?.name || 'No active job';
  set('filename', file);
  $('filename').title = file;

  const progress = Math.min(100, Math.max(0, num(job.progress) ?? 0));
  $('progressFill').style.width = `${progress}%`;
  set('progressPct', `${Math.round(progress)}%`);

  set('timeRemaining', duration(job.time_remaining));
  set('doneAt', clockIn(job.time_remaining));
  set('timeElapsed', duration(job.time_printing));
  const total = num(job.time_printing) !== null && num(job.time_remaining) !== null
    ? Number(job.time_printing) + Number(job.time_remaining) : null;
  set('timeTotal', duration(total));

  set('nozzle', temp(p.temp_nozzle));
  set('nozzleTarget', num(p.target_nozzle) > 0 ? `/ ${Math.round(p.target_nozzle)}°C` : '');
  set('bed', temp(p.temp_bed));
  set('bedTarget', num(p.target_bed) > 0 ? `/ ${Math.round(p.target_bed)}°C` : '');

  const filament = p.filament_display || p.material || '–';
  set('filament', filament);
  $('filament').title = filament;
  const dot = $('filamentColor');
  dot.classList.toggle('hidden', !HEX.test(p.filament_color || ''));
  if (HEX.test(p.filament_color || '')) dot.style.background = p.filament_color;

  const done = num(p.filament_changes);
  const totalChanges = num(p.filament_changes_total);
  const hasToolData = (totalChanges ?? 0) > 0 || (done ?? 0) > 0 || (num(p.tools_total) ?? 0) > 1;
  TOOLCHANGE_KEYS.forEach((key) => document.querySelector(`[data-section="${key}"]`)?.classList.toggle('no-data', !toolchangerOn || !hasToolData));
  set('changes', totalChanges !== null ? `${done ?? 0} / ${totalChanges}` : done !== null ? String(done) : '–');
  set('tool', num(p.tool) !== null ? `T${p.tool}${num(p.tools_total) ? ` / ${p.tools_total}` : ''}` : '–');
  renderSlots(p.filament_slots || [], num(p.tool));

  if (num(p.waste_capacity) > 0) {
    set('waste', `${Math.min(100, Math.round((p.waste_fill / p.waste_capacity) * 100))}%`);
    set('wasteSub', `${p.waste_fill} / ${p.waste_capacity}`);
  } else if (num(p.waste_g) !== null) {
    set('waste', `${p.waste_g} g`);
    set('wasteSub', num(p.waste_total_g) !== null ? `/ ${p.waste_total_g} g` : '');
  } else {
    set('waste', '–');
    set('wasteSub', '');
  }

  set('layer', num(p.layer) !== null && num(p.layer_total) ? `${p.layer} / ${p.layer_total}` : num(p.layer) !== null ? String(p.layer) : '–');
  set('speed', pct(p.speed));
  set('flow', pct(p.flow));
  set('z', num(p.axis_z) === null ? '–' : `${Number(p.axis_z).toFixed(2)} mm`);
  set('fanHotend', num(p.fan_hotend) === null ? '–' : `${Math.round(p.fan_hotend)} RPM`);
  set('fanPrint', num(p.fan_print_pct) !== null ? `${p.fan_print_pct}%` : num(p.fan_print) === null ? '–' : `${Math.round(p.fan_print)} RPM`);
}

function renderSlots(slots, activeTool) {
  const rail = $('slots');
  rail.textContent = '';
  if (!slots.length) {
    rail.textContent = '–';
    return;
  }
  for (const slot of slots) {
    const item = document.createElement('span');
    item.className = `slot${slot.slot === activeTool ? ' active' : ''}${slot.empty ? ' empty' : ''}`;
    item.title = slot.empty ? `Slot ${slot.slot}: empty` : [slot.brand, slot.name, slot.material].filter(Boolean).join(' ');
    const cap = document.createElement('i');
    cap.style.background = slot.color || '#555';
    const nr = document.createElement('b');
    nr.textContent = slot.slot;
    item.append(cap, nr);
    rail.append(item);
  }
}

// ---------- Datenverbindung ----------

const pollMs = Math.max(1000, Number(params.get('poll')) || 2000);
let pollTimer = null;

async function pollOnce() {
  try {
    const res = await fetch(`/api/status?printer=${encodeURIComponent(printerId)}`, { cache: 'no-store' });
    render(await res.json());
  } catch {
    render({ connected: false, error: 'Overlay server unreachable' });
  }
}

function startPolling() {
  if (pollTimer) return;
  pollOnce();
  pollTimer = setInterval(pollOnce, pollMs);
}

function connect() {
  if (!('EventSource' in window) || params.has('poll')) return startPolling();
  const source = new EventSource(`/api/stream?printer=${encodeURIComponent(printerId)}`);
  let failures = 0;
  source.addEventListener('status', (e) => {
    failures = 0;
    render(JSON.parse(e.data));
  });
  // Aenderungen im Dashboard (Preset, Farbe, Bereiche) sofort uebernehmen.
  source.addEventListener('config', () => loadAppearance());
  source.onerror = () => {
    render({ connected: false, error: 'Overlay server unreachable' });
    if (++failures >= 5) {
      source.close();
      startPolling();
    }
  };
}

await loadAppearance();
connect();
