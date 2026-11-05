#!/usr/bin/env node
// The image's smoke test (CI, and by hand): a new site from the starter, the image started on it the way
// docs/DOCKER.md says, then the checks a person would make. Exits 1 on the first failure, with the container's log.
//
//   node scripts/docker/smoke.mjs --image markstage-server:ci [--port 37433] [--site /abs/site] [--keep]
//
// 1. the site: scripts/create-site.mjs into a temporary folder (installed and committed), unless --site names one
// 2. the container: the site mounted at /srv/content, a volume over its node_modules, data in a volume; everything
//    it makes carries the label below, and is removed at the end (--keep leaves it running to look at)
// 3. waits for "healthy" (the first start installs the site's packages and builds its editor)
// 4. checks: the editor is the site's build (not the placeholder); the sign-in setup page answers 200; the public
//    release line; `markstage-server setup-code` in the container; the owner is made with it; signed in, the API
//    lists the starter's posts and its MDX guide; a site publish builds and deploys inside the container
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createSite } from '../create-site.mjs';

const LABEL = process.env.MARKSTAGE_SMOKE_LABEL || 'markstage-docker-starter=1';
const argv = process.argv.slice(2);
const opt = (name, fallback = null) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const image = opt('--image');
const port = Number(opt('--port', '37433'));
const keep = argv.includes('--keep');
if (!image) {
  console.error('Usage: node scripts/docker/smoke.mjs --image <image> [--port 37433] [--site /abs/site] [--keep]');
  process.exit(2);
}

