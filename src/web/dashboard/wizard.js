// Einrichtungsassistent beim ersten Start: Drucker -> Aussehen -> OBS.
import { DEFAULT_ACCENT, SECTION_KEYS, SOCIALS, buildOverlayUrl } from '../shared/sections.js';
import { api } from './api.js';
import { TYPE_LABELS, copyText, discoveredLabel, field, h, scaleSlider, segmented, select, slugify, toast } from './ui.js';

const STEPS = ['Willkommen', 'Drucker', 'Aussehen', 'In OBS'];

/**
 * Oeffnet den Assistenten als Vollbild-Dialog.
 * @param {object} app  gemeinsamer Dashboard-Zustand (main.js)
 * @param {() => void} onDone  wird nach Abschluss oder Ueberspringen aufgerufen
 */
export function openWizard(app, onDone) {
  const models = app.config.printerModels || [];
  const state = {
    step: 0,
    printer: { name: '', type: 'prusalink', model: 'custom', host: '', username: 'maker', password: '', apiKey: '' },
    tested: null, // null = nicht getestet, true/false = Ergebnis
    skipPrinter: false,
    found: null, // Ergebnis der Netzwerksuche
    searching: false,
    theme: { ...app.config.theme, socials: [...(app.config.theme.socials || [])] },
    layout: 'bar',
    scale: 1,
    keepDemo: false,
  };

  const backdrop = h('div', { class: 'wizard-backdrop' });
  const dialog = h('div', { class: 'wizard', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Einrichtung' });
  backdrop.append(dialog);
  document.body.append(backdrop);

  const close = () => {
    backdrop.remove();
    onDone?.();
  };

  async function skip() {
    if (await app.save({ ...app.config, printers: realPrinters(), setupDone: true }, 'Einrichtung übersprungen')) close();
  }

  const realPrinters = () => (app.config.printers || []).filter((p) => !p.virtual).map((p) => ({ ...p, originalId: p.id }));

  // ---------- Schritt: Drucker ----------

  let searchBox = null;
  let nextButton = null;
  const refreshSearch = () => { if (searchBox?.isConnected) fillSearch(searchBox); };
  const refreshNext = () => { if (nextButton) nextButton.disabled = !canContinue(); };

  async function search() {
    state.searching = true;
    refreshSearch();
    try {
      const { subnets } = await api.subnets();
      const results = [];
      if (subnets[0]) results.push(...(await api.discover(subnets[0])).found);
      state.found = results;
    } catch (err) {
      state.found = [];
      toast(`Suche fehlgeschlagen: ${err.message}`, 'bad');
    } finally {
      state.searching = false;
      refreshSearch();
    }
  }

  function pick(item) {
    const p = state.printer;
    p.type = item.type;
    p.host = item.host;
    p.name = item.name || p.name || TYPE_LABELS[item.type];
    if (item.model && item.model !== 'custom') p.model = item.model;
    state.tested = null;
    draw();
  }

  async function test() {
    const p = state.printer;
    if (!p.host.trim()) return toast('Bitte die Adresse des Druckers eintragen.', 'bad');
    state.tested = 'running';
    draw();
    try {
      const r = await api.testPrinter({ ...p, id: 'wizard-test' });
      state.tested = r.ok ? true : false;
      state.testMessage = r.ok ? `Verbunden – Status: ${r.state || 'unbekannt'}` : r.error;
    } catch (err) {
      state.tested = false;
      state.testMessage = err.message;
    }
    draw();
  }

  function fillSearch(box) {
    const p = state.printer;
    box.replaceChildren(
      h('div', { class: 'row between' },
        h('strong', {}, 'Im Netzwerk gefunden'),
        h('button', { class: 'btn sm', disabled: state.searching, onclick: search }, state.searching ? 'Suche läuft …' : 'Erneut suchen')),
      state.searching
        ? h('p', { class: 'muted small' }, 'Durchsuche dein Netzwerk nach PrusaLink, OctoPrint und Klipper … (einige Sekunden)')
        : state.found?.length
          ? h('div', { class: 'discover-list' }, state.found.map((item) => h('button', {
            class: `discover-item pick${item.host === p.host ? ' active' : ''}`,
            onclick: () => pick(item),
          }, discoveredLabel(item, models), h('span', { class: 'muted small' }, 'auswählen'))))
          : h('p', { class: 'muted small' }, state.found ? 'Nichts gefunden – trag die Adresse unten von Hand ein.' : ''));
  }

  function printerStep() {
    const p = state.printer;
    const set = (key, redraw = false) => (e) => {
      p[key] = e?.target ? e.target.value : e;
      if (['host', 'type', 'username', 'password', 'apiKey'].includes(key)) state.tested = null;
      if (redraw) draw();
      else refreshNext();
    };
    searchBox = h('div', { class: 'wizard-box' });
    fillSearch(searchBox);

    const auth = [];
    if (p.type === 'prusalink') {
      auth.push(h('div', { class: 'grid2' },
        field('Benutzer', h('input', { type: 'text', value: p.username, oninput: set('username') })),
        field('Passwort', h('input', { type: 'password', autocomplete: 'new-password', value: p.password, oninput: set('password') }))),
      h('p', { class: 'muted small', style: { marginTop: '-6px' } },
        'Steht am Drucker unter Einstellungen → Netzwerk → PrusaLink. Der Benutzer heißt meist „maker".'));
    } else if (p.type === 'octoprint' || p.type === 'moonraker') {
      auth.push(field(p.type === 'octoprint' ? 'API-Key' : 'API-Key (meist nicht nötig)',
        h('input', { type: 'password', autocomplete: 'new-password', value: p.apiKey, oninput: set('apiKey') })));
    }

    let result = null;
    if (state.tested === 'running') result = h('div', { class: 'test-result' }, 'Teste Verbindung …');
    else if (state.tested === true) result = h('div', { class: 'test-result ok' }, state.testMessage);
    else if (state.tested === false) result = h('div', { class: 'test-result bad' }, `Fehler: ${state.testMessage}`);

    return [
      h('h2', {}, 'Welchen Drucker willst du zeigen?'),
      h('p', { class: 'sub' }, 'Weitere Drucker kannst du später unter „Drucker" hinzufügen.'),
      searchBox,
      h('div', { class: 'grid2', style: { marginTop: '16px' } },
        field('Verbindung', select(Object.entries(TYPE_LABELS).filter(([k]) => k !== 'demo'), p.type, set('type', true))),
        field('Adresse (IP oder Hostname)', h('input', { type: 'text', value: p.host, placeholder: 'z. B. 192.168.1.50', oninput: set('host') }))),
      h('div', { class: 'grid2' },
        field('Modell', select(models.map((m) => [m.id, m.name]), p.model, set('model')), 'Bei INDX und XL erscheinen Toolwechsel und Slots.'),
        field('Name des Druckers', h('input', { type: 'text', value: p.name, placeholder: 'z. B. Werkstatt links', oninput: set('name') }))),
      ...auth,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: test }, 'Verbindung testen')),
      result,
    ];
  }

  // ---------- Schritt: Aussehen ----------

  function previewFrame() {
    const box = h('div', { class: 'preview' });
    const frame = h('iframe', { title: 'Vorschau' });
    box.append(frame);
    const url = buildOverlayUrl('', {
      printer: 'demo',
      layout: state.layout,
      scale: state.scale,
      sections: SECTION_KEYS,
      accent: state.theme.accentColor,
      brand: state.theme.brandText || ' ',
      socials: state.theme.socials,
    });
    frame.src = url;
    new ResizeObserver(() => { frame.style.transform = `scale(${box.clientWidth / 1920})`; }).observe(box);
    return box;
  }

  function lookStep() {
    const t = state.theme;
    let previewTimer;
    const refresh = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => preview.replaceWith(preview = previewFrame()), 300);
    };
    let preview = previewFrame();
    return [
      h('h2', {}, 'Wie soll dein Overlay aussehen?'),
      h('p', { class: 'sub' }, 'Alles lässt sich später unter „Overlay & OBS" ändern. Die Vorschau zeigt Beispieldaten.'),
      preview,
      h('div', { class: 'grid2', style: { marginTop: '16px' } },
        field('Anzeigename (optional)', h('input', {
          type: 'text', maxLength: 32, value: t.brandText, placeholder: 'Dein Name im Overlay',
          oninput: (e) => { t.brandText = e.target.value; refresh(); },
        }), 'Ein Unterstrich färbt den Teil danach in der Akzentfarbe.'),
        field('Akzentfarbe', h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
          h('input', { type: 'color', value: t.accentColor || DEFAULT_ACCENT, oninput: (e) => { t.accentColor = e.target.value; refresh(); } }),
          h('span', { class: 'muted small' }, 'Standard: Prusa-Orange')))),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' },
          h('span', {}, 'Social-Media-Symbole'),
          h('div', { class: 'sections-grid' }, SOCIALS.map((s) => h('label', { class: 'check' },
            h('input', {
              type: 'checkbox',
              checked: t.socials.includes(s.key),
              onchange: (e) => {
                t.socials = SOCIALS.map((x) => x.key).filter((k) => (k === s.key ? e.target.checked : t.socials.includes(k)));
                refresh();
              },
            }), s.label)))),
        field('Layout', segmented([['bar', 'Leiste unten'], ['card', 'Karte']], state.layout, (v) => { state.layout = v; draw(); }),
          'Leiste: über die ganze Breite mit Rahmen. Karte: kompakt in einer Ecke.')),
      state.layout === 'card'
        ? field('Größe der Karte', scaleSlider(state.scale, (v) => { state.scale = v; refresh(); }), 'Position und Größe lassen sich später unter „Overlay & OBS" ändern.')
        : null,
    ];
  }

  // ---------- Schritt: OBS ----------

  function obsStep() {
    const isObs = app.system?.mode === 'obs';
    const hasPrinter = !state.skipPrinter && state.printer.host;
    const printerId = hasPrinter ? newPrinterId() : 'demo';
    const url = buildOverlayUrl(app.baseUrl(), { printer: printerId });
    return [
      h('h2', {}, 'Fast geschafft – jetzt in OBS einbinden'),
      isObs
        ? h('ol', { class: 'steps' },
          h('li', {}, 'In OBS bei „Quellen" auf ', h('b', {}, '+'), ' klicken und ', h('b', {}, 'Printer Overlay'), ' wählen.'),
          h('li', {}, 'Drucker auswählen und mit OK bestätigen.'),
          h('li', {}, 'Die Quelle in der Liste ganz nach oben schieben, damit sie über der Kamera liegt.'))
        : [
          h('ol', { class: 'steps' },
            h('li', {}, 'In OBS: ', h('b', {}, 'Quelle hinzufügen → Browser')),
            h('li', {}, 'Diesen Link einfügen, Breite ', h('b', {}, '1920'), ', Höhe ', h('b', {}, '1080'), ':'),
            h('li', {}, 'Quelle über die ganze Szene ziehen.')),
          h('div', { class: 'urlbox', style: { marginTop: '12px' } },
            h('input', { type: 'text', readOnly: true, value: url, onclick: (e) => e.target.select() }),
            h('button', { class: 'btn', onclick: () => copyText(url) }, 'Kopieren')),
          h('p', { class: 'muted small' }, 'Den Link findest du jederzeit unter „Overlay & OBS".'),
        ],
      hasPrinter ? h('label', { class: 'check', style: { marginTop: '18px' } },
        h('input', { type: 'checkbox', checked: state.keepDemo, onchange: (e) => { state.keepDemo = e.target.checked; } }),
        'Demo-Drucker zusätzlich behalten') : null,
    ];
  }

  function newPrinterId() {
    const existing = new Set((app.config.printers || []).map((p) => p.id));
    const base = slugify(state.printer.name) || 'drucker';
    let id = base;
    for (let n = 2; existing.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  // ---------- Abschluss ----------

  async function finish() {
    const printers = realPrinters();
    const presets = [...(app.config.presets || [])];
    const hasPrinter = !state.skipPrinter && state.printer.host.trim();
    let presetId = '';
    if (state.layout === 'card') {
      presetId = 'karte';
      if (!presets.some((p) => p.id === 'karte')) presets.push({ id: 'karte', name: 'Karte', layout: 'card', scale: state.scale, sections: [...SECTION_KEYS] });
    }
    if (hasPrinter) {
      const p = state.printer;
      printers.push({
        id: newPrinterId(),
        name: p.name.trim() || TYPE_LABELS[p.type],
        type: p.type,
        model: p.model,
        host: p.host.trim(),
        username: p.type === 'prusalink' ? p.username : '',
        password: p.type === 'prusalink' ? p.password : '',
        apiKey: p.apiKey,
        presetId,
        slots: [],
      });
    }
    const next = {
      ...app.config,
      theme: state.theme,
      presets,
      printers,
      demoMode: hasPrinter ? state.keepDemo : true,
      setupDone: true,
    };
    if (await app.save(next, 'Einrichtung abgeschlossen')) close();
  }

  // ---------- Darstellung ----------

  function canContinue() {
    if (state.step !== 1) return true;
    return state.skipPrinter || Boolean(state.printer.host.trim());
  }

  function draw() {
    const steps = h('ol', { class: 'wizard-steps' }, STEPS.map((label, i) => h('li', {
      class: i === state.step ? 'active' : i < state.step ? 'done' : '',
    }, h('span', {}, String(i + 1)), label)));

    let body;
    if (state.step === 0) {
      body = [
        h('h2', {}, 'Willkommen beim Printer OBS Overlay'),
        h('p', { class: 'sub' }, 'In drei kurzen Schritten zeigt dein Stream Fortschritt, Temperaturen, Filament und bei INDX/XL auch die Toolwechsel deines Druckers.'),
        h('ol', { class: 'steps' },
          h('li', {}, h('b', {}, 'Drucker verbinden'), ' – PrusaLink, OctoPrint oder Klipper'),
          h('li', {}, h('b', {}, 'Aussehen wählen'), ' – Name, Farbe, Layout'),
          h('li', {}, h('b', {}, 'In OBS einbinden'))),
      ];
    } else if (state.step === 1) body = printerStep();
    else if (state.step === 2) body = lookStep();
    else body = obsStep();

    const last = state.step === STEPS.length - 1;
    const next = nextButton = h('button', {
      class: 'btn primary',
      disabled: !canContinue(),
      onclick: () => {
        if (last) return finish();
        state.step++;
        draw();
        if (state.step === 1 && state.found === null && !state.searching) search();
      },
    }, state.step === 0 ? 'Los geht\'s' : last ? 'Fertig' : 'Weiter');

    const footerLeft = state.step === 0
      ? h('button', { class: 'btn ghost', onclick: skip }, 'Überspringen')
      : h('button', { class: 'btn ghost', onclick: () => { state.step--; if (state.step === 1) state.skipPrinter = false; draw(); } }, 'Zurück');

    const noPrinter = state.step === 1 ? h('button', {
      class: 'btn ghost sm',
      onclick: () => { state.skipPrinter = true; state.step++; draw(); },
    }, 'Erst mal ohne Drucker (Demo)') : null;

    dialog.replaceChildren(
      steps,
      h('div', { class: 'wizard-body' }, body),
      h('div', { class: 'wizard-foot' }, footerLeft, h('div', { class: 'row' }, noPrinter, next)),
    );
  }

  draw();
}
