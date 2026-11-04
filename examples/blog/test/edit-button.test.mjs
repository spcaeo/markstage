// "Edit this page" in the built blog: without `editButton` the build is byte for byte the build without Markstage;
// with it, every page gains the same one inline script and nothing else (no file, no request, no CMS address).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import markstage from '@markstage/astro';
import { editButtonScript, normalizeConfig } from '@markstage/astro/config';
import blog from '../markstage.config.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-editbutton-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const CMS = 'https://cms.example.com';

/** Builds the blog into tmp/<name> with these integrations; returns { relative path: bytes }. */
async function built(name, integrations) {
  const outDir = path.join(tmp, name);
  await build({ root, outDir, configFile: false, trailingSlash: 'always', integrations, logLevel: 'error', cacheDir: path.join(tmp, `cache-${name}`) });
  const files = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else files[path.relative(outDir, f)] = fs.readFileSync(f);
    }
  };
  walk(outDir);
  return files;
}

test('the build: off is the same as no Markstage; on adds one inline script to each page and nothing else', { timeout: 180_000 }, async () => {
  const none = await built('none', []);
  const off = await built('off', [markstage()]);
  const on = await built('on', [markstage({ config: { ...blog, editButton: { cms: CMS } } })]);
  assert.deepEqual(Object.keys(off).sort(), Object.keys(none).sort());
  for (const f of Object.keys(none)) assert.ok(off[f].equals(none[f]), `${f} differs with Markstage and no editButton`);

  const script = editButtonScript(normalizeConfig({ ...blog, editButton: { cms: CMS } }, root));
  const tag = `<script>${script}</script>`;
  assert.ok(!tag.includes('cms.example.com') && !/markstage/i.test(tag), 'the script names the CMS');
  assert.deepEqual(Object.keys(on).sort(), Object.keys(none).sort());
  const pages = Object.keys(none).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 3, pages.join());
  for (const f of Object.keys(none)) {
    if (!f.endsWith('.html')) {
      assert.ok(on[f].equals(none[f]), `${f} changed`);
      continue;
    }
    const html = on[f].toString('utf8');
    assert.equal(html.split(tag).length, 2, `${f}: the script once, as is`);
    assert.equal(html.replace(tag, ''), none[f].toString('utf8'), `${f}: nothing else changed`);
  }
  console.log(`# bytes added per page: ${Buffer.byteLength(tag)}`);
});
