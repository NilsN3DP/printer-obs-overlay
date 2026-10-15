// Kleine DOM-Helfer. Inhalte werden immer als Text gesetzt (kein innerHTML mit Daten).

/**
 * h('div', {class: 'x', onclick: fn}, 'Text', child) – erzeugt ein Element.
 * Props: class, style (Objekt), dataset, on<event>, sonst Attribut/Property.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function toast(message, kind = 'ok', ms = 3200) {
  const node = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(node);
  setTimeout(() => node.remove(), ms);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast('In die Zwischenablage kopiert');
}

export const field = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('span', { class: 'hint' }, hint) : null);

export function select(options, value, onchange) {
  return h('select', { onchange: (e) => onchange?.(e.target.value) },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
}

export function segmented(options, value, onchange) {
  const wrap = h('div', { class: 'segmented' });
  for (const [v, label] of options) {
    wrap.append(h('button', {
      type: 'button',
      class: v === value ? 'active' : '',
      onclick: () => {
        wrap.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        wrap.querySelector(`[data-v="${v}"]`).classList.add('active');
        onchange(v);
      },
      dataset: { v },
    }, label));
  }
  return wrap;
}

export function duration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s)) return '–';
  const t = Math.max(0, Math.round(s));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  return hh > 0 ? `${hh} h ${String(mm).padStart(2, '0')} min` : `${mm} min`;
}

export const STATE_LABELS = {
  IDLE: 'Bereit', READY: 'Bereit', BUSY: 'Beschäftigt', PRINTING: 'Druckt', PAUSED: 'Pausiert',
  FINISHED: 'Fertig', STOPPED: 'Abgebrochen', ERROR: 'Fehler', ATTENTION: 'Achtung', SWAPPING: 'Toolwechsel',
};

export const TYPE_LABELS = { prusalink: 'PrusaLink', octoprint: 'OctoPrint', moonraker: 'Klipper/Moonraker', demo: 'Demo' };

/** Name -> technische ID ("Core One INDX" -> "core-one-indx"). */
export const slugify = (value) => String(value || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Eigener Bestaetigungsdialog. Browser-Dialoge (confirm) werden in OBS-Docks und
 * eingebetteten Browsern oft unterdrueckt und liefern dann still "Abbrechen".
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, { ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const finish = (result) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(false);
      if (e.key === 'Enter') finish(true);
    };
    const okButton = h('button', { class: `btn ${danger ? 'danger-solid' : 'primary'}`, onclick: () => finish(true) }, ok);
    const backdrop = h('div', { class: 'wizard-backdrop', onclick: (e) => { if (e.target === backdrop) finish(false); } },
      h('div', { class: 'wizard confirm', role: 'alertdialog', 'aria-modal': 'true' },
        h('div', { class: 'wizard-body' }, h('p', { style: { margin: 0, whiteSpace: 'pre-line' } }, message)),
        h('div', { class: 'wizard-foot' },
          h('button', { class: 'btn ghost', onclick: () => finish(false) }, 'Abbrechen'),
          okButton)));
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    okButton.focus();
  });
}
