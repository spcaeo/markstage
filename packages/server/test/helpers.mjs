// Test fixtures: a throwaway Astro-like site repo (with a fake build, deploy and content check), a data dir, a server
// on an ephemeral 127.0.0.1 port, and an HTTP client with a cookie jar and the CSRF token.
// Test users get random passwords generated per run; nothing here is a real credential.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { hashPassword } from '../src/auth/passwords.mjs';
import * as stubCore from './stub-core.mjs';

process.removeAllListeners('warning');

// scratch space outside the repo (MARKSTAGE_TEST_TMP overrides)
export const TMP_ROOT = process.env.MARKSTAGE_TEST_TMP ?? path.join(os.tmpdir(), 'markstage-server-tests');

export const testPassword = () => `T3st-${crypto.randomBytes(12).toString('base64url')}`;

const BUILD = `// fake site build: every live post into dist/index.json (drafts and future publishAt left out)
import fs from 'node:fs';
const now = Date.parse(process.env.MARKSTAGE_BUILD_TIME ?? new Date().toISOString());
if (process.env.FAIL_MARKER && fs.existsSync(process.env.FAIL_MARKER + '.build')) { console.error('build exploded'); process.exit(2); }
const live = [];
fs.rmSync('dist-private', { recursive: true, force: true });
for (const f of fs.readdirSync('src/content/blog').filter((f) => f.endsWith('.md')).sort()) {
  const t = fs.readFileSync('src/content/blog/' + f, 'utf8');
  if (/^draft: true$/m.test(t)) continue;
  const at = /^publishAt: "?([^"\\n]+)"?$/m.exec(t);
  if (at && Date.parse(at[1]) > now) continue;
  const id = f.replace(/\\.md$/, '');
  // protected pages go to the private output only (never the public one, sitemap or feeds)
  if (/^protected: true$/m.test(t)) {
    fs.mkdirSync('dist-private/blog/' + id, { recursive: true });
    fs.writeFileSync('dist-private/blog/' + id + '/index.html', '<!doctype html><title>' + id + '</title><p>SECRET BODY ' + id + '</p>');
    continue;
  }
  live.push(id);
}
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.json', JSON.stringify(live));
console.log('built ' + live.length + ' posts');
`;

const DEPLOY = `// fake atomic deploy: copy dist to a temp dir next to the live dir, then rename over it
import fs from 'node:fs';
const live = process.env.LIVE_DIR;
if (process.env.FAIL_MARKER && fs.existsSync(process.env.FAIL_MARKER + '.deploy')) { console.error('deploy refused'); process.exit(3); }
const tmp = live + '.tmp-' + process.pid;
fs.mkdirSync(tmp, { recursive: true });
fs.copyFileSync('dist/index.json', tmp + '/index.json');
fs.rmSync(live, { recursive: true, force: true });
fs.renameSync(tmp, live);
console.log('deployed');
`;

const CHECK = `// fake content check: reads the entry on stdin; "FORBIDDEN-WORD" is a blocking error
let text = '';
process.stdin.on('data', (d) => (text += d));
process.stdin.on('end', () => {
  if (text.includes('FORBIDDEN-WORD')) {
    console.log(JSON.stringify({ issues: [{ severity: 'error', message: 'Remove FORBIDDEN-WORD', line: 1 }] }));
    process.exit(1);
  }
  console.log(JSON.stringify({ issues: [] }));
});
`;

const WARN_CHECK = `let t='';process.stdin.on('data',d=>t+=d);process.stdin.on('end',()=>{if(t.includes('TODO')){console.log('has a TODO');process.exit(1)}});`;

