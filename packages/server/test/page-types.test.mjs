// Page frames and types on the server (docs/API-PAGE-TYPES.md): the check every entry write makes (a frame or type
// that is not the site's refused, an old one left alone; only editors and above change a page's type); the type's
// locks held on its pages (and on a save that drops the type); a new entry by its type (its template and key); the
// type's checks, in page-checks and in the preflight (a failed "block" check stops a publish).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { as, makeFixture, readFile, startServer, writeFile } from './helpers.mjs';

const CONFIG = `export default {
  frames: true,
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/', frame: 'reading' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', url: '/{id}/', frame: 'full' },
  ],
  pageTypes: {
    types: [
      {
        id: 'money', label: 'Money page', collections: ['pages'], frame: 'full', template: 'lib_money-page',
        locks: { pages: { booking: ['remove'] } },
        checks: [
          { id: 'booking', label: 'A booking button', section: 'booking', level: 'block' },
          { id: 'faq', label: 'Questions and answers', section: 'faq' },
          { id: 'service', label: 'Service structured data', jsonld: 'Service' },
        ],
      },
      { id: 'pillar', label: 'Pillar page', collections: ['pages'], frame: 'reading' },
      { id: 'plain', label: 'Plain page', collections: ['pages'], frame: 'plain' },
      {
        id: 'article', label: 'Article', collections: ['posts'],
        checks: [
          { id: 'hub', label: 'Links to its hub', linksTo: { pageType: 'pillar', sameField: 'cluster' } },
          { id: 'money', label: 'Links to a money page', linksTo: { pageType: 'money' } },
        ],
      },
    ],
  },
};
`;
const page = (o) => `${JSON.stringify(o, null, 2)}\n`;
const MONEY = { title: 'Services', pageType: 'money', sections: [{ discriminant: 'hero', value: { heading: 'Hire us' } }, { discriminant: 'booking', value: { label: 'Book a call' } }] };
const TEMPLATE = { id: 'lib_money-page', name: 'Money page', collection: 'pages', body: { data: { pageType: 'money', sections: [{ discriminant: 'booking', value: { label: 'Book a call' } }, { discriminant: 'faq', value: { items: [] } }] } } };

