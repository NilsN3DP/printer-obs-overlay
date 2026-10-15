// System: allgemeine Einstellungen, Autostart, Programminfo.
import { api } from '../api.js';
import { confirmDialog, field, h, toast } from '../ui.js';

const MODE_LABELS = { docker: 'Docker', app: 'Windows-App', obs: 'OBS-Plugin', dev: 'Entwicklung' };

export function render(container, app) {
  const sys = app.system;
  const c = app.config;
  const form = {
    pollSeconds: c.pollIntervalMs / 1000,
    publicBaseUrl: c.publicBaseUrl,
    demoMode: c.demoMode,
    wasteGramsPerChange: c.wasteGramsPerChange,
    toolchangerEnabled: c.toolchangerEnabled === true,
  };

  async function save() {
    const pollIntervalMs = Math.round(Number(form.pollSeconds) * 1000);
    if (!(pollIntervalMs >= 500 && pollIntervalMs <= 60000)) return toast('Abfrage-Intervall: 0,5 bis 60 Sekunden.', 'bad');
    const printers = c.printers.filter((p) => !p.virtual).map((p) => ({ ...p, originalId: p.id }));
    if (await app.save({ ...app.config, ...form, pollIntervalMs, printers }, 'Einstellungen gespeichert')) app.rerender();
  }

  function toolchangerCard() {
    const waste = field('Abfall pro Wechsel (g, global)', h('input', {
      type: 'number', min: '0', step: '0.001', value: form.wasteGramsPerChange,
      oninput: (e) => { form.wasteGramsPerChange = Number(e.target.value) || 0; },
    }), 'Letzter Fallback, wenn weder Druckdatei noch Drucker einen Wert liefern.');
    waste.classList.toggle('hidden', !form.toolchangerEnabled);
    return h('div', { class: 'card' },
      h('h2', {}, 'Toolchanger (INDX / XL)'),
      h('p', { class: 'sub' }, 'Toolwechsel, aktives Tool, Slot-Leiste und Abfall im Overlay sowie die Datei-Analyse.'),
      h('div', { class: 'notice warn', style: { marginBottom: '14px' } },
        'Aktuell nur mit Custom-Firmware (CFW) oder über die Auswertung der Druckdatei nutzbar, da PrusaLink diese Daten nicht liefert.'),
      h('label', { class: 'check', style: { marginBottom: '14px' } },
        h('input', {
          type: 'checkbox',
          checked: form.toolchangerEnabled,
          onchange: (e) => { form.toolchangerEnabled = e.target.checked; waste.classList.toggle('hidden', !e.target.checked); },
        }),
        'Toolchanger-Funktionen aktivieren'),
      waste);
  }

  const autostart = sys.autostart?.supported ? h('div', { class: 'card' },
    h('h2', {}, 'Mit Windows starten'),
    h('p', { class: 'sub' }, 'Startet den Overlay-Server unsichtbar im Hintergrund, sobald du dich anmeldest.'),
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: sys.autostart.enabled,
        onchange: async (e) => {
          try {
            const r = await api.setAutostart(e.target.checked);
            sys.autostart.enabled = r.enabled;
            toast(r.enabled ? 'Autostart aktiviert' : 'Autostart deaktiviert');
          } catch (err) {
            e.target.checked = !e.target.checked;
            toast(err.message, 'bad');
          }
        },
      }), 'Beim Anmelden automatisch starten')) : null;

  const shutdown = sys.canShutdown ? h('div', { class: 'card' },
    h('h2', {}, 'Server beenden'),
    h('p', { class: 'sub' }, 'Beendet die Windows-App. OBS-Overlays zeigen dann keine Daten mehr, bis du sie wieder startest.'),
    h('button', {
      class: 'btn danger',
      onclick: async () => {
        if (!await confirmDialog('Overlay-Server jetzt beenden?', { ok: 'Beenden', danger: true })) return;
        await api.shutdown().catch(() => {});
        document.getElementById('view').replaceChildren(h('div', { class: 'card empty' },
          h('h2', {}, 'Server beendet'), h('p', {}, 'Starte „Printer OBS Overlay" über das Startmenü erneut.')));
      },
    }, 'Beenden')) : null;

  const info = [
    ['Version', `v${sys.version}`],
    ['Betriebsart', MODE_LABELS[sys.mode] || sys.mode],
    ['Adresse', `${sys.host}:${sys.port}`],
    ['Konfiguration', h('span', { class: 'mono' }, sys.configFile)],
    ['Datenordner', h('span', { class: 'mono' }, sys.dataDir)],
  ];

  container.append(
    h('div', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'System'), h('p', {}, 'Allgemeine Einstellungen und Programminformationen.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => app.wizard() }, 'Einrichtungsassistent'),
        h('button', { class: 'btn primary', onclick: save }, 'Speichern'))),
    h('div', { class: 'cols-even' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('h2', {}, 'Allgemein'),
          h('p', { class: 'sub' }, 'Gilt für alle Drucker.'),
          h('div', { class: 'grid2' },
            field('Abfrage-Intervall (Sekunden)', h('input', {
              type: 'number', min: '0.5', max: '60', step: '0.5', value: form.pollSeconds,
              oninput: (e) => { form.pollSeconds = e.target.value; },
            }), 'Wie oft die Drucker abgefragt werden. 1–2 s sind ideal.'),
            null),
          field('Öffentliche Adresse für OBS-Links (optional)', h('input', {
            type: 'text',
            value: form.publicBaseUrl,
            placeholder: c.effectivePublicBaseUrl || location.origin,
            disabled: c.publicBaseUrlFromEnv,
            oninput: (e) => { form.publicBaseUrl = e.target.value.trim(); },
          }), c.publicBaseUrlFromEnv
            ? 'Durch die Umgebungsvariable PUBLIC_BASE_URL festgelegt.'
            : 'Leer lassen = die Adresse, unter der du das Dashboard gerade öffnest.'),
          h('label', { class: 'check', style: { marginTop: '4px' } },
            h('input', { type: 'checkbox', checked: form.demoMode, onchange: (e) => { form.demoMode = e.target.checked; } }),
            'Demo-Drucker anzeigen (simuliert einen INDX-Druck)')),
        toolchangerCard(),
        autostart),
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('h2', {}, 'Programm'),
          h('dl', { class: 'facts-table' }, info.flatMap(([k, v]) => [h('dt', {}, k), h('dd', { style: { wordBreak: 'break-all' } }, v)]))),
        shutdown)),
  );
}
