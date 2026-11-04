// Two environments of one site for the Environments tests: a bare repo as the shared remote, production (main) and
// staging (staging) each with their own clone, data dir and server, and a developer's clone (the laptop). The site's
// build writes real HTML pages from a layout (so a template change shows on every page), redirect stubs, and keeps
// numbered releases so a rollback can put the one before back. Nothing leaves the machine.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TMP_ROOT, startServer } from './helpers.mjs';

const BUILD = `// fixture build: every page into dist/<uri>/index.html through src/layouts/page.html; redirects as stubs
import fs from 'node:fs';
const marker = process.env.FAIL_MARKER;
if (marker && fs.existsSync(marker + '.build')) { console.error('build exploded'); process.exit(2); }
if (marker && fs.existsSync(marker + '.slow')) { const end = Date.now() + Number(fs.readFileSync(marker + '.slow', 'utf8') || 1500); while (Date.now() < end); }
fs.rmSync('dist', { recursive: true, force: true });
const layout = fs.readFileSync('src/layouts/page.html', 'utf8');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';');
let n = 0;
for (const f of fs.readdirSync('src/content/pages').filter((f) => f.endsWith('.json')).sort()) {
  const p = JSON.parse(fs.readFileSync('src/content/pages/' + f, 'utf8'));
  const heading = (p.sections ?? []).map((s) => s.value?.heading).filter(Boolean).join(' / ');
  const html = layout.replaceAll('{{title}}', esc(p.title)).replaceAll('{{heading}}', esc(heading));
  const dir = 'dist' + p.uri;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + 'index.html', html);
  n++;
}
for (const r of JSON.parse(fs.readFileSync('src/data/redirects.json', 'utf8'))) {
  fs.mkdirSync('dist' + r.from, { recursive: true });
  fs.writeFileSync('dist' + r.from + 'index.html', '<!doctype html><meta http-equiv="refresh" content="0; url=' + r.to + '">');
}
console.log('built ' + n + ' pages');
`;

const DEPLOY = `// fixture deploy: dist into a new numbered release, then the live folder becomes a copy of it
import fs from 'node:fs';
import path from 'node:path';
const live = process.env.LIVE_DIR;
const marker = process.env.FAIL_MARKER;
if (marker && fs.existsSync(marker + '.deploy')) { console.error('deploy refused'); process.exit(3); }
const releases = live + '-releases';
fs.mkdirSync(releases, { recursive: true });
const n = fs.readdirSync(releases).length + 1;
fs.cpSync('dist', path.join(releases, String(n).padStart(4, '0')), { recursive: true });
fs.rmSync(live, { recursive: true, force: true });
fs.cpSync('dist', live, { recursive: true });
console.log('deployed release ' + n);
`;

const ROLLBACK = `// fixture rollback: the release before the newest goes live again, and the newest is dropped
import fs from 'node:fs';
import path from 'node:path';
const live = process.env.LIVE_DIR;
const releases = live + '-releases';
const list = fs.readdirSync(releases).sort();
if (list.length < 2) { console.error('no release before this one'); process.exit(4); }
fs.rmSync(path.join(releases, list.at(-1)), { recursive: true, force: true });
fs.rmSync(live, { recursive: true, force: true });
fs.cpSync(path.join(releases, list.at(-2)), live, { recursive: true });
console.log('rolled back to release ' + list.at(-2));
`;

const CHECK = `let t='';process.stdin.on('data',d=>t+=d);process.stdin.on('end',()=>{if(t.includes('FORBIDDEN-WORD')){console.log(JSON.stringify({issues:[{severity:'error',message:'Remove FORBIDDEN-WORD'}]}));process.exit(1)}});`;

export const page = (title, uri, heading, extra = {}) => `${JSON.stringify({ title, uri, sections: [{ discriminant: 'hero', value: { heading } }], ...extra }, null, 2)}\n`;
export const LAYOUT_V1 = '<!doctype html><html><head><title>{{title}}</title></head><body><header>Site v1</header><h1>{{heading}}</h1></body></html>\n';
export const LAYOUT_V2 = '<!doctype html><html><head><title>{{title}}</title></head><body><header class="new">Site v2</header><h1>{{heading}}</h1><footer>New footer</footer></body></html>\n';

export const sh = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd, encoding: 'utf8' }).trim();

/** Write files and commit them in a clone (optionally push). */
export function commit(dir, files, message, { push = null } = {}) {
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    if (text === null) fs.rmSync(abs, { force: true });
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
  }
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', message);
  if (push) sh(dir, 'push', '-q', 'origin', push);
  return sh(dir, 'rev-parse', 'HEAD');
}

