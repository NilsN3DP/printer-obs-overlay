// Gemeinsame Definitionen fuer Dashboard und Overlay.

/** Alle Overlay-Bereiche in Anzeige-Reihenfolge. `toolchange` = nur bei INDX/XL sinnvoll. */
export const SECTIONS = [
  { key: 'frame', label: 'Eckrahmen', group: 'Rahmen & Branding' },
  { key: 'brand', label: 'Branding', group: 'Rahmen & Branding' },
  { key: 'printerName', label: 'Druckername', group: 'Rahmen & Branding' },
  { key: 'status', label: 'Status', group: 'Druckauftrag' },
  { key: 'file', label: 'Dateiname', group: 'Druckauftrag' },
  { key: 'progress', label: 'Fortschritt', group: 'Druckauftrag' },
  { key: 'time', label: 'Zeiten', group: 'Druckauftrag' },
  { key: 'nozzle', label: 'Düse', group: 'Messwerte' },
  { key: 'bed', label: 'Bett', group: 'Messwerte' },
  { key: 'filament', label: 'Filament', group: 'Messwerte' },
  { key: 'layer', label: 'Layer', group: 'Messwerte' },
  { key: 'speed', label: 'Geschwindigkeit', group: 'Messwerte' },
  { key: 'flow', label: 'Flow', group: 'Messwerte' },
  { key: 'z', label: 'Z-Höhe', group: 'Messwerte' },
  { key: 'fanHotend', label: 'Lüfter Hotend', group: 'Messwerte' },
  { key: 'fanPrint', label: 'Lüfter Bauteil', group: 'Messwerte' },
  { key: 'changes', label: 'Toolwechsel', group: 'Toolchanger', toolchange: true },
  { key: 'tool', label: 'Aktives Tool', group: 'Toolchanger', toolchange: true },
  { key: 'slots', label: 'Slot-Leiste', group: 'Toolchanger', toolchange: true },
  { key: 'waste', label: 'Abfall', group: 'Toolchanger', toolchange: true },
];

export const SECTION_KEYS = SECTIONS.map((s) => s.key);
export const TOOLCHANGE_KEYS = SECTIONS.filter((s) => s.toolchange).map((s) => s.key);

export const SOCIALS = [
  { key: 'youtube', label: 'YouTube' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'twitch', label: 'Twitch' },
  { key: 'website', label: 'Website' },
];

export const DEFAULT_ACCENT = '#fa6831';

/**
 * Baut die Overlay-URL. Nur Abweichungen vom Standard landen in den Parametern,
 * damit der Link kurz bleibt; alles andere kommt aus dem zugewiesenen Preset.
 */
export function buildOverlayUrl(base, { printer, preset, layout, sections, accent, brand, socials } = {}) {
  const params = new URLSearchParams();
  if (printer) params.set('printer', printer);
  if (preset) params.set('preset', preset);
  if (layout) params.set('layout', layout);
  if (Array.isArray(sections)) params.set('sections', sections.length ? sections.join(',') : 'none');
  if (accent) params.set('accent', accent);
  if (brand != null && brand !== '') params.set('brand', brand);
  if (Array.isArray(socials)) params.set('socials', socials.length ? socials.join(',') : 'none');
  const query = params.toString();
  return `${String(base || '').replace(/\/+$/, '')}/overlay.html${query ? `?${query}` : ''}`;
}
