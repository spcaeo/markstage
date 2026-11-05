// The search help's AI kinds (docs/API-AI.md "links", "fix", seo's `problem`): internal links picked from the site's
// own link index, and a fix for one problem the SEO check found. With the stub provider, then with a fake fetch that
// answers what a careless model might (no real API call, no key from this machine): a page it was not offered, words
// not in the article, a page linked already, a draft the person may not see, vague words, a heading still out of
// order, a "shorter" title that is not. Each is dropped or refused on the server. The same rights, limits and audit
// as every kind, and nothing committed.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { findWords } from '../src/ai/seo-kinds.mjs';
import { as, makeFixture, startServer, writeFile } from './helpers.mjs';

const CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', url: '/{id}/' },
  ],
  topics: { generic: ['over there'] },
};
`;
const post = (title, body, extra = '') => `---\ntitle: ${title}\nauthor: alice\ndate: '2026-03-01T10:00:00.000Z'\n${extra}---\n\n${body}\n`;
const NOTES = 'These notes talk about keyboard shortcuts for editors, the editing guide and canvas basics. Secret plans and hidden extras too. To learn more, [click here](/blog/guide/).';

/** The topics site: notes that name four pages (one linked already, one a draft by Bob, one hidden), and a draft of Alice's. */
function topicsFixture() {
  const fx = makeFixture({ checks: false });
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONFIG);
  writeFile(fx, 'src/content/blog/guide.md', post('The editing guide', 'Everything about editing pages.'));
  writeFile(fx, 'src/content/blog/canvas.md', post('Canvas basics', 'The canvas shows the page as it will look.'));
  writeFile(fx, 'src/content/blog/shortcuts.md', post('Keyboard shortcuts for editors', 'Shortcuts save time.'));
  writeFile(fx, 'src/content/blog/secret.md', post('Secret plans', 'Not yet.', 'draft: true\n').replace('author: alice', 'author: bob'));
  writeFile(fx, 'src/content/blog/hidden.md', post('Hidden extras', 'Kept from search engines.', 'noindex: true\n'));
  writeFile(fx, 'src/content/blog/notes.md', post('Field notes', NOTES));
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Topics site');
  return fx;
}

const ask = (who, body) => who.post('/ai/suggest', body);
const refs = (r) => r.json.suggestion.links.map((l) => l.to);

describe('AI links and fixes with the stub provider', () => {
  let fx, srv, ed, alice, head0;

  before(async () => {
    fx = topicsFixture();
    head0 = fx.git('rev-parse', 'HEAD').trim();
    srv = await startServer(fx, { overrides: { collections: [], ai: { provider: 'stub', perMinute: 600, perDay: 100_000 } }, core: await loadCore() });
    ed = await as(srv, 'editor');
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv?.close());

  test('GET /ai lists links (the site keeps topics) and fix', async () => {
    assert.deepEqual((await alice.get('/ai')).json.kinds, ['alt', 'seo', 'rewrite', 'links', 'fix']);
  });

  test('links: pages the article names, never one linked already, hidden, or a draft the person may not see', async () => {
    const r = await ask(alice, { kind: 'links', collection: 'posts', id: 'notes' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(refs(r).sort(), ['posts/canvas', 'posts/shortcuts']);
    const canvas = r.json.suggestion.links.find((l) => l.to === 'posts/canvas');
    assert.deepEqual({ ...canvas, reason: undefined }, { words: 'canvas basics', to: 'posts/canvas', title: 'Canvas basics', url: '/blog/canvas/', status: 'published', reason: undefined });
    assert.match(canvas.reason, /Canvas basics/);
    assert.equal(r.json.suggestion.dropped, 0);
    // an editor may see Bob's draft: it is offered, marked a draft
    const e = await ask(ed, { kind: 'links', collection: 'posts', id: 'notes' });
    assert.deepEqual(refs(e).sort(), ['posts/canvas', 'posts/secret', 'posts/shortcuts']);
    assert.equal(e.json.suggestion.links.find((l) => l.to === 'posts/secret').status, 'draft');
  });

  test('links: the editor’s text now (unsaved) and its links count; max; sizes and shapes refused', async () => {
    const text = 'Keyboard shortcuts for editors are handy, and so are canvas basics.';
    const r = await ask(alice, { kind: 'links', collection: 'posts', id: 'notes', text, linked: ['/blog/canvas/'], max: 3 });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(refs(r), ['posts/shortcuts']);
    assert.equal((await ask(alice, { kind: 'links', collection: 'posts', id: 'notes', max: 1 })).json.suggestion.links.length, 1);
    for (const [body, field] of [
      [{ max: 0 }, 'max'],
      [{ max: 11 }, 'max'],
      [{ linked: 'x' }, 'linked'],
      [{ linked: Array(501).fill('/x/') }, 'linked'],
    ]) {
      const bad = await ask(alice, { kind: 'links', collection: 'posts', id: 'notes', ...body });
      assert.deepEqual([bad.status, bad.json.field], [422, field], JSON.stringify(body));
    }
    const big = await ask(alice, { kind: 'links', collection: 'posts', id: 'notes', text: 'x'.repeat(20_001) });
    assert.deepEqual([big.status, big.json.field], [413, 'text']);
    // the readable rule: Bob's draft is not Alice's to ask about
    assert.equal((await ask(alice, { kind: 'links', collection: 'posts', id: 'secret' })).status, 404);
  });

  test('seo with a problem: only that field, fixed as asked', async () => {
    const long = 'A very long search title that goes on and on about editing pages in the editor today';
    const t = await ask(alice, { kind: 'seo', collection: 'posts', id: 'notes', problem: 'title-long', searchTitle: long });
    assert.equal(t.status, 200, t.text);
    assert.deepEqual(Object.keys(t.json.suggestion), ['title']);
    assert.ok(t.json.suggestion.title.length < long.length);
    const d = await ask(alice, { kind: 'seo', collection: 'posts', id: 'notes', problem: 'description-missing' });
    assert.deepEqual(d.json.suggestion, { description: 'Stub description of Field notes.' });
    const s = await ask(alice, { kind: 'seo', collection: 'posts', id: 'notes', problem: 'description-short', description: 'Notes.' });
    assert.ok(s.json.suggestion.description.length > 'Notes.'.length);
    assert.deepEqual([(await ask(alice, { kind: 'seo', collection: 'posts', id: 'notes', problem: 'title-funny' })).json.field], ['problem']);
    assert.equal((await ask(alice, { kind: 'seo', collection: 'posts', id: 'notes', problem: 'description-long' })).status, 422, 'no description to shorten');
  });

  test('fix a heading: a level in order; one in order already is refused; shapes', async () => {
    const headings = [{ level: 1, text: 'Field notes' }, { level: 2, text: 'Tools' }, { level: 4, text: 'Shortcuts' }, { level: 1, text: 'Again' }, { level: 2, text: '' }];
    const r = await ask(alice, { kind: 'fix', collection: 'posts', id: 'notes', problem: 'heading', headings, index: 2 });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.suggestion, { level: 3, text: 'Shortcuts' });
    assert.deepEqual((await ask(alice, { kind: 'fix', collection: 'posts', id: 'notes', problem: 'heading', headings, index: 3 })).json.suggestion, { level: 2, text: 'Again' });
    assert.deepEqual((await ask(alice, { kind: 'fix', collection: 'posts', id: 'notes', problem: 'heading', headings, index: 4, after: 'Some text.' })).json.suggestion, { level: 2, text: 'Stub heading 5' });
    const ok = await ask(alice, { kind: 'fix', collection: 'posts', id: 'notes', problem: 'heading', headings, index: 1 });
    assert.deepEqual([ok.status, ok.json.error], [422, 'in-order']);
    for (const [body, field] of [
      [{ headings: [], index: 0 }, 'headings'],
      [{ headings: [{ level: 7, text: 'x' }], index: 0 }, 'headings.0.level'],
      [{ headings, index: 9 }, 'index'],
      [{ problem: 'tone' }, 'problem'],
    ]) {
      const bad = await ask(alice, { kind: 'fix', collection: 'posts', id: 'notes', problem: 'heading', ...body });
      assert.deepEqual([bad.status, bad.json.field], [422, field], JSON.stringify(body));
    }
  });

  test('fix vague link words: the sentence again, its link words naming the page', async () => {
    const sentence = 'To learn more, click here.';
    const r = await ask(alice, { kind: 'fix', collection: 'posts', id: 'notes', problem: 'link-text', sentence, words: 'click here', href: '/blog/guide/' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.suggestion, { sentence: 'To learn more, The editing guide.', words: 'The editing guide' });
    const bad = await ask(alice, { kind: 'fix', collection: 'posts', id: 'notes', problem: 'link-text', sentence, words: 'read more', href: '/blog/guide/' });
    assert.deepEqual([bad.status, bad.json.field], [422, 'words']);
  });

  test('each ask is audited by kind and entry, and nothing is committed', async () => {
    const rows = srv.app.db.prepare("SELECT target, detail FROM audit WHERE action = 'ai.suggest'").all().map((x) => ({ target: x.target, kind: JSON.parse(x.detail).kind }));
    assert.ok(rows.some((x) => x.kind === 'links' && x.target === 'posts/notes'));
    assert.ok(rows.some((x) => x.kind === 'fix' && x.target === 'posts/notes'));
    for (const x of srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'ai.suggest'").all()) assert.doesNotMatch(x.detail, /keyboard shortcuts|click here/i);
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), head0);
    assert.equal(fx.git('status', '--porcelain').trim(), '');
  });
});

describe('a careless model, with a fake fetch: what it says is checked', () => {
  const key = `sk-test-${crypto.randomBytes(16).toString('hex')}`;
  const before0 = process.env.MARKSTAGE_AI_KEY;
  const reply = (content) => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 9 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  let fx, srv, alice, said, sent;

  before(async () => {
    process.env.MARKSTAGE_AI_KEY = key;
    fx = topicsFixture();
    sent = [];
    srv = await startServer(fx, {
      overrides: { collections: [], ai: { provider: 'openai', model: 'gpt-test-1', baseUrl: 'https://llm.example.test/v1', perMinute: 600, perDay: 100_000 } },
      core: await loadCore(),
      ai: { env: { MARKSTAGE_AI_KEY: key }, fetch: async (url, init) => (sent.push(JSON.parse(init.body)), reply(JSON.stringify(said))) },
    });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(async () => {
    await srv?.close();
    if (before0 === undefined) delete process.env.MARKSTAGE_AI_KEY;
    else process.env.MARKSTAGE_AI_KEY = before0;
  });

  test('links: only offered pages, words in the article, each page and words once; the rest is counted as dropped', async () => {
    said = {
      links: [
        { to: 'posts/made-up', words: 'canvas basics', reason: 'Invented.' },
        { to: 'posts/guide', words: 'the editing guide', reason: 'Linked already.' },
        { to: 'posts/secret', words: 'Secret plans', reason: 'Bob’s draft.' },
        { to: 'posts/hidden', words: 'hidden extras', reason: 'Hidden from search engines.' },
        { to: 'posts/notes', words: 'These notes', reason: 'Itself.' },
        { to: 'posts/canvas', words: 'not in the article at all', reason: 'Missing words.' },
        { to: 'posts/shortcuts', words: 'click here', reason: 'Vague.' },
        { to: 'posts/shortcuts', words: 'over there', reason: 'The site’s own vague words.' },
        { to: 'posts/canvas', words: 'CANVAS   basics', reason: 'Good, in other case.' },
        { to: 'posts/canvas', words: 'keyboard shortcuts', reason: 'The same page again.' },
        { to: 'posts/shortcuts', words: 'canvas basics', reason: 'The same words again.' },
        { to: 'posts/shortcuts', words: 'keyboard shortcuts for editors' },
        'not an object',
      ],
    };
    const r = await ask(alice, { kind: 'links', collection: 'posts', id: 'notes' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(
      r.json.suggestion.links.map((l) => [l.to, l.words, l.reason]),
      [
        ['posts/canvas', 'canvas basics', 'Good, in other case.'],
        ['posts/shortcuts', 'keyboard shortcuts for editors', 'A page on the same subject.'],
      ],
    );
    assert.equal(r.json.suggestion.dropped, 11);
    // what the model was offered: never the page itself, one linked already, a hidden one or a draft Alice may not see
    const offered = sent.at(-1).messages[1].content.split('<pages>')[1];
    for (const ref of ['posts/notes', 'posts/guide', 'posts/hidden', 'posts/secret']) assert.doesNotMatch(offered, new RegExp(`^${ref} \\|`, 'm'));
    assert.match(offered, /^posts\/canvas \| Canvas basics \| \/blog\/canvas\/$/m);
    said = { nope: [] };
    assert.deepEqual([(await ask(alice, { kind: 'links', collection: 'posts', id: 'notes' })).json.error], ['ai-failed']);
  });

  test('fixes that do not fix are dropped: a level still out of order, vague or missing link words, a title no shorter', async () => {
    const headings = [{ level: 1, text: 'Field notes' }, { level: 2, text: 'Tools' }, { level: 4, text: 'Shortcuts' }];
    said = { level: 4, text: 'Shortcuts' };
    const h = await ask(alice, { kind: 'fix', collection: 'posts', id: 'notes', problem: 'heading', headings, index: 2 });
    assert.deepEqual([h.status, h.json.error], [502, 'ai-failed']);
    assert.match(h.json.message, /out of order/);
    said = { level: 'H3', text: 'Shortcuts' };
    assert.deepEqual((await ask(alice, { kind: 'fix', collection: 'posts', id: 'notes', problem: 'heading', headings, index: 2 })).json.suggestion, { level: 3, text: 'Shortcuts' });
    const link = { kind: 'fix', collection: 'posts', id: 'notes', problem: 'link-text', sentence: 'To learn more, click here.', words: 'click here', href: '/blog/guide/' };
    said = { sentence: 'To learn more, read more.', words: 'read more' };
    assert.match((await ask(alice, link)).json.message, /do not name the page/);
    said = { sentence: 'To learn more, see the guide.', words: 'editing guide' };
    assert.match((await ask(alice, link)).json.message, /not in its sentence/);
    said = { sentence: 'Read the editing guide to learn more.', words: 'editing guide' };
    assert.deepEqual((await ask(alice, link)).json.suggestion, said);
    assert.match(sent.at(-1).messages[1].content, /<linked-page>The editing guide \(\/blog\/guide\/\)<\/linked-page>/);
    said = { title: 'An even longer title than the one there, which is long already' };
    const t = await ask(alice, { kind: 'seo', collection: 'posts', id: 'notes', problem: 'title-long', searchTitle: 'A long title that is long' });
    assert.match(t.json.message, /no shorter/);
  });

  test('the same per-minute limit as every kind', async () => {
    const tight = await startServer(topicsFixture(), { overrides: { collections: [], ai: { provider: 'stub', perMinute: 2 } }, core: await loadCore() });
    try {
      const a = await as(tight, 'author', { authorSlug: 'alice' });
      assert.equal((await ask(a, { kind: 'links', collection: 'posts', id: 'notes' })).status, 200);
      assert.equal((await ask(a, { kind: 'fix', collection: 'posts', id: 'notes', problem: 'link-text', sentence: 'Go, click here.', words: 'click here' })).status, 200);
      const r = await ask(a, { kind: 'seo', collection: 'posts', id: 'notes', problem: 'description-missing' });
      assert.deepEqual([r.status, r.json.error, r.json.limit], [429, 'ai-rate', 'minute']);
    } finally {
      await tight.close();
    }
  });
});

test('findWords: whole words, any case, spaces as one, as the text has them', () => {
  assert.equal(findWords('Read the Canvas  basics now.', 'canvas basics'), 'Canvas  basics');
  assert.equal(findWords('canvasbasics', 'canvas'), null);
  assert.equal(findWords('ab c', 'b c'), null, 'a word cut in two is not a match');
  assert.equal(findWords('Ça va très bien', 'très bien'), 'très bien');
});
