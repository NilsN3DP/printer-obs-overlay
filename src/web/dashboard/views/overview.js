// Uebersicht: Live-Karten aller Drucker mit Status, Fortschritt und OBS-Link.
import { buildOverlayUrl } from '../../shared/sections.js';
import { STATE_LABELS, TYPE_LABELS, duration, h } from '../ui.js';

let grid = null;
let summary = null;
let appRef = null;

export function render(container, app) {
  appRef = app;
  summary = h('p', {}, '');
  grid = h('div', { class: 'printer-grid' });
  container.append(
    h('div', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'Übersicht'), summary),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => app.go('printers', 'new') }, '+ Drucker hinzufügen'),
        h('button', { class: 'btn primary', onclick: () => app.go('overlay') }, 'Overlay & OBS einrichten'))),
    grid,
  );
  if (app.health) onHealth(app.health);
}

function metaLine(p) {
  const m = p.meta;
  if (!m || m.state === 'idle' || p.type !== 'prusalink') return null;
  if (m.state === 'ready') return h('div', { class: 'meta-line' }, 'Toolwechsel/Layer aus Druckdatei: bereit');
  if (m.state === 'downloading') {
    const mb = (b) => (b / 1048576).toFixed(1);
    const of = m.total ? ` von ${mb(m.total)} MB` : '';
    return h('div', { class: 'meta-line' }, `Druckdatei wird analysiert … ${mb(m.bytes)} MB${of} (PrusaLink liefert während des Drucks langsam)`);
  }
  return h('div', { class: 'meta-line', style: { color: 'var(--warn)' } }, `Dateianalyse fehlgeschlagen, neuer Versuch folgt: ${m.error || ''}`);
}

function card(p) {
  const badge = p.virtual
    ? h('span', { class: 'badge warn' }, 'Demo')
    : p.connected ? h('span', { class: 'badge ok' }, 'Online') : h('span', { class: 'badge bad' }, 'Offline');
  const url = buildOverlayUrl(appRef.baseUrl(), { printer: p.id });

  const progress = typeof p.progress === 'number' ? Math.max(0, Math.min(100, p.progress)) : null;
  const job = p.connected
    ? h('div', { class: 'pcard-job' },
      h('div', { class: 'row between' },
        h('span', { class: 'muted' }, STATE_LABELS[p.state] || p.state || 'Unbekannt'),
        progress !== null ? h('strong', {}, `${Math.round(progress)} %`) : null),
      h('div', { class: 'file', title: p.file || '' }, p.file || 'Kein aktiver Druck'),
      h('div', { class: 'progress' }, h('span', { style: { width: `${progress ?? 0}%` } })),
      p.timeRemaining != null && progress !== null && progress < 100
        ? h('div', { class: 'facts' },
          h('span', {}, `noch ${duration(p.timeRemaining)}`),
          h('span', {}, `fertig ca. ${new Date(Date.now() + p.timeRemaining * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`))
        : null,
      metaLine(p))
    : h('div', { class: 'err' }, p.error || 'Nicht erreichbar');

  return h('article', { class: 'card pcard' },
    h('div', { class: 'pcard-head' },
      h('div', {},
        h('div', { class: 'pcard-title' }, p.name),
        h('div', { class: 'pcard-meta' }, [p.capabilities?.name, TYPE_LABELS[p.type], p.host].filter(Boolean).join(' · '))),
      badge),
    job,
    h('div', { class: 'pcard-foot' },
      h('a', { class: 'btn sm', href: url, target: '_blank', rel: 'noreferrer' }, 'Overlay ansehen'),
      p.virtual ? null : h('button', { class: 'btn sm ghost', onclick: () => appRef.go('printers', p.id) }, 'Bearbeiten')));
}

export function onHealth(health) {
  if (!grid?.isConnected) return;
  const list = health.printers || [];
  const real = list.filter((p) => !p.virtual);
  const online = real.filter((p) => p.connected).length;
  summary.textContent = real.length
    ? `${online} von ${real.length} Drucker${real.length === 1 ? '' : 'n'} online`
    : 'Noch kein eigener Drucker eingerichtet';

  const nodes = list.map(card);
  if (!real.length) {
    nodes.unshift(h('div', { class: 'card empty', style: { gridColumn: '1 / -1' } },
      h('h2', {}, 'Willkommen!'),
      h('p', {}, 'Füge deinen ersten Drucker hinzu – PrusaLink, OctoPrint oder Klipper. ',
        list.length ? 'Bis dahin zeigt der Demo-Drucker, wie das Overlay aussieht.' : ''),
      h('button', { class: 'btn primary', onclick: () => appRef.go('printers', 'new') }, 'Drucker hinzufügen')));
  }
  grid.replaceChildren(...nodes);
}
