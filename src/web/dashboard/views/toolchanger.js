// Toolchanger: Druckdatei analysieren (Wechsel, Abfall, Farben) und Live-Status der INDX/XL-Drucker.
import { api } from '../api.js';
import { h, select, toast } from '../ui.js';

let app;
let live = null;
let lastResult = null;

export function render(container, appState) {
  app = appState;
  live = h('div', { class: 'stack' });
  const result = h('div');
  const input = h('input', { type: 'file', accept: '.gcode,.bgcode,.gco,.g', class: 'hidden', onchange: (e) => analyze(e.target.files[0]) });
  const zone = h('div', {
    class: 'dropzone',
    onclick: () => input.click(),
    ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
    ondragleave: () => zone.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); zone.classList.remove('over'); analyze(e.dataTransfer.files[0]); },
  },
  h('strong', {}, 'G-code hierher ziehen oder klicken'),
  h('div', { class: 'small', style: { marginTop: '6px' } }, '.gcode und .bgcode aus PrusaSlicer – die Datei bleibt auf deinem Server.'));

  async function analyze(file) {
    if (!file) return;
    result.replaceChildren(h('p', { class: 'muted' }, `Analysiere ${file.name} …`));
    try {
      lastResult = await api.analyze(file);
      result.replaceChildren(facts(lastResult));
    } catch (err) {
      result.replaceChildren(h('div', { class: 'notice bad', style: { marginTop: '14px' } }, err.message));
    } finally {
      input.value = '';
    }
  }

  container.append(
    h('div', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'Toolchanger'), h('p', {}, 'Toolwechsel, Spülmenge und Farben für INDX und XL.'))),
    h('div', { class: 'cols-even' },
      h('div', { class: 'card' },
        h('h2', {}, 'Druckdatei prüfen'),
        h('p', { class: 'sub' }, 'Zeigt vorab, wie viele Wechsel ein Druck hat und wie viel Material dabei verloren geht.'),
        zone, input, result),
      h('div', {},
        h('div', { class: 'card' },
          h('h2', {}, 'Live während des Drucks'),
          h('p', { class: 'sub' }, 'Bei PrusaLink lädt der Server die laufende Druckdatei einmal herunter und berechnet daraus Toolwechsel, Layer und Abfall. Eigene Firmware-Felder haben Vorrang.'),
          live))),
  );
  if (lastResult) result.replaceChildren(facts(lastResult));
  if (app.health) onHealth(app.health);
}

function facts(r) {
  const perChange = r.changesTotal > 0 && r.wasteTotalG != null ? r.wasteTotalG / r.changesTotal : null;
  const rows = [
    ['Datei', r.fileName],
    ['Tools', r.toolsTotal ?? '–'],
    ['Toolwechsel', r.changesTotal],
    ['Layer', r.layerTotal || '–'],
    ['Abfall gesamt', r.wasteTotalG != null ? `${r.wasteTotalG} g` : 'keine Angabe in der Datei'],
    ['Abfall pro Wechsel', perChange != null ? `${perChange.toFixed(3)} g` : '–'],
    ['Filament gesamt', r.totalUsedG != null ? `${r.totalUsedG} g` : '–'],
    ['Materialien', r.materials.length ? r.materials.join(', ') : '–'],
    ['Farben', r.colors.length ? r.colors.map((c) => h('span', { class: 'mono', style: { marginRight: '10px' } }, h('span', { class: 'swatch', style: { background: c } }), c)) : '–'],
    ['Nutzung je Tool', r.toolUseCounts.length ? r.toolUseCounts.map((t) => `T${t.tool}: ${t.count}x`).join(' · ') : '–'],
    ['INDX erkannt', r.indxDetected ? 'ja' : 'nein'],
  ];
  const targets = (app.config.printers || []).filter((p) => p.capabilities?.toolchanger && !p.virtual);
  let target = targets[0]?.id;
  async function apply() {
    const printers = app.config.printers.filter((p) => !p.virtual)
      .map((p) => ({ ...p, originalId: p.id, wasteGramsPerChange: p.id === target ? Number(perChange.toFixed(3)) : p.wasteGramsPerChange }));
    if (await app.save({ ...app.config, printers }, 'Abfall pro Wechsel übernommen')) toast('Wird genutzt, wenn eine Druckdatei keine Abfallwerte enthält.');
  }
  return h('div', {},
    h('dl', { class: 'facts-table' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    perChange != null && targets.length ? h('div', { class: 'row', style: { marginTop: '16px', flexWrap: 'nowrap' } },
      h('span', { class: 'muted small', style: { whiteSpace: 'nowrap' } }, 'Als Fallback für'),
      select(targets.map((p) => [p.id, p.name]), target, (v) => { target = v; }),
      h('button', { class: 'btn sm', onclick: apply }, 'übernehmen')) : null);
}

function liveCard(p) {
  const m = p.meta || { state: 'idle' };
  const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
  const text = {
    idle: p.type === 'prusalink' ? 'Kein Druck aktiv.' : 'Werte kommen direkt vom Drucker.',
    downloading: `Druckdatei wird geladen: ${mb(m.bytes || 0)}${m.total ? ` von ${mb(m.total)}` : ''}`,
    ready: 'Druckdatei analysiert – Wechsel, Layer und Abfall werden live berechnet.',
    failed: `Analyse fehlgeschlagen (${m.error || 'unbekannt'}). Neuer Versuch in wenigen Minuten.`,
  }[m.state] || '';
  const pct = m.state === 'downloading' && m.total ? (m.bytes / m.total) * 100 : null;
  return h('div', { style: { borderTop: '1px solid var(--line)', paddingTop: '12px' } },
    h('div', { class: 'row between' },
      h('strong', {}, p.name),
      h('span', { class: `badge ${p.connected ? 'ok' : 'bad'}` }, p.connected ? 'Online' : 'Offline')),
    p.file ? h('div', { class: 'muted small', style: { marginTop: '4px' } }, p.file) : null,
    h('div', { class: 'small', style: { marginTop: '6px', color: m.state === 'failed' ? 'var(--warn)' : 'var(--muted)' } }, text),
    pct != null ? h('div', { class: 'progress', style: { marginTop: '8px' } }, h('span', { style: { width: `${pct}%` } })) : null);
}

export function onHealth(health) {
  if (!live?.isConnected) return;
  const printers = (health.printers || []).filter((p) => p.capabilities?.toolchanger);
  live.replaceChildren(...(printers.length
    ? printers.map(liveCard)
    : [h('p', { class: 'muted' }, 'Kein Toolchanger eingerichtet. Wähle beim Drucker ein INDX- oder XL-Modell.')]));
}
