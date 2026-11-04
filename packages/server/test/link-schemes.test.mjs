// The link-scheme rule agrees with the site's Markdown renderer (security review 3 Nov, S1). Markstage's own
// document keeps `<javascript:…>` as text, but CommonMark builds it as a live link; so the check reads the saved
// Markdown with a CommonMark parse too: autolinks, reference definitions, entities and case tricks are refused for
// every role, and normal https, mailto and tel autolinks still save.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadCore, markdownUrlsFallback } from '../src/content/converter.mjs';
import { isSafeUrl, schemeOf } from '../src/content/urls.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';

describe('link schemes in the Markdown source (S1)', () => {
  let srv, carol, editor;
  before(async () => {
    srv = await startServer(makeFixture({ checks: false }), { core: await loadCore() });
    carol = await as(srv, 'contributor', { authorSlug: 'carol' });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
  });
  after(() => srv.close());

  const BAD = {
    autolink: '<javascript:alert(1)>',
    'mixed case': '<JaVaScRiPt:alert(1)>',
    vbscript: '<vbscript:msgbox(1)>',
    data: '<data:text/html,hi>',
    file: '<file:///etc/passwd>',
    'reference definition': '[x][r]\n\n[r]: javascript:alert(1)',
    'unused definition': '[r]: javascript:alert(1)',
    'definition in angle brackets': '[x][r]\n\n[r]: <javascript:alert(1)>',
    'entity in the scheme': '[x](jav&#x61;script:alert(1))',
    'named entity colon': '[x](javascript&colon;alert(1))',
    'tab inside the scheme': '[x](<java\tscript:alert(1)>)',
  };

  test('a contributor cannot save any unsafe-scheme link the site would build (new entry and source save)', async () => {
    const own = await carol.get('/collections/posts/entries/carol-draft/source');
    for (const [name, body] of Object.entries(BAD)) {
      const made = await carol.post('/collections/posts/entries', { title: `Bad ${name}`, source: `---\ntitle: Bad\nauthor: carol\n---\n\n${body}\n` });
      assert.equal(made.status, 422, `create: ${name} (${made.status} ${made.text})`);
      assert.ok(made.json.urls?.length, name);
      const saved = await carol.put('/collections/posts/entries/carol-draft/source', { version: own.json.version, source: `${own.json.source}\n${body}\n` });
      assert.equal(saved.status, 422, `source save: ${name}`);
    }
  });

  test('an editor cannot either, and a document whose text prints as an autolink is refused', async () => {
    const cur = await editor.get('/collections/posts/entries/bob-draft');
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<javascript:alert(1)>' }] }] };
    const r = await editor.put('/collections/posts/entries/bob-draft', { version: cur.json.version, doc });
    // either the printer escapes it (so the site shows text, 200) or the save is refused; never a live link
    if (r.status === 200) {
      const src = await editor.get('/collections/posts/entries/bob-draft/source');
      assert.doesNotMatch(src.json.source, /(^|[^\\])<javascript:/, 'printed as an escaped text, not an autolink');
    } else assert.equal(r.status, 422);
  });

  test('normal https, mailto and tel autolinks and links still save', async () => {
    const own = await carol.get('/collections/posts/entries/carol-draft/source');
    const good = '<https://example.test/a> <mailto:a@b.test> <tel:+15550100> <a@b.test> [x](/blog/x/) [y](#top)';
    const r = await carol.put('/collections/posts/entries/carol-draft/source', { version: own.json.version, source: `${own.json.source}\n${good}\n` });
    assert.equal(r.status, 200, r.text);
    // a safe reference definition (kept as raw source, so an editor's) saves too
    const bob = await editor.get('/collections/posts/entries/bob-draft/source');
    const ref = await editor.put('/collections/posts/entries/bob-draft/source', { version: bob.json.version, source: `${bob.json.source}\n[x][r]\n\n[r]: https://example.test/r\n` });
    assert.equal(ref.status, 200, ref.text);
  });

  test('a scheme that only looks unsafe after entities, but is not an autolink to CommonMark, stays harmless text', async () => {
    // `&` cannot be part of an autolink scheme, so the site prints the words; the editor's document agrees
    const made = await carol.post('/collections/posts/entries', { title: 'Words', source: '---\ntitle: Words\nauthor: carol\n---\n\n<jav&#97;script:alert(1)>\n' });
    assert.equal(made.status, 201, made.text);
    assert.equal(made.json.doc.content[0].content[0].marks, undefined, 'text, not a link');
  });
});

test('schemeOf reads the scheme as a browser would, after entities, whitespace and case', () => {
  assert.equal(schemeOf('jav&#x61;script:x'), 'javascript');
  assert.equal(schemeOf('jav&#97;script:x'), 'javascript');
  assert.equal(schemeOf('javascript&colon;x'), 'javascript');
  assert.equal(schemeOf(' \tJAVA\nSCRIPT:x'), 'javascript');
  assert.equal(schemeOf('/a:b'), null);
  assert.equal(isSafeUrl('https://x.test'), true);
  assert.equal(isSafeUrl('MAILTO:a@b.test'), true);
  assert.equal(isSafeUrl('file:///etc/passwd'), false);
});

test('without core, the loose fallback still finds autolinks, definitions and inline destinations', () => {
  const md = '---\ntitle: x\n---\n\n<javascript:a> [x](vbscript:b) ![y]( <data:c> )\n\n  [r]:\n  file:///d\n';
  assert.deepEqual(markdownUrlsFallback(md), ['javascript:a', 'data:c', 'file:///d', 'vbscript:b', 'data:c']);
});