/** The shared remote, the three clones and the two data dirs. */
export function makeEnvFixture() {
  const run = path.join(TMP_ROOT, `env-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  const remote = path.join(run, 'remote.git');
  const seed = path.join(run, 'seed');
  fs.mkdirSync(seed, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const files = {
    'src/content/pages/home.json': page('Home', '/', 'Welcome'),
    'src/content/pages/about.json': page('About', '/about/', 'We are here'),
    'src/content/pages/services.json': page('Services', '/services/', 'What we do'),
    'src/content/pages/old-offer.json': page('Old offer', '/old-offer/', 'Last year'),
    'src/data/redirects.json': '[]\n',
    'src/layouts/page.html': LAYOUT_V1,
    'scripts/build.mjs': BUILD,
    'scripts/deploy.mjs': DEPLOY,
    'scripts/rollback.mjs': ROLLBACK,
    'scripts/check.mjs': CHECK,
    '.gitignore': 'dist/\n',
    'package.json': '{ "name": "env-fixture-site", "private": true, "type": "module" }\n',
  };
  sh(seed, 'init', '-q', '-b', 'main');
  commit(seed, files, 'The site');
  sh(seed, 'remote', 'add', 'origin', remote);
  sh(seed, 'push', '-q', 'origin', 'main');
  sh(seed, 'push', '-q', 'origin', 'main:staging');
  const clone = (name, branch) => {
    const dir = path.join(run, name);
    execFileSync('git', ['clone', '-q', '-b', branch, remote, dir]);
    return dir;
  };
  const prodSite = clone('prod-site', 'main');
  const stagingSite = clone('staging-site', 'staging');
  const laptop = clone('laptop', 'main');
  const data = (name) => {
    const d = path.join(run, `${name}-data`);
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    return d;
  };
  return { run, remote, seed, prodSite, stagingSite, laptop, prodData: data('prod'), stagingData: data('staging'), prodLive: path.join(run, 'prod-live'), stagingLive: path.join(run, 'staging-live'), fail: path.join(run, 'fail') };
}

/** The server config of one environment. */
export function envConfig(fx, which, { environment, extra = {} } = {}) {
  const site = which === 'production' ? fx.prodSite : fx.stagingSite;
  return {
    contentRoot: site,
    commands: {
      build: [process.execPath, 'scripts/build.mjs'],
      deploy: [process.execPath, 'scripts/deploy.mjs'],
      rollback: [process.execPath, 'scripts/rollback.mjs'],
      timeoutSeconds: 60,
      env: { LIVE_DIR: which === 'production' ? fx.prodLive : fx.stagingLive, FAIL_MARKER: fx.fail },
    },
    checks: [{ id: 'words', label: 'Forbidden words', command: [process.execPath, 'scripts/check.mjs'], blocking: true }],
    collections: [{ id: 'pages', label: 'Pages', dir: 'src/content/pages', format: 'json', fields: { url: 'uri' } }],
    verify: { public: 'dist' },
    login: { ipMaxAttempts: 1000 },
    environment,
    ...extra,
  };
}

export const PRODUCTION = { name: 'production', branch: 'main', peers: { staging: { branch: 'staging' } } };
export const STAGING = (cmsOrigin = null) => ({ name: 'staging', branch: 'staging', upstream: 'main', promoteTo: 'production', peers: { production: { branch: 'main', origin: cmsOrigin } }, mail: 'actor' });

/** Start one environment's server on its data dir (the config is written to <data>/config.json first). */
export async function startEnv(fx, which, opts = {}) {
  const dataDir = which === 'production' ? fx.prodData : fx.stagingData;
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(envConfig(fx, which, opts), null, 2));
  const fixture = { data: dataDir };
  return startServer(fixture, { overrides: opts.overrides ?? {}, clock: opts.clock, env: opts.env ?? {} });
}

/** Wait for a job to end; returns it. */
export async function waitJob(srv, id, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const j = srv.app.jobs.get(id);
    if (j.status === 'succeeded' || j.status === 'failed') return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} did not end`);
}

/** Make a plan and wait until it is prepared; returns the plan as GET shows it. */
export async function plan(client, srv, body) {
  const r = await client.post('/env/plans', body);
  if (r.status !== 202) throw new Error(`plan refused: ${r.status} ${JSON.stringify(r.json)}`);
  await waitJob(srv, r.json.job);
  return (await client.get(`/env/plans/${r.json.plan.id}`)).json;
}
