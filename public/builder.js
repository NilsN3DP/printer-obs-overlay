const SECTIONS = [
  { key: 'frame', label: 'Eckrahmen' },
  { key: 'brand', label: 'Branding' },
  { key: 'printerName', label: 'Druckername' },
  { key: 'status', label: 'Status-Badge' },
  { key: 'file', label: 'Dateiname' },
  { key: 'progress', label: 'Fortschritt' },
  { key: 'time', label: 'Zeiten' },
  { key: 'nozzle', label: 'Düse' },
  { key: 'bed', label: 'Bett' },
  { key: 'filament', label: 'Filament' },
  { key: 'changes', label: 'Tool-/Filamentwechsel' },
  { key: 'tool', label: 'Aktives Tool' },
  { key: 'waste', label: 'Waste' },
  { key: 'layer', label: 'Layer' },
  { key: 'speed', label: 'Speed' },
  { key: 'flow', label: 'Flow' },
  { key: 'z', label: 'Z-Höhe' },
  { key: 'fanHotend', label: 'Lüfter Hotend' },
  { key: 'fanPrint', label: 'Lüfter Druck' },
];

const DEFAULT_SOCIALS = ['youtube', 'instagram'];
const TOOLCHANGE_SECTIONS = new Set(['changes', 'tool', 'waste']);
let appConfig = { printers: [], presets: [], theme: {}, demoMode: true, pollIntervalMs: 2000, printerModels: [] };

const $ = (id) => document.getElementById(id);
const printerSelect = $('printerSelect');
const analysisPrinterSelect = $('analysisPrinterSelect');
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
const discoverCidr = $('discoverCidr');
const discoverResult = $('discoverResult');
const toolchangePanel = $('toolchangePanel');

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
  const chosen = new Set(Array.isArray(keys) ? keys : SECTIONS.map((s) => s.key));
  sectionList.querySelectorAll('input').forEach((c) => { c.checked = chosen.has(c.value); });
}

function currentLayout() {
  return document.querySelector('input[name="layout"]:checked').value;
}

function setLayout(layout) {
  const radio = document.querySelector(`input[name="layout"][value="${layout === 'card' ? 'card' : 'bar'}"]`);
  if (radio) radio.checked = true;
}

function selectedSocials() {
  return [...document.querySelectorAll('[data-social-toggle]:checked')].map((el) => el.dataset.socialToggle);
}

function setSelectedSocials(keys) {
  const chosen = new Set(Array.isArray(keys) ? keys : DEFAULT_SOCIALS);
  document.querySelectorAll('[data-social-toggle]').forEach((el) => {
    el.checked = chosen.has(el.dataset.socialToggle);
  });
}

function printerById(id) {
  return (appConfig.printers || []).find((p) => p.id === id);
}

function supportsToolchange(printer) {
  const caps = printer?.capabilities || modelCapabilities(printer?.model);
  return Boolean(caps?.indx || caps?.toolchanger || caps?.xl);
}

function modelCapabilities(modelId) {
  return (appConfig.printerModels || []).find((m) => m.id === modelId) || {};
}

function visibleSectionsForPrinter(sections, printer) {
  if (supportsToolchange(printer)) return sections;
  return sections.filter((key) => !TOOLCHANGE_SECTIONS.has(key));
}

function buildUrl(absolute, printerId = printerSelect.value) {
  const printer = printerById(printerId);
  const params = new URLSearchParams();
  if (printerId) params.set('printer', printerId);
  if (currentLayout() === 'card') params.set('layout', 'card');
  if (accentColor.value && accentColor.value !== '#fa6831') params.set('accent', accentColor.value);
  if (brandText.value && brandText.value !== 'N3DP_de') params.set('brand', brandText.value);

  const socials = selectedSocials();
  if (socials.join(',') !== DEFAULT_SOCIALS.join(',')) params.set('socials', socials.length ? socials.join(',') : 'none');

  const chosen = visibleSectionsForPrinter(selectedSections(), printer);
  if (chosen.length !== SECTIONS.length) params.set('sections', chosen.join(','));
  const rel = `overlay.html${params.toString() ? `?${params}` : ''}`;
  return absolute ? `${window.location.origin}/${rel}` : rel;
}

function update() {
  updateToolchangeVisibility();
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
    card.querySelector('.printer-meta').textContent = `${p.model || p.type || 'printer'} · ${p.host || p.id}`;
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
      model: get('model') || 'custom',
      host: get('host'),
      apiKey: get('apiKey') || '__KEEP__',
      cameraUrl: get('cameraUrl'),
      wasteGramsPerChange: Number(get('wasteGramsPerChange') || 0),
    };
  }).filter((p) => p.id);
}

function populateModelSelect(select, selected = 'custom') {
  select.innerHTML = '';
  for (const model of appConfig.printerModels || []) {
    const opt = document.createElement('option');
    opt.value = model.id;
    opt.textContent = model.name;
    select.appendChild(opt);
  }
  select.value = selected;
}

