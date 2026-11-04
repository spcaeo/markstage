// `markstage build-editor --out <dir>`: the editor for a Markstage server, built once from the site's
// markstage.config. It is the same browser code `astro dev` serves at /markstage/ (client.mjs: the site's CSS, its
// block packs, link and spelling modules), compiled by the site's own Vite, plus:
//
//   index.html          the editor page (page.astro's twin), with the site's pageData run here at build time
//   assets/…            the editor's script and styles, under the site config's basePath (/markstage/assets/…)
//   preview-agent.js    the preview agent as one classic script: the server adds it to every preview page
//   markstage-editor.json  what was built, and when (the folder's marker: a rebuild only replaces a folder with it)
//
// Point the server's `editorDir` (config.json) at the folder. Build again when the site's editor CSS, packs or
// pageData change. The new folder is written beside the old one and swapped in at the end, so a running server
// never serves half a build. Site paths in the CSS (url(/fonts/…)) stay as they are: the server answers them on the
// CMS origin for signed-in people (site-files.mjs), as the dev server does in `astro dev`.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { releaseInfo } from '@markstage/core/release';
import { metaOf, V, virtualPlugin } from './client.mjs';
import { loadConfig, normalizeConfig } from './config.mjs';

export const MARKER = 'markstage-editor.json';
const here = path.dirname(fileURLToPath(import.meta.url));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The site's Vite (it comes with Astro), else the one next to this package. */
async function importVite(root) {
  for (const from of [path.join(root, 'package.json'), fileURLToPath(import.meta.url)]) {
    let file;
    try {
      file = createRequire(from).resolve('vite/package.json');
    } catch {
      continue;
    }
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const exp = pkg.exports?.['.'];
    const entry = typeof exp === 'string' ? exp : (exp?.import?.default ?? exp?.import ?? exp?.default ?? pkg.module ?? pkg.main);
    return import(pathToFileURL(path.join(path.dirname(file), entry)).href);
  }
  throw new Error('markstage build-editor needs Vite, which comes with Astro: run npm install in the site first.');
}

/** The site's pageData() result, run through Vite (the module may be TypeScript and import the site's code). */
async function pageDataOf(vite, cfg, root) {
  if (!cfg.editor.pageData) return {};
  let mod;
  if (vite.runnerImport) {
    mod = (await vite.runnerImport(cfg.editor.pageData, { root, configFile: false, logLevel: 'warn' })).module;
  } else {
    const server = await vite.createServer({ root, configFile: false, logLevel: 'warn', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false } });
    try {
      mod = await server.ssrLoadModule(cfg.editor.pageData);
    } finally {
      await server.close();
    }
  }
  return (await mod.default?.()) ?? {};
}

/** Vite's logger without the two expected notes: site paths left for the server, and dynamic imports kept in the bundle. */
function quietLogger(vite, logLevel) {
  const logger = vite.createLogger(logLevel);
  const expected = (msg) => /didn't resolve at build time|INEFFECTIVE_DYNAMIC_IMPORT/.test(String(msg));
  const warn = logger.warn.bind(logger);
  const warnOnce = logger.warnOnce.bind(logger);
  logger.warn = (msg, o) => !expected(msg) && warn(msg, o);
  logger.warnOnce = (msg, o) => !expected(msg) && warnOnce(msg, o);
  return logger;
}

/** The editor page: page.astro's twin, pointing at the built script and styles. */
export function editorHtml({ meta, base, data, css, js }) {
  const head = [
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="robots" content="noindex, nofollow" />',
    `<title>${esc(meta.siteName ?? 'Markstage')} · Markstage</title>`,
    ...(meta.favicon ? [`<link rel="icon" href="${esc(meta.favicon)}" />`] : []),
    ...meta.preload.map((href) => `<link rel="preload" href="${esc(href)}" as="font" type="font/woff2" crossorigin />`),
    // JSON, never run (the CMS's CSP allows only its own script files)
    `<script type="application/json" id="ms-page-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`,
    ...css.map((f) => `<link rel="stylesheet" href="${esc(base + f)}" />`),
    `<script type="module" src="${esc(base + js)}"></script>`,
  ];
  return `<!doctype html>\n<html lang="${esc(meta.lang)}">\n  <head>\n    ${head.join('\n    ')}\n  </head>\n  <body class="ms">\n    <div id="markstage" class="ms-app" aria-busy="true"></div>\n  </body>\n</html>\n`;
}

