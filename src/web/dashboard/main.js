// Dashboard: Navigation, gemeinsamer Zustand und Live-Aktualisierung.
import { api } from './api.js';
import { toast } from './ui.js';
import { openWizard } from './wizard.js';
import * as overview from './views/overview.js';
import * as printers from './views/printers.js';
import * as overlay from './views/overlay.js';
import * as toolchanger from './views/toolchanger.js';
import * as system from './views/system.js';

const VIEWS = { overview, printers, overlay, toolchanger, system };

/** Gemeinsamer Zustand aller Ansichten. */
export const app = {
  config: null,
  health: null,
  system: null,
  view: null,
  /** Konfiguration speichern und alle Ansichten mit dem Ergebnis versorgen. */
  async save(next, message = 'Gespeichert') {
    try {
      app.config = await api.saveConfig(next);
      toast(message);
      refreshHealth();
      return true;
    } catch (err) {
      toast(`Speichern fehlgeschlagen: ${err.message}`, 'bad', 6000);
      return false;
    }
  },
  /** Basis-URL fuer OBS-Links (oeffentliche Adresse oder aktuelle Seite). */
  baseUrl() {
    return (app.config?.effectivePublicBaseUrl || location.origin).replace(/\/+$/, '');
  },
  hasToolchanger() {
    return (app.config?.printers || []).some((p) => p.capabilities?.toolchanger);
  },
  /** Einrichtungsassistent (erneut) starten. */
  wizard() {
    openWizard(app, () => { app.go('overview'); render(); });
  },
  go(view, params) {
    location.hash = params ? `#/${view}/${encodeURIComponent(params)}` : `#/${view}`;
  },
};

const container = document.getElementById('view');

function currentRoute() {
  const [, view = 'overview', param] = location.hash.split('/');
  return { view: VIEWS[view] ? view : 'overview', param: param ? decodeURIComponent(param) : null };
}

function render() {
  const { view, param } = currentRoute();
  app.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  document.querySelector('.tab[data-view="toolchanger"]').classList.toggle('hidden', !app.hasToolchanger());
  container.replaceChildren();
  VIEWS[view].render(container, app, param);
}

async function refreshHealth() {
  try {
    app.health = await api.health();
    VIEWS[app.view]?.onHealth?.(app.health);
  } catch {
    app.health = null;
  }
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const view = e.target.closest('.tab')?.dataset.view;
  if (view) app.go(view);
});
window.addEventListener('hashchange', render);

try {
  [app.config, app.system] = await Promise.all([api.config(), api.system()]);
  document.getElementById('version').textContent = `v${app.system.version}`;
  await refreshHealth();
  render();
  setInterval(refreshHealth, 3000);
  if (!app.config.setupDone) app.wizard();
} catch (err) {
  container.textContent = `Dashboard konnte nicht geladen werden: ${err.message}`;
}
