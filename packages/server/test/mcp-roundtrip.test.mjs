// The MCP server on site-shaped files (core's fixtures/site, an example site's pages and article, with its pack and the real
// converter): what get_entry gives, sent back to update_entry unchanged, is the same file byte for byte, with no
// commit, on every page and article, with sections, components, raw HTML, synced Library copies and `value._lock`.
// A one-word change changes that word only. An agent never changes, drops or detaches a synced block, nor changes
// a locked block or a lock: 423, through update_entry and add_to_release alike, and nothing is written or added.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';
import { mcpClient, mcpToken } from './mcp-support.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../core/test/fixtures/site');
const CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages' },
  ],
};
`;
const PAGES = ['about-us', 'contact-us', 'data-migration'];
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const json = (d) => `${JSON.stringify(d, null, 2)}\n`;

describe('the MCP server on real site files: lossless, and locked and synced blocks stay', () => {
  let fx, srv, ed, agent, cta, piece;
  const read = (rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const relOf = (c, id) => (c === 'pages' ? `src/content/pages/${id}.json` : `src/content/blog/${id}.md`);
  const page = async (id, f) => {
    const s = (await ed.get(`/collections/pages/entries/${id}/source`)).json;
    const r = await ed.put(`/collections/pages/entries/${id}/source`, { version: s.version, source: json(f(JSON.parse(s.source))) });
    assert.equal(r.status, 200, r.text);
  };
  const entry = async (c, id) => (await agent.tool('get_entry', { collection: c, id })).data;
  /** Every way to send a changed source: update_entry for a draft, add_to_release (into an open release) for any. */
  const refusedBoth = async (c, id, change, error, release) => {
    const e = await entry(c, id);
    const source = change(e.source);
    assert.notEqual(source, e.source, 'the change changes something');
    const before = { file: read(relOf(c, id)), head: head(), items: (await ed.get(`/releases/${release}`)).json.counts.items };
    const tries = [['add_to_release', { release, collection: c, id, version: e.version, source }]];
    if (e.status === 'draft') tries.push(['update_entry', { collection: c, id, version: e.version, source }]);
    for (const [tool, args] of tries) {
      const r = await agent.tool(tool, args);
      assert.equal(r.ok, false, `${tool} ${id}: ${r.text}`);
      assert.deepEqual([r.data.status, r.data.error], [423, error], `${tool} ${id}: ${r.data.message}`);
    }
    assert.equal(read(relOf(c, id)), before.file);
    assert.equal(head(), before.head);
    assert.equal((await ed.get(`/releases/${release}`)).json.counts.items, before.items);
    return tries.length;
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONFIG);
    for (const id of PAGES) fs.copyFileSync(path.join(SITE, `${id}.json`), path.join(fx.site, relOf('pages', id)));
    const article = fs.readFileSync(path.join(SITE, 'planning-tools-compared.md'), 'utf8');
    fs.writeFileSync(path.join(fx.site, relOf('posts', 'planning-tools-compared')), article);
    // the same article as a draft (an agent changes drafts)
    fs.writeFileSync(path.join(fx.site, relOf('posts', 'planning-draft')), article.replace(/^slug: planning-tools-compared$/m, 'slug: planning-draft\ndraft: true'));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Real pages and an article');
    srv = await startServer(fx, { overrides: { collections: [], packs: [path.join(SITE, 'pack.mjs')] }, core: await loadCore() });
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
    agent = mcpClient(srv.base, await mcpToken(ed, ['mcp:draft'], 'Round trip'));

    // a synced section on two pages (the About page's call to action), and a synced piece in an article
    cta = (await ed.post('/library', { kind: 'section', name: 'Talk to us', synced: true, collection: 'pages', body: { value: JSON.parse(read(relOf('pages', 'about-us'))).sections[3] } })).json;
    await page('about-us', (d) => ({ ...d, sections: d.sections.map((s, i) => (i === 3 ? { ...s, _synced: { id: cta.id } } : s)) }));
    await page('data-migration', (d) => ({ ...d, sections: [...d.sections, { ...d.sections.at(-1), discriminant: 'cta', value: JSON.parse(read(relOf('pages', 'about-us'))).sections[3].value, _synced: { id: cta.id } }] }));
    // locks as a site sets them: the About text locked against edits (value._lock), the migration hero against removal
    await page('about-us', (d) => ({ ...d, sections: d.sections.map((s, i) => (i === 1 ? { ...s, value: { ...s.value, _lock: { edit: true } } } : s)) }));
    await page('data-migration', (d) => ({ ...d, sections: d.sections.map((s, i) => (i === 0 ? { ...s, _lock: { remove: true } } : s)) }));
    const body = { doc: { type: 'doc', content: [para('Book a free 30-minute call with our team.'), para('We reply within one business day.')] } };
    piece = (await ed.post('/library', { kind: 'snippet', name: 'Call to action', synced: true, body })).json;
    const made = await ed.post('/collections/posts/entries', { title: 'Synced note', frontmatter: { author: 'alice', synced: [{ id: piece.id }] }, doc: { type: 'doc', content: [para('Intro words here.'), ...body.doc.content, para('Outro.')] } });
    assert.equal(made.status, 201, made.text);
  });
  after(() => srv?.close());

  test('the fixtures have what the round trip must keep: sections, components, raw HTML, synced copies, value._lock', async () => {
    const about = await entry('pages', 'about-us');
    assert.match(about.source, /"_synced": \{\s+"id": "/);
    assert.match(about.source, /"_lock": \{\s+"edit": true/);
    assert.deepEqual(about.synced.map((u) => [u.id, u.state]), [[cta.id, 'synced']]);
    const migration = await entry('pages', 'data-migration');
    assert.match(migration.source, /"_lock": \{\s+"remove": true/);
    assert.ok(JSON.parse(migration.source).sections.length >= 13, 'many sections, many components');
    const note = await entry('posts', 'synced-note');
    assert.equal(note.status, 'draft');
    assert.deepEqual(note.synced.map((u) => [u.id, u.state]), [[piece.id, 'synced']]);
    assert.match((await entry('posts', 'planning-draft')).source, /<aside class="takeaways"/);
  });

  test('get_entry, then update_entry with what it gave: {changed: false}, the file byte for byte, no commit, on every entry', async () => {
    const seen = [];
    for (const c of ['pages', 'posts']) {
      const list = await agent.tool('list_entries', { collection: c });
      assert.equal(list.ok, true, list.text);
      for (const { id } of list.data.items) {
        const rel = relOf(c, id);
        const file = fs.readFileSync(path.join(fx.site, rel));
        const start = head();
        const e = await entry(c, id);
        assert.equal(e.source, file.toString('utf8'), `${rel}: get_entry gives the file`);
        const u = await agent.tool('update_entry', { collection: c, id, version: e.version, source: e.source });
        assert.equal(u.ok, true, `${rel}: ${u.text}`);
        assert.deepEqual(u.data, { changed: false, version: e.version }, rel);
        assert.ok(fs.readFileSync(path.join(fx.site, rel)).equals(file), `${rel}: byte for byte`);
        assert.equal(head(), start, `${rel}: no commit`);
        seen.push(rel);
      }
    }
    // every file of both collections (the real ones and the fixture's own)
    const files = ['src/content/pages', 'src/content/blog'].flatMap((d) => fs.readdirSync(path.join(fx.site, d)).map((f) => `${d}/${f}`));
    assert.deepEqual(seen.sort(), files.sort());
    for (const id of [...PAGES.map((p) => relOf('pages', p)), relOf('posts', 'planning-tools-compared'), relOf('posts', 'planning-draft'), relOf('posts', 'synced-note')]) assert.ok(seen.includes(id), id);
  });

  test('a one-word change to a draft changes that word only, also beside a synced piece', async () => {
    for (const [id, from, to] of [['planning-draft', 'Gantt', 'timeline'], ['synced-note', 'Intro words here.', 'Intro words there.']]) {
      const rel = relOf('posts', id);
      const before = read(rel);
      const e = await entry('posts', id);
      const u = await agent.tool('update_entry', { collection: 'posts', id, version: e.version, source: e.source.replace(from, to) });
      assert.equal(u.ok, true, `${id}: ${u.text}`);
      assert.equal(u.data.changed, true);
      assert.equal(read(rel), before.replace(from, to), `${id}: only that word`);
    }
  });

  test('synced blocks: changed, dropped or detached, refused (423 synced), through update_entry and add_to_release', async () => {
    const r = (await ed.post('/releases', { name: 'Agent tries' })).json;
    let tries = 0;
    // a page's synced section
    const at = (d) => d.sections.findIndex((s) => s._synced);
    const pageChange = (f) => (src) => json(f(JSON.parse(src)));
    tries += await refusedBoth('pages', 'about-us', pageChange((d) => ({ ...d, sections: d.sections.map((s, i) => (i === at(d) ? { ...s, value: { ...s.value, heading: `${s.value.heading ?? ''} now` } } : s)) })), 'synced', r.id);
    tries += await refusedBoth('pages', 'about-us', pageChange((d) => ({ ...d, sections: d.sections.filter((s, i) => i !== at(d)) })), 'synced', r.id);
    tries += await refusedBoth('pages', 'about-us', pageChange((d) => ({ ...d, sections: d.sections.map((s) => (({ _synced, ...rest }) => rest)(s)) })), 'synced', r.id);
    tries += await refusedBoth('pages', 'data-migration', pageChange((d) => ({ ...d, sections: d.sections.filter((s) => !s._synced) })), 'synced', r.id);
    // an article's synced piece (a draft: both tools)
    tries += await refusedBoth('posts', 'synced-note', (t) => t.replace('within one business day', 'within an hour'), 'synced', r.id);
    tries += await refusedBoth('posts', 'synced-note', (t) => t.replace('We reply within one business day.\n\n', ''), 'synced', r.id);
    tries += await refusedBoth('posts', 'synced-note', (t) => t.replace(/synced:\n(\s+.*\n)+?(?=\w)/, ''), 'synced', r.id);
    assert.equal(tries, 10);
  });

  test('locks: a locked block changed or removed, a lock taken off or put on: refused (423 locked); a change elsewhere goes in', async () => {
    const r = (await ed.post('/releases', { name: 'Agent and locks' })).json;
    const pageChange = (f) => (src) => json(f(JSON.parse(src)));
    const edited = (d) => d.sections.findIndex((s) => s.value?._lock?.edit);
    // the About text, locked against edits: changed, and its lock taken off
    await refusedBoth('pages', 'about-us', pageChange((d) => ({ ...d, sections: d.sections.map((s, i) => (i === edited(d) ? { ...s, value: { ...s.value, html: `${s.value.html}<p>More.</p>` } } : s)) })), 'locked', r.id);
    await refusedBoth('pages', 'about-us', pageChange((d) => ({ ...d, sections: d.sections.map((s, i) => (i === edited(d) ? { ...s, value: (({ _lock, ...rest }) => rest)(s.value) } : s)) })), 'locked', r.id);
    // the migration hero, locked against removal: removed, and its lock taken off
    const hero = (d) => d.sections.findIndex((s) => s.value?._lock?.remove || s._lock?.remove);
    await refusedBoth('pages', 'data-migration', pageChange((d) => ({ ...d, sections: d.sections.filter((s, i) => i !== hero(d)) })), 'locked', r.id);
    await refusedBoth('pages', 'data-migration', pageChange((d) => ({ ...d, sections: d.sections.map((s, i) => (i === hero(d) ? { ...((({ _lock, ...rest }) => rest)(s)), value: (({ _lock, ...rest }) => rest)(s.value) } : s)) })), 'locked', r.id);
    // a lock put on by an agent
    await refusedBoth('pages', 'contact-us', pageChange((d) => ({ ...d, sections: d.sections.map((s, i) => (i === 0 ? { ...s, value: { ...s.value, _lock: { edit: true } } } : s)) })), 'locked', r.id);
    // the title of the same page, the rest as it was: into the release, with the file on the site unchanged
    const e = await entry('pages', 'about-us');
    const file = read(relOf('pages', 'about-us'));
    const ok = await agent.tool('add_to_release', { release: r.id, collection: 'pages', id: 'about-us', version: e.version, source: e.source.replace('"title": "About Us"', '"title": "About Example Co"') });
    assert.equal(ok.ok, true, ok.text);
    assert.equal(read(relOf('pages', 'about-us')), file);
    assert.equal((await ed.get(`/releases/${r.id}`)).json.counts.items, 1);
  });
});
