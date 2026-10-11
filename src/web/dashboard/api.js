// Zugriff auf die Server-API.

async function request(method, url, body, headers = {}) {
  const init = { method, headers: { ...headers }, cache: 'no-store' };
  if (body !== undefined) {
    if (body instanceof Blob) init.body = body;
    else {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  health: () => request('GET', '/api/health'),
  config: () => request('GET', '/api/config'),
  saveConfig: (config) => request('PUT', '/api/config', config),
  system: () => request('GET', '/api/system'),
  setAutostart: (enabled) => request('PUT', '/api/system/autostart', { enabled }),
  shutdown: () => request('POST', '/api/system/shutdown', {}),
  testPrinter: (printer) => request('POST', '/api/printers/test', printer),
  subnets: () => request('GET', '/api/discover/subnets'),
  discover: (cidr) => request('GET', `/api/discover?cidr=${encodeURIComponent(cidr)}`),
  analyze: (file) => request('POST', '/api/analyze', file, { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }),
};
