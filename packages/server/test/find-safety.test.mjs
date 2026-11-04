// Find and replace never changes an address by accident: each match is sorted by where it sits (plain text, a link
// address, an image file name, inside an HTML tag, code, a field's name), only plain text is replaced unless another
// group is asked for, and each match says its field and the words around it.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { placesOf } from '../src/content/find-places.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';

const BODY = `Intro about Acme and more words here to count the context well enough for us.

## Pricing at Acme

See [Acme](https://acme.example/acme) and ![Acme logo](/uploads/acme-logo.png).

<a href="/acme/" class="acme">Acme link</a> <img src="/uploads/acme.jpg" alt="Acme">

\`\`\`
acme code
\`\`\`

Use \`acme()\` inline. Visit https://acme.example/x now.

[ref]: /acme/ref
`;
const MD = `---\ntitle: Acme Tools guide\ncover: /uploads/acme.png\nsite: "https://acme.example/"\nacme_key: 1\n---\n\n${BODY}`;

/** [kind, field] of every "acme" in the text, in order. */
const sorted = (text, format) => {
  const p = placesOf(text, { format });
  return [...text.matchAll(/acme/gi)].map((m) => [p.kindAt(m.index, m.index + 4), p.fieldAt(m.index)]);
};
/** Every address in a Markdown/HTML text: link targets, image paths, href/src values, written-out URLs. */
const addresses = (t) => [...t.matchAll(/\]\(([^)\s]+)|(?:href|src)="([^"]*)"|https?:\/\/[^\s)<"]+|^\[[^\]]+\]:\s*(\S+)|^(?:cover|site): (.*)$/gm)].map((m) => m.slice(1).find((x) => x !== undefined) ?? m[0]);

test('each match is sorted by where it sits, with its field', () => {
  const H = 'Body under heading “Pricing at Acme”';
  assert.deepEqual(sorted(MD, 'md'), [
    ['text', 'Title'],
    ['image', 'Cover'],
    ['link', 'Site'],
    ['key', 'Acme key'],
    ['text', 'Body'],
    ['text', H],
    ['text', H],
    ['link', H],
    ['link', H],
    ['text', H],
    ['image', H],
    ['link', H],
    ['html', H],
    ['text', H],
    ['image', H],
    ['html', H],
    ['code', H],
    ['code', H],
    ['link', H],
    ['link', H],
  ]);
  const json = JSON.stringify({ title: 'Acme', hero: { heading: 'We are Acme', image: '/uploads/acme.png', body: 'Go <a href="/acme">Acme</a>' }, list: [{ acme: 'x' }] }, null, 2);
  assert.deepEqual(sorted(json, 'json'), [
    ['text', 'Title'],
    ['text', 'Hero › Heading'],
    ['image', 'Hero › Image'],
    ['link', 'Hero › Body'],
    ['text', 'Hero › Body'],
    ['key', 'Field name'],
  ]);
});

test('the words around a match: about eight each side, within its paragraph or field', () => {
  const p = placesOf(MD, { format: 'md' });
  const at = MD.indexOf('Acme and more');
  assert.deepEqual(p.contextAt(at, at + 4), { before: 'Intro about ', after: ' and more words here to count the context…' });
  const t = MD.indexOf('Acme Tools');
  assert.deepEqual(p.contextAt(t, t + 4), { before: 'title: ', after: ' Tools guide' });
  const long = 'one two three four five six seven eight nine ten Acme.';
  assert.equal(placesOf(long, { format: 'html' }).contextAt(long.indexOf('Acme'), long.indexOf('Acme') + 4).before, '…three four five six seven eight nine ten ');
});

describe('find and replace leaves addresses alone unless asked', () => {
  let fx;
  let srv;
  let editor;
  const src = async (id) => (await editor.get(`/collections/posts/entries/${id}/source`)).json;

  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx);
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    const s = await src('bob-draft');
    assert.equal((await editor.put('/collections/posts/entries/bob-draft/source', { version: s.version, source: `${s.source.trimEnd()}\n\n${BODY}` })).status, 200);
  });
  after(() => srv.close());

  test('the search: counts per group; each sample says its group, field and the words around it', async () => {
    const e = (await editor.get('/site/find?q=acme&with=Initech')).json.entries.find((x) => x.id === 'bob-draft');
    assert.deepEqual(e.kinds, { text: 5, link: 5, image: 2, html: 2, code: 2 });
    assert.equal(e.count, 16);
    assert.equal(e.problem, null);
    assert.deepEqual(Object.keys(e.problems).sort(), ['code', 'html', 'image', 'link']);
    const s = e.samples.find((x) => x.kind === 'link');
    assert.equal(s.field, 'Body under heading “Pricing at Acme”');
    assert.equal(s.before, 'See [Acme](https://');
    assert.equal(e.samples[0].field, 'Body');
  });

  test('a plain replace changes the words and never an address, image, tag or code', async () => {
    const was = (await src('bob-draft')).source;
    const r = await editor.post('/site/replace', { q: 'acme', with: 'Initech', entries: [{ collection: 'posts', id: 'bob-draft', version: (await src('bob-draft')).version }] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.changed.map((x) => [x.id, x.count, x.kinds]), [['bob-draft', 5, ['text']]]);
    const now = (await src('bob-draft')).source;
    assert.deepEqual(addresses(now), addresses(was), 'every address as it was');
    assert.ok(addresses(was).some((a) => /acme/.test(a)), 'there were addresses with the text');
    assert.match(now, /```\nacme code\n```/, 'code as it was');
    assert.match(now, /`acme\(\)`/);
    assert.match(now, /<a href="\/acme\/" class="acme">Initech link<\/a>/, 'the link text changes, the tag does not');
    assert.match(now, /See \[Initech\]\(https:\/\/acme\.example\/acme\)/);
    assert.equal((await editor.post('/site/undo', { commit: r.json.commit })).status, 200);
  });

  test('a link address changes only when that group is ticked on purpose; unknown groups are refused', async () => {
    const version = (await src('bob-draft')).version;
    const bad = await editor.post('/site/replace', { q: 'acme', with: 'x', entries: [{ collection: 'posts', id: 'bob-draft', version, kinds: ['links'] }] });
    assert.equal(bad.status, 400);
    const r = await editor.post('/site/replace', { q: 'acme.example', with: 'initech.example', entries: [{ collection: 'posts', id: 'bob-draft', version, kinds: ['link'] }] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.changed.map((x) => [x.count, x.kinds]), [[2, ['link']]]);
    const now = (await src('bob-draft')).source;
    assert.match(now, /\]\(https:\/\/initech\.example\/acme\)/);
    assert.match(now, /Visit https:\/\/initech\.example\/x now/);
    const audit = JSON.parse(srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'site.replace' ORDER BY rowid DESC LIMIT 1").get().detail);
    assert.deepEqual(audit.kinds, { 'posts/bob-draft': ['link'] }, 'the groups ticked beyond plain text are in the audit log');
  });
});
