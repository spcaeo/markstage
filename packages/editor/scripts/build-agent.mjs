// Builds the preview agent (src/preview-agent.ts: the screen checks, and the pages editor's in-page agent) into
// one classic script, dist/preview-agent.js, which the Markstage server adds to every preview page it proxies
// (packages/server src/preview/agent.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: false,
    minify: true,
    lib: { entry: path.join(root, 'src/preview-agent.ts'), formats: ['iife'], name: 'markstageAgent', fileName: () => 'preview-agent.js' },
  },
});
console.log(`built ${path.join(root, 'dist/preview-agent.js')}`);