function updateFormCapabilities(form) {
  const model = form.querySelector('[data-field="model"]').value;
  const caps = modelCapabilities(model);
  const note = form.querySelector('[data-capabilities]');
  const indxField = form.querySelector('[data-indx-field]');
  const chips = [
    caps.board ? `Board: ${caps.board}` : null,
    caps.indx ? 'INDX' : null,
    caps.xl ? 'XL Familie' : null,
    caps.toolchanger ? 'Toolchange aktiv' : null,
  ].filter(Boolean);
  note.textContent = chips.length ? chips.join(' · ') : 'Keine Spezialfunktionen erkannt';
  indxField.classList.toggle('hidden', !caps.indx && !caps.toolchanger && !caps.xl);
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
    model: printer.model || 'custom',
    host: printer.host || '',
    apiKey: '',
    cameraUrl: printer.cameraUrl || '',
    wasteGramsPerChange: printer.wasteGramsPerChange ?? 0.022,
  };
  for (const [key, value] of Object.entries(data)) {
    const field = form.querySelector(`[data-field="${key}"]`);
    if (field && key !== 'model') field.value = value;
  }
  populateModelSelect(form.querySelector('[data-field="model"]'), data.model);
  form.querySelector('[data-title]').textContent = `${data.name || data.id}${printer.apiKeySet ? ' · Key gespeichert' : ''}`;
  form.querySelector('[data-remove]').addEventListener('click', () => {
    form.remove();
    refreshPrinterDerivedUi();
  });
  form.querySelector('[data-test]').addEventListener('click', async () => testForm(form));
  form.querySelector('[data-field="model"]').addEventListener('change', () => {
    updateFormCapabilities(form);
    refreshPrinterDerivedUi();
  });
  form.querySelector('[data-field="name"]').addEventListener('input', () => refreshPrinterDerivedUi());
  form.querySelector('[data-field="id"]').addEventListener('input', () => refreshPrinterDerivedUi());
  updateFormCapabilities(form);
  printerEditor.appendChild(form);
}

async function testForm(form) {
  const result = form.querySelector('[data-result]');
  const id = form.querySelector('[data-field="id"]').value.trim();
  const printer = collectPrinterForms().find((p) => p.id === id);
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

async function discoverPrinters() {
  const cidr = discoverCidr.value.trim();
  discoverResult.textContent = 'Suche im Netzwerk...';
  try {
    const url = `/api/discover${cidr ? `?cidr=${encodeURIComponent(cidr)}` : ''}`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Suche fehlgeschlagen');
    if (!data.found.length) {
      discoverResult.textContent = `Keine Drucker in ${data.cidr} gefunden.`;
      return;
    }
    discoverResult.innerHTML = '';
    for (const item of data.found) {
      const row = document.createElement('div');
      row.className = 'discover-row';
      row.innerHTML = `<span>${item.type} · ${item.host}</span><button type="button" class="mini">Übernehmen</button>`;
      row.querySelector('button').addEventListener('click', () => {
        addPrinterForm({
          id: item.host.replace(/[^0-9a-z]+/gi, '-').replace(/^-|-$/g, ''),
          name: `${item.type} ${item.host}`,
          type: item.type,
          host: item.host,
          model: item.type === 'prusalink' ? 'mk4s' : 'custom',
        });
      });
      discoverResult.appendChild(row);
    }
  } catch (err) {
    discoverResult.textContent = `Fehler: ${err.message}`;
  }
}

function collectTheme() {
  return {
    accentColor: accentColor.value,
    brandText: brandText.value,
    socials: Object.fromEntries(['youtube', 'instagram', 'tiktok', 'twitch', 'website'].map((key) => [
      key,
      selectedSocials().includes(key) ? 'visible' : '',
    ])),
  };
}

async function saveConfig() {
  saveStatus.textContent = 'Speichere...';
  const next = {
    ...appConfig,
    demoMode: demoMode.checked,
    theme: collectTheme(),
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
  const previous = printerSelect.value;
  const analysisPrevious = analysisPrinterSelect.value;
  printerSelect.innerHTML = '';
  analysisPrinterSelect.innerHTML = '';
  const printers = appConfig.printers || [];
  if (!printers.length) {
    const opt = document.createElement('option');
    opt.textContent = 'Keine Drucker konfiguriert';
    printerSelect.appendChild(opt);
    printerSelect.disabled = true;
  } else {
    printerSelect.disabled = false;
    for (const p of printers) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.id})`;
      printerSelect.appendChild(opt);
    }
    printerSelect.value = printers.some((p) => p.id === previous) ? previous : printers[0].id;
  }

  const toolPrinters = printers.filter(supportsToolchange);
  for (const p of toolPrinters) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.capabilities?.indx ? 'INDX' : 'XL'})`;
    analysisPrinterSelect.appendChild(opt);
  }
  if (toolPrinters.length) {
    analysisPrinterSelect.value = toolPrinters.some((p) => p.id === analysisPrevious) ? analysisPrevious : toolPrinters[0].id;
  }
}

