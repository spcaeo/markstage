// An AI agent publishes a release on the example blog (examples/blog), end to end: the site's real Astro build and a
// deploy that copies it live. The agent holds an owner's mcp:publish token (made in the owner's session, as the
// Tokens screen makes it) and speaks MCP over HTTP. First its release holds a word the site's blocking check refuses:
// publish_release is refused, nothing is committed, built or deployed, and the refusal is audited. The agent fixes
// the words in the release and asks again: the checks pass, the publish rules and the promotion rules allow it for
// the owner, and the change is live in the built site, in one commit that names the agent and the owner.
//
//   npm run test:e2e -w packages/server        (e2e/run.mjs; no browser here, so it runs where Playwright does)
//
// Port: support.mjs MCP_PUBLISH_PORT.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { as, fakeCodec, makeFixture, readFile } from '../test/helpers.mjs';
import { mcpClient, mcpToken } from '../test/mcp-support.mjs';
import { MCP_PUBLISH_PORT } from './support.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EXAMPLE = path.join(REPO, 'examples/blog');
// the site's own build: Astro, into dist/ (the deploy copies dist/ live)
const BUILD = `import { build } from 'astro';
await build({ root: process.cwd(), outDir: 'dist', logLevel: 'error' });
console.log('built');
`;
const DEPLOY = `import fs from 'node:fs';
fs.rmSync(process.env.LIVE_DIR, { recursive: true, force: true });
fs.cpSync('dist', process.env.LIVE_DIR, { recursive: true });
console.log('deployed');
`;
const HELLO = 'src/content/posts/hello-markstage.md';

describe('an AI agent publishes a release on the example blog, only when the checks pass', () => {
  let fx, app, owner, agent;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const live = (rel) => fs.readFileSync(path.join(fx.live, rel), 'utf8');
  const audits = (action) => app.db.prepare('SELECT * FROM audit WHERE action = ? ORDER BY id').all(action);

  before(async () => {
    // the fixture's server setup (its blocking check refuses FORBIDDEN-WORD), with the example blog as the site
    fx = makeFixture({ checks: true });
    fs.rmSync(path.join(fx.site, 'src/content'), { recursive: true });
    fs.cpSync(path.join(EXAMPLE, 'src'), path.join(fx.site, 'src'), { recursive: true });
    for (const f of ['astro.config.mjs', 'markstage.config.mjs', 'package.json']) fs.copyFileSync(path.join(EXAMPLE, f), path.join(fx.site, f));
    fs.writeFileSync(path.join(fx.site, 'scripts/build.mjs'), BUILD);
    fs.writeFileSync(path.join(fx.site, 'scripts/deploy.mjs'), DEPLOY);
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(fx.site, 'node_modules'));
    fs.appendFileSync(path.join(fx.site, '.gitignore'), 'node_modules\n.astro/\n');
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'The example blog');
    const cfgPath = path.join(fx.data, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    fs.writeFileSync(cfgPath, JSON.stringify({ ...cfg, commands: { ...cfg.commands, timeoutSeconds: 300 } }, null, 2));
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: MCP_PUBLISH_PORT, collections: [] } });
    app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore() });
    await app.listen(MCP_PUBLISH_PORT, '127.0.0.1');
    app.backup.stop();
    const srv = { app, base: `http://127.0.0.1:${MCP_PUBLISH_PORT}`, config: app.config };
    owner = await as(srv, 'owner', { authorSlug: 'alex-rivera' });
    agent = mcpClient(srv.base, await mcpToken(owner, ['mcp:draft', 'mcp:publish'], 'Release bot'));
  });
  after(async () => {
    await app?.close();
  });

  test('refused while a blocking check fails; published, built and live once it passes', { timeout: 300_000 }, async () => {
    const r = (await owner.post('/releases', { name: 'Agent launch' })).json;
    const hello = (await agent.tool('get_entry', { collection: 'posts', id: 'hello-markstage' })).data;
    const put = (words) => agent.tool('add_to_release', { release: r.id, collection: 'posts', id: 'hello-markstage', version: hello.version, source: hello.source.replace('## Text and lists', `## ${words}`) });
    const added = await put('Text and lists, with FORBIDDEN-WORD');
    assert.equal(added.ok, true, added.text);
    const start = head();

    // refused: the check fails on what the release holds
    let rel = (await agent.tool('get_release', { id: r.id })).data;
    const no = await agent.tool('publish_release', { release: r.id, version: rel.version });
    assert.equal(no.ok, false, no.text);
    assert.deepEqual([no.data.status, no.data.error], [422, 'checks-failed']);
    assert.deepEqual(no.data.checks, [{ entry: 'posts/hello-markstage', check: 'Forbidden words' }]);
    await app.jobs.idle();
    assert.equal(head(), start, 'nothing committed');
    assert.equal(fs.existsSync(fx.live), false, 'nothing built or deployed');
    assert.equal((await owner.get(`/releases/${r.id}`)).json.status, 'open');
    assert.deepEqual(audits('release.publish').map((a) => [a.ok, JSON.parse(a.detail).via]), [[0, 'mcp']]);

    // fixed in the release, asked again: allowed, built by Astro, live
    const fixed = await put('Text and lists, checked and published by an agent');
    assert.equal(fixed.ok, true, fixed.text);
    rel = (await agent.tool('get_release', { id: r.id })).data;
    const yes = await agent.tool('publish_release', { release: r.id, version: rel.version });
    assert.equal(yes.ok, true, yes.text);
    assert.equal(yes.data.publishing, true);
    assert.ok(yes.data.checks.passed.includes('words'));
    await app.jobs.idle();
    const after = (await owner.get(`/releases/${r.id}`)).json;
    assert.equal(after.status, 'published', JSON.stringify(after));
    assert.match(readFile(fx, HELLO), /^## Text and lists, checked and published by an agent$/m);
    assert.match(live('posts/hello-markstage/index.html'), /Text and lists, checked and published by an agent/);
    assert.doesNotMatch(live('posts/hello-markstage/index.html'), /FORBIDDEN-WORD/);
    // one commit, the owner's, naming the agent
    assert.equal(fx.git('rev-list', '--count', `${start}..HEAD`).trim(), '1');
    assert.match(fx.git('log', '-1', '--format=%s').trim(), /^Release “Agent launch” \(published by an AI agent for .+, via MCP: Release bot\)$/);
    assert.deepEqual(audits('release.publish').map((a) => [a.ok, JSON.parse(a.detail).via]), [[0, 'mcp'], [1, 'mcp']]);
  });
});
