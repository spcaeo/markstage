// Fetching from the web for the Library's imports (a page's sections, the pictures they show, a list of picture
// addresses) without letting a URL reach into the server's own network. docs/SECURITY.md "Fetching from the web":
//   - http and https only, on ports 80 and 443, with no name and password in the address;
//   - every address the name resolves to must be on the public internet (no loopback, private, link-local such as
//     169.254.169.254, carrier-grade NAT, multicast, documentation or reserved ranges, IPv6 included, and no IPv4
//     hidden in an IPv6 form); the connection goes to the address that was checked, so the name cannot resolve to
//     something else in between;
//   - redirects are followed by hand, at most five, each new address checked again;
//   - a time limit for the whole fetch and a size limit on what comes back (after unzipping);
//   - a site's robots.txt is respected for pages (robotsAllow).
// `outbound` ({lookup, allow}) is a seam for tests only, handed in by createMarkstage's deps, never by config:
// `lookup` resolves names like dns.lookup, `allow(ip, port)` lets a test reach its own server on loopback.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { HttpError } from '../util.mjs';

export const USER_AGENT = 'Markstage/1 (Library import)';
const ROBOTS_TOKEN = 'markstage';

const v4 = (ip) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
const BLOCKED4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([a, bits]) => [v4(a), 2 ** (32 - bits)]);
const public4 = (ip) => {
  const n = v4(ip);
  return !BLOCKED4.some(([base, size]) => n >= base && n < base + size);
};