/** The entry's script and every stylesheet it pulls in (its own and its static imports'), from Vite's manifest. */
function entryFiles(manifest) {
  const entry = Object.values(manifest).find((m) => m.isEntry);
  if (!entry) throw new Error('The editor build has no entry.');
  const css = new Set();
  const seen = new Set();
  const walk = (m) => {
    for (const f of m.css ?? []) css.add(f);
    for (const k of m.imports ?? []) if (!seen.has(k) && manifest[k]) seen.add(k), walk(manifest[k]);
  };
  walk(entry);
  return { js: entry.file, css: [...css] };
}

/** A folder that may be replaced: missing, empty, or an earlier editor build (it has the marker). */
function replaceable(dir) {
  if (!fs.existsSync(dir)) return true;
  if (!fs.statSync(dir).isDirectory()) return false;
  const names = fs.readdirSync(dir);
  return names.length === 0 || names.includes(MARKER);
}

/**
 * Build the editor into `out`. `root`: the site (its markstage.config). `config`: a config object instead of the
 * file (tests). Returns { out, js, css, ms }.
 */
export async function buildEditor({ root = process.cwd(), out, config, logLevel = 'warn' } = {}) {
  if (!out) throw new Error('Say where the editor goes: markstage build-editor --out <folder> (then set editorDir to it).');
  root = path.resolve(root);
  out = path.resolve(out);
  if (!replaceable(out)) throw new Error(`${out} is not empty and is not an editor build (no ${MARKER}): refusing to replace it.`);
  const started = Date.now();
  const cfg = config ? normalizeConfig(config, root) : (await loadConfig(root))?.config;
  if (!cfg) throw new Error(`No markstage.config at ${root}.`);
  const vite = await importVite(root);
  const base = `${cfg.basePath}/`;
  const tmp = `${out}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const data = await pageDataOf(vite, cfg, root);
    const customLogger = quietLogger(vite, logLevel);
    const release = releaseInfo({ dir: path.resolve(here, '../../..') });
    const onwarn = (w, next) => w.code !== 'INEFFECTIVE_DYNAMIC_IMPORT' && next(w);
    await vite.build({
      root,
      base,
      configFile: false,
      // site paths in the CSS stay site paths (the server answers them); nothing from public/ is copied
      publicDir: false,
      logLevel,
      customLogger,
      mode: 'production',
      plugins: [virtualPlugin(cfg)],
      build: {
        outDir: tmp,
        emptyOutDir: false,
        assetsDir: 'assets',
        manifest: true,
        target: 'es2022',
        chunkSizeWarningLimit: 8192,
        rollupOptions: { input: { editor: `${V}client` }, onwarn },
      },
    });
    const manifestFile = path.join(tmp, '.vite', 'manifest.json');
    const { js, css } = entryFiles(JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
    fs.rmSync(path.join(tmp, '.vite'), { recursive: true, force: true });
    // the preview agent: one classic script (it reads document.currentScript), as scripts/build-agent.mjs makes it
    const editorRoot = path.dirname(path.dirname(fileURLToPath(import.meta.resolve('@markstage/editor'))));
    await vite.build({
      root: editorRoot,
      configFile: false,
      publicDir: false,
      logLevel,
      customLogger,
      build: {
        outDir: tmp,
        emptyOutDir: false,
        minify: true,
        lib: { entry: path.join(editorRoot, 'src/preview-agent.ts'), formats: ['iife'], name: 'markstageAgent', fileName: () => 'preview-agent.js' },
      },
    });
    fs.writeFileSync(path.join(tmp, 'index.html'), editorHtml({ meta: metaOf(cfg), base, data, css, js }));
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(tmp, MARKER), `${JSON.stringify({ builtAt: new Date().toISOString(), basePath: cfg.basePath, markstage: pkg.version, release: release.line, site: cfg.siteName ?? null, js, css }, null, 2)}\n`);
    // swap: the old build out of the way, the new one in, the old one gone
    const old = `${out}.old-${process.pid}`;
    if (fs.existsSync(out)) fs.renameSync(out, old);
    fs.renameSync(tmp, out);
    fs.rmSync(old, { recursive: true, force: true });
    return { out, js, css, ms: Date.now() - started };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}
