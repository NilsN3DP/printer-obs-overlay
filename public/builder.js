// Section keys must match data-section attributes in overlay.html.
const SECTIONS = [
  { key: 'frame', label: 'Eckrahmen' },
  { key: 'brand', label: 'Branding (N3DP_de)' },
  { key: 'printerName', label: 'Druckername' },
  { key: 'status', label: 'Status-Badge' },
  { key: 'file', label: 'Dateiname' },
  { key: 'progress', label: 'Fortschritt' },
  { key: 'time', label: 'Zeiten' },
  { key: 'nozzle', label: 'Düsentemperatur' },
  { key: 'bed', label: 'Betttemperatur' },
  { key: 'filament', label: 'Filament (Material + Farbe)' },
  { key: 'changes', label: 'Filamentwechsel' },
  { key: 'tool', label: 'Aktives Tool' },
  { key: 'waste', label: 'Waste (Wastebin / G-Code)' },
  { key: 'layer', label: 'Layer (aktuell / gesamt)' },
  { key: 'speed', label: 'Speed' },
  { key: 'flow', label: 'Flow' },
  { key: 'z', label: 'Z-Höhe' },
  { key: 'fanHotend', label: 'Lüfter Hotend' },
  { key: 'fanPrint', label: 'Lüfter Druck' },
];

const printerSelect = document.getElementById('printerSelect');
const sectionList = document.getElementById('sectionList');
const urlOut = document.getElementById('urlOut');
const copyBtn = document.getElementById('copyBtn');
const previewFrame = document.getElementById('previewFrame');
const refreshBtn = document.getElementById('refreshBtn');
const printerCards = document.getElementById('printerCards');
const healthSummary = document.getElementById('healthSummary');

// Build section checkboxes
for (const s of SECTIONS) {
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = s.key;
  cb.checked = true;
  cb.addEventListener('change', update);
  label.appendChild(cb);
  label.appendChild(document.createTextNode(s.label));
  sectionList.appendChild(label);
}

function selectedSections() {
  return [...sectionList.querySelectorAll('input:checked')].map((c) => c.value);
}

function currentLayout() {
  return document.querySelector('input[name="layout"]:checked').value;
}

function buildUrl(absolute) {
  const params = new URLSearchParams();
  if (printerSelect.value) params.set('printer', printerSelect.value);
  if (currentLayout() === 'card') params.set('layout', 'card');

  const chosen = selectedSections();
  // Only add sections param if not everything is selected (absent = all).
  if (chosen.length !== SECTIONS.length) {
    params.set('sections', chosen.join(','));
  }
  const qs = params.toString();
  const rel = `overlay.html${qs ? `?${qs}` : ''}`;
  return absolute ? `${window.location.origin}/${rel}` : rel;
}

function update() {
  urlOut.value = buildUrl(true);
  previewFrame.src = buildUrl(false);
  copyBtn.classList.remove('copied');
  copyBtn.textContent = 'Kopieren';
}

function overlayUrlFor(printerId) {
  const url = new URL('overlay.html', window.location.origin);
  if (printerId) url.searchParams.set('printer', printerId);
  return url.toString();
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
    printerCards.innerHTML = '<div class="printer-card">Keine Drucker konfiguriert. Lege /config/config.json an.</div>';
    return;
  }

  for (const p of printers) {
    const card = document.createElement('article');
    card.className = 'printer-card';
    const pct = formatProgress(p.progress);
    const url = overlayUrlFor(p.id);
    card.innerHTML = `
      <div class="printer-card-head">
        <div>
          <div class="printer-title"></div>
          <div class="printer-meta"></div>
        </div>
        <span class="badge ${p.connected ? 'badge-ok' : 'badge-off'}">${p.connected ? 'Online' : 'Offline'}</span>
      </div>
      <div class="printer-progress"><span style="width:${pct}"></span></div>
      <div class="printer-detail"></div>
      <div class="card-actions">
        <a href="${url}" target="_blank" rel="noreferrer">Overlay</a>
        <button type="button" data-copy="${url}">OBS-Link</button>
      </div>
    `;
    card.querySelector('.printer-title').textContent = p.name || p.id;
    card.querySelector('.printer-meta').textContent = `${p.type || 'printer'} · ${p.host || p.id}`;
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

function scalePreview() {
  const wrap = previewFrame.parentElement;
  const scale = wrap.clientWidth / 1920;
  previewFrame.style.transform = `scale(${scale})`;
}

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(urlOut.value);
  } catch {
    urlOut.select();
    document.execCommand('copy');
  }
  copyBtn.textContent = 'Kopiert!';
  copyBtn.classList.add('copied');
});

printerCards.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-copy]');
  if (!btn) return;
  const url = btn.getAttribute('data-copy');
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const tmp = document.createElement('input');
    tmp.value = url;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
  }
  btn.textContent = 'Kopiert!';
  setTimeout(() => { btn.textContent = 'OBS-Link'; }, 1200);
});

refreshBtn.addEventListener('click', loadHealth);

document.getElementById('selectAll').addEventListener('click', () => {
  sectionList.querySelectorAll('input').forEach((c) => (c.checked = true));
  update();
});
document.getElementById('selectNone').addEventListener('click', () => {
  sectionList.querySelectorAll('input').forEach((c) => (c.checked = false));
  update();
});
document.querySelectorAll('input[name="layout"]').forEach((r) => r.addEventListener('change', update));
printerSelect.addEventListener('change', update);
window.addEventListener('resize', scalePreview);

async function init() {
  try {
    const res = await fetch('/api/printers', { cache: 'no-store' });
    const printers = await res.json();
    if (printers.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'Keine Drucker konfiguriert';
      printerSelect.appendChild(opt);
      printerSelect.disabled = true;
    } else {
      for (const p of printers) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.id})`;
        printerSelect.appendChild(opt);
      }
    }
  } catch {
    const opt = document.createElement('option');
    opt.textContent = 'Server nicht erreichbar';
    printerSelect.appendChild(opt);
  }
  scalePreview();
  update();
  loadHealth();
  setInterval(loadHealth, 5000);
}

init();