export const POSTS = {
  'hello-world': `---\ntitle: Hello World\nauthor: alice\ndate: '2026-01-02T10:00:00.000Z'\nmodified: '2026-01-03T10:00:00.000Z'\ncluster: basics\ntags:\n  - intro\n  - news\nexcerpt: The first post.\n---\n\n# Hello\n\nFirst paragraph.\n\nSecond paragraph.\n`,
  'bob-draft': `---\ntitle: Bob Draft\nauthor: bob\ndate: '2026-02-01T10:00:00.000Z'\nmodified: '2026-02-05T10:00:00.000Z'\ntags:\n  - news\ndraft: true\n---\n\nA draft by Bob.\n`,
  'carol-draft': `---\ntitle: Carol Draft\nauthor: carol\ndate: '2026-02-02T10:00:00.000Z'\nmodified: '2026-02-06T10:00:00.000Z'\ndraft: true\n---\n\nCarol writes.\n\n<div class="legacy">old html</div>\n`,
  'with-html': `---\ntitle: With HTML\nauthor: alice\ndate: '2026-01-05T10:00:00.000Z'\nmodified: '2026-01-06T10:00:00.000Z'\n---\n\nIntro.\n\n<div class="box">Boxed</div>\n`,
};

export const PAGES = {
  about: '{\n  "title": "About",\n  "uri": "/about/",\n  "sections": [\n    {\n      "discriminant": "hero",\n      "value": {\n        "heading": "We are here"\n      }\n    }\n  ]\n}\n',
};

/** Make a tiny 2x2 PNG (real, decodable), optionally with bytes appended after IEND. */
export function makePng(extra = Buffer.alloc(0)) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)), extra]);
}

/** A stand-in codec: returns a fresh PNG (proves the stored bytes are the codec's output, not the upload). */
export const fakeCodec = {
  name: 'fake',
  calls: 0,
  async reencode(buf, { type }) {
    this.calls++;
    if (type !== 'image/png') throw new Error('fake codec only does PNG');
    return { buffer: makePng(), type, width: 2, height: 2 };
  },
};

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd, encoding: 'utf8' });

