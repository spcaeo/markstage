#!/usr/bin/env node
// A new site from the starter (examples/starter): copies it to a folder of its own, puts this checkout's Markstage
// packages beside it as tarballs (vendor/), installs it and makes the first git commit. With --npm the site takes
// @markstage/astro from npm instead, at this checkout's version (the packages are on npm from 0.5.0).
// docs/STARTER.md.
//
//   node scripts/create-site.mjs ../my-blog              a new site in ../my-blog, the packages in its vendor/
//   node scripts/create-site.mjs ../my-blog --npm        the same, the packages from npm
//   node scripts/create-site.mjs ../my-blog --no-install --no-git
//   node scripts/create-site.mjs --update ../my-blog     put this checkout's packages in an existing site's vendor/
//
// Only Node's own modules, so it runs from a fresh clone before `npm ci`. Relative folders are read from where the
// command was typed (npm run sets INIT_CWD to it).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STARTER = path.join(REPO, 'examples/starter');
export const PACKAGES = ['core', 'editor', 'astro'];
/** Never copied from the starter: what its own runs leave behind. */
const SKIP = new Set(['node_modules', 'dist', 'dist-private', '.astro', '.markstage', '.DS_Store']);
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** "My Blog!" -> "my-blog" (a package name). */
export const slug = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'my-site';

/** Copies the starter into `target` (which must not exist, or be empty), leaving build output and installs out. */
export function copyStarter(target, { from = STARTER } = {}) {
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`${target} is not empty. Pick a new folder.`);
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(from, target, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
}

/**
 * Packs @markstage/core, editor and astro from this checkout into `<site>/vendor/` (old markstage-*.tgz removed) and
 * returns { '@markstage/core': 'file:vendor/markstage-core-0.3.0.tgz', … }.
 */
