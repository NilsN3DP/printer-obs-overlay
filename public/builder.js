const SECTIONS = [
  { key: 'frame', label: 'Eckrahmen' },
  { key: 'brand', label: 'Branding' },
  { key: 'printerName', label: 'Druckername' },
  { key: 'status', label: 'Status-Badge' },
  { key: 'file', label: 'Dateiname' },
  { key: 'progress', label: 'Fortschritt' },
  { key: 'time', label: 'Zeiten' },
  { key: 'nozzle', label: 'Düsentemperatur' },
  { key: 'bed', label: 'Betttemperatur' },
  { key: 'filament', label: 'Filament' },
  { key: 'changes', label: 'Filamentwechsel' },
  { key: 'tool', label: 'Aktives Tool' },
  { key: 'waste', label: 'Waste' },
  { key: 'layer', label: 'Layer' },
  { key: 'speed', label: 'Speed' },
  { key: 'flow', label: 'Flow' },
  { key: 'z', label: 'Z-Höhe' },
  { key: 'fanHotend', label: 'Lüfter Hotend' },
  { key: 'fanPrint', label: 'Lüfter Druck' },
];

let appConfig = { printers: [], presets: [], theme: {}, demoMode: true, pollIntervalMs: 2000 };

const $ = (id) => document.getElementById(id);
const printerSelect = $('printerSelect');
const sectionList = $('sectionList');
const urlOut = $('urlOut');
const copyBtn = $('copyBtn');
const previewFrame = $('previewFrame');
const refreshBtn = $('refreshBtn');
const printerCards = $('printerCards');
const healthSummary = $('healthSummary');
const printerEditor = $('printerEditor');
const saveStatus = $('saveStatus');
const demoMode = $('demoMode');
const accentColor = $('accentColor');
const brandText = $('brandText');
const presetSelect = $('presetSelect');
const presetName = $('presetName');

for (const s of SECTIONS) {
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = s.key;
  cb.checked = true;
  cb.addEventListener('change', update);
  label.append(cb, document.createTextNode(s.label));
  sectionList.appendChild(label);
}

function selectedSections() {
  return [...sectionList.querySelectorAll('input:checked')].map((c) => c.value);
}

function setSelectedSections(keys) {
  const chosen = new Set(keys?.length ? keys : SECTIONS.map((s) => s.key));
  sectionList.querySelectorAll('input').forEach((c) => { c.checked = chosen.has(c.value); });
}

function currentLayout() {
  return document.querySelector('input[name="layout"]:checked').value;
}

function setLayout(layout) {
  const radio = document.querySelector(`input[name="layout"][value="${layout === 'card' ? 'card' : 'bar'}"]`);
  if (radio) radio.checked = true;
}

function buildUrl(absolute, printerId = printerSelect.value) {
  const params = new URLSearchParams();
  if (printerId) params.set('printer', printerId);
  if (currentLayout() === 'card') params.set('layout', 'card');
  if (accentColor.value && accentColor.value !== '#fa6831') params.set('accent', accentColor.value);
  if (brandText.value && brandText.value !== 'N3DP_de') params.set('brand', brandText.value);
  const chosen = selectedSections();
  if (chosen.length !== SECTIONS.length) params.set('sections', chosen.join(','));
  const rel = `overlay.html${params.toString() ? `?${params}` : ''}`;
  return absolute ? `${window.location.origin}/${rel}` : rel;
}

function update() {
  urlOut.value = buildUrl(true);
  previewFrame.src = buildUrl(false);
  copyBtn.textContent = 'Kopieren';
  copyBtn.classList.remove('copied');
}

