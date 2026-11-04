// Find and replace shows a plain-text match as it reads (no markup; a link as a chip with its address), the raw form
// only for the groups about markup; and "Keep the case of each match" writes the new text in each match's case.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { keepCase, readable } from '../src/content/find-read.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';

test('the context as it reads: emphasis, code, tags and entities go; links are chips; a match in a link stays marked', () => {
  assert.deepEqual(readable('See the **bold** ', 'Acme', ' _docs_ and `x` &amp; <b>y</b>.'), ['See the bold ', { match: 'Acme' }, ' docs and x & y.']);
  assert.deepEqual(readable('Read [the ', 'Acme', ' guide](/guides/acme/ "Guide") now'), ['Read ', { link: '/guides/acme/', label: ['the ', { match: 'Acme' }, ' guide'] }, ' now']);
  assert.deepEqual(readable('Ask <a href="https://x.example/">our team</a> at ', 'Acme', '.'), ['Ask ', { link: 'https://x.example/', label: ['our team'] }, ' at ', { match: 'Acme' }, '.']);
  assert.deepEqual(readable('## Pricing at ', 'Acme', '\n\n- one'), ['Pricing at ', { match: 'Acme' }, ' one']);
  // an image reads as its alt text
  assert.deepEqual(readable('![Logo of ', 'Acme', '](/uploads/a.png) here'), ['Logo of ', { match: 'Acme' }, ' here']);
  // a JSON value's escapes read as the characters
  assert.deepEqual(readable('Say \\"hi\\" to ', 'Acme', '\\nnow'), ['Say "hi" to ', { match: 'Acme' }, '\\nnow'], 'Markdown: an escaped quote reads as a quote; \\n is text');
  assert.deepEqual(readable('Say \\"hi\\" to ', 'Acme', '\\nnow', { json: true }), ['Say "hi" to ', { match: 'Acme' }, ' now']);
  // the match across the edge of a link (cut context): shown as written
  // a link cut by the context's edge is no link: it reads as written
  assert.deepEqual(readable('[Big ', 'Acme', ' tools'), ['[Big ', { match: 'Acme' }, ' tools']);
  assert.equal(readable('x [Big ', 'Acme]', '(/a/) y'), null);
  // snake_case and 2*3*4 are words, not emphasis
  assert.deepEqual(readable('use snake_case_name and 2*3*4 with ', 'Acme', ''), ['use snake_case_name and 2*3*4 with ', { match: 'Acme' }]);
});

test('keep the case of each match', () => {
  assert.equal(keepCase('ACME', 'Initech'), 'INITECH');
  assert.equal(keepCase('acme', 'Initech'), 'initech');
  assert.equal(keepCase('Acme', 'initech'), 'Initech');
  assert.equal(keepCase('Acme', 'initech Co'), 'Initech Co');
  assert.equal(keepCase('AcMe', 'Initech'), 'Initech', 'mixed case: as typed');
  assert.equal(keepCase('A', 'b'), 'B', 'one capital: a capital first');
  assert.equal(keepCase('12', 'x'), 'x');
  assert.equal(keepCase('ÉCOLE', 'lycée'), 'LYCÉE');
  assert.equal(keepCase('acme', ''), '');
});

describe('find and replace: as read, and keeping the case', () => {
  let fx, srv, editor;
  const src = async (id) => (await editor.get(`/collections/posts/entries/${id}/source`)).json;
  const BODY = 'ACME news. Read [the Acme guide](https://acme.example/acme/) and **acme** tips.\n';
  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx);
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    const s = await src('bob-draft');
    assert.equal((await editor.put('/collections/posts/entries/bob-draft/source', { version: s.version, source: `${s.source.trimEnd()}\n\n${BODY}` })).status, 200);
  });
  after(() => srv.close());

  test('the search: plain-text matches as they read, with each new text; link addresses as written', async () => {
    const e = (await editor.get('/site/find?q=acme&with=Initech&keep=1')).json.entries.find((x) => x.id === 'bob-draft');
    const text = e.samples.filter((s) => s.kind === 'text');
    assert.deepEqual(text.map((s) => s.to), ['INITECH', 'Initech', 'initech']);
    const inLink = text[1].read.find((p) => typeof p === 'object' && 'link' in p);
    assert.deepEqual(inLink, { link: 'https://acme.example/acme/', label: ['the ', { match: 'Acme' }, ' guide'] });
    assert.ok(text[2].read.some((p) => p === ' tips.' || (typeof p === 'string' && p.includes('tips'))), 'no ** around it');
    for (const s of e.samples.filter((x) => x.kind !== 'text')) assert.equal(s.read, undefined, 'raw for the address groups');
    // case matched: kept as typed
    const asTyped = (await editor.get('/site/find?q=acme&with=Initech&keep=1&case=1')).json.entries.find((x) => x.id === 'bob-draft');
    assert.deepEqual(asTyped.samples.filter((s) => s.kind === 'text').map((s) => s.to), ['Initech']);
  });

  test('the replace keeps each case and leaves the address alone', async () => {
    const s = await src('bob-draft');
    const r = await editor.post('/site/replace', { q: 'acme', with: 'Initech', keep: true, entries: [{ collection: 'posts', id: 'bob-draft', version: s.version }] });
    assert.equal(r.status, 200, r.text);
    assert.ok((await src('bob-draft')).source.endsWith('INITECH news. Read [the Initech guide](https://acme.example/acme/) and **initech** tips.\n'));
    const audit = JSON.parse(srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'site.replace' ORDER BY rowid DESC LIMIT 1").get().detail);
    assert.equal(audit.keepCase, true);
  });
});
