// Drucker einrichten: Liste, Formular, Verbindungstest, Netzwerksuche und Slotplan.
import { api } from '../api.js';
import { TYPE_LABELS, field, h, select, slugify, toast } from '../ui.js';

const MATERIALS = ['PLA', 'PETG', 'ASA', 'ABS', 'TPU', 'PA', 'PC', 'PVB', 'HIPS', 'PLA-CF', 'PETG-CF', 'PA-CF'];
let app;
let draft = []; // Arbeitskopie der Drucker
let selectedId = null;
let dirty = false;
let root;

const clone = (v) => JSON.parse(JSON.stringify(v));

function loadDraft() {
  draft = clone((app.config.printers || []).filter((p) => !p.virtual)).map((p) => ({ ...p, originalId: p.id }));
  dirty = false;
}

function markDirty() {
  dirty = true;
  root.querySelector('[data-dirty]')?.classList.remove('hidden');
}

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

function newPrinter(extra = {}) {
  let n = draft.length + 1;
  while (draft.some((p) => p.id === `drucker-${n}`)) n++;
  const printer = {
    id: `drucker-${n}`, name: '', type: 'prusalink', model: 'custom', host: '', username: 'maker',
    cameraUrl: '', presetId: '', wasteGramsPerChange: 0, slots: [], isNew: true, ...extra,
  };
  draft.push(printer);
  selectedId = printer.id;
  markDirty();
  return printer;
}

export function render(container, appState, param) {
  app = appState;
  root = container;
  loadDraft();
  if (param === 'new') newPrinter();
  else selectedId = draft.some((p) => p.id === param) ? param : (selectedId && draft.some((p) => p.id === selectedId) ? selectedId : draft[0]?.id);
  draw();
}

function draw() {
  root.replaceChildren(
    h('div', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'Drucker'), h('p', {}, 'Verbindung zu deinen Druckern einrichten. Zugangsdaten bleiben auf dem Server.')),
      h('div', { class: 'row' },
        h('span', { class: `dirty${dirty ? '' : ' hidden'}`, dataset: { dirty: '1' } }, 'Ungespeicherte Änderungen'),
        h('button', { class: 'btn primary', onclick: save }, 'Speichern'))),
    h('div', { class: 'cols' },
      h('div', { class: 'stack' }, listCard(), discoverCard()),
      formCard()),
  );
}

function statusOf(id) {
  return (app.health?.printers || []).find((p) => p.id === id);
}

function listCard() {
  const items = draft.map((p) => {
    const s = statusOf(p.originalId || p.id);
    const dot = p.isNew ? '' : s?.connected ? 'ok' : 'bad';
    return h('button', {
      class: `plist-item${p.id === selectedId ? ' active' : ''}`,
      onclick: () => { selectedId = p.id; draw(); },
    },
    h('div', { class: 'row', style: { gap: '10px', flexWrap: 'nowrap', minWidth: 0 } },
      h('span', { class: `dot ${dot}` }),
      h('div', { style: { minWidth: 0 } }, p.name || 'Neuer Drucker', h('small', {}, [TYPE_LABELS[p.type], p.host].filter(Boolean).join(' · ') || 'noch nicht eingerichtet'))),
    p.isNew ? h('span', { class: 'badge warn' }, 'neu') : null);
  });
  return h('div', { class: 'card' },
    h('div', { class: 'row between', style: { marginBottom: '12px' } },
      h('h2', {}, 'Deine Drucker'),
      h('button', { class: 'btn sm', onclick: () => { newPrinter(); draw(); } }, '+ Hinzufügen')),
    items.length ? h('div', { class: 'plist' }, items) : h('p', { class: 'muted' }, 'Noch keine Drucker. Füge einen hinzu oder suche im Netzwerk.'));
}

function discoverCard() {
  const cidr = h('input', { type: 'text', placeholder: '192.168.1.0/24' });
  const results = h('div', { class: 'discover-list' });
  const button = h('button', { class: 'btn', onclick: run }, 'Suchen');
  api.subnets().then(({ subnets }) => { if (!cidr.value && subnets[0]) cidr.value = subnets[0]; }).catch(() => {});

  async function run() {
    button.disabled = true;
    results.replaceChildren(h('p', { class: 'muted small' }, 'Durchsuche das Netzwerk … (ca. 10–20 Sekunden)'));
    try {
      const { found, cidr: used } = await api.discover(cidr.value.trim());
      const known = new Set(draft.map((p) => p.host));
      results.replaceChildren(...(found.length ? found.map((item) => h('div', { class: 'discover-item' },
        h('span', {}, h('strong', {}, TYPE_LABELS[item.type]), ` · ${item.host}`),
        known.has(item.host)
          ? h('span', { class: 'muted small' }, 'bereits eingerichtet')
          : h('button', {
            class: 'btn sm',
            onclick: () => {
              newPrinter({ type: item.type, host: item.host, name: `${TYPE_LABELS[item.type]} ${item.host.split('.').pop()}` });
              draw();
            },
          }, 'Übernehmen'))) : [h('p', { class: 'muted small' }, `Keine Drucker in ${used} gefunden.`)]));
    } catch (err) {
      results.replaceChildren(h('p', { class: 'small', style: { color: 'var(--bad)' } }, err.message));
    } finally {
      button.disabled = false;
    }
  }

  return h('div', { class: 'card' },
    h('h2', {}, 'Im Netzwerk suchen'),
    h('p', { class: 'sub' }, 'Findet PrusaLink-, OctoPrint- und Klipper-Drucker im lokalen Netz.'),
    h('div', { class: 'inline' }, cidr, button),
    results);
}