function formatProgress(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0%';
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function renderHealth(data) {
  const printers = data.printers || [];
  const online = printers.filter((p) => p.connected).length;
  healthSummary.textContent = `${online}/${printers.length} Drucker online · Polling ${data.pollIntervalMs ?? '?'} ms`;
  printerCards.innerHTML = '';

  if (!printers.length) {
    printerCards.innerHTML = '<div class="printer-card">Keine Drucker konfiguriert. Demo-Modus aktivieren oder Drucker hinzufügen.</div>';
    return;
  }

  for (const p of printers) {
    const card = document.createElement('article');
    card.className = 'printer-card';
    const pct = formatProgress(p.progress);
    const url = buildUrl(true, p.id);
    card.innerHTML = `
      <div class="printer-card-head">
        <div>
          <div class="printer-title"></div>
          <div class="printer-meta"></div>
        </div>
        <span class="badge ${p.connected ? 'badge-ok' : 'badge-off'}">${p.connected ? 'Online' : 'Offline'}</span>
      </div>
      ${p.cameraUrl ? '<img class="camera-preview" alt="Kamera" />' : ''}
      <div class="printer-progress"><span style="width:${pct}"></span></div>
      <div class="printer-detail"></div>
      <div class="card-actions">
        <a href="${url}" target="_blank" rel="noreferrer">Overlay</a>
        ${p.cameraUrl ? `<a href="${p.cameraUrl}" target="_blank" rel="noreferrer">Kamera</a>` : ''}
        <button type="button" data-copy="${url}">OBS-Link</button>
      </div>
    `;
    card.querySelector('.printer-title').textContent = p.name || p.id;
    card.querySelector('.printer-meta').textContent = `${p.type || 'printer'} · ${p.host || p.id}`;
    const img = card.querySelector('.camera-preview');
    if (img) img.src = p.cameraUrl;
    card.querySelector('.printer-detail').textContent = p.connected
      ? `${p.state || 'Unknown'} · ${pct} · ${p.file || 'kein aktiver Job'}`
      : p.error || 'Nicht erreichbar';
    printerCards.appendChild(card);
  }
}

async function loadHealth() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    renderHealth(await res.json());
  } catch {
    healthSummary.textContent = 'Overlay-Server nicht erreichbar.';
    printerCards.innerHTML = '';
  }
}

function collectPrinterForms() {
  return [...printerEditor.querySelectorAll('.printer-form')].map((form) => {
    const get = (name) => form.querySelector(`[data-field="${name}"]`)?.value.trim() || '';
    return {
      id: get('id'),
      name: get('name'),
      type: get('type') || 'prusalink',
      host: get('host'),
      apiKey: get('apiKey') || '__KEEP__',
      cameraUrl: get('cameraUrl'),
      wasteGramsPerChange: Number(get('wasteGramsPerChange') || 0),
    };
  }).filter((p) => p.id);
}

function renderPrinterEditor() {
  printerEditor.innerHTML = '';
  for (const printer of appConfig.printers.filter((p) => p.type !== 'demo')) {
    addPrinterForm(printer);
  }
}

function addPrinterForm(printer = {}) {
  const tpl = $('printerTemplate').content.cloneNode(true);
  const form = tpl.querySelector('.printer-form');
  const data = {
    id: printer.id || `printer${printerEditor.children.length + 1}`,
    name: printer.name || '',
    type: printer.type || 'prusalink',
    host: printer.host || '',
    apiKey: '',
    cameraUrl: printer.cameraUrl || '',
    wasteGramsPerChange: printer.wasteGramsPerChange ?? 0.022,
  };
  for (const [key, value] of Object.entries(data)) {
    const field = form.querySelector(`[data-field="${key}"]`);
    if (field) field.value = value;
  }
  form.querySelector('[data-title]').textContent = `${data.name || data.id}${printer.apiKeySet ? ' · Key gespeichert' : ''}`;
  form.querySelector('[data-remove]').addEventListener('click', () => form.remove());
  form.querySelector('[data-test]').addEventListener('click', async () => testForm(form));
  printerEditor.appendChild(form);
}

async function testForm(form) {
  const result = form.querySelector('[data-result]');
  const printer = collectPrinterForms().find((p) => p.id === form.querySelector('[data-field="id"]').value.trim());
  result.textContent = 'Teste Verbindung...';
  try {
    const res = await fetch('/api/printers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(printer),
    });
    const data = await res.json();
    result.textContent = data.ok ? `OK: ${data.state || 'verbunden'} ${data.file || ''}` : `Fehler: ${data.error}`;
    result.className = `test-result ${data.ok ? 'ok' : 'bad'}`;
  } catch (err) {
    result.textContent = `Fehler: ${err.message}`;
    result.className = 'test-result bad';
  }
}

async function saveConfig() {
  saveStatus.textContent = 'Speichere...';
  const next = {
    ...appConfig,
    demoMode: demoMode.checked,
    theme: { accentColor: accentColor.value, brandText: brandText.value },
    printers: collectPrinterForms(),
  };
  const res = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');
  appConfig = data;
  saveStatus.textContent = 'Gespeichert';
  await refreshConfigUi();
  loadHealth();
}

