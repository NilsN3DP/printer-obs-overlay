// Overlay & OBS: Branding, Overlay-Varianten (Presets), OBS-Link und Live-Vorschau.
import { DEFAULT_ACCENT, SECTIONS, SECTION_KEYS, SOCIALS, buildOverlayUrl } from '../../shared/sections.js';
import { confirmDialog, copyText, field, h, segmented, select, slugify, toast } from '../ui.js';

let app;
let root;
let theme;
let presets;
let editId = null; // gerade bearbeitete Variante ('' = Standard)
let linkPrinter = '';
let linkPreset = '';
let dirty = false;
let previewTimer = null;
let frame = null;
let resizeObserver = null;

const clone = (v) => JSON.parse(JSON.stringify(v));
const STANDARD = { id: '', name: 'Standard', layout: 'bar', sections: SECTION_KEYS, accentColor: '', brandText: '', socials: null };

function markDirty() {
  dirty = true;
  root.querySelector('[data-dirty]')?.classList.remove('hidden');
  schedulePreview();
}

export function render(container, appState) {
  app = appState;
  root = container;
  theme = clone(app.config.theme);
  presets = clone(app.config.presets || []);
  dirty = false;
  const printers = app.config.printers || [];
  if (!printers.some((p) => p.id === linkPrinter)) linkPrinter = printers[0]?.id || '';
  if (editId === null || (editId && !presets.some((p) => p.id === editId))) {
    editId = printers.find((p) => p.id === linkPrinter)?.presetId || presets[0]?.id || '';
  }
  draw();
}

function draw() {
  resizeObserver?.disconnect();
  root.replaceChildren(
    h('div', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'Overlay & OBS'), h('p', {}, 'Aussehen festlegen und das Overlay in OBS einbinden.')),
      h('div', { class: 'row' },
        h('span', { class: `dirty${dirty ? '' : ' hidden'}`, dataset: { dirty: '1' } }, 'Ungespeicherte Änderungen'),
        h('button', { class: 'btn primary', onclick: save }, 'Speichern'))),
    h('div', { class: 'cols flip' },
      h('div', { class: 'stack sticky' }, previewCard(), obsCard()),
      h('div', { class: 'stack' }, brandingCard(), presetCard())),
  );
  updatePreview();
}

// ---------- Branding ----------

function brandingCard() {
  const set = (key) => (e) => { theme[key] = e.target.value; markDirty(); };
  return h('div', { class: 'card' },
    h('h2', {}, 'Branding'),
    h('p', { class: 'sub' }, 'Gilt für alle Overlays. Ein Unterstrich färbt den Teil danach in der Akzentfarbe (z. B. MeinKanal_de).'),
    h('div', { class: 'grid2' },
      field('Kanalname', h('input', { type: 'text', maxLength: 32, value: theme.brandText, oninput: set('brandText') })),
      field('Akzentfarbe', h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
        h('input', { type: 'color', value: theme.accentColor || DEFAULT_ACCENT, oninput: set('accentColor') }),
        h('button', { class: 'btn ghost sm', onclick: () => { theme.accentColor = DEFAULT_ACCENT; markDirty(); draw(); } }, 'Prusa-Orange')))),
    field('Logo-URL (optional)', h('input', { type: 'text', value: theme.logoUrl, placeholder: 'https://…/logo.png', oninput: set('logoUrl') }),
      'Quadratisches Bild, wird links neben dem Namen angezeigt.'),
    h('div', { class: 'field' },
      h('span', {}, 'Social-Media-Symbole'),
      h('div', { class: 'sections-grid' }, SOCIALS.map((s) => h('label', { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: theme.socials.includes(s.key),
          onchange: (e) => {
            theme.socials = SOCIALS.map((x) => x.key).filter((k) => (k === s.key ? e.target.checked : theme.socials.includes(k)));
            markDirty();
          },
        }), s.label)))));
}

// ---------- Varianten ----------

function currentPreset() {
  return presets.find((p) => p.id === editId) || STANDARD;
}

