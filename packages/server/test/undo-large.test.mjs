// Undo a change to more entries than one audit row can list: the change is still found, and every entry of its
// commit goes back (the entries come from the commit itself, not from the audit row, which is kept short).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { clip } from '../src/audit.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';

let fx;
let srv;
let editor;
const N = 150;
const ids = Array.from({ length: N }, (_, i) => `a-rather-long-post-name-for-the-undo-test-${String(i).padStart(3, '0')}`);

before(async () => {
  fx = makeFixture({ checks: false });
  for (const id of ids) fs.writeFileSync(path.join(fx.site, 'src/content/blog', `${id}.md`), `---\ntitle: ${id}\ndraft: true\n---\n\nWidgetco makes widgets.\n`);
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Many drafts');
  srv = await startServer(fx);
  editor = await as(srv, 'editor', { authorSlug: 'ed' });
});
after(() => srv.close());

test(`a replace in ${N} entries is undone in all of them`, async () => {
  const found = (await editor.get('/site/find?q=Widgetco&with=x')).json.entries;
  assert.equal(found.length, N);
  const r = await editor.post('/site/replace', { q: 'Widgetco', with: 'Gadgetco', entries: found.map(({ collection, id, version }) => ({ collection, id, version })) });
  assert.equal(r.status, 200, r.text);
  const row = srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'site.replace' ORDER BY id DESC LIMIT 1").get();
  assert.ok(row.detail.length <= 4000, 'the audit row stays short');
  assert.equal(JSON.parse(row.detail).commit, r.json.commit, 'and still names its commit');
  const u = await editor.post('/site/undo', { commit: r.json.commit });
  assert.equal(u.status, 200, u.text);
  assert.equal(u.json.undone.length, N);
  for (const id of [ids[0], ids[N - 1]]) assert.match(fs.readFileSync(path.join(fx.site, 'src/content/blog', `${id}.md`), 'utf8'), /Widgetco makes widgets/);
});

test('a long audit detail keeps its short values and the count of each long list, within 4000 characters', () => {
  const d = { commit: 'a'.repeat(40), action: 'set', find: '"\\'.repeat(3000), entries: Array.from({ length: 500 }, (_, i) => `posts/x-${i}`), kinds: { a: ['b'] } };
  const out = clip(d);
  assert.ok(out.length <= 4000, String(out.length));
  const j = JSON.parse(out);
  assert.deepEqual([j.truncated, j.commit, j.action, j.entriesCount, j.find, j.kinds], [true, d.commit, 'set', 500, undefined, undefined]);
  assert.equal(clip({ a: 1 }), '{"a":1}');
  assert.ok(clip(Array.from({ length: 2000 }, () => '"')).length <= 4000);
});
