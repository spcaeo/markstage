#!/usr/bin/env node
// Builds the live demo (docs/DEMO.md): the real editor on the example blog, as static files served from any path.
//
//   npm run demo:build -- OUT [--base /markstage/demo/] [--install <url>]
//
// OUT gets (only a folder this script wrote, an empty one, or one holding just the demo's landing page):
//   editor/     the real editor and its preview agent (markstage build-editor), built with `demo` in its config, so
//               it answers its own API calls in the browser (packages/editor/src/demo/); noindex
//   blog/       the example blog's own Astro build at <base>blog/, drafts included (it is what the editor previews)
//   data/       the recorded server answers (scripts/demo/recorded/api.json, made by npm run demo:record)
//   index.html  only when OUT has none: a page that sends the reader to the editor (the public site has its own
//               landing page at /demo/, scripts/site/demo-page.mjs)
// --base is the address OUT is served at, with slashes at both ends (GitHub Pages: /markstage/demo/). Nothing in
// the output names another path. The work happens in .wt-demo-build (git-ignored), removed afterwards.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEMO_BUILT, DEMO_START, SITE_URL } from '../site/config.mjs';
import { brandCss, prefixPaths, agentLoader, redirectPage } from './html.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const MARKER = '.markstage-demo';
export const PARTS = DEMO_BUILT;

export function parseArgs(argv) {
  const opts = { out: null, base: '/markstage/demo/', install: `${SITE_URL}#install` };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') opts.base = argv[++i];
    else if (a === '--install') opts.install = argv[++i];
    else if (!a.startsWith('--') && !opts.out) opts.out = a;
    else throw new Error(`Unknown argument ${a}`);
  }
  if (!opts.out) throw new Error('Say where the demo goes: npm run demo:build -- OUT [--base /markstage/demo/]');
  if (!/^\/([A-Za-z0-9._~-]+\/)*$/.test(opts.base ?? '')) throw new Error(`--base must be a path with a slash at both ends, such as /markstage/demo/, not ${opts.base}.`);
  if (!/^https?:\/\//.test(opts.install ?? '')) throw new Error('--install must be an http(s) address.');
  return opts;
}

/** OUT may be written: missing, empty, an earlier demo build, or a folder with only its landing page. */
function writable(out) {
  if (!fs.existsSync(out)) return true;
  const names = fs.readdirSync(out).filter((n) => n !== '.DS_Store');
  return names.length === 0 || names.includes(MARKER) || names.every((n) => n === 'index.html');
}

const astro = (cwd, ...args) => execFileSync(process.execPath, [path.join(ROOT, 'node_modules/astro/bin/astro.mjs'), ...args], { cwd, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });

export async function buildDemo({ out, base, install }) {
  out = path.resolve(out);
  if (!writable(out)) throw new Error(`${out} is not empty and is not a demo build (no ${MARKER}): refusing to write there.`);
  const work = path.join(ROOT, '.wt-demo-build');
  const site = path.join(work, 'site');
  const started = Date.now();
  fs.rmSync(work, { recursive: true, force: true });
  try {
    // the example blog, drafts included: the demo's blog is what the editor previews, as a server's preview is
    const skip = new Set(['node_modules', 'dist', '.astro', '.markstage', 'uploads', 'test']);
    fs.cpSync(path.join(ROOT, 'examples', 'blog'), site, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
    fs.writeFileSync(path.join(site, 'src/lib/live.ts'), "// the live demo's blog: every post, drafts too (it is what the editor previews)\nexport const isLive = (_post: unknown) => true;\n");
    console.log('Building the example blog');
    astro(site, 'build', '--base', `${base}blog/`);
    const dist = path.join(site, 'dist');
    const loader = 'markstage-agent.js';
    for (const f of fs.readdirSync(dist, { recursive: true })) {
      if (!String(f).endsWith('.html')) continue;
      const file = path.join(dist, f);
      const html = prefixPaths(fs.readFileSync(file, 'utf8'), `${base}blog/`);
      // at the end of the body: the canvas runs a page's first <head> scripts in a sandbox, and this is not one of them
      fs.writeFileSync(file, html.replace(/<\/body>/i, `<script src="${base}editor/${loader}"></script></body>`));
    }

    console.log('Building the editor (demo)');
    const { buildEditor } = await import(pathToFileURL(path.join(ROOT, 'packages/astro/src/build-editor.mjs')).href);
    const tmpEditor = path.join(work, 'editor');
    await buildEditor({ root: site, out: tmpEditor, basePath: `${base}editor`, demo: { data: `${base}data/api.json`, site: `${base}blog/`, install }, logLevel: 'warn' });
    fs.writeFileSync(path.join(tmpEditor, loader), agentLoader());
    // the strip takes the public site's brand (its tokens in site/styles.css), so a new brand needs no editor change
    const siteCss = path.join(ROOT, 'site', 'styles.css');
    const brand = fs.existsSync(siteCss) ? brandCss(fs.readFileSync(siteCss, 'utf8')) : '';
    if (brand) {
      fs.writeFileSync(path.join(tmpEditor, 'demo-brand.css'), brand);
      const index = path.join(tmpEditor, 'index.html');
      fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/<\/head>/i, `<link rel="stylesheet" href="${base}editor/demo-brand.css" />\n</head>`));
    }

    const recorded = path.join(here, 'recorded', 'api.json');
    if (!fs.existsSync(recorded)) throw new Error('No recorded answers yet: run npm run demo:record first.');
    JSON.parse(fs.readFileSync(recorded, 'utf8'));

    fs.mkdirSync(out, { recursive: true });
    for (const part of PARTS) fs.rmSync(path.join(out, part), { recursive: true, force: true });
    fs.cpSync(dist, path.join(out, 'blog'), { recursive: true });
    fs.cpSync(tmpEditor, path.join(out, 'editor'), { recursive: true });
    fs.mkdirSync(path.join(out, 'data'), { recursive: true });
    fs.copyFileSync(recorded, path.join(out, 'data', 'api.json'));
    if (!fs.existsSync(path.join(out, 'index.html'))) fs.writeFileSync(path.join(out, 'index.html'), redirectPage(DEMO_START));
    fs.writeFileSync(path.join(out, MARKER), `${JSON.stringify({ builtAt: new Date().toISOString(), base, parts: PARTS }, null, 2)}\n`);
  } finally {
    if (!process.env.DEMO_KEEP) fs.rmSync(work, { recursive: true, force: true });
  }
  const size = (dir) => fs.readdirSync(dir, { recursive: true }).reduce((n, f) => n + (fs.statSync(path.join(dir, f)).isFile() ? fs.statSync(path.join(dir, f)).size : 0), 0);
  console.log(`Demo in ${out} for ${base} (${Math.round(size(out) / 1024)} KB, ${Math.round((Date.now() - started) / 1000)} s)`);
  return { out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await buildDemo(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message ?? e);
    process.exit(1);
  }
}