function presetCard() {
  const preset = currentPreset();
  const isStandard = preset === STANDARD;
  const options = [['', 'Standard (alle Bereiche)'], ...presets.map((p) => [p.id, p.name])];

  function add() {
    const base = currentPreset();
    let n = presets.length + 1;
    while (presets.some((p) => p.id === `variante-${n}`)) n++;
    const created = { ...clone(base), id: `variante-${n}`, name: `Variante ${n}`, isNew: true };
    presets.push(created);
    editId = created.id;
    markDirty();
    draw();
  }

  async function remove() {
    const users = (app.config.printers || []).filter((p) => p.presetId === preset.id).map((p) => p.name);
    const note = users.length ? `\n\nVerwendet von: ${users.join(', ')} – diese nutzen danach den Standard.` : '';
    if (!await confirmDialog(`Variante „${preset.name}" löschen?${note}`, { ok: 'Löschen', danger: true })) return;
    presets = presets.filter((p) => p !== preset);
    editId = '';
    markDirty();
    draw();
  }

  const body = isStandard
    ? [h('p', { class: 'muted small' }, 'Der Standard zeigt alle Bereiche in der Leiste unten. Lege eine Variante an, um Bereiche auszublenden oder die Karte zu nutzen.')]
    : [
      h('div', { class: 'grid2' },
        field('Name', h('input', {
          type: 'text', value: preset.name,
          oninput: (e) => { preset.name = e.target.value; if (preset.isNew) preset.id = slugify(e.target.value) || preset.id; editId = preset.id; markDirty(); },
        })),
        field('Layout', segmented([['bar', 'Leiste unten'], ['card', 'Karte']], preset.layout, (v) => { preset.layout = v; markDirty(); }))),
      field('Eigene Akzentfarbe', h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
        h('label', { class: 'check' },
          h('input', {
            type: 'checkbox', checked: Boolean(preset.accentColor),
            onchange: (e) => { preset.accentColor = e.target.checked ? (theme.accentColor || DEFAULT_ACCENT) : ''; markDirty(); draw(); },
          }), 'abweichend vom Branding'),
        preset.accentColor ? h('input', { type: 'color', value: preset.accentColor, oninput: (e) => { preset.accentColor = e.target.value; markDirty(); } }) : null)),
      sectionPicker(preset),
    ];

  return h('div', { class: 'card' },
    h('div', { class: 'row between', style: { marginBottom: '12px' } },
      h('h2', {}, 'Overlay-Varianten'),
      h('button', { class: 'btn sm', onclick: add }, '+ Neue Variante')),
    h('p', { class: 'sub' }, 'Welche Bereiche angezeigt werden. Jedem Drucker wird unter „Drucker" eine Variante zugewiesen.'),
    h('div', { class: 'row', style: { flexWrap: 'nowrap', marginBottom: '14px' } },
      select(options, editId, (v) => { editId = v; draw(); }),
      isStandard ? null : h('button', { class: 'btn danger sm', onclick: remove }, 'Löschen')),
    body);
}

function sectionPicker(preset) {
  const active = new Set(preset.sections?.length ? preset.sections : SECTION_KEYS);
  const toolchanger = app.hasToolchanger();
  const groups = [...new Set(SECTIONS.map((s) => s.group))];
  const setAll = (on) => { preset.sections = on ? [...SECTION_KEYS] : []; markDirty(); draw(); };
  return h('div', { class: 'field' },
    h('div', { class: 'row between' },
      h('span', { class: 'label' }, 'Bereiche'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm', onclick: () => setAll(true) }, 'alle'),
        h('button', { class: 'btn ghost sm', onclick: () => setAll(false) }, 'keine'))),
    h('div', { class: 'sections-groups' }, groups.map((group) => {
      const items = SECTIONS.filter((s) => s.group === group);
      if (items[0].toolchange && !toolchanger) return null;
      return h('div', { class: 'sections-group' },
        h('h4', {}, group),
        h('div', { class: 'sections-grid' }, items.map((s) => h('label', { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: active.has(s.key),
            onchange: (e) => {
              if (e.target.checked) active.add(s.key); else active.delete(s.key);
              preset.sections = SECTION_KEYS.filter((k) => active.has(k));
              markDirty();
            },
          }), s.label))));
    })),
    toolchanger ? h('span', { class: 'hint' }, 'Toolchanger-Bereiche erscheinen nur bei INDX- und XL-Druckern.') : null);
}

// ---------- Vorschau ----------

function previewUrl() {
  const preset = currentPreset();
  const sections = preset.sections?.length ? preset.sections : SECTION_KEYS;
  return buildOverlayUrl('', {
    printer: linkPrinter,
    layout: preset.layout,
    sections: preset === STANDARD ? SECTION_KEYS : sections,
    accent: preset.accentColor || theme.accentColor,
    brand: theme.brandText || ' ',
    socials: theme.socials,
  });
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 250);
}