describe('page frames and types on the server', () => {
  let fx, srv, ed, alice;
  const src = async (c, id, who = ed) => (await who.get(`/collections/${c}/entries/${id}/source`)).json;
  const save = async (c, id, f, who = ed) => {
    const s = await src(c, id, who);
    return who.put(`/collections/${c}/entries/${id}/source`, { version: s.version, source: f(s.source) });
  };
  const json = (id, f, who) => save('pages', id, (t) => page(f(JSON.parse(t))), who);

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONFIG);
    writeFile(fx, 'src/content/pages/services.json', page(MONEY));
    writeFile(fx, 'src/content/pages/basics.json', page({ title: 'Basics', pageType: 'pillar', cluster: 'basics', sections: [] }));
    writeFile(fx, 'src/content/pages/old.json', page({ title: 'Old', frame: 'wide', sections: [] }));
    writeFile(fx, 'src/content/blog/typed.md', "---\ntitle: Typed\nauthor: alice\npageType: article\ncluster: basics\ndate: '2026-03-01T10:00:00.000Z'\ndraft: true\n---\n\nRead [the basics](/basics/).\n");
    fs.mkdirSync(path.join(fx.site, 'markstage/library/template'), { recursive: true });
    writeFile(fx, 'markstage/library/template/lib_money-page.json', page(TEMPLATE));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Typed pages');
    srv = await startServer(fx, { overrides: { collections: [] }, core: await loadCore() });
    ed = await as(srv, 'editor');
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv.close());

  test('a frame or type that is not the site’s is refused (422); an old one is left alone', async () => {
    const r = await json('about', (d) => ({ ...d, frame: 'wide' }));
    assert.equal(r.status, 422, r.text);
    assert.equal(r.json.error, 'invalid-page');
    assert.match(r.json.message, /“wide” is not a frame of this site\. Pick one of: Full width, Reading, Plain\./);
    const t = await json('about', (d) => ({ ...d, pageType: 'article' }));
    assert.equal(t.status, 422);
    assert.match(t.json.message, /“article” is not a page type here\. Pick one of: Money page, Pillar page, Plain page\./);
    assert.equal((await json('about', (d) => ({ ...d, frame: 'plain', pageType: 'plain' }))).status, 200);
    // the old page keeps its odd frame through an unrelated change
    assert.equal((await json('old', (d) => ({ ...d, title: 'Old page' }))).status, 200);
  });

  test('only editors and above change a page’s type; an author sets one on a new post', async () => {
    const r = await save('posts', 'typed', (t) => t.replace('pageType: article\n', ''), alice);
    assert.equal(r.status, 403, r.text);
    assert.match(r.json.message, /Only an owner, administrator or editor can change what type of page this is\./);
    const made = await alice.post('/collections/posts/entries', { title: 'Fresh', pageType: 'article' });
    assert.equal(made.status, 201, made.text);
    assert.match(readFile(fx, `src/content/blog/${made.json.id}.md`), /\npageType: article\n/);
    assert.equal((await alice.post('/collections/posts/entries', { title: 'Wrong', pageType: 'money' })).status, 422);
  });

  test('a new page by its type starts from the type’s template, with the type set', async () => {
    const r = await ed.post('/collections/pages/entries', { title: 'Payroll help', pageType: 'money' });
    assert.equal(r.status, 201, r.text);
    const d = JSON.parse(readFile(fx, `src/content/pages/${r.json.id}.json`));
    assert.equal(d.pageType, 'money');
    assert.deepEqual(d.sections.map((s) => s.discriminant), ['booking', 'faq']);
  });

  test('the type’s locks hold on its pages, and on a save that drops the type with the block', async () => {
    const head = fx.git('rev-parse', 'HEAD').trim();
    const r = await json('services', (d) => ({ ...d, sections: d.sections.filter((s) => s.discriminant !== 'booking') }));
    assert.equal(r.status, 423, r.text);
    assert.deepEqual(r.json.blocks.map((b) => [b.what, b.type]), [['remove', 'booking']]);
    const both = await json('services', ({ pageType: _t, ...d }) => ({ ...d, sections: d.sections.filter((s) => s.discriminant !== 'booking') }));
    assert.equal(both.status, 423, both.text);
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), head);
    // a page of another type may drop its own booking section
    writeFile(fx, 'src/content/pages/thanks.json', page({ title: 'Thanks', pageType: 'plain', sections: [{ discriminant: 'booking', value: {} }] }));
    assert.equal((await json('thanks', (d) => ({ ...d, sections: [] }))).status, 200);
  });

  test('page-checks: the type, the frame and what the page still needs', async () => {
    const r = await ed.get('/collections/pages/entries/services/page-checks');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.type, { id: 'money', label: 'Money page' });
    assert.deepEqual([r.json.frame.id, r.json.frame.from], ['full', 'type']);
    assert.deepEqual(r.json.checks.map((k) => [k.id, k.ok, k.level]), [['booking', true, 'block'], ['faq', false, 'warn'], ['service', false, 'warn']]);
    assert.match(r.json.checks[1].message, /Add a “faq” section/);
    // the article links to its hub (same cluster), not yet to a money page
    const a = (await ed.get('/collections/posts/entries/typed/page-checks')).json;
    assert.deepEqual([a.frame.id, a.frame.from], ['reading', 'collection']);
    assert.deepEqual(a.checks.map((k) => [k.id, k.ok]), [['hub', true], ['money', false]]);
    assert.match(a.checks[1].message, /Link to a money page from the text\./);
    // a page with no type: its frame only
    const p = (await ed.get('/collections/pages/entries/basics/page-checks')).json;
    assert.deepEqual([p.type.id, p.frame.id, p.checks.length], ['pillar', 'reading', 0]);
  });

  test('the preflight: failed checks at their level; a missing booking button stops a publish', async () => {
    const pf = (await ed.get('/collections/pages/entries/services/preflight')).json;
    assert.equal(pf.page.type.id, 'money');
    assert.deepEqual(pf.rules.filter((v) => v.rule === 'pageType').map((v) => [v.check, v.level]), [['faq', 'warn'], ['service', 'warn']]);
    assert.equal(pf.blocked, false);
    writeFile(fx, 'src/content/pages/bare.json', page({ title: 'Bare', pageType: 'money', sections: [] }));
    const bare = (await ed.get('/collections/pages/entries/bare/preflight')).json;
    assert.equal(bare.blocked, true);
    assert.deepEqual(bare.rules.find((v) => v.check === 'booking'), { rule: 'pageType', level: 'block', check: 'booking', count: 1, message: 'Add a “booking” section: this page has none.' });
    // the server's own verdicts (what publish and schedule ask)
    assert.deepEqual(srv.app.publishRules.blocking(srv.app.store.collection('pages'), 'bare', readFile(fx, 'src/content/pages/bare.json')).map((v) => v.check), ['booking']);
  });
});
