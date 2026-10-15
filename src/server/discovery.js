// Netzwerksuche nach PrusaLink-, OctoPrint- und Moonraker-Druckern.
//  1. mDNS (Bonjour): Prusa-Drucker melden sich als _prusalink._tcp mit Namen wie
//     "prusa-core-one-l" – sofort und ohne Zugangsdaten. Falls Multicast blockiert ist
//     (Firewall, VPN), hilft zusaetzlich:
//  2. Scan des /24-Netzes: kurzer TCP-Test, dann Erkennung am Antwortverhalten. Den Namen
//     liefert eine gezielte mDNS-Rueckfrage an das Geraet.
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import { inferModel } from './config/models.js';

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
// Virtuelle Adapter (VirtualBox, Hyper-V/WSL, VMware, Docker) sind keine Drucker-Netze.
const VIRTUAL_IFACE = /virtualbox|vbox|vethernet|hyper-v|wsl|vmware|vmnet|docker|^br-|^veth|^virbr|tailscale|zerotier/i;
// Hersteller-Praefixe virtueller Netzwerkkarten: VirtualBox, Hyper-V, VMware, Docker.
const VIRTUAL_MAC = /^(08:00:27|0a:00:27|00:15:5d|00:50:56|00:0c:29|00:05:69|00:1c:14|02:42)/i;
const MDNS = { address: '224.0.0.251', port: 5353 };

/** Private IPv4-Netze dieses Rechners als /24-Vorschlaege. */
export function localSubnets() {
  const nets = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_IFACE.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || !PRIVATE.test(a.address) || VIRTUAL_MAC.test(a.mac)) continue;
      const cidr = `${a.address.split('.').slice(0, 3).join('.')}.0/24`;
      if (!nets.includes(cidr)) nets.push(cidr);
    }
  }
  return nets.sort((a, b) => Number(a.startsWith('172.')) - Number(b.startsWith('172.')));
}

/** Netz des aufrufenden Browsers als Vorschlag fuer die Suche. */
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

// ---------- mDNS ----------

function encodeName(name) {
  const labels = name.split('.').filter(Boolean).map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));
  return Buffer.concat([...labels, Buffer.from([0])]);
}

export function mdnsQuery(name, type) {
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1, 2); // Klasse IN
  return Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]), encodeName(name), tail]);
}

function readName(buf, offset) {
  const labels = [];
  let off = offset;
  let end = null;
  for (let guard = 0; guard < 64 && off < buf.length; guard++) {
    const len = buf[off];
    if (len === 0) { end ??= off + 1; break; }
    if ((len & 0xc0) === 0xc0) {
      end ??= off + 2;
      off = ((len & 0x3f) << 8) | buf[off + 1];
      continue;
    }
    labels.push(buf.toString('utf8', off + 1, off + 1 + len));
    off += len + 1;
  }
  return [labels.join('.'), end ?? off];
}

/** Antwort-Records (PTR, A) einer DNS-Nachricht. */
export function mdnsRecords(buf) {
  const records = [];
  const questions = buf.readUInt16BE(4);
  const count = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let off = 12;
  for (let i = 0; i < questions; i++) off = readName(buf, off)[1] + 4;
  for (let i = 0; i < count && off + 10 <= buf.length; i++) {
    const [name, o] = readName(buf, off);
    const type = buf.readUInt16BE(o);
    const len = buf.readUInt16BE(o + 8);
    const data = o + 10;
    if (type === 12) records.push({ name, type: 'PTR', value: readName(buf, data)[0] });
    if (type === 1 && len === 4) records.push({ name, type: 'A', value: [...buf.subarray(data, data + 4)].join('.') });
    off = data + len;
  }
  return records;
}

const hostLabel = (name) => String(name || '').replace(/\.local$/i, '').replace(/\._prusalink\._tcp$/i, '');

