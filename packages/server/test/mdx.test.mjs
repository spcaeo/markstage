// An MDX collection on the server (docs/MDX.md), with the real core: list and open, a save with no edit writes
// nothing, a paragraph edit and a prop edit change only those bytes, a contributor cannot change code, and a file the
// reader cannot read opens read-only with its line, and a save over it is refused.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, readFile, startServer } from './helpers.mjs';
import { loadCore } from '../src/content/converter.mjs';

const GUIDE = `---
title: Install guide
---
import { Callout } from '../../components/Callout.astro';

Install it in one step.

<Callout type="tip" title='Before you start'>
  Check the version you have.
</Callout>

<Chart data={rows} height={240} />

Then run it.
`;
const BROKEN = `---
title: Broken
---
Text.

<Callout type="tip">
`;

describe('MDX collection', () => {
  let fx;
  let srv;
  let editor;
  let carol;
  const rel = (id) => `src/content/guides/${id}.mdx`;
  before(async () => {
    fx = makeFixture({ checks: false });
    fs.mkdirSync(path.join(fx.site, 'src/content/guides'), { recursive: true });
    fs.writeFileSync(path.join(fx.site, rel('install')), GUIDE);
    fs.writeFileSync(path.join(fx.site, rel('broken')), BROKEN);
    fs.writeFileSync(path.join(fx.site, rel('carols')), GUIDE.replace('title: Install guide', 'title: Carol’s guide\nauthor: carol\ndraft: true'));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Guides');
    const cfgPath = path.join(fx.data, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.collections.push({ id: 'guides', label: 'Guides', dir: 'src/content/guides', format: 'mdx', hasStatus: true, url: '/guides/{id}/' });
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    srv = await startServer(fx, { core: await loadCore() });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    carol = await as(srv, 'contributor', { authorSlug: 'carol' });
  });
  after(() => srv.close());

  test('the collection lists .mdx files and says it is MDX', async () => {
    const cols = (await editor.get('/collections')).json;
    const guides = cols.find((c) => c.id === 'guides');
    assert.ok(guides);
    const list = (await editor.get('/collections/guides/entries')).json;
    assert.deepEqual(list.items.map((e) => e.id).sort(), ['broken', 'carols', 'install']);
  });

  test('open and save with no edit: the file is byte for byte the same', async () => {
    const cur = await editor.get('/collections/guides/entries/install');
    assert.equal(cur.status, 200);
    assert.equal(cur.json.mdx, true);
    assert.ok(cur.json.doc.content.some((n) => n.type === 'mdxContainer'));
    const r = await editor.put('/collections/guides/entries/install', { version: cur.json.version, doc: cur.json.doc });
    assert.ok(r.status < 300, JSON.stringify(r.json));
    assert.equal(readFile(fx, rel('install')), GUIDE);
  });

  test('a paragraph and a prop edited: only those bytes change, the quote style kept', async () => {
    const cur = (await editor.get('/collections/guides/entries/install')).json;
    const doc = structuredClone(cur.doc);
    const intro = doc.content.find((n) => n.type === 'paragraph' && n.content?.[0]?.text === 'Install it in one step.');
    intro.content[0].text = 'Install it in two steps.';
    const callout = doc.content.find((n) => n.type === 'mdxContainer');
    callout.attrs.props = callout.attrs.props.map((p) => (p.name === 'title' ? { ...p, value: "Don't skip this" } : p.name === 'type' ? { ...p, value: 'warn' } : p));
    const r = await editor.put('/collections/guides/entries/install', { version: cur.version, doc });
    assert.ok(r.status < 300, JSON.stringify(r.json));
    const want = GUIDE.replace('in one step', 'in two steps').replace(`type="tip" title='Before you start'`, `type="warn" title='Don&#39;t skip this'`);
    assert.equal(readFile(fx, rel('install')), want);
  });

  test('a contributor may change words and literal props, never the code', async () => {
    const cur = (await carol.get('/collections/guides/entries/carols')).json;
    assert.equal(cur.can.edit, true, 'her own guide');
    // words and a literal prop: allowed
    const words = structuredClone(cur.doc);
    words.content.find((n) => n.type === 'paragraph').content[0].text = 'Install it today.';
    const callout = words.content.find((n) => n.type === 'mdxContainer');
    callout.attrs.props = callout.attrs.props.map((p) => (p.name === 'type' ? { ...p, value: 'note' } : p));
    const ok = await carol.put('/collections/guides/entries/carols', { version: cur.version, doc: words });
    assert.ok(ok.status < 300, JSON.stringify(ok.json));
    assert.match(readFile(fx, rel('carols')), /Install it today\.[\s\S]*<Callout type="note"/);
    // the code: refused
    const now = (await carol.get('/collections/guides/entries/carols')).json;
    const doc = structuredClone(now.doc);
    const chart = doc.content.find((n) => n.type === 'mdxComponent');
    chart.attrs.source = '<Chart data={evil} height={240} />';
    chart.attrs.props = chart.attrs.props.map((p) => (p.name === 'data' ? { ...p, value: 'evil' } : p));
    const r = await carol.put('/collections/guides/entries/carols', { version: now.version, doc });
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.match(r.json.message ?? r.json.error ?? '', /MDX|code/);
  });

  test('a file the reader cannot read: open read-only with its line, a save refused, nothing written', async () => {
    const cur = await editor.get('/collections/guides/entries/broken');
    assert.equal(cur.status, 200, JSON.stringify(cur.json));
    assert.equal(cur.json.mdx, true);
    assert.equal(cur.json.can.edit, false);
    assert.equal(cur.json.doc ?? null, null);
    assert.ok(cur.json.unreadable?.message);
    assert.equal(typeof cur.json.unreadable.line, 'number');
    const r = await editor.put('/collections/guides/entries/broken', { version: cur.json.version, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Over it' }] }] } });
    assert.ok(r.status >= 400, `refused, got ${r.status}`);
    assert.equal(readFile(fx, rel('broken')), BROKEN);
    // its source is still shown, as it is
    const src = await editor.get('/collections/guides/entries/broken/source');
    assert.equal(src.status, 200);
    assert.equal(src.json.source, BROKEN);
  });

  test('a new entry in the collection is an .mdx file', async () => {
    const r = await editor.post('/collections/guides/entries', { title: 'Quick start' });
    assert.ok(r.status < 300, JSON.stringify(r.json));
    assert.ok(fs.existsSync(path.join(fx.site, rel(r.json.id))), 'written as .mdx');
  });

  test('a new entry from a template: its components come along, kept as written', async () => {
    const cur = (await editor.get('/collections/guides/entries/install')).json;
    const doc = { type: 'doc', content: cur.doc.content.filter((n) => n.type === 'mdxCode' || n.type === 'mdxContainer') };
    const t = await editor.post('/templates', { collection: 'guides', name: 'With a callout', doc });
    assert.equal(t.status, 201, JSON.stringify(t.json));
    const made = await editor.post('/collections/guides/entries', { title: 'From the template', templateId: t.json.id });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const text = readFile(fx, rel(made.json.id));
    assert.match(text, /import \{ Callout \} from '\.\.\/\.\.\/components\/Callout\.astro';\n\n<Callout type="warn" title='Don&#39;t skip this'>\n {2}Check the version you have\.\n<\/Callout>\n$/);
  });

  test('history, rename and delete work on .mdx files', async () => {
    const revs = await editor.get('/collections/guides/entries/install/revisions');
    assert.equal(revs.status, 200);
    assert.ok(revs.json.length >= 2, 'the fixture commit and the edit');
    const old = await editor.get(`/collections/guides/entries/install/revisions/${revs.json.at(-1).sha}`);
    assert.equal(old.status, 200);
    let cur = (await editor.get('/collections/guides/entries/install')).json;
    const moved = await editor.post('/collections/guides/entries/install/move', { version: cur.version, newId: 'installing' });
    assert.ok(moved.status < 300, JSON.stringify(moved.json));
    assert.ok(fs.existsSync(path.join(fx.site, rel('installing'))) && !fs.existsSync(path.join(fx.site, rel('install'))));
    cur = (await editor.get('/collections/guides/entries/installing')).json;
    const d = await editor.del(`/collections/guides/entries/installing?version=${cur.version}`);
    assert.equal(d.status, 200, JSON.stringify(d.json));
    assert.ok(!fs.existsSync(path.join(fx.site, rel('installing'))));
    const back = await editor.post(`/trash/${d.json.trashId}/restore`, {});
    assert.equal(back.status, 201);
    assert.ok(fs.existsSync(path.join(fx.site, rel('installing'))), 'restored as .mdx');
  });
});
