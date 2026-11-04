// An approximate location for a form message (docs/DEPLOY.md "Forms"), from the visitor's address and a city
// database on this server: any MaxMind DB City file (.mmdb), such as DB-IP's free "IP to City Lite" (CC BY 4.0, no
// account needed) or MaxMind's GeoLite2 City. Optional: without the file, messages have no location. Nothing is
// asked of anyone else, and the browser is never trusted for it. Looked up when the message comes in; only the place
// ("Toronto, Ontario, Canada") is kept with it.
//   config.json "geoip": {"file": "<path>.mmdb"}   default <dataDir>/geoip/city.mmdb when it is there
//   markstage-server geoip update <url|file>      fetch or copy a city file into place, checked first
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MmdbError, openMmdb } from './mmdb.mjs';

const RECHECK_MS = 60_000;
const MAX_BYTES = 512 * 1024 * 1024;

/** Where the city file is: config geoip.file (relative to the data dir), else <dataDir>/geoip/city.mmdb. */
export const geoFileOf = (config) => path.resolve(config.dataDir, config.geoip?.file ?? path.join('geoip', 'city.mmdb'));

/** "City, Region, Country" from a record in either schema (MaxMind's or DB-IP's: the same names.en keys). */
export function placeOf(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const name = (x) => (x && typeof x === 'object' ? (x.names?.en ?? (typeof x.names === 'object' ? Object.values(x.names)[0] : null)) : null);
  const parts = [name(rec.city), name(rec.subdivisions?.[0]), name(rec.country) ?? rec.country?.iso_code ?? null].filter((p) => typeof p === 'string' && p.trim());
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.length ? unique.join(', ').slice(0, 200) : null;
}

/** The parts a CRM wants (Odoo's city, state by name, country by code): {city, region, countryCode}, or null. */
export function partsOf(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const name = (x) => (x && typeof x === 'object' ? (x.names?.en ?? (typeof x.names === 'object' ? Object.values(x.names)[0] : null)) : null);
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);
  const parts = { city: str(name(rec.city)), region: str(name(rec.subdivisions?.[0])), countryCode: str(rec.country?.iso_code)?.toUpperCase() ?? null };
  return parts.city || parts.region || parts.countryCode ? parts : null;
}

const attributionOf = (meta) => (/db-?ip/i.test(`${meta?.database_type ?? ''} ${JSON.stringify(meta?.description ?? '')}`) ? 'IP Geolocation by DB-IP (https://db-ip.com), CC BY 4.0' : null);

export function createGeo(config) {
  const file = geoFileOf(config);
  let db = null;
  let stamp = null;
  let checked = 0;
  let problem = null;

  /** (Re)open the file when it appeared or changed (a `geoip update` while the server runs). */
  function current(now = Date.now()) {
    if (now - checked < RECHECK_MS && (db || problem || stamp === 'none')) return db;
    checked = now;
    let st = null;
    try {
      st = fs.statSync(file);
    } catch {
      db?.close();
      db = null;
      stamp = 'none';
      problem = null;
      return null;
    }
    const next = `${st.size}:${st.mtimeMs}`;
    if (next === stamp) return db;
    db?.close();
    db = null;
    stamp = next;
    try {
      db = openMmdb(file);
      problem = null;
    } catch (e) {
      problem = e.message;
      console.error(`[markstage] the city database ${file} could not be opened (${e.message}); messages get no location`);
    }
    return db;
  }

  return {
    /** The approximate place of an address, or null (no database, not in it, a private address). */
    locate(ip) {
      return this.where(ip)?.place ?? null;
    },
    /** The place and its parts: {place, city, region, countryCode}, or null. */
    where(ip) {
      const d = current();
      if (!d || !ip) return null;
      try {
        const rec = d.get(ip);
        const place = placeOf(rec);
        return place ? { place, ...(partsOf(rec) ?? { city: null, region: null, countryCode: null }) } : null;
      } catch (e) {
        console.error(`[markstage] city lookup failed: ${e.message}`);
        return null;
      }
    },
    status() {
      const d = current();
      if (!d) return { on: false, file, problem };
      const m = d.metadata;
      return { on: true, file, type: m.database_type ?? null, builtAt: m.build_epoch ? new Date(Number(m.build_epoch) * 1000).toISOString() : null, attribution: attributionOf(m) };
    },
    close() {
      db?.close();
      db = null;
    },
  };
}

/**
 * Put a city file in place from a URL (https; http only for this machine) or a local file, gzip or not: checked to be
 * a MaxMind DB with city records before it replaces the old one. Returns {file, type, builtAt, bytes, attribution}.
 */
export async function installGeo(config, source, { fetchImpl = fetch } = {}) {
  const dest = geoFileOf(config);
  let buf;
  if (/^https?:\/\//i.test(source)) {
    const u = new URL(source);
    if (u.protocol === 'http:' && !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) throw new Error('Use an https:// address (http only for this machine).');
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(600_000), redirect: 'follow' });
    if (!res.ok) throw new Error(`${u.host} answered ${res.status}.`);
    const chunks = [];
    let n = 0;
    for await (const c of res.body) {
      n += c.length;
      if (n > MAX_BYTES) throw new Error(`The file is larger than ${MAX_BYTES / 1024 / 1024} MB; not a city database.`);
      chunks.push(c);
    }
    buf = Buffer.concat(chunks);
  } else {
    buf = fs.readFileSync(path.resolve(source));
  }
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf, { maxOutputLength: MAX_BYTES });
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf, { mode: 0o600 });
  let meta;
  try {
    const d = openMmdb(tmp);
    meta = d.metadata;
    d.close();
    if (!/city/i.test(String(meta.database_type ?? ''))) throw new MmdbError(`it is a "${meta.database_type}" database, not a City one`);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Not a city database: ${e.message}.`);
  }
  fs.renameSync(tmp, dest);
  return { file: dest, type: meta.database_type, builtAt: meta.build_epoch ? new Date(Number(meta.build_epoch) * 1000).toISOString() : null, bytes: buf.length, attribution: attributionOf(meta) };
}