function secretInput(p, key, label, hint) {
  const isSet = key === 'apiKey' ? p.apiKeySet : p.passwordSet;
  const input = h('input', {
    type: 'password',
    autocomplete: 'new-password',
    placeholder: isSet ? '•••••• gespeichert – leer lassen zum Behalten' : '',
    value: typeof p[key] === 'string' ? p[key] : '',
    oninput: (e) => { p[key] = e.target.value; markDirty(); },
  });
  const clear = isSet ? h('button', {
    type: 'button',
    class: 'btn ghost sm',
    onclick: () => { p[key] = null; p[`${key}Set`] = false; markDirty(); draw(); },
  }, 'entfernen') : null;
  return field(label, h('div', { class: 'inline' }, input, clear), hint);
}

function authFields(p) {
  if (p.type === 'prusalink') {
    return [
      h('div', { class: 'grid2' },
        field('Benutzer', h('input', { type: 'text', value: p.username || '', oninput: (e) => { p.username = e.target.value; markDirty(); } })),
        secretInput(p, 'password', 'Passwort')),
      h('p', { class: 'muted small', style: { marginTop: '-6px' } },
        'Am Drucker unter Einstellungen → Netzwerk → PrusaLink (Benutzer meist „maker"). Alternativ funktioniert ein API-Key:'),
      secretInput(p, 'apiKey', 'API-Key (optional, statt Passwort)'),
    ];
  }
  if (p.type === 'octoprint') return [secretInput(p, 'apiKey', 'API-Key', 'OctoPrint → Einstellungen → API → Application Keys')];
  if (p.type === 'moonraker') return [secretInput(p, 'apiKey', 'API-Key (optional)', 'Nur nötig, wenn Moonraker den Zugriff beschränkt.')];
  return [];
}

function slotEditor(p, count) {
  const slots = Array.from({ length: count }, (_, i) => p.slots.find((s) => s.slot === i + 1) || { slot: i + 1, empty: true });
  p.slots = slots;
  const rows = slots.map((slot) => {
    const set = (key, value) => {
      slot[key] = value;
      if (key !== 'empty' && key !== 'color' && value) slot.empty = false;
      markDirty();
      row.classList.toggle('is-empty', slot.empty);
      emptyBox.checked = slot.empty;
    };
    const emptyBox = h('input', { type: 'checkbox', checked: slot.empty, onchange: (e) => set('empty', e.target.checked) });
    const row = h('div', { class: `slot-row${slot.empty ? ' is-empty' : ''}` },
      h('strong', {}, `S${slot.slot}`),
      h('input', { type: 'text', placeholder: 'Hersteller', value: slot.brand || '', oninput: (e) => set('brand', e.target.value) }),
      h('input', { type: 'text', placeholder: 'Farbe / Produkt', value: slot.name || '', oninput: (e) => set('name', e.target.value) }),
      h('input', { type: 'text', placeholder: 'Material', list: 'materials', value: slot.material || '', oninput: (e) => set('material', e.target.value) }),
      h('input', { type: 'color', value: slot.color || '#777777', oninput: (e) => set('color', e.target.value) }),
      h('label', { class: 'check small' }, emptyBox, 'leer'));
    return row;
  });
  return h('div', { class: 'slot-table' },
    h('datalist', { id: 'materials' }, MATERIALS.map((m) => h('option', { value: m }))),
    rows);
}

