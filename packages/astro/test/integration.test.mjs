// The integration's setup hook: in `astro dev` the editor page, the dev API and the agent; in the Markstage
// server's preview clone (MARKSTAGE_PREVIEW=1) the field bindings only; in a build nothing.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import markstage from '../src/index.mjs';

const blog = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/blog');
const saved = { editor: process.env.MARKSTAGE_EDITOR, preview: process.env.MARKSTAGE_PREVIEW };
afterEach(() => {
  for (const [k, v] of [['MARKSTAGE_EDITOR', saved.editor], ['MARKSTAGE_PREVIEW', saved.preview]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function setup(command) {
  const seen = { routes: [], scripts: [], vite: null };
  const logger = { info() {}, warn() {} };
  await markstage().hooks['astro:config:setup']({
    command,
    config: { root: pathToFileURL(`${blog}/`), site: undefined },
    injectRoute: (r) => seen.routes.push(r.pattern),
    injectScript: (stage) => seen.scripts.push(stage),
    updateConfig: (c) => (seen.vite = c.vite),
    logger,
  });
  return seen;
}

test('astro dev: the editor page, the dev API (a Vite plugin) and the page agent', async () => {
  delete process.env.MARKSTAGE_PREVIEW;
  const s = await setup('dev');
  assert.equal(process.env.MARKSTAGE_EDITOR, '1');
  assert.deepEqual(s.routes, ['/markstage']);
  assert.deepEqual(s.scripts, ['page']);
  assert.ok(s.vite.plugins.some((p) => p.name === 'markstage-dev' && p.configureServer));
});

test("the server's preview clone: field bindings on, but no editor page, dev API or agent behind its proxy", async () => {
  process.env.MARKSTAGE_PREVIEW = '1';
  const s = await setup('dev');
  assert.equal(process.env.MARKSTAGE_EDITOR, '1');
  assert.deepEqual(s.routes, []);
  assert.deepEqual(s.scripts, []);
  assert.equal(s.vite, null);
});
