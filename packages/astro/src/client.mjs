// The editor's browser code, as generated modules: one source for `astro dev` (index.mjs, through Vite's dev server)
// and for the production build (build-editor.mjs, served by the Markstage server from `editorDir`).
//
//   virtual:markstage/client     the site's CSS, the editor's, each pack's, then start() with the packs
//   virtual:markstage/agent      dev only: the preview agent on the site's own pages (same-origin frame)
//   virtual:markstage/meta       what the editor page's <head> needs (language, site name, favicon, font preloads)
//   virtual:markstage/page-data  the site's pageData module (data its packs read in the browser)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseInfo } from '@markstage/core/release';
import { clientConfig } from './config.mjs';

export const V = 'virtual:markstage/';
const fromHere = (spec) => fileURLToPath(import.meta.resolve(spec));
const js = (v) => JSON.stringify(v);

/** The browser entry: the site's CSS, the editor's, each pack's, then start() with the packs. */
export function clientModule(cfg) {
  const editorDir = path.dirname(fromHere('@markstage/editor'));
  const lines = [];
  // the site's CSS, marked: inside the page shell the editor fences it out (editor/src/canvas-shell/fence.ts)
  for (const f of cfg.editor.css) lines.push(`import ${js(`${f}?ms-site`)};`);
  lines.push(...['chrome', 'status', 'canvas', 'settings', 'device', 'host', 'image'].map((f) => `import ${js(path.join(editorDir, `styles/${f}.css`))};`));
  const packs = [];
  const markdown = [];
  cfg.editor.packs.forEach((p, i) => {
    for (const f of p.css) lines.push(`import ${js(f)};`);
    if (p.editor) lines.push(`import editor${i} from ${js(p.editor)};`), packs.push(`editor${i}`);
    if (p.markdown) lines.push(`import markdown${i} from ${js(p.markdown)};`), markdown.push(`markdown${i}`);
  });
  lines.push(`import { start } from ${js(fromHere('@markstage/editor'))};`);
  // editor.links as a module (it may read the site's own constants, e.g. its booking URL)
  if (cfg.editor.links.module) lines.push(`import links from ${js(cfg.editor.links.module)};`);
  const config = clientConfig(cfg);
  lines.push(`const config = ${js(config)};`);
  if (cfg.editor.links.module) lines.push('config.links = { special: links.special ?? [], popup: links.popup ?? null };');
  // a locale's spelling (the site's own text -> text function), for the region preview's list of changes
  cfg.locales?.list.forEach((l, i) => {
    if (!l.spelling) return;
    lines.push(`import spelling${i} from ${js(l.spelling)};`, `config.locales.list[${i}].spell = spelling${i};`);
  });
  // a live demo build only (cfg.demo, set by scripts/demo/build-demo.mjs): the editor answers its own API calls in
  // the browser; a normal build never imports the demo module, so none of it is in the bundle
  if (cfg.demo) {
    lines.push(`import { installDemo } from ${js(path.join(editorDir, 'demo/index.ts'))};`, `config.demo = ${js(cfg.demo)};`, 'installDemo(config);');
  }
  lines.push(`start({ config, packs: [${packs}], markdown: [${markdown}] });`);
  return lines.join('\n');
}

/** The site's pages in dev: inside the editor's screen check frame, the preview agent answers on this origin (the
 *  same message path as a production preview on its own origin), and the dev toolbar is not part of the page. */
export function agentModule() {
  const agent = path.join(path.dirname(fromHere('@markstage/editor')), 'preview-agent.ts');
  return [
    `import { listen } from ${js(agent)};`,
    'if (window.parent !== window) {',
    '  listen(window, new Set([location.origin]));',
    "  const style = document.createElement('style');",
    "  style.textContent = 'astro-dev-toolbar{display:none!important}';",
    '  document.head.append(style);',
    '}',
  ].join('\n');
}

/** What the editor page's <head> needs. */
export const metaOf = (cfg) => ({ lang: cfg.editor.lang, siteName: cfg.siteName, favicon: cfg.editor.favicon, preload: cfg.editor.preload });

/** A Vite plugin that answers the virtual:markstage/* modules. */
export function virtualPlugin(cfg, extra = {}) {
  return {
    name: 'markstage-virtual',
    enforce: 'post',
    resolveId: (id) => (id.startsWith(V) ? `\0${id}` : undefined),
    load(id) {
      if (!id.startsWith(`\0${V}`)) return undefined;
      const name = id.slice(V.length + 1);
      if (name === 'client') return clientModule(cfg);
      if (name === 'agent') return agentModule();
      if (name === 'meta') return `export default ${js(metaOf(cfg))};`;
      // the footer's release line (core's release.mjs; docs/RELEASES.md), stamped at build time
      if (name === 'release') return `export default ${js(releaseInfo({ dir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..') }))};`;
      if (name === 'page-data') return cfg.editor.pageData ? `export { default } from ${js(cfg.editor.pageData)};` : 'export default () => ({});';
      return undefined;
    },
    ...extra,
  };
}