/** An IPv6 address as its eight 16-bit groups (an IPv4 tail and a zone are read), or null. */
function groups6(ip) {
  let s = ip.replace(/%.*$/, '');
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    if (!net.isIPv4(tail[1])) return null;
    const n = v4(tail[1]);
    s = `${s.slice(0, -tail[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const fill = rest === undefined ? [] : Array(8 - a.length - b.length).fill('0');
  const g = [...a, ...fill, ...b].map((x) => Number.parseInt(x, 16));
  return g.length === 8 && g.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? g : null;
}
const embedded4 = (hi, lo) => `${hi >>> 8}.${hi & 255}.${lo >>> 8}.${lo & 255}`;
function public6(ip) {
  const g = groups6(ip);
  if (!g) return false;
  const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);
  // IPv4 inside: mapped (::ffff:a.b.c.d) and the NAT64 prefix are judged by that IPv4; the old compatible form is not taken
  if (zeros(0, 5) && g[5] === 0xffff) return public4(embedded4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return public4(embedded4(g[6], g[7]));
  // only global unicast (2000::/3), less documentation (2001:db8::/32, 3fff::/20), the IETF block with Teredo
  // (2001::/23) and 6to4 (2002::/16), whose IPv4 inside cannot be trusted
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] < 0x0200)) return false;
  if (g[0] === 0x2002) return false;
  if (g[0] === 0x3fff && g[1] < 0x1000) return false;
  return true;
}

/** Whether an IP address is on the public internet (anything else is refused). */
export function isPublicAddress(ip) {
  if (net.isIPv4(ip)) return public4(ip);
  if (net.isIPv6(ip.replace(/%.*$/, ''))) return public6(ip);
  return false;
}

const refuse = (message) => new HttpError(400, 'unsafe-url', message);
const portOf = (u) => Number(u.port || (u.protocol === 'https:' ? 443 : 80));
const hostOf = (u) => u.hostname.replace(/^\[|\]$/g, '');
const mayReach = (ip, port, outbound) => (isPublicAddress(ip) && (port === 80 || port === 443)) || Boolean(outbound.allow?.(ip, port));

/** The address checked before anything is sent: protocol, port, no credentials, and an IP written in it. */
export function checkUrl(input, outbound = {}) {
  let u;
  try {
    u = new URL(String(input ?? '').trim());
  } catch {
    throw refuse('This is not a web address. Paste the whole address, starting with https://.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw refuse('Only http and https addresses can be fetched.');
  if (u.username || u.password) throw refuse('An address with a name and password in it cannot be fetched.');
  const port = portOf(u);
  const host = hostOf(u);
  if (net.isIP(host)) {
    if (!mayReach(host, port, outbound)) throw refuse('This address is not on the public internet, so it is not fetched.');
  } else if (port !== 80 && port !== 443 && !outbound.allow) throw refuse('Only addresses on the usual ports (80 and 443) can be fetched.');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i.test(host)) throw refuse('This address is not on the public internet, so it is not fetched.');
  return u;
}

/** dns.lookup that refuses a name when any of its addresses is not public (the connection uses a checked one). */
function vetted(port, outbound) {
  const resolve = outbound.lookup ?? dns.lookup;
  return (hostname, options, cb) => {
    resolve(hostname, { all: true, family: options?.family ?? 0 }, (err, list) => {
      if (err) return cb(err);
      const addrs = (Array.isArray(list) ? list : [{ address: list, family: net.isIP(list) }]).filter((a) => a?.address);
      if (!addrs.length) return cb(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }));
      if (addrs.some((a) => !mayReach(a.address, port, outbound))) return cb(refuse(`${hostname} points into a private network, so it is not fetched.`));
      return options?.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

function inflate(res) {
  const enc = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

const sizeOf = (n) => (n >= 1024 * 1024 ? `${Math.round(n / 1024 / 1024)} MB` : `${Math.round(n / 1024)} KB`);

function once(u, { outbound, maxBytes, deadline, accept, method = 'GET', body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const left = deadline - Date.now();
    if (left <= 0) return reject(new HttpError(504, 'timeout', `${u.host} did not answer in time.`));
    const port = portOf(u);
    const mod = u.protocol === 'https:' ? https : http;
    let done = false;
    const fail = (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.destroy();
      reject(e instanceof HttpError ? e : new HttpError(502, 'fetch-failed', `${u.host} could not be reached${e?.code ? ` (${e.code})` : ''}.`));
    };
    const req = mod.request(
      {
        method,
        host: hostOf(u),
        port,
        path: `${u.pathname}${u.search}`,
        headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Encoding': 'gzip, deflate, br', Host: u.host, ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
        lookup: vetted(port, outbound),
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && method === 'GET') {
          res.resume();
          done = true;
          clearTimeout(timer);
          return resolve({ status, location: String(res.headers.location), headers: res.headers });
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) return fail(new HttpError(413, 'too-large', `${u.host} sends more than ${sizeOf(maxBytes)}, so it is not fetched.`));
        const chunks = [];
        let size = 0;
        const body = inflate(res);
        res.on('error', fail);
        body.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) return fail(new HttpError(413, 'too-large', `${u.host} sends more than ${sizeOf(maxBytes)}, so it is not fetched.`));
          chunks.push(c);
          return undefined;
        });
        body.on('error', fail);
        body.on('end', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks) });
        });
      },
    );
    const timer = setTimeout(() => fail(new HttpError(504, 'timeout', `${u.host} did not answer in time.`)), left);
    req.on('error', fail);
    req.end(body ?? undefined);
  });
}

/**
 * POST to a public web address through the same guard (a webhook): {status, headers, body}. A redirect is never
 * followed (its status is the answer), so a signed body goes only where it was sent.
 */
export async function safePost(input, { body, headers = {}, maxBytes = 64 * 1024, timeoutMs = 10_000, outbound = {} } = {}) {
  const u = checkUrl(input, outbound);
  return once(u, { outbound, maxBytes, deadline: Date.now() + timeoutMs, accept: '*/*', method: 'POST', body, headers });
}

/**
 * GET a public web address: {url (after redirects), status, type, headers, body: Buffer}. Refused (400 unsafe-url)
 * before anything is sent when the address is not public; 413 when too large, 504 when too slow, 502 otherwise.
 * `headers` (a sign-in, say) go to the first address's origin only: a redirect elsewhere is asked without them.
 */
export async function safeFetch(input, { maxBytes = 5 * 1024 * 1024, timeoutMs = 10_000, maxRedirects = 5, accept = '*/*', outbound = {}, headers = {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let u = checkUrl(input, outbound);
  const origin = u.origin;
  for (let hop = 0; ; hop++) {
    const r = await once(u, { outbound, maxBytes, deadline, accept, headers: u.origin === origin ? headers : {} });
    if (r.location !== undefined) {
      if (hop >= maxRedirects) throw new HttpError(502, 'fetch-failed', `${u.host} redirects too many times.`);
      let next;
      try {
        next = new URL(r.location, u);
      } catch {
        throw new HttpError(502, 'fetch-failed', `${u.host} redirects to an address that cannot be read.`);
      }
      u = checkUrl(next.href, outbound);
      continue;
    }
    return { url: u.href, status: r.status, type: String(r.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), headers: r.headers, body: r.body };
  }
}

const MAX_RULES = 1000;
const MAX_RULE = 2048;

/**
 * The rules of a robots.txt for our name (else for `*`): [{allow, path}]. At most 1000 rules are read, and a rule
 * longer than 2048 characters is skipped, so a hostile file cannot make the matching slow.
 */
export function robotsRules(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  let count = 0;
  for (const raw of String(text).split(/\r?\n|\r/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !cur) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (cur && (key === 'allow' || key === 'disallow') && val.length <= MAX_RULE && count < MAX_RULES) {
      cur.rules.push({ allow: key === 'allow', path: val });
      count++;
    }
  }
  const ours = groups.filter((g) => g.agents.some((a) => a.replace(/\/.*$/, '') === ROBOTS_TOKEN));
  const pick = ours.length ? ours : groups.filter((g) => g.agents.includes('*'));
  return pick.flatMap((g) => g.rules);
}

/**
 * Whether a robots.txt path pattern matches a path: `*` is any run of characters, a final `$` is "ends here", else
 * it is a prefix. Matched piece by piece with indexOf (no regular expression), so it takes linear time whatever the
 * pattern: each piece found leftmost after the one before is a match whenever any match exists.
 */
export function robotsMatch(pattern, p) {
  const anchored = pattern.endsWith('$');
  const pieces = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  if (!p.startsWith(pieces[0])) return false;
  if (pieces.length === 1) return anchored ? p === pieces[0] : true;
  let at = pieces[0].length;
  for (let i = 1; i < pieces.length - 1; i++) {
    if (!pieces[i]) continue;
    const found = p.indexOf(pieces[i], at);
    if (found < 0) return false;
    at = found + pieces[i].length;
  }
  const last = pieces[pieces.length - 1];
  if (anchored) return p.length - last.length >= at && p.endsWith(last);
  return p.indexOf(last, at) >= 0;
}

/** Whether a path (with its query) may be fetched under these rules: the longest match wins, Allow on a tie. */
export function robotsAllows(rules, pathAndQuery) {
  let best = null;
  for (const r of rules) {
    if (!r.path || !robotsMatch(r.path, pathAndQuery)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

/**
 * Whether the site's robots.txt lets us fetch this page. No robots.txt (4xx) allows; a robots.txt that cannot be
 * read (5xx, no answer) refuses, in words, as the robots rules ask.
 */
export async function robotsAllow(input, { outbound = {}, timeoutMs = 5000 } = {}) {
  const u = checkUrl(input, outbound);
  let r;
  try {
    r = await safeFetch(new URL('/robots.txt', u).href, { maxBytes: 512 * 1024, timeoutMs, accept: 'text/plain', outbound });
  } catch (e) {
    if (e.code === 'unsafe-url') throw e;
    return { allowed: false, why: `${u.host}/robots.txt could not be read (${e.message.replace(/\.$/, '')}), so the page is not fetched. Try again later.` };
  }
  if (r.status >= 400 && r.status < 500) return { allowed: true };
  if (r.status >= 500 || r.status < 200) return { allowed: false, why: `${u.host}/robots.txt answered ${r.status}, so the page is not fetched. Try again later.` };
  const ok = robotsAllows(robotsRules(r.body.toString('utf8')), `${u.pathname}${u.search}`);
  return ok ? { allowed: true } : { allowed: false, why: `${u.host} asks robots not to fetch ${u.pathname} (its robots.txt), so it is not imported.` };
}
