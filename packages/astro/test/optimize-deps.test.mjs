// optimizeDepsFor (client.mjs): installed from npm, `astro dev` pre-bundles core, so the editor's CommonJS (unified's
// `extend`) reaches the browser as ESM; a linked checkout is the site's own code to Vite and gets nothing. The real
// proof is scripts/npm-install.mjs, which opens the editor in `astro dev` from the tarballs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { optimizeDepsFor } from '../src/client.mjs';

test('installed from npm (the editor inside node_modules): core is pre-bundled', () => {
  const file = path.join(os.tmpdir(), 'site', 'node_modules', '@markstage', 'editor', 'src', 'index.ts');
  assert.deepEqual(optimizeDepsFor(file), { include: ['@markstage/astro > @markstage/core'] });
});

test('a linked checkout (this repo, or a site whose node_modules link to it): nothing changes', () => {
  assert.deepEqual(optimizeDepsFor(path.join(os.tmpdir(), 'markstage', 'packages', 'editor', 'src', 'index.ts')), {});
  // the workspace link resolves to packages/editor, outside node_modules
  assert.deepEqual(optimizeDepsFor(), {});
});

test('a link in node_modules that points at a checkout is followed to its real path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-optimize-'));
  try {
    const checkout = path.join(dir, 'markstage', 'packages', 'editor', 'src');
    fs.mkdirSync(checkout, { recursive: true });
    fs.writeFileSync(path.join(checkout, 'index.ts'), '');
    const scope = path.join(dir, 'site', 'node_modules', '@markstage');
    fs.mkdirSync(scope, { recursive: true });
    fs.symlinkSync(path.join(dir, 'markstage', 'packages', 'editor'), path.join(scope, 'editor'));
    assert.deepEqual(optimizeDepsFor(path.join(scope, 'editor', 'src', 'index.ts')), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
