// "Unlock on this page" (a false in an entry's own marker lifts the site's rule there only; an editor's, audited with
// rule: 'site', who and when written by the server) and Settings → Locks (the site's rules for every page, kept in
// markstage.locks.json once changed: owner and administrator, version-checked, committed, audited), on a real site's
// kind of rules and core's site-shaped fixture files.
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

describe('lock overrides and the site-wide rules', () => {
  let fx, srv, ed, alice, admin;
  const file = (rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');
  const src = async (c, id, who) => (await who.get(`/collections/${c}/entries/${id}/source`)).json;
  const save = async (c, id, f, who = ed) => {
    const s = await src(c, id, who);
    return who.put(`/collections/${c}/entries/${id}/source`, { version: s.version, source: f(s.source) });
  };
  const page = (id, f, who = ed) => save('pages', id, (t) => `${JSON.stringify(f(JSON.parse(t)), null, 2)}\n`, who);
  const audits = (action) => srv.app.db.prepare('SELECT detail FROM audit WHERE action = ? ORDER BY id').all(action).map((r) => JSON.parse(r.detail));
  const faqs = (t) => t.match(/<details>[\s\S]*?<\/details>\n*/g);

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONFIG);
    for (const p of ['about-us', 'contact-us', 'data-migration']) fs.copyFileSync(path.join(SITE, `${p}.json`), path.join(fx.site, `src/content/pages/${p}.json`));
    const art = fs.readFileSync(path.join(SITE, 'planning-tools-compared.md'), 'utf8').replace(/^author: .*$/m, 'author: alice').replace(/^modified: .*$/m, (m) => `${m}\ndraft: true`);
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/planning-tools-compared.md'), art);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Real pages and an article');
    srv = await startServer(fx, { overrides: { collections: [], packs: [path.join(SITE, 'pack.mjs')] }, core: await loadCore() });
    ed = await as(srv, 'editor');
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    admin = await as(srv, 'administrator');
  });
  after(() => srv.close());

  test('"Unlock on this page" on a page: an editor lifts the hero\'s rule (audited, stamped, last key); then anyone may delete it there', async () => {
    const lift = (d) => ({ ...d, sections: d.sections.map((s, i) => (i === 0 ? { ...s, _lock: { move: false, remove: false, by: 'someone@else.example', at: '1999-01-01T00:00:00Z' } } : s)) });
    const no = await page('about-us', lift, alice);
    assert.equal(no.status, 403, 'an author cannot lift a site rule');
    const r = await page('about-us', lift);
    assert.equal(r.status, 200, r.text);
    const hero = JSON.parse(file('src/content/pages/about-us.json')).sections[0];
    assert.equal(Object.keys(hero).at(-1), '_lock', 'written last');
    const me = (await ed.get('/auth/me')).json.user.name;
    assert.equal(hero._lock.by, me, 'the server says who, not the editor');
    assert.match(hero._lock.at, /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.notEqual(hero._lock.at, '1999-01-01T00:00:00Z');
    assert.deepEqual(audits('entry.unlock').map((a) => [a.path, a.rule, a.to]), [['sections[0]', 'site', { move: false, remove: false }]]);
    // here the hero may now go, even for the author; on another page the rule still holds
    assert.equal((await page('about-us', (d) => ({ ...d, sections: d.sections.slice(1) }))).status, 200);
    const other = await page('contact-us', (d) => ({ ...d, sections: d.sections.filter((s) => s.discriminant !== 'contact') }));
    assert.equal(other.status, 423, other.text);
  });

  test('"Unlock on this page" in an article: a box lock in the frontmatter lifts the FAQ\'s rule for this article', async () => {
    const L = 'locks:\n  - box: faq\n    move: false\n    remove: false\n';
    const add = (t) => t.replace(/^---\n/, `---\n${L}`);
    assert.equal((await save('posts', 'planning-tools-compared', add, alice)).status, 403);
    assert.equal((await save('posts', 'planning-tools-compared', add)).status, 200);
    assert.deepEqual(audits('entry.unlock').at(-1).rule, 'site');
    assert.match(file('src/content/blog/planning-tools-compared.md'), /^ {4}by: .+\n {4}at: 20/m);
    // every question may go now, by the author too
    const gone = await save('posts', 'planning-tools-compared', (t) => faqs(t).reduce((x, f) => x.replace(f, ''), t), alice);
    assert.equal(gone.status, 200, gone.text);
  });

  test('Settings → Locks: everyone reads the rules and the kinds; only owner and administrator change them, checked and committed', async () => {
    const r = await alice.get('/site/locks');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.source, 'config');
    assert.deepEqual(r.json.rules.pages.hero, { move: true, remove: true });
    const types = r.json.kinds.pages.map((k) => k.type);
    for (const t of ['hero', 'credentials', 'cta', 'prose', 'contact', 'page-list']) assert.ok(types.includes(t), t);
    assert.deepEqual(r.json.kinds.pages.find((k) => k.type === 'cluster-list'), { type: 'cluster-list', label: 'Cluster list' });
    const boxes = r.json.kinds.articles.map((k) => k.type);
    for (const b of ['faq', 'takeaways', 'sideNote']) assert.ok(boxes.includes(b), b);
    const rules = { ...r.json.rules, pages: { ...r.json.rules.pages, prose: { remove: true } } };
    delete rules.pages.contact;
    assert.equal((await ed.put('/site/locks', { rules, version: r.json.version })).status, 403);
    assert.equal((await admin.put('/site/locks', { rules, version: 'stale' })).status, 409);
    const bad = await admin.put('/site/locks', { rules: { pages: { hero: ['fly'] } }, version: r.json.version });
    assert.equal(bad.status, 400);
    assert.match(bad.json.message, /^Lock rules: /);
    const head = fx.git('rev-parse', 'HEAD').trim();
    const ok = await admin.put('/site/locks', { rules, version: r.json.version });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.source, 'file');
    assert.ok(JSON.parse(file('markstage.locks.json')).pages.prose.includes('remove'));
    assert.equal(fx.git('log', '-1', '--format=%s', `${head}..HEAD`).trim(), 'Lock rules for every page');
    assert.deepEqual(fx.git('show', '--name-only', '--format=', 'HEAD').trim(), 'markstage.locks.json');
    // the administrators hear of it (lock.changed); the editor's lifts on single pages above too
    const locks = srv.app.db.prepare("SELECT user_id, text, link FROM notices WHERE kind = 'lock.changed' ORDER BY rowid").all();
    assert.match(locks[0].text, /^.+ unlocked .+ \(the site's rule, on this page only\) in “.+”\.$/);
    assert.equal(locks.at(-1).text, `${(await admin.get('/auth/me')).json.user.name} changed the lock rules for every page (Settings → Locks).`);
    assert.equal(locks.at(-1).link, '#/settings/locks');
    assert.ok(locks.every((l) => l.user_id === admin.user.id), 'administrators only');
    const audit = audits('site.locks').at(-1);
    assert.equal(audit.was, 'config');
    assert.equal(audit.to.pages.contact, undefined);
    // saves follow the new rules at once: the contact section may go, the prose may not
    assert.equal((await page('contact-us', (d) => ({ ...d, sections: d.sections.filter((s) => s.discriminant !== 'contact') }))).status, 200);
    const prose = await page('about-us', (d) => ({ ...d, sections: d.sections.filter((s) => s.discriminant !== 'prose') }));
    assert.equal(prose.status, 423, prose.text);
    assert.deepEqual(prose.json.blocks.map((b) => [b.what, b.type, b.by]), [['remove', 'prose', 'the site']]);
    assert.equal((await alice.get('/site/locks')).json.version, ok.json.version);
    // the same rules again: nothing to commit
    const same = await admin.put('/site/locks', { rules, version: ok.json.version });
    assert.deepEqual([same.status, same.json.commit], [200, null]);
  });
});
