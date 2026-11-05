#!/usr/bin/env node
// The image's entrypoint (deploy/Dockerfile, docs/DOCKER.md). With no command, or `serve`, it gets the site ready
// and starts the server:
//   1. /srv/data/config.json: written once, on the first start, if there is none (the site at /srv/content, its
//      build `npm run build`, deploys with markstage-deploy to /srv/site). An existing config.json is never touched.
//   2. The site's packages: `npm ci` in /srv/content when node_modules has no install yet (Linux builds of the
//      site's tools; a node_modules made on a Mac cannot run here, so mount a volume over it).
//   3. The site's editor: `markstage build-editor` into /srv/editor/app (a few seconds, at every start, so it always
//      matches the site's code), named to the server by MARKSTAGE_EDITOR_DIR.
//   4. `markstage-server serve`, in this process.
// MARKSTAGE_SITE_SETUP=off skips 2 and 3 (an operator who installs and builds the editor themselves).
// A server command (`setup-code`, `backup`, `reset-password <email>`, `check`, …) runs that command; `prepare`
// runs 1 to 3 and stops; anything else (`npm ci`, `sh`) runs as it is.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SERVER_BIN = '/opt/markstage/packages/server/bin/markstage-server.mjs';
export const SERVER_COMMANDS = new Set(['serve', 'init', 'setup-code', 'reset-password', 'backup', 'version', 'check', 'forms', 'geoip', 'env', 'library', 'media']);
export const EDITOR_DIR = '/srv/editor/app';

/** The config.json a first start writes: paths are the container's; the origin comes from the environment. */
export function defaultConfig(env = process.env) {
  const port = Number(env.MARKSTAGE_PORT || 18231);
  const origin = env.MARKSTAGE_PUBLIC_ORIGIN || `http://127.0.0.1:${port}`;
  return {
    $comment: 'Written by the Markstage image on its first start (docs/DOCKER.md). Change it freely: it is never rewritten. Secrets never go here (docs/DEPLOY.md).',
    contentRoot: env.MARKSTAGE_CONTENT_ROOT || '/srv/content',
    commands: {
      build: ['npm', 'run', 'build'],
      deploy: ['markstage-deploy', '--to', '/srv/site'],
      rollback: ['markstage-deploy', 'rollback', '--to', '/srv/site'],
      // the starter's "Edit this page" button points at this server (examples/starter/markstage.config.mjs)
      env: { MARKSTAGE_CMS_URL: origin },
    },
    verify: { public: 'dist' },
  };
}

/** What to do for these arguments: { prepare: 'all' | 'config' | null, run: 'server' | 'exec' | null }. */
export function plan(args) {
  const [cmd] = args;
  if (!cmd || cmd === 'serve') return { prepare: 'all', run: 'server' };
  if (cmd === 'prepare') return { prepare: 'all', run: null };
  if (SERVER_COMMANDS.has(cmd)) return { prepare: 'config', run: 'server' };
  return { prepare: null, run: 'exec' };
}

/** Does the site need `npm ci`? It has a package.json and node_modules holds no finished install. */
export function needsInstall(site) {
  return fs.existsSync(path.join(site, 'package.json')) && !fs.existsSync(path.join(site, 'node_modules', '.package-lock.json'));
}

const writable = (dir) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Where the editor is built: /srv/editor/app, or a temporary folder when the container runs as another user
 * (`--user`, so /srv/editor is not theirs).
 */
export const editorOut = (root = path.dirname(EDITOR_DIR)) => (writable(root) ? EDITOR_DIR : path.join(os.tmpdir(), 'markstage-editor', 'app'));

const say = (text) => console.log(`[markstage] ${text}`);

/** Writes the first config.json; returns true when it did. */
export function ensureConfig(dataDir, env = process.env) {
  const file = path.join(dataDir, 'config.json');
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(defaultConfig(env), null, 2)}\n`, { mode: 0o600 });
  return true;
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  return r.status === 0;
}

/** Steps 2 and 3; false when the site could not be installed (the server would not load it). */
export function prepareSite(site, env = process.env) {
  if (String(env.MARKSTAGE_SITE_SETUP).toLowerCase() === 'off') return true;
  if (!fs.existsSync(path.join(site, '.git'))) {
    say(`${site} is not a git repository. Mount your site's git working copy there (docs/DOCKER.md).`);
    return false;
  }
  if (needsInstall(site)) {
    const lock = fs.existsSync(path.join(site, 'package-lock.json'));
    say(`Installing the site's packages (${lock ? 'npm ci' : 'npm install'}); the first start takes a minute.`);
    if (!run('npm', [lock ? 'ci' : 'install', '--no-audit', '--no-fund'], site)) {
      say('The install failed (see above). Fix it, or install yourself and start with MARKSTAGE_SITE_SETUP=off.');
      return false;
    }
  }
  const cli = path.join(site, 'node_modules/@markstage/astro/bin/markstage.mjs');
  if (!fs.existsSync(cli)) {
    say('The site has no @markstage/astro, so there is no editor to build: /markstage/ shows a placeholder page.');
    return true;
  }
  say('Building the site\'s editor (markstage build-editor).');
  const out = editorOut();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (run(process.execPath, [cli, 'build-editor', '--out', out], site)) env.MARKSTAGE_EDITOR_DIR ||= out;
  else say('The editor build failed (see above); /markstage/ shows a placeholder page until it builds.');
  return true;
}

async function main(args) {
  const p = plan(args);
  const env = process.env;
  const dataDir = env.MARKSTAGE_DATA_DIR || '/srv/data';
  // another user (`--user 1001:1001`) has no home folder in the image: npm keeps its cache in a temporary one; the
  // server passes npm_config_cache on to the site's build
  if (!writable(env.HOME || '/')) env.npm_config_cache ||= path.join(os.tmpdir(), 'npm-cache');
  if (p.prepare) {
    if (ensureConfig(dataDir, env)) say(`Wrote ${path.join(dataDir, 'config.json')} (first start). Edit it to change the build, the deploy and more.`);
  }
  if (p.prepare === 'all') {
    const site = env.MARKSTAGE_CONTENT_ROOT || '/srv/content';
    if (!prepareSite(site, env)) return 1;
  }
  if (p.run === 'server') {
    process.argv = [process.argv[0], SERVER_BIN, ...(args.length ? args : ['serve'])];
    await import(SERVER_BIN);
    return null;
  }
  if (p.run === 'exec') {
    const r = spawnSync(args[0], args.slice(1), { stdio: 'inherit' });
    if (r.error) {
      console.error(`[markstage] ${args[0]}: ${r.error.message}`);
      return 127;
    }
    return r.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const code = await main(process.argv.slice(2));
  if (code !== null) process.exitCode = code;
}