function formCard() {
  const p = draft.find((x) => x.id === selectedId);
  if (!p) {
    return h('div', { class: 'card empty' },
      h('h2', {}, 'Kein Drucker ausgewählt'),
      h('p', {}, 'Wähle links einen Drucker oder füge einen neuen hinzu.'),
      h('button', { class: 'btn primary', onclick: () => { newPrinter(); draw(); } }, '+ Drucker hinzufügen'));
  }
  const model = (app.config.printerModels || []).find((m) => m.id === p.model) || {};
  const result = h('div', { class: 'test-result' });
  const update = (key, redraw = false) => (e) => {
    p[key] = e.target ? e.target.value : e;
    if (key === 'name' && p.isNew && !p.idTouched) p.id = slugify(p.name) || p.id;
    markDirty();
    if (redraw) draw();
  };

  async function test() {
    result.className = 'test-result';
    result.textContent = 'Teste Verbindung …';
    try {
      const r = await api.testPrinter(p);
      result.className = `test-result ${r.ok ? 'ok' : 'bad'}`;
      result.textContent = r.ok ? `Verbunden – Status: ${r.state || 'unbekannt'}${r.file ? ` · ${r.file}` : ''}` : `Fehler: ${r.error}`;
    } catch (err) {
      result.className = 'test-result bad';
      result.textContent = `Fehler: ${err.message}`;
    }
  }

  function remove() {
    if (!p.isNew && !confirm(`„${p.name || p.id}" wirklich entfernen? OBS-Quellen mit diesem Drucker zeigen danach nichts mehr an.`)) return;
    draft = draft.filter((x) => x !== p);
    selectedId = draft[0]?.id || null;
    markDirty();
    draw();
  }

  const presetOptions = [['', 'Standard (alle Bereiche, Leiste)'], ...(app.config.presets || []).map((pr) => [pr.id, pr.name])];
  const modelOptions = (app.config.printerModels || []).map((m) => [m.id, m.name]);

  return h('div', { class: 'card' },
    h('div', { class: 'row between', style: { marginBottom: '16px' } },
      h('h2', {}, p.name || 'Neuer Drucker'),
      h('button', { class: 'btn danger sm', onclick: remove }, 'Entfernen')),
    h('div', { class: 'grid2' },
      field('Name', h('input', { type: 'text', value: p.name, placeholder: 'z. B. Core One INDX', oninput: update('name') })),
      field('Modell', select(modelOptions, p.model, (v) => update('model', true)(v)))),
    h('div', { class: 'grid2' },
      field('Verbindung', select(Object.entries(TYPE_LABELS).filter(([k]) => k !== 'demo'), p.type, (v) => update('type', true)(v))),
      field('Adresse (IP oder Hostname)', h('input', { type: 'text', value: p.host, placeholder: '192.168.1.122', oninput: update('host') }))),
    ...authFields(p),
    h('div', { class: 'grid2' },
      field('Kamera-URL (optional)', h('input', { type: 'text', value: p.cameraUrl, placeholder: 'http://…/snapshot.jpg', oninput: update('cameraUrl') }), 'Wird im Dashboard angezeigt.'),
      field('Overlay-Variante', select(presetOptions, p.presetId, (v) => update('presetId')(v)), 'Bestimmt Layout & Bereiche im OBS-Overlay.')),
    model.toolchanger ? h('div', {},
      h('h2', { style: { marginTop: '10px' } }, `Slotplan (${model.slots} Slots)`),
      h('p', { class: 'sub' }, 'Optional: Was in welchem Slot steckt – wird im Overlay beim aktiven Tool angezeigt.'),
      slotEditor(p, model.slots),
      h('div', { style: { marginTop: '14px', maxWidth: '260px' } },
        field('Abfall pro Wechsel (g, Fallback)', h('input', {
          type: 'number', step: '0.001', min: '0', value: p.wasteGramsPerChange || 0,
          oninput: (e) => { p.wasteGramsPerChange = Number(e.target.value) || 0; markDirty(); },
        }), 'Nur nötig, wenn die Druckdatei keine Werte liefert.'))) : null,
    h('details', { style: { marginTop: '14px' } },
      h('summary', { class: 'muted small', style: { cursor: 'pointer' } }, 'Erweitert'),
      h('div', { style: { marginTop: '10px' } },
        field('Technische ID (für OBS-Links)', h('input', {
          type: 'text', value: p.id, readOnly: !p.isNew,
          oninput: (e) => { p.id = slugify(e.target.value); p.idTouched = true; markDirty(); },
        }), p.isNew ? 'Wird aus dem Namen erzeugt.' : 'Kann nach dem Speichern nicht mehr geändert werden, damit OBS-Links gültig bleiben.'))),
    h('div', { class: 'row', style: { marginTop: '18px' } },
      h('button', { class: 'btn', onclick: test }, 'Verbindung testen'),
      h('button', { class: 'btn primary', onclick: save }, 'Speichern')),
    result);
}

async function save() {
  const ids = new Set();
  for (const p of draft) {
    if (!p.id) return toast('Jeder Drucker braucht einen Namen.', 'bad');
    if (ids.has(p.id)) return toast(`Die ID „${p.id}" ist doppelt.`, 'bad');
    ids.add(p.id);
  }
  const printers = draft.map(({ isNew, idTouched, apiKeySet, passwordSet, capabilities, issues, virtual, ...rest }) => rest);
  if (await app.save({ ...app.config, printers }, 'Drucker gespeichert')) {
    loadDraft();
    draw();
  }
}
