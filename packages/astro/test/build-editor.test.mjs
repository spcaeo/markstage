// `markstage build-editor`: the editor for a Markstage server (its editorDir), built from the example blog's
// markstage.config with the same client module `astro dev` serves.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildEditor, editorHtml, MARKER } from '../src/build-editor.mjs';

const blog = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/blog');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-build-editor-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('builds the page, its script and styles under the base path, and the preview agent', async () => {
  const out = path.join(tmp, 'editor');
  const r = await buildEditor({ root: blog, out, logLevel: 'silent' });
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /<title>Example blog · Markstage<\/title>/);
  assert.match(html, /<div id="markstage" class="ms-app"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
  // the CMS's CSP allows only its own script files: one module script, no inline code (the page data is JSON)
  const scripts = [...html.matchAll(/<script([^>]*)>([^<]*)<\/script>/g)];
  assert.deepEqual(scripts.map((m) => m[1].trim()), ['type="application/json" id="ms-page-data"', `type="module" src="/markstage/${r.js}"`]);
  assert.ok(fs.statSync(path.join(out, r.js)).size > 100_000, 'the editor is in the script');
  assert.ok(r.css.length >= 1);
  for (const f of r.css) {
    assert.match(html, new RegExp(`href="/markstage/${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.ok(fs.existsSync(path.join(out, f)));
  }
  // the site's own CSS is in the bundle (the canvas draws an entry as its page does)
  const css = r.css.map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
  const selector = fs.readFileSync(path.join(blog, 'src/styles/blog.css'), 'utf8').match(/^\.[a-z][a-z0-9-]+/m)[0];
  assert.ok(css.includes(selector), `blog.css is in it (${selector})`);
  const agent = fs.readFileSync(path.join(out, 'preview-agent.js'), 'utf8');
  assert.doesNotMatch(agent, /^\s*(import|export)\s/m, 'a classic script, not a module');
  const marker = JSON.parse(fs.readFileSync(path.join(out, MARKER), 'utf8'));
  assert.equal(marker.basePath, '/markstage');
  assert.equal(marker.js, r.js);
  assert.equal(fs.existsSync(path.join(out, '.vite')), false, 'no manifest left behind');
});

test('a second build replaces the first; a folder that is not an editor build is never replaced', async () => {
  const out = path.join(tmp, 'again');
  await buildEditor({ root: blog, out, logLevel: 'silent' });
  fs.writeFileSync(path.join(out, 'stale.txt'), 'old');
  await buildEditor({ root: blog, out, logLevel: 'silent' });
  assert.equal(fs.existsSync(path.join(out, 'stale.txt')), false);
  assert.equal(fs.readdirSync(tmp).filter((n) => n.includes('.tmp-') || n.includes('.old-')).length, 0, 'nothing left beside it');

  const data = path.join(tmp, 'data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'config.json'), '{}');
  await assert.rejects(buildEditor({ root: blog, out: data, logLevel: 'silent' }), /not an editor build/);
  assert.equal(fs.readFileSync(path.join(data, 'config.json'), 'utf8'), '{}');
  await assert.rejects(buildEditor({ root: blog, logLevel: 'silent' }), /--out/);
});

test('editorHtml: escapes what the site config gives it', () => {
  const html = editorHtml({ meta: { lang: 'en"x', siteName: '<b>Site</b>', favicon: '/f.png"', preload: [] }, base: '/markstage/', data: { x: '</script>' }, css: [], js: 'assets/e.js' });
  assert.match(html, /lang="en&quot;x"/);
  assert.match(html, /&lt;b&gt;Site&lt;\/b&gt; · Markstage/);
  assert.match(html, /href="\/f.png&quot;"/);
  assert.doesNotMatch(html, /"<\/script>"/);
});