function renderPrinterSelect() {
  printerSelect.innerHTML = '';
  const printers = appConfig.printers || [];
  if (!printers.length) {
    const opt = document.createElement('option');
    opt.textContent = 'Keine Drucker konfiguriert';
    printerSelect.appendChild(opt);
    printerSelect.disabled = true;
    return;
  }
  printerSelect.disabled = false;
  for (const p of printers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.id})`;
    printerSelect.appendChild(opt);
  }
}

function renderPresets() {
  presetSelect.innerHTML = '<option value="">Preset wählen...</option>';
  for (const p of appConfig.presets || []) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    presetSelect.appendChild(opt);
  }
}

async function savePreset() {
  const name = presetName.value.trim() || `Preset ${appConfig.presets.length + 1}`;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `preset-${Date.now()}`;
  const existing = (appConfig.presets || []).filter((p) => p.id !== id);
  appConfig.presets = [...existing, {
    id,
    name,
    layout: currentLayout(),
    sections: selectedSections(),
  }];
  await saveConfig();
  presetSelect.value = id;
}

function applyPreset(id) {
  const preset = (appConfig.presets || []).find((p) => p.id === id);
  if (!preset) return;
  setLayout(preset.layout);
  setSelectedSections(preset.sections);
  update();
}

async function refreshConfigUi() {
  const res = await fetch('/api/config', { cache: 'no-store' });
  appConfig = await res.json();
  demoMode.checked = Boolean(appConfig.demoMode);
  accentColor.value = appConfig.theme?.accentColor || '#fa6831';
  brandText.value = appConfig.theme?.brandText || 'N3DP_de';
  renderPrinterEditor();
  renderPrinterSelect();
  renderPresets();
  update();
}

function renderAnalysis(data) {
  const target = $('uploadResult');
  if (!data.ok) {
    target.textContent = `Fehler: ${data.error}`;
    target.className = 'analysis-result bad';
    return;
  }
  const tools = (data.toolUseCounts || []).map((t) => `T${t.tool}: ${t.count}`).join(' · ') || 'keine';
  const events = (data.firstEvents || []).map((e) => `T${e.tool}@${e.progress}%`).join(', ') || 'keine';
  target.className = 'analysis-result';
  target.innerHTML = `
    <strong>${data.fileName}</strong>
    <dl>
      <dt>Tools</dt><dd>${data.toolsTotal ?? '–'}</dd>
      <dt>Toolchanges</dt><dd>${data.changesTotal}</dd>
      <dt>Layer</dt><dd>${data.layerTotal}</dd>
      <dt>Waste gesamt</dt><dd>${data.wasteTotalG ?? '–'} g</dd>
      <dt>INDX erkannt</dt><dd>${data.detectedIndx ? 'Ja' : 'Nicht eindeutig'}</dd>
      <dt>Tool-Nutzung</dt><dd>${tools}</dd>
      <dt>Erste Events</dt><dd>${events}</dd>
    </dl>
  `;
}

async function analyzeUpload(event) {
  event.preventDefault();
  const file = $('gcodeFile').files[0];
  if (!file) return renderAnalysis({ ok: false, error: 'Bitte eine .gcode oder .bgcode Datei auswählen' });
  const fd = new FormData();
  fd.append('file', file);
  $('uploadResult').textContent = 'Analysiere Datei...';
  const res = await fetch('/api/analyze-upload', { method: 'POST', body: fd });
  renderAnalysis(await res.json());
}

function scalePreview() {
  const wrap = previewFrame.parentElement;
  const scale = wrap.clientWidth / 1920;
  previewFrame.style.transform = `scale(${scale})`;
}

copyBtn.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(urlOut.value); } catch {
    urlOut.select();
    document.execCommand('copy');
  }
  copyBtn.textContent = 'Kopiert!';
  copyBtn.classList.add('copied');
});

printerCards.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-copy]');
  if (!btn) return;
  await navigator.clipboard.writeText(btn.getAttribute('data-copy'));
  btn.textContent = 'Kopiert!';
  setTimeout(() => { btn.textContent = 'OBS-Link'; }, 1200);
});

refreshBtn.addEventListener('click', loadHealth);
$('addPrinterBtn').addEventListener('click', () => addPrinterForm());
$('saveConfigBtn').addEventListener('click', () => saveConfig().catch((err) => { saveStatus.textContent = err.message; }));
$('savePresetBtn').addEventListener('click', () => savePreset().catch((err) => { saveStatus.textContent = err.message; }));
presetSelect.addEventListener('change', () => applyPreset(presetSelect.value));
$('uploadForm').addEventListener('submit', analyzeUpload);
$('selectAll').addEventListener('click', () => { setSelectedSections(SECTIONS.map((s) => s.key)); update(); });
$('selectNone').addEventListener('click', () => { setSelectedSections([]); update(); });
document.querySelectorAll('input[name="layout"]').forEach((r) => r.addEventListener('change', update));
[printerSelect, accentColor, brandText].forEach((el) => el.addEventListener('input', update));
window.addEventListener('resize', scalePreview);

async function init() {
  await refreshConfigUi();
  scalePreview();
  loadHealth();
  setInterval(loadHealth, 5000);
}

init().catch((err) => {
  healthSummary.textContent = `Dashboard konnte nicht laden: ${err.message}`;
});
