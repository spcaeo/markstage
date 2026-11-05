// `markstage-server import …` (src/import/cli.mjs): the same plan and run as the Import screen, from the server
// itself, as the person named by --as; a secret only from a file or the environment, never the command line.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { importCommand } from '../src/import/cli.mjs';
import { addUser, readFile } from './helpers.mjs';
import { fixture, importServer, oldFiles } from './site-import.mjs';
import { startWebSite } from './web-site.mjs';

describe('markstage-server import', () => {
  let fx, srv, site, file, editor, author;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const cli = async (args, env = {}) => {
    const lines = [];
    const code = await importCommand(srv.app, args, { out: (l) => lines.push(l), env });
    return { code, text: lines.join('\n') };
  };

  before(async () => {
    site = await startWebSite(oldFiles());
    ({ fx, srv } = await importServer({ outbound: site.outbound }));
    editor = (await addUser(srv.app, { email: 'cli-editor@example.test', role: 'editor', authorSlug: 'alice' })).email;
    author = (await addUser(srv.app, { email: 'cli-author@example.test', role: 'author', authorSlug: 'alice' })).email;
    file = path.join(fx.run, 'export.xml');
    fs.writeFileSync(file, fixture('wordpress.xml', site.base));
  });
  after(async () => {
    await srv?.close();
    await site?.close();
  });

  test('--dry says the plan in words and writes nothing', async () => {
    const h = head();
    const r = await cli(['wordpress', file, '--dry', '--as', editor]);
    assert.equal(r.code, 0);
    assert.match(r.text, /export\.xml: 3 posts, 1 page in WordPress\./);
    assert.match(r.text, /4 entries to create/);
    assert.match(r.text, /3 media files to bring in/);
    assert.match(r.text, /2 pictures need alt text/);
    assert.match(r.text, /Dry run, nothing written/);
    assert.equal(head(), h);
  });

  test('a run imports, as the person; again, nothing changes', async () => {
    const r = await cli(['wordpress', file, '--as', editor]);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /Done in 4 commits: 4 created/);
    assert.match(readFile(fx, 'src/content/blog/moving-day.md'), /^draft: true$/m);
    const h = head();
    assert.match((await cli(['wordpress', file, '--as', editor])).text, /0 created, 0 updated, 4 unchanged/);
    assert.equal(head(), h);
  });

  test('who and how: an editor or up, secrets never on the command line, usage in words', async () => {
    await assert.rejects(cli(['wordpress', file, '--as', author]), /editors and up/);
    await assert.rejects(cli(['wordpress', file]), /--as/);
    await assert.rejects(cli(['wordpress', '--url', site.base, '--user', 'x', '--password', 'secret-on-the-line', '--as', editor]), /not on the command line/);
    await assert.rejects(cli(['joomla', file, '--as', editor]), /Usage/);
    await assert.rejects(cli(['wordpress', '--url', 'http://169.254.169.254', '--as', editor]), /address|public|private|allowed/i);
  });
});
