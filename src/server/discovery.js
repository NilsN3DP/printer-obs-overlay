// Netzwerksuche: durchsucht ein /24-Netz nach PrusaLink, OctoPrint und Moonraker.
import os from 'node:os';

const PROBES = [
  { type: 'moonraker', port: 7125, path: '/server/info' },
  { type: 'prusalink', port: 80, path: '/api/v1/status' },
  { type: 'octoprint', port: 80, path: '/api/version' },
  { type: 'octoprint', port: 5000, path: '/api/version' },
];
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Private IPv4-Netze dieses Rechners als /24-Vorschlaege (Docker-Bridges zuletzt). */
export function localSubnets() {
  const nets = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || !PRIVATE.test(a.address)) continue;
      const cidr = `${a.address.split('.').slice(0, 3).join('.')}.0/24`;
      if (!nets.includes(cidr)) nets.push(cidr);
    }
  }
  return nets.sort((a, b) => Number(a.startsWith('172.')) - Number(b.startsWith('172.')));
}

/** Netz des aufrufenden Browsers – im Docker-Betrieb meist das richtige LAN. */
export function subnetOf(remoteAddress = '') {
  const ip = String(remoteAddress).replace(/^::ffff:/, '');
  if (!PRIVATE.test(ip) || ip.startsWith('172.17.')) return null;
  return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
}

export function hostsFromCidr(cidr) {
  const m = String(cidr || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.0\/24$/);
  if (!m || m.slice(1).some((o) => Number(o) > 255)) return [];
  const prefix = `${m[1]}.${m[2]}.${m[3]}`;
  return Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
}

async function probeHost(host) {
  for (const probe of PROBES) {
    try {
      const res = await fetch(`http://${host}:${probe.port}${probe.path}`, { signal: AbortSignal.timeout(800) });
      await res.body?.cancel().catch(() => {});
      if ([200, 401, 403].includes(res.status)) {
        return { host: probe.port === 80 ? host : `${host}:${probe.port}`, type: probe.type };
      }
    } catch {
      // naechste Probe
    }
  }
  return null;
}

export async function discover(cidr, concurrency = 32) {
  const hosts = hostsFromCidr(cidr);
  if (!hosts.length) throw new Error('Bitte ein /24-Netz angeben, z. B. 192.168.1.0/24');
  const found = [];
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < hosts.length) {
      const result = await probeHost(hosts[next++]);
      if (result) found.push(result);
    }
  }));
  return found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}