/** Create a fresh site repo + data dir; returns their paths. */
export function makeFixture({ checks = true } = {}) {
  const run = path.join(TMP_ROOT, `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  const site = path.join(run, 'site');
  const data = path.join(run, 'data');
  for (const d of ['src/content/blog', 'src/content/pages', 'src/assets/uploads', 'scripts']) fs.mkdirSync(path.join(site, d), { recursive: true });
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  for (const [id, text] of Object.entries(POSTS)) fs.writeFileSync(path.join(site, 'src/content/blog', `${id}.md`), text);
  for (const [id, text] of Object.entries(PAGES)) fs.writeFileSync(path.join(site, 'src/content/pages', `${id}.json`), text);
  fs.writeFileSync(path.join(site, 'scripts/build.mjs'), BUILD);
  fs.writeFileSync(path.join(site, 'scripts/deploy.mjs'), DEPLOY);
  fs.writeFileSync(path.join(site, 'scripts/check.mjs'), CHECK);
  fs.writeFileSync(path.join(site, 'scripts/warn.mjs'), WARN_CHECK);
  fs.writeFileSync(path.join(site, '.gitignore'), 'dist/\ndist-private/\n');
  fs.writeFileSync(path.join(site, 'secret.txt'), 'not content\n');
  fs.writeFileSync(path.join(site, 'package.json'), '{ "name": "fixture-site", "private": true, "type": "module" }\n');
  git(site, 'init', '-q', '-b', 'main');
  git(site, 'add', '-A');
  git(site, 'commit', '-q', '-m', 'Fixture site');
  const live = path.join(run, 'live');
  const config = {
    contentRoot: site,
    commands: {
      build: [process.execPath, 'scripts/build.mjs'],
      deploy: [process.execPath, 'scripts/deploy.mjs'],
      timeoutSeconds: 60,
      env: { LIVE_DIR: live, FAIL_MARKER: path.join(run, 'fail') },
    },
    checks: checks
      ? [
          { id: 'words', label: 'Forbidden words', command: [process.execPath, 'scripts/check.mjs'], blocking: true },
          { id: 'todo', label: 'No TODO', command: [process.execPath, 'scripts/warn.mjs'], blocking: false },
        ]
      : [],
    collections: [
      { id: 'posts', label: 'Posts', dir: 'src/content/blog', format: 'md', hasStatus: true, url: '/blog/{id}/' },
      { id: 'pages', label: 'Pages', dir: 'src/content/pages', format: 'json', fields: { url: 'uri' } },
    ],
    media: { dir: 'src/assets/uploads', url: '/uploads/{path}', maxBytes: 64 * 1024 },
    compat: { collection: 'posts' },
    login: { ipMaxAttempts: 1000 },
  };
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify(config, null, 2));
  return { run, site, data, live, failMarker: path.join(run, 'fail'), git: (...a) => git(site, ...a) };
}

export const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/**
 * Start a server on the fixture. `clock` is a settable fake clock ({ now }) for timeout tests; `outbound` the web
 * fetch seam ({lookup, allow}) so a test may reach its own server on loopback; `ai` the AI suggestions' {fetch, env}.
 */
export async function startServer(fx, { overrides = {}, env = {}, codec = fakeCodec, core = stubCore, clock, outbound, ai } = {}) {
  const port = await freePort();
  const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test', ...env }, overrides: { port, ...overrides } });
  const app = await createMarkstage(config, { core, codec, ...(clock ? { clock: () => clock.now } : {}), ...(outbound ? { outbound } : {}), ...(ai ? { ai } : {}) });
  await app.listen(port, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  return { app, config: app.config, base, port, close: () => app.close() };
}

/** Create a user straight in the database (cheap scrypt params so tests stay fast). Returns { id, email, password }. */
export async function addUser(app, { email, name = email.split('@')[0], role, authorSlug = null, password = testPassword() }) {
  const pwHash = await hashPassword(password, { N: 2 ** 12, r: 8, p: 1, keylen: 32 });
  const row = app.users.create({ email, name, role, authorSlug, pwHash });
  return { id: row.id, email, password };
}

/** An HTTP client for one browser: cookie jar, Origin header and CSRF token handled like the editor does. */
export function client(base, { origin = base, api = '/markstage/api' } = {}) {
  const jar = new Map();
  const c = {
    csrf: null,
    lastCookies: [],
    async request(method, p, { body, headers = {}, raw = false, noCsrf = false, noOrigin = false } = {}) {
      const h = { ...headers };
      if (!noOrigin && origin) h.Origin = origin;
      if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      if (c.csrf && !noCsrf && method !== 'GET') h['X-CSRF-Token'] = c.csrf;
      let payload = body;
      if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') {
        payload = JSON.stringify(body);
        h['Content-Type'] = 'application/json';
      }
      const url = p.startsWith('http') || p.startsWith('/studio-api') ? (p.startsWith('http') ? p : base + p) : `${base}${api}${p}`;
      const res = await fetch(url, { method, headers: h, body: payload, redirect: 'manual' });
      c.lastCookies = res.headers.getSetCookie();
      for (const sc of c.lastCookies) {
        const [pair] = sc.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (/Max-Age=0/.test(sc) || value === '') jar.delete(name);
        else jar.set(name, value);
      }
      const text = raw ? null : await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (json?.csrfToken) c.csrf = json.csrfToken;
      return { status: res.status, headers: res.headers, json, text, res };
    },
    get: (p, o) => c.request('GET', p, o),
    post: (p, body, o) => c.request('POST', p, { ...o, body }),
    put: (p, body, o) => c.request('PUT', p, { ...o, body }),
    patch: (p, body, o) => c.request('PATCH', p, { ...o, body }),
    del: (p, o) => c.request('DELETE', p, o),
    async login(email, password) {
      const r = await c.post('/auth/login', { email, password });
      if (r.status !== 200 || !r.json?.user) throw new Error(`login failed for test user: ${r.status} ${JSON.stringify(r.json)}`);
      return r;
    },
    cookies: jar,
  };
  return c;
}

/** Sign in a fresh client as a new user of this role. */
export async function as(srv, role, { authorSlug = null, email } = {}) {
  const u = await addUser(srv.app, { email: email ?? `${role}-${crypto.randomBytes(3).toString('hex')}@example.test`, role, authorSlug });
  // a server at another basePath (config basePath) answers its API there
  const c = client(srv.base, { api: `${srv.config?.basePath ?? '/markstage'}/api` });
  await c.login(u.email, u.password);
  c.user = u;
  return c;
}

export const readFile = (fx, rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');
export const writeFile = (fx, rel, text) => fs.writeFileSync(path.join(fx.site, rel), text);
export const gitLog = (fx, rel) => fx.git('log', '--format=%an|%ae|%s', '--', rel).trim().split('\n');
