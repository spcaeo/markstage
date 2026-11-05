// The MCP server's publish tool (docs/API-MCP.md "Publishing"): an AI agent asks to publish a release, and the site
// decides exactly as for the token's person. The scope (mcp:publish, an owner's or administrator's to give, never
// brought by another), the tool listed only with it, a publish that is allowed (one commit naming the agent and the
// person, the audit), and each refusal: without the scope, by the person's role, by the promotion rules, by a failed
// check, by the publish rules, a stale version. And the limit: 5 publishes an hour per token. Test people and
// tokens are made here.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, readFile } from './helpers.mjs';
import { releaseServer } from './release-site.mjs';
import { mcpClient, mcpToken } from './mcp-support.mjs';

describe('the MCP publish tool', () => {
  let fx, srv, clock, owner, admin, ed, agent;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const audits = (action) => srv.app.db.prepare('SELECT * FROM audit WHERE action = ? ORDER BY id').all(action);
  const entryV = async (c, id) => (await ed.get(`/collections/${c}/entries/${id}`)).json.version;
  /** An open release holding hello-world with `words` in place of its first paragraph. */
  async function releaseWith(words, name = `Release ${Math.random().toString(36).slice(2, 7)}`) {
    const r = (await ed.post('/releases', { name })).json;
    const src = readFile(fx, 'src/content/blog/hello-world.md').replace(/First paragraph[^\n]*/, words);
    const add = await ed.post(`/releases/${r.id}/items`, { kind: 'entry', collection: 'posts', id: 'hello-world', version: await entryV('posts', 'hello-world'), source: src });
    assert.equal(add.status, 201, add.text);
    return add.json.release;
  }
  const rules = async (doc) => {
    const cur = (await owner.get('/env/rules')).json;
    const r = await owner.put('/env/rules', { version: cur.version, ...doc(cur) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };

  before(async () => {
    ({ fx, srv, clock } = await releaseServer());
    owner = await as(srv, 'owner');
    admin = await as(srv, 'administrator');
    ed = await as(srv, 'editor');
    agent = mcpClient(srv.base, await mcpToken(admin, ['mcp:publish'], 'Release bot'));
  });
  after(() => srv.close());

  test('the scope: an owner’s or administrator’s to give; it brings reading, never drafting; the tool is listed with it only', async () => {
    const no = await ed.post('/me/tokens', { name: 'Mine', scopes: ['mcp:publish'], days: 1 });
    assert.equal(no.status, 403);
    assert.match(no.json.message, /Only an owner or administrator can make a token that lets an AI agent publish/);
    assert.equal((await ed.get('/me/tokens')).json.canMcpPublish, false);
    assert.equal((await admin.get('/me/tokens')).json.canMcpPublish, true);
    const made = await admin.post('/me/tokens', { name: 'Both', scopes: ['mcp:draft', 'mcp:publish'], days: 1 });
    assert.deepEqual(made.json.token.scopes, ['mcp:read', 'mcp:draft', 'mcp:publish']);
    // never mixed with the command line's
    assert.equal((await owner.post('/me/tokens', { name: 'Mixed', scopes: ['env:promote', 'mcp:publish'], days: 1 })).status, 400);
    const tools = (await agent.rpc('tools/list')).json.result.tools;
    const pub = tools.find((t) => t.name === 'publish_release');
    assert.deepEqual([pub.annotations.destructiveHint, pub.annotations.readOnlyHint, pub.inputSchema.required], [true, false, ['release', 'version']]);
    // reads, but no drafting
    assert.ok(tools.some((t) => t.name === 'get_release'));
    assert.equal(tools.some((t) => t.name === 'update_entry'), false);
    const info = (await agent.tool('site_info')).data;
    assert.match(info.rules.join(' '), /publish_release asks to publish a release/);
  });

  test('refused without the scope: a drafting token is told so, and it is not listed', async () => {
    const drafter = mcpClient(srv.base, await mcpToken(admin, ['mcp:draft'], 'Drafter'));
    assert.equal((await drafter.rpc('tools/list')).json.result.tools.some((t) => t.name === 'publish_release'), false);
    const r = (await ed.post('/releases', { name: 'No scope' })).json;
    const out = await drafter.tool('publish_release', { release: r.id, version: r.version });
    assert.equal(out.ok, false);
    assert.match(out.rpcError.message, /does not hold mcp:publish\. Only an owner or administrator makes such a token/);
  });

  test('allowed: the checks pass, the rules allow it, it goes live in one commit named as the agent and its person', async () => {
    const r = await releaseWith('First paragraph, published by the bot.', 'Bot launch');
    const start = head();
    const out = await agent.tool('publish_release', { release: r.id, version: r.version });
    assert.equal(out.ok, true, out.text);
    assert.equal(out.data.publishing, true);
    assert.ok(out.data.job);
    assert.deepEqual(out.data.checks.passed.sort(), ['todo', 'words']);
    await srv.app.jobs.idle();
    const now = (await ed.get(`/releases/${r.id}`)).json;
    assert.equal(now.status, 'published');
    assert.match(readFile(fx, 'src/content/blog/hello-world.md'), /published by the bot/);
    // one commit, by the person, saying it was the agent
    assert.equal(fx.git('rev-list', '--count', `${start}..HEAD`).trim(), '1');
    const name = srv.app.users.get(admin.user.id).name;
    const [author, subject] = fx.git('log', '-1', '--format=%an|%s').trim().split('|');
    assert.equal(author, name);
    assert.equal(subject, `Release “Bot launch” (published by an AI agent for ${name}, via MCP: Release bot)`);
    const row = audits('release.publish').at(-1);
    const d = JSON.parse(row.detail);
    assert.deepEqual([row.ok, row.user_id, row.user_name, row.target, d.via, d.token, d.by], [1, admin.user.id, name, r.id, 'mcp', 'Release bot', `published by an AI agent for ${name}, via MCP: Release bot`]);
    // the notice editors see names the agent too
    assert.match(JSON.stringify(srv.app.db.prepare("SELECT * FROM notices WHERE kind = 'release.published'").all()), /published by an AI agent for/);
    const call = audits('mcp.call').filter((x) => x.target === 'publish_release').at(-1);
    assert.deepEqual([call.ok, JSON.parse(call.detail).token], [1, 'Release bot']);
  });

  test('refused by a check: a blocking check fails on what it holds, nothing is written, the refusal is audited', async () => {
    const r = await releaseWith('First paragraph with FORBIDDEN-WORD in it.');
    const start = head();
    const out = await agent.tool('publish_release', { release: r.id, version: r.version });
    assert.equal(out.ok, false);
    assert.deepEqual([out.data.status, out.data.error], [422, 'checks-failed']);
    assert.match(out.data.message, /Forbidden words failed on posts\/hello-world.*never publishes past a failed check/);
    assert.deepEqual(out.data.checks, [{ entry: 'posts/hello-world', check: 'Forbidden words' }]);
    assert.equal(head(), start);
    assert.equal((await ed.get(`/releases/${r.id}`)).json.status, 'open');
    const row = audits('release.publish').at(-1);
    assert.deepEqual([row.ok, row.target, JSON.parse(row.detail).via, JSON.parse(row.detail).words], [0, r.id, 'mcp', 'a check failed']);
  });

  test('refused by the publish rules (an image with no description), and by a stale version', async () => {
    const r = await releaseWith('First paragraph.\n\n![](/uploads/nowhere.png)');
    const blocked = await agent.tool('publish_release', { release: r.id, version: r.version });
    assert.deepEqual([blocked.ok, blocked.data.status, blocked.data.error], [false, 422, 'blocked']);
    const fresh = await releaseWith('First paragraph, again.');
    const stale = await agent.tool('publish_release', { release: fresh.id, version: 'r0' });
    assert.deepEqual([stale.ok, stale.data.status], [false, 409]);
    assert.equal((await ed.get(`/releases/${fresh.id}`)).json.status, 'open');
  });

  test('refused by the rules and by role: the person as they are now decides', async () => {
    const r = await releaseWith('First paragraph, ruled.');
    const ruler = mcpClient(srv.base, await mcpToken(admin, ['mcp:publish'], 'Rules bot'));
    // the site's rules let only the owner publish releases: the administrator's agent is refused, in the rule's words
    await rules((cur) => ({ groups: cur.starter.groups, rules: cur.starter.rules.map((x) => (x.id === 'releases' ? { ...x, who: { roles: ['owner'] } } : x)) }));
    const ruled = await ruler.tool('publish_release', { release: r.id, version: r.version });
    assert.deepEqual([ruled.ok, ruled.data.status, ruled.data.error], [false, 403, 'rule']);
    assert.match(ruled.data.message, /No rule lets/);
    await rules((cur) => ({ groups: cur.starter.groups, rules: cur.starter.rules }));
    // the person is an editor now: the token publishes nothing
    srv.app.db.prepare('UPDATE users SET role = ? WHERE id = ?').run('editor', admin.user.id);
    const demoted = await ruler.tool('publish_release', { release: r.id, version: r.version });
    assert.deepEqual([demoted.ok, demoted.data.status, demoted.data.error], [false, 403, 'forbidden']);
    assert.match(demoted.data.message, /publishes for an owner or administrator, and .* is now an editor/);
    srv.app.db.prepare('UPDATE users SET role = ? WHERE id = ?').run('administrator', admin.user.id);
    assert.equal((await ed.get(`/releases/${r.id}`)).json.status, 'open');
  });

  test('at most 5 publishes an hour per token: then 429 with Retry-After, audited once, and another token is not held up', async () => {
    const bot = mcpClient(srv.base, await mcpToken(admin, ['mcp:publish'], 'Busy bot'));
    const r = await releaseWith('First paragraph with FORBIDDEN-WORD, refused each time.');
    // asks count whatever the answer: five refused by the check
    for (let i = 0; i < 5; i++) assert.equal((await bot.tool('publish_release', { release: r.id, version: r.version })).data.error, 'checks-failed');
    const over = await bot.rpc('tools/call', { name: 'publish_release', arguments: { release: r.id, version: r.version } });
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers.get('retry-after')) > 3000);
    assert.match(over.json.message, /At most 5 publishes an hour/);
    await bot.rpc('tools/call', { name: 'publish_release', arguments: { release: r.id, version: r.version } });
    const told = audits('mcp.limited').filter((x) => JSON.parse(x.detail).publishesPerHour === 5);
    assert.equal(told.length, 1);
    // reading still works, and another token publishes on
    assert.equal((await bot.tool('get_release', { id: r.id })).ok, true);
    assert.equal((await mcpClient(srv.base, await mcpToken(admin, ['mcp:publish'], 'Other bot')).tool('publish_release', { release: r.id, version: r.version })).data.error, 'checks-failed');
    // an hour later it may ask again
    clock.now += 3_600_001;
    assert.equal((await bot.tool('publish_release', { release: r.id, version: r.version })).data.error, 'checks-failed');
  });
});
