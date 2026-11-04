// @markstage/astro: the Markstage editor inside `astro dev`, for the person running the site on their own machine.
//
//   // astro.config.mjs
//   import markstage from '@markstage/astro';
//   export default defineConfig({ integrations: [markstage()] });
//
// It reads markstage.config at the project root and, in `astro dev` only, adds the editor page at /markstage/ and
// the API under /markstage/api/ (docs/API.md, without sign-in, answering 127.0.0.1 only), and to the site's pages
// the preview agent the editor's screen check talks to (it only starts inside a frame). A build or preview adds
// nothing at all: no route, no middleware, no script, so the built site is byte for byte the same. The one exception
// is opt-in: with `editButton` in markstage.config, a build adds the "Edit this page" check (@markstage/core
// edit-button.mjs) to every page as one small inline script. With author files (`authors`) a build also checks that
// every entry names authors the site has (it stops with the list when one does not), and the site's own pages can
// read them through @markstage/astro/authors; neither adds anything to the built pages. The same editor for a
// Markstage server is built by `markstage build-editor` (build-editor.mjs) into the server's `editorDir`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConverter, readFrontmatter, setFrontmatter } from '@markstage/core';
import { devApi } from './api.mjs';
import { entryPageProblems } from './api-pages.mjs';
import { entryAuthorProblems } from './authors-files.mjs';
import { CONFIG_KEY } from './authors.mjs';
import { V, virtualPlugin } from './client.mjs';
import { editButtonScript, loadConfig, normalizeConfig } from './config.mjs';

export { defineConfig } from './config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Stops the build when an entry names an author the site does not have (docs/API-AUTHORS.md "The build's check"). */
export function checkAuthors(cfg) {
  const bad = entryAuthorProblems(cfg, readFrontmatter);
  if (!bad.length) return;
  const lines = bad.slice(0, 20).map((b) => `  ${b.file}: ${b.message}`);
  if (bad.length > 20) lines.push(`  … and ${bad.length - 20} more.`);
  throw new Error(`markstage: ${bad.length === 1 ? 'an entry names an author' : `${bad.length} entries name authors`} the site does not have (${cfg.authors.dir}):\n${lines.join('\n')}`);
}

/** Stops the build when an entry has a frame or page type the site does not have (docs/API-PAGE-TYPES.md "The build's check"). */
export function checkPages(cfg) {
  const bad = entryPageProblems(cfg, readFrontmatter);
  if (!bad.length) return;
  const lines = bad.slice(0, 20).map((b) => `  ${b.file}: ${b.message}`);
  if (bad.length > 20) lines.push(`  … and ${bad.length - 20} more.`);
  throw new Error(`markstage: ${bad.length === 1 ? 'an entry has a frame or page type' : `${bad.length} entries have frames or page types`} the site does not have:\n${lines.join('\n')}`);
}

export default function markstage(options = {}) {
  return {
    name: '@markstage/astro',
    hooks: {
      'astro:config:setup': async ({ command, config, injectRoute, injectScript, updateConfig, logger }) => {
        if (command === 'build') {
          const root = path.resolve(fileURLToPath(config.root));
          const site = config.site ? String(config.site) : null;
          const built = options.config ? normalizeConfig(options.config, root, { site }) : (await loadConfig(root, undefined, { site }))?.config;
          // the site's pages read their authors through @markstage/astro/authors (authors.mjs)
          if (built) globalThis[CONFIG_KEY] = built;
          if (built?.authors && options.checkAuthors !== false) checkAuthors(built);
          // the site's layout reads each page's frame and type through @markstage/astro/pages (pages.mjs)
          if (built && options.checkPages !== false) checkPages(built);
          const script = built && editButtonScript(built);
          if (script) injectScript('head-inline', script);
          return;
        }
        if (command !== 'dev') return;
        // the site's pages render their data-ms-* field bindings (the pages editor clicks into them) in dev only
        process.env.MARKSTAGE_EDITOR = '1';
        // the Markstage server's preview (a private clone it serves on the preview origin, which adds the agent
        // itself): the field bindings only, never the no-sign-in editor page or dev API behind its proxy
        if (process.env.MARKSTAGE_PREVIEW === '1') {
          logger.info('Markstage preview: field bindings on, no editor page or dev API here.');
          return;
        }
        const root = path.resolve(fileURLToPath(config.root));
        const site = config.site ? String(config.site) : null;
        const loaded = options.config ? { config: normalizeConfig(options.config, root, { site }) } : await loadConfig(root, undefined, { site });
        if (!loaded) {
          logger.warn('No markstage.config.mjs at the project root: the editor is off.');
          return;
        }
        const cfg = loaded.config;
        globalThis[CONFIG_KEY] = cfg;
        injectRoute({ pattern: cfg.basePath, entrypoint: path.join(here, 'page.astro'), prerender: false });
        injectScript('page', `import '${V}agent';`);
        let server;
        // the site's packs go through Vite, so an edit to a pack applies without restarting the dev server
        const tools = async () => {
          const packs = [];
          for (const p of cfg.editor.packs) if (p.markdown) packs.push((await server.ssrLoadModule(p.markdown)).default);
          return { md: createConverter({ packs }), readFrontmatter, setFrontmatter };
        };
        const markstageRoot = path.resolve(here, '../../..');
        updateConfig({
          vite: {
            server: { fs: { allow: [root, markstageRoot] } },
            plugins: [
              virtualPlugin(cfg, {
                name: 'markstage-dev',
                configureServer(s) {
                  server = s;
                  // after Astro's own middleware is set up, put the API at the front (before its trailing-slash rules)
                  return () => void s.middlewares.stack.unshift({ route: '', handle: devApi(cfg, tools, logger) });
                },
              }),
            ],
          },
        });
        logger.info(`Markstage editor: ${cfg.basePath}/ (dev only, this machine only)`);
      },
    },
  };
}