function renderPresets() {
  const previous = presetSelect.value;
  presetSelect.innerHTML = '<option value="">Preset wählen...</option>';
  for (const p of appConfig.presets || []) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    presetSelect.appendChild(opt);
  }
  presetSelect.value = (appConfig.presets || []).some((p) => p.id === previous) ? previous : '';
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
    accentColor: accentColor.value,
    brandText: brandText.value,
    socials: selectedSocials(),
  }];
  await saveConfig();
  presetSelect.value = id;
  applyPreset(id);
}

async function deletePreset() {
  if (!presetSelect.value) return;
  appConfig.presets = (appConfig.presets || []).filter((p) => p.id !== presetSelect.value);
  presetSelect.value = '';
  await saveConfig();
}

function applyPreset(id) {
  const preset = (appConfig.presets || []).find((p) => p.id === id);
  if (!preset) return;
  setLayout(preset.layout);
  setSelectedSections(preset.sections);
  if (preset.accentColor) accentColor.value = preset.accentColor;
  if (preset.brandText) brandText.value = preset.brandText;
  if (preset.socials) setSelectedSocials(preset.socials);
  presetName.value = preset.name;
  update();
}

function refreshPrinterDerivedUi() {
  const forms = collectPrinterForms();
  const byId = new Map(forms.map((p) => [p.id, {
    ...p,
    capabilities: modelCapabilities(p.model),
  }]));
  appConfig.printers = [
    ...forms.map((p) => ({ ...p, capabilities: modelCapabilities(p.model), apiKeySet: p.apiKey === '__KEEP__' })),
    ...(demoMode.checked ? [{ id: 'demo', name: 'Demo Drucker', type: 'demo', model: 'coreone-indx', capabilities: modelCapabilities('coreone-indx') }] : []),
  ];
  if (printerSelect.value && byId.has(printerSelect.value)) {
    const current = printerSelect.value;
    renderPrinterSelect();
    printerSelect.value = current;
  } else {
    renderPrinterSelect();
  }
  updateToolchangeVisibility();
}

function updateToolchangeVisibility() {
  const printer = printerById(printerSelect.value);
  const hasToolPrinters = (appConfig.printers || []).some(supportsToolchange);
  toolchangePanel.classList.toggle('hidden', !hasToolPrinters);
  sectionList.querySelectorAll('input').forEach((input) => {
    const blocked = TOOLCHANGE_SECTIONS.has(input.value) && printer && !supportsToolchange(printer);
    input.closest('label').classList.toggle('muted', blocked);
  });
}

async function refreshConfigUi() {
  const res = await fetch('/api/config', { cache: 'no-store' });
  appConfig = await res.json();
  demoMode.checked = Boolean(appConfig.demoMode);
  accentColor.value = appConfig.theme?.accentColor || '#fa6831';
  brandText.value = appConfig.theme?.brandText || 'N3DP_de';
  const socialMap = appConfig.theme?.socials || {};
  const active = Object.entries(socialMap).filter(([, value]) => value).map(([key]) => key);
  setSelectedSocials(active.length ? active : DEFAULT_SOCIALS);
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
  const selected = printerById(analysisPrinterSelect.value);
  if (!selected || !supportsToolchange(selected)) {
    return renderAnalysis({ ok: false, error: 'Bitte einen INDX- oder XL-Toolchanger-Drucker auswählen.' });
  }
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
$('addPrinterBtn').addEventListener('click', () => {
  addPrinterForm();
  refreshPrinterDerivedUi();
});
$('saveConfigBtn').addEventListener('click', () => saveConfig().catch((err) => { saveStatus.textContent = err.message; }));
$('savePresetBtn').addEventListener('click', () => savePreset().catch((err) => { saveStatus.textContent = err.message; }));
$('deletePresetBtn').addEventListener('click', () => deletePreset().catch((err) => { saveStatus.textContent = err.message; }));
$('discoverBtn').addEventListener('click', discoverPrinters);
presetSelect.addEventListener('change', () => applyPreset(presetSelect.value));
$('uploadForm').addEventListener('submit', analyzeUpload);
$('selectAll').addEventListener('click', () => { setSelectedSections(SECTIONS.map((s) => s.key)); update(); });
$('selectNone').addEventListener('click', () => { setSelectedSections([]); update(); });
document.querySelectorAll('input[name="layout"]').forEach((r) => r.addEventListener('change', update));
[printerSelect, analysisPrinterSelect, accentColor, brandText].forEach((el) => el.addEventListener('input', update));
demoMode.addEventListener('change', refreshPrinterDerivedUi);
document.querySelectorAll('[data-social-toggle]').forEach((el) => el.addEventListener('change', update));
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