function updatePreview() {
  if (!frame) return;
  const url = previewUrl();
  if (frame.dataset.url !== url) {
    frame.dataset.url = url;
    frame.src = url;
  }
}

function previewCard() {
  const box = h('div', { class: 'preview' });
  frame = h('iframe', { title: 'Overlay-Vorschau', loading: 'lazy' });
  box.append(frame);
  resizeObserver = new ResizeObserver(() => { frame.style.transform = `scale(${box.clientWidth / 1920})`; });
  resizeObserver.observe(box);
  const printers = (app.config.printers || []).map((p) => [p.id, p.name]);
  return h('div', { class: 'card' },
    h('div', { class: 'row between', style: { marginBottom: '12px' } },
      h('h2', {}, 'Vorschau'),
      printers.length > 1 ? h('div', { style: { minWidth: '200px' } }, select(printers, linkPrinter, (v) => { linkPrinter = v; draw(); })) : null),
    box,
    h('p', { class: 'muted small', style: { margin: '10px 0 0' } },
      `Zeigt „${currentPreset().name}" mit deinen aktuellen Einstellungen in 1920 × 1080 – auch vor dem Speichern.`));
}

// ---------- OBS ----------

function obsCard() {
  const printers = (app.config.printers || []).map((p) => [p.id, p.name]);
  const presetOptions = [['', 'wie beim Drucker eingestellt'], ...presets.filter((p) => !p.isNew).map((p) => [p.id, p.name])];
  const url = buildOverlayUrl(app.baseUrl(), { printer: linkPrinter, preset: linkPreset });
  const input = h('input', { type: 'text', readOnly: true, value: url, onclick: (e) => e.target.select() });
  const localOnly = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) && app.system?.mode === 'docker';
  return h('div', { class: 'card' },
    h('h2', {}, 'In OBS einbinden'),
    h('div', { class: 'grid2' },
      field('Drucker', select(printers, linkPrinter, (v) => { linkPrinter = v; draw(); })),
      field('Variante', select(presetOptions, linkPreset, (v) => { linkPreset = v; draw(); }))),
    h('div', { class: 'urlbox' },
      input,
      h('button', { class: 'btn', onclick: () => copyText(url) }, 'Kopieren'),
      h('a', { class: 'btn', href: url, target: '_blank', rel: 'noreferrer' }, 'Öffnen')),
    localOnly ? h('div', { class: 'notice warn', style: { marginTop: '12px' } },
      'Der Link enthält „localhost". Läuft OBS auf einem anderen Rechner, öffne das Dashboard über die IP des Servers oder trage unter System eine öffentliche Adresse ein.') : null,
    h('ol', { class: 'steps' },
      h('li', {}, 'In OBS: ', h('b', {}, 'Quelle hinzufügen → Browser')),
      h('li', {}, 'Link einfügen, Breite ', h('b', {}, '1920'), ', Höhe ', h('b', {}, '1080')),
      h('li', {}, 'Quelle über die gesamte Szene ziehen – fertig. Änderungen hier erscheinen sofort in OBS.')),
    h('p', { class: 'muted small', style: { margin: '12px 0 0' } },
      'Mit dem OBS-Plugin geht es ohne Link: ', h('b', {}, 'Quelle hinzufügen → Printer Overlay'), ' und Drucker auswählen.'));
}

// ---------- Speichern ----------

async function save() {
  const ids = new Set();
  for (const p of presets) {
    if (!p.name.trim()) return toast('Jede Variante braucht einen Namen.', 'bad');
    if (ids.has(p.id)) return toast(`Zwei Varianten heißen gleich („${p.name}").`, 'bad');
    ids.add(p.id);
  }
  const cleanPresets = presets.map(({ isNew, ...rest }) => rest);
  // Drucker, deren Variante gelöscht wurde, fallen auf den Standard zurück.
  const printers = (app.config.printers || []).filter((p) => !p.virtual).map((p) => ({
    ...p, originalId: p.id, presetId: ids.has(p.presetId) ? p.presetId : '',
  }));
  if (await app.save({ ...app.config, theme, presets: cleanPresets, printers }, 'Overlay gespeichert')) {
    render(root, app);
  }
}
