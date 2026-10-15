// Druckermodelle und ihre Faehigkeiten. Steuert, welche Overlay-Bereiche und
// Editorfelder (Slotplan, Toolchanger-Analyse) fuer einen Drucker sinnvoll sind.

export const PRINTER_TYPES = ['prusalink', 'octoprint', 'moonraker', 'demo'];

export const PRINTER_MODELS = [
  { id: 'custom', name: 'Anderer Drucker', toolchanger: false, indx: false, xl: false, slots: 0 },
  { id: 'mini', name: 'Prusa MINI / MINI+', toolchanger: false, indx: false, xl: false, slots: 0 },
  { id: 'mk35', name: 'Prusa MK3.5', toolchanger: false, indx: false, xl: false, slots: 0 },
  { id: 'mk4', name: 'Prusa MK4', toolchanger: false, indx: false, xl: false, slots: 0 },
  { id: 'mk4s', name: 'Prusa MK4S', toolchanger: false, indx: false, xl: false, slots: 0 },
  { id: 'coreone', name: 'Prusa Core One', toolchanger: false, indx: false, xl: false, slots: 0 },
  { id: 'coreone-l', name: 'Prusa Core One L', toolchanger: false, indx: false, xl: false, slots: 0 },
  { id: 'coreone-indx', name: 'Prusa Core One INDX', toolchanger: true, indx: true, xl: false, slots: 8, base: 'coreone' },
  { id: 'coreone-l-indx', name: 'Prusa Core One L INDX', toolchanger: true, indx: true, xl: false, slots: 8, base: 'coreone-l' },
  { id: 'xl-1t', name: 'Prusa XL 1 Tool', toolchanger: false, indx: false, xl: true, slots: 0 },
  { id: 'xl-2t', name: 'Prusa XL 2 Tool', toolchanger: true, indx: false, xl: true, slots: 2, base: 'xl-1t' },
  { id: 'xl-5t', name: 'Prusa XL 5 Tool', toolchanger: true, indx: false, xl: true, slots: 5, base: 'xl-1t' },
];

export function modelById(id) {
  return PRINTER_MODELS.find((m) => m.id === id) || PRINTER_MODELS[0];
}

/** Rät das Modell aus ID/Name, wenn eine alte Konfiguration kein `model` enthält. */
export function inferModel(printer) {
  const explicit = printer?.model || printer?.printerModel;
  if (explicit && PRINTER_MODELS.some((m) => m.id === explicit)) return explicit;
  const text = `${printer?.id || ''} ${printer?.name || ''}`.toLowerCase();
  const isL = /\bl\b|core\s*one\s*l|coreone-?l/.test(text);
  if (text.includes('xl') && text.includes('5')) return 'xl-5t';
  if (text.includes('xl') && text.includes('2')) return 'xl-2t';
  if (text.includes('xl')) return 'xl-1t';
  if (text.includes('indx')) return isL ? 'coreone-l-indx' : 'coreone-indx';
  if (text.includes('core') && text.includes('one')) return isL ? 'coreone-l' : 'coreone';
  if (text.includes('mk4s')) return 'mk4s';
  if (text.includes('mk4')) return 'mk4';
  if (text.includes('mk3.5') || text.includes('mk35')) return 'mk35';
  if (text.includes('mini')) return 'mini';
  return 'custom';
}
