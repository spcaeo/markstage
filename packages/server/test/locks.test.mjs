// Locks enforced by the server on site-shaped files (core's fixtures/site, an example site's pages and article): the
// owner's rules in markstage.config, an editor's `_lock` in a page and heading locks in an article. A save that
// deletes, moves or changes a locked block gets 423 naming it, for every role and every save route; an author may not
// lock or unlock (403); an editor may, audited; other blocks move past a locked one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../core/test/fixtures/site');
const CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages' },
  ],
  locks: {
    pages: { hero: ['move', 'remove'], credentials: ['move', 'remove'], contact: ['move', 'remove'], 'cluster-list': ['remove'], 'page-list': ['remove'] },
    articles: { faq: ['move', 'remove'], takeaways: ['move'] },
  },
};
`;

describe('locks on the server', () => {
  let fx, srv, ed, alice;
  const src = async (c, id, who = ed) => (await who.get(`/collections/${c}/entries/${id}/source`)).json;
  const save = async (c, id, f, who = ed) => {
    const s = await src(c, id, who);
    return who.put(`/collections/${c}/entries/${id}/source`, { version: s.version, source: f(s.source) });
  };
  const page = (f) => save('pages', 'about-us', (t) => `${JSON.stringify(f(JSON.parse(t)), null, 2)}\n`);
  const audits = (action) => srv.app.db.prepare('SELECT detail FROM audit WHERE action = ? ORDER BY id').all(action).map((r) => JSON.parse(r.detail));

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONFIG);
    fs.copyFileSync(path.join(SITE, 'about-us.json'), path.join(fx.site, 'src/content/pages/about-us.json'));
    // the article as Alice's draft
    const art = fs.readFileSync(path.join(SITE, 'planning-tools-compared.md'), 'utf8').replace(/^author: .*$/m, 'author: alice').replace(/^modified: .*$/m, (m) => `${m}\ndraft: true`);
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/planning-tools-compared.md'), art);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A real page and article');
    srv = await startServer(fx, { overrides: { collections: [], packs: [path.join(SITE, 'pack.mjs')] }, core: await loadCore() });
    ed = await as(srv, 'editor');
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv.close());

  test('a page: deleting the hero is refused (423, naming it), the repo untouched; others move past it', async () => {
    const head = fx.git('rev-parse', 'HEAD').trim();
    const r = await page((d) => ({ ...d, sections: d.sections.slice(1) }));
    assert.equal(r.status, 423, r.text);
    assert.equal(r.json.error, 'locked');
    assert.deepEqual(r.json.blocks.map((b) => [b.what, b.type, b.by]), [['remove', 'hero', 'the site']]);
    assert.match(r.json.message, /is locked by the site: it can't be deleted\./);
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), head);
    // the hero and the credentials changing places
    assert.equal((await page((d) => ({ ...d, sections: [d.sections[2], d.sections[1], d.sections[0], d.sections[3]] }))).status, 423);
    // the prose below the credentials: allowed
    assert.equal((await page((d) => ({ ...d, sections: [d.sections[0], d.sections[2], d.sections[1], d.sections[3]] }))).status, 200);
  });

  test('every save route: the JSON data save too', async () => {
    const e = (await ed.get('/collections/pages/entries/about-us')).json;
    const data = { ...e.data, sections: e.data.sections.filter((s) => s.discriminant !== 'credentials') };
    const r = await ed.put('/collections/pages/entries/about-us', { version: e.version, data });
    assert.equal(r.status, 423, r.text);
    assert.equal(r.json.blocks[0].type, 'credentials');
  });

  test("an editor's own lock on a section: added and taken off by an editor (audited), never by an author", async () => {
    const at = (d) => d.sections.findIndex((s) => s.discriminant === 'cta');
    const lock = await page((d) => ({ ...d, sections: d.sections.map((s, i) => (i === at(d) ? { ...s, _lock: { remove: true } } : s)) }));
    assert.equal(lock.status, 200, lock.text);
    assert.deepEqual(audits('entry.lock').map((a) => [a.path, a.to]), [['sections[3]', { remove: true }]]);
    assert.equal((await page((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== at(d)) }))).status, 423, 'the call to action stays');
    const unlock = await page((d) => ({ ...d, sections: d.sections.map((s) => (s._lock ? (({ _lock, ...rest }) => rest)(s) : s)) }));
    assert.equal(unlock.status, 200, unlock.text);
    assert.equal(audits('entry.unlock').length, 1);
    assert.equal((await page((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== at(d)) }))).status, 200, 'unlocked first, then deleted');
  });

  test('a lock inside a section\'s value (as the site and the editor keep it) binds; by and at are written beside it', async () => {
    // as a site's privacy-policy and terms-and-conditions may carry it: sections[1].value._lock {edit: true}
    const prose = (d) => d.sections.findIndex((s) => s.discriminant === 'prose');
    const lock = await page((d) => ({ ...d, sections: d.sections.map((s, i) => (i === prose(d) ? { ...s, value: { ...s.value, _lock: { edit: true } } } : s)) }));
    assert.equal(lock.status, 200, lock.text);
    const stored = JSON.parse(fs.readFileSync(path.join(fx.site, 'src/content/pages/about-us.json'), 'utf8'));
    const sec = stored.sections[prose(stored)];
    assert.equal(sec._lock, undefined, 'nothing written on the section itself');
    assert.deepEqual(Object.keys(sec.value._lock), ['edit', 'by', 'at']);
    assert.equal(sec.value._lock.by, (await ed.get('/auth/me')).json.user.name);
    const edit = await page((d) => ({ ...d, sections: d.sections.map((s, i) => (i === prose(d) ? { ...s, value: { ...s.value, html: `${s.value.html}<p>More.</p>` } } : s)) }));
    assert.equal(edit.status, 423, edit.text);
    assert.deepEqual(edit.json.blocks.map((b) => [b.what, b.type]), [['edit', 'prose']]);
    const off = await page((d) => ({ ...d, sections: d.sections.map((s) => (s.value?._lock ? { ...s, value: (({ _lock, ...rest }) => rest)(s.value) } : s)) }));
    assert.equal(off.status, 200, off.text);
  });

  test("an article: the FAQ stays and the takeaways keep their place, for the author; the author can't unlock", async () => {
    const faqs = (t) => t.match(/<details>[\s\S]*?<\/details>\n*/g);
    const none = await save('posts', 'planning-tools-compared', (t) => faqs(t).reduce((x, f) => x.replace(f, ''), t), alice);
    assert.equal(none.status, 423, none.text);
    assert.deepEqual(none.json.blocks.map((b) => [b.what, b.type]), [['remove', 'faq']]);
    assert.equal((await save('posts', 'planning-tools-compared', (t) => t.replace(faqs(t)[1], ''), alice)).status, 200, 'one question may go');
    const tk = /<aside class="takeaways"[\s\S]*?<\/aside>\n\n/;
    const moved = await save('posts', 'planning-tools-compared', (t) => `${t.replace(tk, '').trimEnd()}\n\n${tk.exec(t)[0].trim()}\n`, alice);
    assert.equal(moved.status, 423, moved.text);
    assert.equal(moved.json.blocks[0].what, 'move');
    // a heading lock: an editor adds it; the author may neither take it off nor change the section
    const fm = (t, line) => t.replace(/^---\n/, `---\n${line}`);
    const L = 'locks:\n  - heading: "Quick Comparison: 7 Hearth Alternatives"\n    remove: true\n    edit: true\n';
    assert.equal((await save('posts', 'planning-tools-compared', (t) => fm(t, L), alice)).status, 403, 'an author cannot lock');
    assert.equal((await save('posts', 'planning-tools-compared', (t) => fm(t, L))).status, 200, 'an editor can');
    // the server wrote who set it and when, in the frontmatter, under the lock
    const stored = fs.readFileSync(path.join(fx.site, 'src/content/blog/planning-tools-compared.md'), 'utf8');
    const block = /^locks:\n(?: {2}.*\n)+/m.exec(stored)?.[0];
    assert.ok(block, stored.slice(0, 400));
    assert.match(block, new RegExp(`by: ${(await ed.get('/auth/me')).json.user.name}\\n`), 'the signed-in person, not what the editor sent');
    assert.match(block, /at: .*20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ/);
    const off = await save('posts', 'planning-tools-compared', (t) => t.replace(/^locks:\n(?: {2}.*\n)+/m, ''), alice);
    assert.equal(off.status, 403, off.text);
    assert.match(off.json.message, /Only an owner, administrator or editor can lock or unlock/);
    const h = '## Quick Comparison: 7 Hearth Alternatives\n\n';
    const edit = await save('posts', 'planning-tools-compared', (t) => t.replace(h, `${h}A new first line.\n\n`), alice);
    assert.equal(edit.status, 423, edit.text);
    assert.equal(edit.json.blocks[0].by, 'an editor');
  });
});