/** Gezielte mDNS-Rueckfrage an ein Geraet: IP -> Hostname (z. B. "prusa-mk4"). */
export function mdnsHostname(ip, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const done = (value) => { clearTimeout(timer); socket.close(); resolve(value); };
    const timer = setTimeout(() => done(null), timeoutMs);
    socket.on('error', () => done(null));
    socket.on('message', (msg) => {
      try {
        const ptr = mdnsRecords(msg).find((r) => r.type === 'PTR' && r.name.endsWith('in-addr.arpa'));
        if (ptr) done(hostLabel(ptr.value));
      } catch {
        // kaputte Antwort ignorieren
      }
    });
    const reverse = `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
    socket.send(mdnsQuery(reverse, 12), MDNS.port, ip, (err) => { if (err) done(null); });
  });
}

/** Multicast-Abfrage nach Prusa-Druckern im lokalen Netz. */
export function mdnsBrowsePrusa(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const found = new Map(); // ip -> name
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const finish = () => { try { socket.close(); } catch { /* schon zu */ } resolve([...found].map(([ip, name]) => ({ ip, name }))); };
    socket.on('error', finish);
    socket.on('message', (msg) => {
      try {
        const records = mdnsRecords(msg);
        const instances = records.filter((r) => r.type === 'PTR' && r.name === '_prusalink._tcp.local').map((r) => hostLabel(r.value));
        const addresses = records.filter((r) => r.type === 'A');
        for (const a of addresses) {
          const name = hostLabel(a.name);
          if (instances.includes(name) || instances.length === 0 && /prusa/i.test(name)) found.set(a.value, name);
        }
      } catch {
        // ignorieren
      }
    });
    socket.bind(0, () => {
      socket.send(mdnsQuery('_prusalink._tcp.local', 12), MDNS.port, MDNS.address, () => {});
      setTimeout(finish, timeoutMs);
    });
  });
}

// ---------- Scan ----------

function portOpen(host, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
  const text = await res.text().catch(() => '');
  return { status: res.status, headers: res.headers, text };
}

/** Erkennt anhand der Antworten, ob und welcher Drucker-Dienst laeuft. */
async function identify(ip) {
  const [p80, p7125, p5000] = await Promise.all([portOpen(ip, 80), portOpen(ip, 7125), portOpen(ip, 5000)]);
  try {
    if (p80) {
      const r = await get(`http://${ip}/api/v1/status`);
      const realm = r.headers.get('www-authenticate') || '';
      if ((r.status === 401 && /Printer API/i.test(realm)) || (r.status === 200 && /"printer"/.test(r.text))) {
        return { host: ip, type: 'prusalink' };
      }
    }
    if (p7125) {
      const r = await get(`http://${ip}:7125/server/info`);
      if (/klippy|moonraker/i.test(r.text)) return { host: `${ip}:7125`, type: 'moonraker' };
    }
    for (const port of [p80 && 80, p5000 && 5000].filter(Boolean)) {
      const base = `http://${ip}${port === 80 ? '' : `:${port}`}`;
      const r = await get(`${base}/api/version`);
      if (/airtunes|airplay/i.test(r.headers.get('server') || '')) continue;
      const isOcto = /octoprint/i.test(r.text) || ((r.status === 401 || r.status === 403) && /octoprint/i.test((await get(`${base}/`)).text));
      if (isOcto) return { host: port === 80 ? ip : `${ip}:${port}`, type: 'octoprint' };
    }
  } catch {
    // Geraet antwortet nicht sinnvoll
  }
  return null;
}

/** Ergebnis um Namen und vermutetes Modell ergaenzen. */
async function describe(item, knownName) {
  const ip = item.host.split(':')[0];
  const name = knownName || await mdnsHostname(ip);
  const model = name ? inferModel({ name: name.replace(/-/g, ' ') }) : 'custom';
  return { ...item, name: name || null, model };
}

export async function discover(cidr, { concurrency = 64 } = {}) {
  const hosts = hostsFromCidr(cidr);
  if (!hosts.length) throw new Error('Bitte ein /24-Netz angeben, z. B. 192.168.1.0/24');

  const viaMdns = await mdnsBrowsePrusa().catch(() => []);
  const names = new Map(viaMdns.map((d) => [d.ip, d.name]));

  const found = [];
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < hosts.length) {
      const result = await identify(hosts[next++]);
      if (result) found.push(result);
    }
  }));
  // Per mDNS gefundene Prusa-Drucker auch dann aufnehmen, wenn der Scan sie verpasst hat.
  for (const { ip } of viaMdns) {
    if (hosts.includes(ip) && !found.some((f) => f.host === ip)) found.push({ host: ip, type: 'prusalink' });
  }

  const described = await Promise.all(found.map((f) => describe(f, names.get(f.host.split(':')[0]))));
  return described.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}
