// Library packs (docs/API-LIBRARY.md "Packs"): export from one site, import into another as a dry run then for real,
// byte for byte (items, pictures, the media they name), export again gives the same pack; clashes, damage, rights.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { libraryCommand } from '../src/library/cli.mjs';
import { as, makeFixture, makePng, startServer } from './helpers.mjs';

/** A multipart/form-data body as a browser's FormData sends it. */
function form(fields, file) {
  const boundary = '----markstage-test-boundary';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/json\r\n\r\n`), Buffer.from(file.data), Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

describe('Library packs', () => {
  let a, b, srvA, srvB, edA, edB, pack, ids;
  const libFile = (fx, rel) => fs.readFileSync(path.join(fx.site, 'markstage/library', rel));
  const importInto = (c, text, fields = {}, q = '', name = 'team-pack.json') => c.request('POST', `/library/import${q}`, form(fields, { name, data: text }));

  before(async () => {
    a = makeFixture({ checks: false });
    b = makeFixture({ checks: false });
    srvA = await startServer(a);
    srvB = await startServer(b);
    edA = await as(srvA, 'editor');
    edB = await as(srvB, 'editor');
  });
  after(async () => {
    await srvA?.close();
    await srvB?.close();
  });

  test('export, import (dry run, then for real), export again: the same bytes; the media the items name come along', async () => {
    const up = await edA.request('POST', '/media?filename=team.png&alt=The%20team', { body: makePng(), headers: { 'Content-Type': 'image/png' } });
    assert.equal(up.status, 201, up.text);
    const mediaPath = up.json.path.replace(/^src\/assets\/uploads\//, '');
    const sec = (await edA.post('/library', { kind: 'section', name: 'Team photo', folder: 'People', tags: ['team'], body: { value: { discriminant: 'image', value: { src: mediaPath, alt: 'The team' } } } })).json;
    const tpl = (await edA.post('/library', { kind: 'template', name: 'Case study', collection: 'posts', body: { frontmatter: { tags: ['case'] } } })).json;
    assert.equal((await edA.request('PUT', `/library/${sec.id}/thumb`, { body: makePng(), headers: { 'Content-Type': 'image/png' } })).status, 200);
    ids = [sec.id, tpl.id];
    const ex = await edA.get(`/library/export?ids=${ids.join(',')}`);
    assert.equal(ex.status, 200);
    assert.match(ex.headers.get('content-disposition'), /^attachment; filename="markstage-pack-\d{4}-\d{2}-\d{2}\.json"$/);
    pack = ex.text;
    const p = JSON.parse(pack);
    assert.deepEqual([p.format, p.version, p.items.map((i) => i.path).sort(), p.media.map((m) => m.path)], ['markstage-pack', 1, [`section/${sec.id}.json`, `section/${sec.id}.png`, `template/${tpl.id}.json`].sort(), [mediaPath]]);
    // the other site: a dry run writes nothing
    const head = b.git('rev-parse', 'HEAD').trim();
    const dry = await importInto(edB, pack, {}, '?dry=1');
    assert.equal(dry.status, 200, dry.text);
    assert.deepEqual([dry.json.items.map((i) => [i.kind, i.name, i.exists ?? false]).sort(), dry.json.media, dry.json.problems], [[['section', 'Team photo', false], ['template', 'Case study', false]], 1, []]);
    assert.equal(b.git('rev-parse', 'HEAD').trim(), head);
    const done = await importInto(edB, pack);
    assert.equal(done.status, 200, done.text);
    assert.deepEqual([done.json.created.sort(), done.json.media, done.json.problems], [ids.slice().sort(), 1, []]);
    assert.equal(b.git('log', '-1', '--format=%s').trim(), 'Library: import 2 items from team-pack.json');
    // byte for byte: item files, the picture, the media file
    for (const rel of [`section/${sec.id}.json`, `section/${sec.id}.png`, `template/${tpl.id}.json`]) assert.deepEqual(libFile(b, rel), libFile(a, rel), rel);
    assert.deepEqual(fs.readFileSync(path.join(b.site, up.json.path)), fs.readFileSync(path.join(a.site, up.json.path)));
    const row = srvB.app.db.prepare('SELECT * FROM media WHERE path = ?').get(up.json.path);
    assert.equal(row.alt, 'The team');
    // and the pack exported again from the other site is the same text
    assert.equal((await edB.get(`/library/export?ids=${ids.join(',')}`)).text, pack);
  });

  test('clashes: skipped by default, or copied under new ids; a damaged or foreign file is said in words; editors only', async () => {
    const dry = await importInto(edB, pack, {}, '?dry=1');
    assert.ok(dry.json.items.every((i) => i.exists));
    const skip = await importInto(edB, pack);
    assert.deepEqual([skip.json.created, skip.json.skipped.length, skip.json.commit], [[], 2, null]);
    const copy = await importInto(edB, pack, { onClash: 'copy' });
    assert.equal(copy.json.created.length, 2);
    assert.ok(copy.json.created.every((id) => !ids.includes(id) && id.startsWith('lib_')));
    // damage: a changed picture and a link the site does not take
    const p = JSON.parse(pack);
    p.items.find((i) => i.path.endsWith('.png')).base64 = Buffer.from('nope').toString('base64');
    const tpl = p.items.find((i) => i.path.startsWith('template/'));
    const v = JSON.parse(tpl.text);
    v.body.frontmatter.href = 'javascript:alert(1)';
    tpl.text = `${JSON.stringify(v, null, 2)}\n`;
    const bad = await importInto(edB, JSON.stringify(p), {}, '?dry=1');
    assert.equal(bad.status, 200, bad.text);
    assert.ok(bad.json.problems.some((x) => /\.png: the picture is damaged/.test(x)));
    assert.ok(bad.json.problems.some((x) => /template\/.*Links must start with http/.test(x)), bad.json.problems.join(' | '));
    assert.equal((await importInto(edB, '{"format":"something-else"}', {}, '?dry=1')).status, 400);
    assert.equal((await importInto(edB, 'PK\u0003\u0004 a zip', {}, '?dry=1', 'site.zip')).status, 415);
    const author = await as(srvB, 'author');
    assert.equal((await importInto(author, pack, {}, '?dry=1')).status, 403);
    assert.equal((await edB.get('/library/export')).status, 400);
  });

  test('the command line: export to a file, import it as a dry run and for real, as a named person', async () => {
    const lines = [];
    const out = (l) => lines.push(l);
    const file = path.join(b.run, 'cli-pack.json');
    assert.equal(await libraryCommand(srvB.app, ['export', ids.join(','), '--out', file, '--as', edB.user.email], out), 0);
    assert.equal(fs.readFileSync(file, 'utf8'), pack, 'the same pack as the route');
    await assert.rejects(libraryCommand(srvB.app, ['export', ids.join(',')], out), /Say who does it: --as/);
    const c = makeFixture({ checks: false });
    const srvC = await startServer(c);
    try {
      const ed = await as(srvC, 'editor');
      lines.length = 0;
      assert.equal(await libraryCommand(srvC.app, ['import', file, '--dry', '--as', ed.user.email], out), 0);
      assert.match(lines[0], /^Dry run, nothing written: 2 items, 1 media file\.$/);
      lines.length = 0;
      assert.equal(await libraryCommand(srvC.app, ['import', file, '--as', ed.user.email], out), 0);
      assert.match(lines[0], /^Imported 2 items in [0-9a-f]{7}\.$/);
      const author = await as(srvC, 'author');
      await assert.rejects(libraryCommand(srvC.app, ['import', file, '--as', author.user.email], out), /Only editors can import/);
    } finally {
      await srvC.close();
    }
  });
});
