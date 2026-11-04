// Synced Library items (docs/API-LIBRARY.md "Synced") on site-shaped files (core's fixtures/site, an example site's
// site) with the real converter: a page keeps a plain copy with `_synced`, an article its blocks with frontmatter
// `synced`; "edit everywhere" rewrites every copy in one commit and skips one changed in place; a copy changed without
// detaching is refused; detach, delete while in use, impact and locks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { canon, plain, syncVersion } from '../src/library/synced.mjs';
import { as, gitLog, makeFixture, startServer } from './helpers.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../core/test/fixtures/site');
const CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages' },
  ],
};
`;
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('synced Library items', () => {
  let fx, srv, ed, alice;
  const read = (rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');
  const pageData = (id) => JSON.parse(read(`src/content/pages/${id}.json`));
  const src = async (c, id, who = ed) => (await who.get(`/collections/${c}/entries/${id}/source`)).json;
  const save = async (c, id, f, who = ed) => {
    const s = await src(c, id, who);
    return who.put(`/collections/${c}/entries/${id}/source`, { version: s.version, source: f(s.source) });
  };
  const page = (id, f, who = ed) => save('pages', id, (t) => `${JSON.stringify(f(JSON.parse(t)), null, 2)}\n`, who);

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONFIG);
    const about = fs.readFileSync(path.join(SITE, 'about-us.json'), 'utf8');
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/about-us.json'), about);
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/team.json'), about.replace('"/about-us/"', '"/team/"'));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Two real pages');
    srv = await startServer(fx, { overrides: { collections: [], packs: [path.join(SITE, 'pack.mjs')] }, core: await loadCore() });
    ed = await as(srv, 'editor');
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv.close());

  test('a page section: a plain copy with a marker; edit everywhere follows on every page in one commit, skipping one changed in place', async () => {
    const cta = pageData('about-us').sections[3];
    const made = await ed.post('/library', { kind: 'section', name: 'Talk to us', synced: true, collection: 'pages', body: { value: cta } });
    assert.equal(made.status, 201, made.text);
    const it = made.json;
    assert.equal(it.sectionType, 'cta');
    assert.equal(it.syncVersion, syncVersion(it.body), 'the version a marker carries, for the editor to write');
    // both pages use it: the CTA they have becomes the item's copy (a marker added, nothing else)
    for (const id of ['about-us', 'team']) assert.equal((await page(id, (d) => ({ ...d, sections: d.sections.map((s, i) => (i === 3 ? { ...s, _synced: { id: it.id } } : s)) }))).status, 200);
    const about = pageData('about-us');
    assert.deepEqual(about.sections[3]._synced, { id: it.id, version: syncVersion(it.body) }, 'the server writes the version');
    assert.equal(canon(plain(about.sections[3])), canon(cta), 'the site reads exactly the inline copy');
    assert.deepEqual((await ed.get(`/library/${it.id}/impact`)).json.pages.map((p) => [p.id, p.state, p.uses]).sort(), [['about-us', 'synced', 1], ['team', 'synced', 1]]);
    const one = (await ed.get(`/library/${it.id}`)).json;
    assert.deepEqual([one.usedOn, one.uses.length], [2, 2]);
    const synced = (await ed.get('/library?synced=1')).json;
    assert.equal(synced.items.find((x) => x.id === it.id).usedOn, 2);
    // the "Synced (N)" chip: the synced items within the kind filter, whatever the synced filter says
    assert.equal(synced.facets.synced, synced.total);
    assert.equal((await ed.get('/library?kind=section')).json.facets.synced, (await ed.get('/library?kind=section&synced=1')).json.total);
    assert.equal((await ed.get('/library?kind=snippet')).json.facets.synced, (await ed.get('/library?kind=snippet&synced=1')).json.total);
    // changing the copy on a page without detaching it: refused, in words, nothing written
    const head = fx.git('rev-parse', 'HEAD').trim();
    const edited = await page('about-us', (d) => ({ ...d, sections: d.sections.map((s, i) => (i === 3 ? { ...s, value: { ...s.value, heading: 'Changed here' } } : s)) }));
    assert.equal(edited.status, 409);
    assert.equal(edited.json.error, 'synced');
    assert.match(edited.json.message, /“Talk to us” is synced from the Library: change it there/);
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), head);
    // other changes on that page save as always
    assert.equal((await page('about-us', (d) => ({ ...d, title: 'About Example Co' }))).status, 200);
    // a copy changed outside Markstage (by hand in git) is left alone when the item changes, and listed
    const team = pageData('team');
    team.sections[3].value.heading = 'Changed by hand';
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/team.json'), `${JSON.stringify(team, null, 2)}\n`);
    fx.git('commit', '-q', '-am', 'A hand edit');
    assert.deepEqual((await ed.get(`/library/${it.id}/impact`)).json.pages.map((p) => [p.id, p.state]).sort(), [['about-us', 'synced'], ['team', 'changed']]);
    const next = { value: { ...cta, value: { ...cta.value, heading: 'Ready when you are' } } };
    const put = await ed.put(`/library/${it.id}`, { body: next, version: one.version });
    assert.equal(put.status, 200, put.text);
    assert.deepEqual([put.json.changed, put.json.skipped.map((u) => u.id)], [1, ['team']]);
    assert.ok(put.json.job?.id, 'a live page changed: built and deployed');
    await srv.app.jobs.idle();
    assert.equal(srv.app.jobs.get(put.json.job.id).status, 'succeeded');
    assert.equal(pageData('about-us').sections[3].value.heading, 'Ready when you are');
    assert.deepEqual(pageData('about-us').sections[3]._synced, { id: it.id, version: syncVersion(next) });
    assert.equal(pageData('team').sections[3].value.heading, 'Changed by hand');
    // one commit: the item and the page
    const files = fx.git('show', '--name-only', '--format=%s', 'HEAD').trim().split('\n').filter(Boolean);
    assert.deepEqual([files[0], files.slice(1).sort()], ['Library: change the section “Talk to us” on 1 page', [`markstage/library/section/${it.id}.json`, 'src/content/pages/about-us.json']]);
    // a stale version is refused
    assert.equal((await ed.put(`/library/${it.id}`, { body: next, version: one.version })).status, 409);
    // the content check says it in words: keep it as its own copy, or reset it to the Library version
    const pf = (await ed.get('/collections/pages/entries/team/preflight')).json;
    assert.deepEqual(pf.synced.map((x) => [x.id, x.name, x.canReset]), [[it.id, 'Talk to us', true]]);
    assert.match(pf.synced[0].message, /^This copy of “Talk to us” was changed here, so it no longer follows the Library\. Keep it as its own copy \(detach it\) or reset it to the Library version\.$/);
    assert.deepEqual(pf.rules.filter((r) => r.rule === 'synced').map((r) => [r.level, r.count]), [['warn', 1]]);
    assert.deepEqual((await ed.get('/collections/pages/entries/about-us/preflight')).json.synced, []);
    // reset: the page's copy is the item again, one commit, the live page built; an author may not
    assert.equal((await alice.post(`/library/${it.id}/reset`, { collection: 'pages', entry: 'team' })).status, 403);
    const reset = await ed.post(`/library/${it.id}/reset`, { collection: 'pages', entry: 'team' });
    assert.equal(reset.status, 200, reset.text);
    assert.equal(reset.json.copies, 1);
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Library: reset the section “Talk to us” on “' + pageData('team').title + '”');
    await srv.app.jobs.idle();
    assert.ok(reset.json.job?.id, 'the page is live: built and deployed');
    assert.equal(srv.app.jobs.get(reset.json.job.id).status, 'succeeded');
    assert.equal(canon(plain(pageData('team').sections[3])), canon(next.value));
    assert.deepEqual(pageData('team').sections[3]._synced, { id: it.id, version: syncVersion(next) });
    assert.deepEqual((await ed.get('/collections/pages/entries/team/preflight')).json.synced, []);
    assert.equal((await ed.post(`/library/${it.id}/reset`, { collection: 'pages', entry: 'team' })).status, 409, 'nothing to reset');
    // detach: drop the marker, the section stays as it is
    assert.equal((await page('team', (d) => ({ ...d, sections: d.sections.map((s) => { const { _synced, ...rest } = s; return rest; }) }))).status, 200);
    assert.deepEqual((await ed.get(`/library/${it.id}/impact`)).json.pages.map((p) => p.id), ['about-us']);
    assert.equal(pageData('team').sections[3].value.heading, 'Ready when you are');
  });

  test('a failed publish after edit everywhere puts the pages and the item back', async () => {
    const value = pageData('about-us').sections[1];
    const it = (await ed.post('/library', { kind: 'section', name: 'About text', synced: true, body: { value } })).json;
    assert.equal((await page('about-us', (d) => ({ ...d, sections: d.sections.map((s, i) => (i === 1 ? { ...s, _synced: { id: it.id } } : s)) }))).status, 200);
    const itemRel = `markstage/library/section/${it.id}.json`;
    const itemBefore = read(itemRel);
    const pageBefore = read('src/content/pages/about-us.json');
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    try {
      const put = await ed.put(`/library/${it.id}`, { body: { value: { ...value, value: { ...value.value, html: '<p>New words</p>' } } }, version: it.version });
      assert.equal(put.status, 200, put.text);
      await srv.app.jobs.idle();
      assert.equal(srv.app.jobs.get(put.json.job.id).status, 'failed');
    } finally {
      fs.rmSync(`${fx.failMarker}.build`, { force: true });
    }
    assert.equal(read('src/content/pages/about-us.json'), pageBefore);
    assert.equal(read(itemRel), itemBefore);
    assert.match(fx.git('log', '-1', '--format=%s').trim(), /^Revert the library-sync/);
  });

  test('a page copy of a locked item carries its locks: deleting or moving it is refused like any locked section', async () => {
    const hero = pageData('team').sections[0];
    const it = (await ed.post('/library', { kind: 'section', name: 'Team hero', synced: true, locks: { remove: true, move: true }, body: { value: hero } })).json;
    assert.equal((await page('team', (d) => ({ ...d, sections: [{ ...d.sections[0], _synced: { id: it.id } }, ...d.sections.slice(1)] }))).status, 200);
    const copy = pageData('team').sections[0];
    // in the section's value, where a site keeps a lock (its legal pages, the editor's padlock)
    assert.deepEqual([copy.value._lock?.remove, copy.value._lock?.move], [true, true], 'the server gives the copy its item’s locks');
    assert.equal(copy._lock, undefined, 'never on the section itself');
    assert.ok(copy._synced, 'the Library marker stays on the section');
    const del = await page('team', (d) => ({ ...d, sections: d.sections.slice(1) }));
    assert.equal(del.status, 423);
    assert.equal((await page('team', (d) => ({ ...d, sections: [d.sections[1], d.sections[0], ...d.sections.slice(2)] }))).status, 200, 'other sections move past it');
  });

  test('an article piece: frontmatter marker, found by its Markdown; changed in place 409; edit everywhere; locks', async () => {
    const piece = { doc: { type: 'doc', content: [para('Book a free 30-minute call with our team.'), para('We reply within one business day.')] } };
    const it = (await ed.post('/library', { kind: 'snippet', name: 'Call to action', synced: true, body: piece })).json;
    const made = await alice.post('/collections/posts/entries', { title: 'Synced test', frontmatter: { author: 'alice', synced: [{ id: it.id }] }, doc: { type: 'doc', content: [para('Intro.'), ...piece.doc.content, para('Outro.')] } });
    assert.equal(made.status, 201, made.text);
    const rel = 'src/content/blog/synced-test.md';
    assert.match(read(rel), /Book a free 30-minute call with our team\.\n\nWe reply within one business day\./);
    assert.match(read(rel), new RegExp(`version: ${syncVersion(it.body)}`), 'the server writes the version');
    assert.deepEqual((await ed.get(`/library/${it.id}/impact`)).json.pages.map((p) => [p.collection, p.id, p.state]), [['posts', 'synced-test', 'synced']]);
    // changed in place without detaching: refused
    const edited = await save('posts', 'synced-test', (t) => t.replace('within one business day', 'within an hour'), alice);
    assert.equal(edited.status, 409);
    // edit everywhere: the blocks are replaced where they stand, the marker follows
    const next = { doc: { type: 'doc', content: [para('Book a free call with our team.'), para('We reply the same day.')] } };
    const put = await ed.put(`/library/${it.id}`, { body: next, version: it.version });
    assert.equal(put.status, 200, put.text);
    assert.equal(put.json.changed, 1);
    const text = read(rel);
    assert.match(text, /Intro\.\n\nBook a free call with our team\.\n\nWe reply the same day\.\n\nOutro\./);
    assert.doesNotMatch(text, /30-minute/);
    assert.match(text, new RegExp(`version: ${syncVersion(next)}`));
    // locked against removal: deleting the piece is refused for everyone; an author may not detach it
    const cur = (await ed.get(`/library/${it.id}`)).json;
    assert.equal((await ed.patch(`/library/${it.id}`, { locks: { remove: true }, version: cur.version })).status, 200);
    const gone = await save('posts', 'synced-test', (t) => t.replace('Book a free call with our team.\n\nWe reply the same day.\n\n', ''), alice);
    assert.equal(gone.status, 423);
    const detach = await save('posts', 'synced-test', (t) => t.replace(/synced:\n(\s+.*\n)+?(?=\w)/, ''), alice);
    assert.equal(detach.status, 403, detach.text);
    assert.match(detach.json.message, /only an editor can detach it/);
  });

  test('delete: refused while in use, naming the pages; with detach every copy stays as plain content, in the same commit', async () => {
    const value = pageData('about-us').sections[2];
    const it = (await ed.post('/library', { kind: 'section', name: 'Credentials', synced: true, body: { value } })).json;
    assert.equal((await page('about-us', (d) => ({ ...d, sections: d.sections.map((s, i) => (i === 2 ? { ...s, _synced: { id: it.id } } : s)) }))).status, 200);
    const refused = await ed.del(`/library/${it.id}`);
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error, 'in-use');
    assert.deepEqual(refused.json.pages.map((p) => p.id), ['about-us']);
    const del = await ed.del(`/library/${it.id}?detach=1`);
    assert.equal(del.status, 200);
    assert.equal(pageData('about-us').sections[2]._synced, undefined);
    assert.equal(canon(plain(pageData('about-us').sections[2])), canon(value));
    const files = fx.git('show', '--name-only', '--format=%s', 'HEAD').trim().split('\n').filter(Boolean);
    assert.deepEqual([files[0], files.slice(1).sort()], ['Library: delete the section “Credentials” (1 page keeps a plain copy)', [`markstage/library/section/${it.id}.json`, 'src/content/pages/about-us.json']]);
    assert.equal((await ed.post('/library', { kind: 'template', name: 'T', synced: true, collection: 'posts', body: {} })).status, 422, 'a template is not synced');
    assert.ok(gitLog(fx, 'markstage/library').length > 0);
  });
});
