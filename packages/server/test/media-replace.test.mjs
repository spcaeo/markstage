// Replace an image everywhere (docs/OPERATIONS.md): the plan lists every entry that uses it, the replace is one
// commit across them (whole paths only, never part of a longer file name), the old file stays, and live entries are
// rebuilt and deployed; a failed deploy puts the texts back. Editors and above only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { mentions } from '../src/media/replace.mjs';
import { as, fakeCodec, makeFixture, makePng, startServer } from './helpers.mjs';

const upload = (c, name) => c.request('POST', `/media?filename=${encodeURIComponent(name)}`, { body: makePng(), headers: { 'Content-Type': 'application/octet-stream' } });

describe('replace an image everywhere', () => {
  let fx;
  let srv;
  let editor;
  let alice;
  let oldImg;
  let newImg;
  const src = async (id) => (await editor.get(`/collections/posts/entries/${id}/source`)).json;
  const put = async (id, f) => {
    const s = await src(id);
    assert.equal((await editor.put(`/collections/posts/entries/${id}/source`, { version: s.version, source: f(s.source) })).status, 200);
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { codec: fakeCodec });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    oldImg = (await upload(editor, 'team.png')).json;
    newImg = (await upload(editor, 'team-2026.png')).json;
    const rel = oldImg.url;
    // a live entry uses it twice, a draft once; another file whose name only starts the same is left alone
    await put('hello-world', (t) => `${t.trimEnd()}\n\n<p><img src="${rel}" alt="The team"> and again ![The team](${rel})</p>\n\n<p><img src="${rel}.bak" alt="x"></p>\n`);
    await put('bob-draft', (t) => `${t.trimEnd()}\n\n<p><img src="${rel}" alt="Team"></p>\n`);
  });
  after(() => srv.close());

  test('the plan: every entry using it, with how often; authors may not', async () => {
    assert.equal((await alice.get(`/media/${oldImg.id}/replace?with=${newImg.id}`)).status, 403);
    const p = await editor.get(`/media/${oldImg.id}/replace?with=${newImg.id}`);
    assert.equal(p.status, 200, p.text);
    assert.deepEqual(p.json.entries.map((e) => [e.id, e.status, e.count]).sort(), [['bob-draft', 'draft', 1], ['hello-world', 'published', 2]]);
    assert.equal((await editor.get(`/media/${oldImg.id}/replace?with=${oldImg.id}`)).status, 400);
    assert.equal((await editor.get(`/media/${oldImg.id}/replace?with=m_nope`)).status, 404);
  });

  test('one commit across the entries, whole paths only; the live one is rebuilt; the old file stays', async () => {
    const r = await editor.post(`/media/${oldImg.id}/replace`, { with: newImg.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.entries.length, 2);
    assert.ok(r.json.job, 'a live entry changed: deployed');
    await srv.app.jobs.idle();
    assert.equal((await editor.get(`/jobs/${r.json.job}`)).json.status, 'succeeded');
    const hw = (await src('hello-world')).source;
    assert.equal(hw.split(newImg.url).length - 1, 2, 'both uses');
    assert.ok(hw.includes(`${oldImg.url}.bak`), 'a longer file name is not touched');
    assert.ok(!hw.replace(`${oldImg.url}.bak`, '').includes(oldImg.url));
    assert.match((await src('bob-draft')).source, new RegExp(newImg.url.replace(/[.]/g, '\\.')));
    assert.match(fx.git('log', '-1', '--format=%s', r.json.commit).trim(), /^Replace .*team\.png with .*team-2026\.png in 2 entries$/);
    assert.equal(fx.git('show', '--name-only', '--format=', r.json.commit).trim().split('\n').length, 2);
    assert.ok(fs.existsSync(path.join(fx.site, oldImg.path)), 'the old file stays in the library');
    assert.equal((await editor.get(`/media/${oldImg.id}/replace?with=${newImg.id}`)).json.entries.length, 0, 'unused now');
  });

  test('a failed build keeps the replacement and says so; the site stays as it was (QA F10)', async () => {
    const a = (await upload(editor, 'a.png')).json;
    const b = (await upload(editor, 'b.png')).json;
    await put('with-html', (t) => `${t.trimEnd()}\n\n<p><img src="${a.url}" alt="A"></p>\n`);
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    try {
      const r = await editor.post(`/media/${a.id}/replace`, { with: b.id });
      await srv.app.jobs.idle();
      const job = (await editor.get(`/jobs/${r.json.job}`)).json;
      assert.equal(job.status, 'failed');
      assert.doesNotMatch(job.log, /Put back/, 'nothing is rolled back');
      assert.ok((await src('with-html')).source.includes(b.url), 'the replacement is kept');
      const told = (await editor.get('/notices')).json.items.find((x) => x.link === `#/jobs/${r.json.job}`);
      assert.match(told.text, /^Replaced in 1 page, but the site could not be rebuilt: The build step failed.*Your changes are saved; the site stays as it was\.$/);
    } finally {
      fs.unlinkSync(`${fx.failMarker}.build`);
    }
  });
});

test('mentions: a whole media path, never a part of a longer name', () => {
  const re = mentions('2026/10/team.png');
  assert.equal('/uploads/2026/10/team.png "2026/10/team.png" (2026/10/team.png)'.match(re).length, 3);
  assert.equal('2026/10/team.png.bak x2026/10/team.png 2026/10/team.png-2'.match(re), null);
});
