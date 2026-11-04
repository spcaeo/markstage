// Builds the editor (the shell and the admin screens) into `outDir` for the end-to-end tests, with a client config
// for the test site. The server serves the folder as its `editorDir` at /markstage/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every stylesheet of the shell must reach the page, or a screen's dialogs show unstyled under it: imported by the
 * entry (as the astro integration does), or by one of the editor's own modules (bundled with it).
 */
async function checkStyles() {
  const fs = await import('node:fs');
  const src = path.join(here, '../../editor/src');
  const entry = fs.readFileSync(path.join(here, 'editor-entry.ts'), 'utf8');
  // every module of the editor, in any folder (order/index.ts imports '../styles/order.css')
  const modules = fs.readdirSync(src, { recursive: true }).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
  const missing = fs.readdirSync(path.join(src, 'styles')).filter((f) => f.endsWith('.css') && !entry.includes(`styles/${f}'`) && !modules.includes(`/styles/${f}'`));
  if (missing.length) throw new Error(`e2e/editor-entry.ts does not import ${missing.join(', ')} (the shell's styles, see packages/astro/src/index.mjs)`);
}

export async function buildEditor(outDir, config) {
  await checkStyles();
  const id = 'virtual:markstage-e2e/config';
  // the footer's release line, as the astro package's client.mjs answers it
  const rel = 'virtual:markstage/release';
  const { releaseInfo } = await import('@markstage/core/release');
  const release = releaseInfo({ dir: path.resolve(here, '../../..') });
  await build({
    root: here,
    base: '/markstage/',
    configFile: false,
    logLevel: 'warn',
    plugins: [
      { name: 'markstage-e2e-config', resolveId: (s) => (s === id ? `\0${id}` : null), load: (s) => (s === `\0${id}` ? `export default ${JSON.stringify(config)};` : null) },
      { name: 'markstage-e2e-release', resolveId: (s) => (s === rel ? `\0${rel}` : null), load: (s) => (s === `\0${rel}` ? `export default ${JSON.stringify(release)};` : null) },
    ],
    build: { outDir, emptyOutDir: true, minify: false, sourcemap: false, rollupOptions: { input: path.join(here, 'editor.html') } },
  });
  // the page is index.html for the server
  const fs = await import('node:fs');
  fs.renameSync(path.join(outDir, 'editor.html'), path.join(outDir, 'index.html'));
  return outDir;
}