export function packVendor(site, { run = execFileSync } = {}) {
  const vendor = path.join(site, 'vendor');
  fs.mkdirSync(vendor, { recursive: true });
  for (const f of fs.readdirSync(vendor)) if (/^markstage-[a-z]+-.*\.tgz$/.test(f)) fs.rmSync(path.join(vendor, f));
  const args = ['pack', '--json', '--ignore-scripts', '--pack-destination', vendor, ...PACKAGES.flatMap((p) => ['-w', `packages/${p}`])];
  const out = JSON.parse(run(NPM, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  const deps = {};
  for (const p of out) {
    if (!fs.existsSync(path.join(vendor, p.filename))) throw new Error(`npm pack wrote no ${p.filename}`);
    deps[p.name] = `file:vendor/${p.filename}`;
  }
  for (const p of PACKAGES) if (!deps[`@markstage/${p}`]) throw new Error(`npm pack did not pack @markstage/${p}`);
  return deps;
}

/**
 * The site's package.json with the packages from vendor/: the integration and the two it needs, so npm takes all
 * three from the tarballs and never looks for them on the registry.
 */
export function withVendor(pkg, deps, { name } = {}) {
  const next = { ...pkg, ...(name ? { name } : {}) };
  const own = Object.fromEntries(Object.entries(pkg.dependencies ?? {}).filter(([k]) => !k.startsWith('@markstage/')));
  next.dependencies = Object.fromEntries(Object.entries({ ...own, ...deps }).sort(([a], [b]) => a.localeCompare(b)));
  next.overrides = { ...(pkg.overrides ?? {}), '@markstage/core': deps['@markstage/core'], '@markstage/editor': deps['@markstage/editor'] };
  return next;
}

/**
 * The site's package.json with @markstage/astro from npm at `version` (exactly: the four packages move together) and
 * no tarballs: the other @markstage packages come with it, and overrides that pointed at vendor/ are dropped.
 */
export function withNpm(pkg, version, { name } = {}) {
  const next = { ...pkg, ...(name ? { name } : {}) };
  const own = Object.fromEntries(Object.entries(pkg.dependencies ?? {}).filter(([k]) => !k.startsWith('@markstage/')));
  next.dependencies = Object.fromEntries(Object.entries({ ...own, '@markstage/astro': version }).sort(([a], [b]) => a.localeCompare(b)));
  const overrides = Object.fromEntries(Object.entries(pkg.overrides ?? {}).filter(([k]) => !k.startsWith('@markstage/')));
  if (Object.keys(overrides).length) next.overrides = overrides;
  else delete next.overrides;
  return next;
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);
const step = (text) => console.log(`\n> ${text}`);

/** Runs a command in `cwd`, its output shown; false when it failed (the error is printed). */
function tryRun(cmd, args, cwd) {
  try {
    execFileSync(cmd, args, { cwd, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

export function createSite(target, { install = true, git = true, npm = false, name = slug(path.basename(target)) } = {}) {
  step(`Copying the starter to ${target}`);
  copyStarter(target);
  const file = path.join(target, 'package.json');
  let deps;
  if (npm) {
    const version = readJson(path.join(REPO, 'packages/astro/package.json')).version;
    step(`Taking @markstage/astro ${version} from npm`);
    deps = { '@markstage/astro': version };
    writeJson(file, withNpm(readJson(file), version, { name }));
  } else {
    step('Packing this checkout of Markstage into vendor/');
    deps = packVendor(target);
    writeJson(file, withVendor(readJson(file), deps, { name }));
  }
  if (install) {
    step('Installing (npm install)');
    if (!tryRun(NPM, ['install', '--no-audit', '--no-fund'], target)) throw new Error(`npm install failed in ${target}. Fix the error above, then run it there again.`);
  }
  let committed = false;
  if (git) {
    step('Making it a git repository (Markstage saves every change as a commit)');
    committed = tryRun('git', ['init', '-q', '-b', 'main'], target) && tryRun('git', ['add', '-A'], target) && tryRun('git', ['commit', '-q', '-m', 'A new site from the Markstage starter'], target);
    if (!committed) console.log('  The first commit did not happen (is git\'s user.name and user.email set?). Run "git add -A && git commit" there yourself.');
  }
  // the folder as typed from where the command ran (npm run sets INIT_CWD), or in full when that is long
  const rel = path.relative(process.env.INIT_CWD ?? process.cwd(), target) || '.';
  const shown = rel.split(path.sep).filter((p) => p === '..').length > 2 ? target : rel;
  console.log(`\nYour site is ready in ${target}.\n\n  cd ${shown}${install ? '' : '\n  npm install'}\n  npm run dev\n\nThen open http://127.0.0.1:18237/markstage/ to write. For a team, see docs/DOCKER.md.`);
  return { deps, committed };
}

export function updateSite(site, { install = true } = {}) {
  const file = path.join(site, 'package.json');
  if (!fs.existsSync(file)) throw new Error(`${site} has no package.json.`);
  step(`Packing this checkout of Markstage into ${path.join(site, 'vendor')}`);
  const deps = packVendor(site);
  writeJson(file, withVendor(readJson(file), deps));
  if (install && !tryRun(NPM, ['install', '--no-audit', '--no-fund'], site)) throw new Error(`npm install failed in ${site}.`);
  console.log(`\nUpdated to ${Object.values(deps).join(', ')}. Commit vendor/, package.json and package-lock.json.`);
  return { deps };
}

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [folder] = argv.filter((a) => !a.startsWith('--'));
  const known = new Set(['--update', '--no-install', '--no-git', '--npm']);
  const unknown = [...flags].filter((f) => !known.has(f));
  if (!folder || unknown.length) {
    console.error('Usage: node scripts/create-site.mjs <new folder> [--npm] [--no-install] [--no-git]\n       node scripts/create-site.mjs --update <site folder> [--no-install]');
    return 2;
  }
  const target = path.resolve(process.env.INIT_CWD ?? process.cwd(), folder);
  const opts = { install: !flags.has('--no-install'), git: !flags.has('--no-git'), npm: flags.has('--npm') };
  if (flags.has('--update') && opts.npm) {
    console.error('--update puts tarballs in vendor/. For a site on npm, run npm install @markstage/astro@<version> there.');
    return 2;
  }
  try {
    if (flags.has('--update')) updateSite(target, opts);
    else createSite(target, opts);
    return 0;
  } catch (e) {
    console.error(`\n${e.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