const id = `ms-smoke-${process.pid}`;
const made = { container: null, volumes: [], dirs: [] };
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const log = (text) => console.log(`# ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanup() {
  if (keep) return log(`left running: container ${made.container}, volumes ${made.volumes.join(', ')}`);
  if (made.container) spawnSync('docker', ['rm', '-f', '-v', made.container], { stdio: 'ignore' });
  for (const v of made.volumes) spawnSync('docker', ['volume', 'rm', '-f', v], { stdio: 'ignore' });
  // files the container made in the site (as its own user) may not be ours to delete: the temp folder goes anyway
  for (const d of made.dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch (e) {
      log(`could not remove ${d}: ${e.code}`);
    }
  }
}

function fail(message) {
  if (made.container) {
    console.error('--- container log ---');
    spawnSync('docker', ['logs', '--tail', '200', made.container], { stdio: 'inherit' });
  }
  throw new Error(message);
}

const portFree = (p) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
  });

/** A new site from the starter, installed and committed (git identity from the environment if git has none). */
function newSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-smoke-'));
  made.dirs.push(dir);
  const site = path.join(dir, 'site');
  process.env.GIT_AUTHOR_NAME ||= 'Markstage smoke test';
  process.env.GIT_AUTHOR_EMAIL ||= 'smoke@example.com';
  process.env.GIT_COMMITTER_NAME ||= process.env.GIT_AUTHOR_NAME;
  process.env.GIT_COMMITTER_EMAIL ||= process.env.GIT_AUTHOR_EMAIL;
  const { committed } = createSite(site, { install: true, git: true });
  if (!committed) fail('the new site has no first commit');
  return site;
}

async function waitHealthy(timeoutMs) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const state = JSON.parse(docker('inspect', '--format', '{{json .State}}', made.container));
    if (!state.Running) fail(`the container stopped (exit ${state.ExitCode})`);
    if (state.Health?.Status === 'healthy') return;
    if (Date.now() > until) fail(`not healthy after ${timeoutMs / 1000} s (${state.Health?.Status})`);
    await sleep(2000);
  }
}

async function main() {
  if (!(await portFree(port))) fail(`port ${port} is in use: pass --port with a free one`);
  const site = opt('--site') ?? newSite();
  // the container's user (node, uid 1000) writes commits and builds in the mounted site
  if (process.platform === 'linux') spawnSync('chmod', ['-R', 'a+rwX', site]);
  for (const v of ['data', 'modules', 'releases']) {
    made.volumes.push(docker('volume', 'create', '--label', LABEL, `${id}-${v}`));
  }
  const origin = `http://127.0.0.1:${port}`;
  log(`starting ${image} on ${origin}`);
  made.container = docker(
    'run', '-d', '--name', id, '--label', LABEL,
    '-p', `127.0.0.1:${port}:18231`,
    '-e', `MARKSTAGE_PUBLIC_ORIGIN=${origin}`,
    '-v', `${site}:/srv/content`,
    '-v', `${id}-modules:/srv/content/node_modules`,
    '-v', `${id}-data:/srv/data`,
    '-v', `${id}-releases:/srv/site`,
    image,
  );
  const started = Date.now();
  await waitHealthy(300_000);
  log(`healthy after ${Math.round((Date.now() - started) / 1000)} s`);

  const get = (p, headers = {}) => fetch(`${origin}/markstage/${p}`, { headers, redirect: 'manual' });
  const page = await get('');
  if (page.status !== 200) fail(`GET /markstage/ answered ${page.status}`);
  const html = await page.text();
  if (/The editor is not built yet/.test(html)) fail('/markstage/ is the placeholder: the site\'s editor was not built');
  const built = await (await get('markstage-editor.json')).json();
  log(`the site's editor: built ${built.builtAt}, Markstage ${built.markstage}, site "${built.site}"`);
  // the sign-in setup page is the editor at #/setup (a hash: the server answers the editor page for it)
  const me = await (await get('api/auth/me')).json();
  if (me.setupRequired !== true) fail(`a new server should ask for setup: ${JSON.stringify(me)}`);
  const release = await get('api/release');
  if (release.status !== 200) fail(`GET /markstage/api/release answered ${release.status}`);
  log(`release line: ${(await release.json()).line}`);

  const out = docker('exec', made.container, 'markstage-server', 'setup-code');
  const code = /code[^:]*:\s*(\S+)/i.exec(out)?.[1];
  if (!code) fail('setup-code printed no code');
  const password = `Smoke-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const setup = await fetch(`${origin}/markstage/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ setupCode: code, email: 'owner@example.com', name: 'Smoke Owner', password }),
  });
  if (setup.status !== 201) fail(`POST auth/setup answered ${setup.status}: ${await setup.text()}`);
  const cookie = setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const session = await (await get('api/auth/me', { Cookie: cookie })).json();
  if (session.user?.role !== 'owner') fail(`not signed in as the owner: ${JSON.stringify(session.user)}`);
  const cols = await (await get('api/collections', { Cookie: cookie })).json();
  const count = (cid) => cols.find((c) => c.id === cid)?.counts?.all;
  if (count('posts') !== 4 || count('guides') !== 1) fail(`the starter's collections: ${JSON.stringify(cols)}`);
  log('signed in as the owner; posts 4, guides 1');

  const pub = await fetch(`${origin}/markstage/api/site/publish`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }, body: '{}' });
  if (pub.status !== 202) fail(`POST site/publish answered ${pub.status}: ${await pub.text()}`);
  const { job } = await pub.json();
  const until = Date.now() + 300_000;
  let j;
  do {
    await sleep(2000);
    j = await (await get(`api/jobs/${job}`, { Cookie: cookie })).json();
  } while (!['succeeded', 'failed'].includes(j.status) && Date.now() < until);
  if (j.status !== 'succeeded') fail(`the site publish ${j.status}: ${j.error ?? ''}\n${j.log ?? ''}`);
  const live = docker('exec', made.container, 'ls', '/srv/site/current/public/posts');
  for (const p of ['welcome', 'writing-in-markdown', 'from-draft-to-live']) if (!live.split('\n').includes(p)) fail(`the release has no posts/${p}: ${live}`);
  log('a site publish built and deployed the starter inside the container');
  log('smoke test passed');
}

try {
  await main();
} catch (e) {
  console.error(`smoke test failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
