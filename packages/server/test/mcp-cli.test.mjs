// `markstage mcp` (packages/astro/bin), the stdio relay an AI client starts: one JSON-RPC message per line in, each
// answer on one line out and nothing else on stdout; the token from MARKSTAGE_TOKEN or `markstage mcp login`, sent
// in the Authorization header only. The tokens are test ones made here.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, readFile, startServer } from './helpers.mjs';
import { mcpToken } from './mcp-support.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../astro/bin/markstage.mjs');
const line = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

describe('markstage mcp, the stdio relay', () => {
  let fx, srv, ed, cfg, secret;
  /** The CLI with these lines on stdin: {code, out (the relay's stdout lines, parsed), raw, err}. */
  const cli = (args, input, env = {}) =>
    new Promise((resolve) => {
      const child = execFile(process.execPath, [BIN, ...args], { cwd: fx.run, env: { PATH: process.env.PATH, HOME: fx.run, MARKSTAGE_CONFIG_DIR: cfg, ...env } }, (err, stdout, stderr) =>
        resolve({ code: err ? err.code : 0, raw: stdout, out: args.includes('login') || args[0] === 'status' ? [] : stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)), err: stderr }),
      );
      child.stdin.end(input);
    });

  before(async () => {
    fx = makeFixture();
    cfg = path.join(fx.run, 'cli-config');
    srv = await startServer(fx);
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
    secret = await mcpToken(ed, ['mcp:draft'], 'Relay');
  });
  after(() => srv.close());

  test('initialize, a notification, tools/list, tools/call and a bad line: one answer per request, in order, JSON only', async () => {
    const input = [
      line(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      line(2, 'tools/list'),
      line(3, 'tools/call', { name: 'get_entry', arguments: { collection: 'posts', id: 'hello-world' } }),
      'not json',
      '',
      line(4, 'nope'),
    ].join('\n');
    const r = await cli(['mcp', srv.base], `${input}\n`, { MARKSTAGE_TOKEN: secret });
    assert.equal(r.code, 0, r.err);
    // the notification has no answer; the rest one line each, in order
    assert.deepEqual(r.out.map((m) => m.id), [1, 2, 3, null, 4]);
    assert.equal(r.raw.split('\n').filter(Boolean).length, 5, 'one line per answer');
    assert.equal(r.out[0].result.protocolVersion, '2025-06-18');
    assert.ok(r.out[1].result.tools.some((t) => t.name === 'update_entry'), 'mcp:draft lists the write tools');
    assert.equal(r.out[2].result.structuredContent.source, readFile(fx, 'src/content/blog/hello-world.md'));
    assert.equal(r.out[3].error.code, -32700);
    assert.equal(r.out[4].error.code, -32601);
    assert.equal(r.raw.includes(secret), false);
    assert.equal(r.err.includes(secret), false);
  });

  test('mcp login keeps the token (0600) after the server takes it; the relay then needs no MARKSTAGE_TOKEN', async () => {
    const bad = await cli(['mcp', 'login', srv.base, '--token-stdin'], 'mst_not-a-real-token-at-all-xxxxx\n');
    assert.equal(bad.code, 1);
    assert.match(bad.err, /The server did not take the token: Unknown token\./);
    assert.equal(fs.existsSync(path.join(cfg, 'credentials')), false, 'nothing kept');
    // the command line's login does not take an agent's token
    const cliLogin = await cli(['login', srv.base, '--token-stdin'], `${secret}\n`);
    assert.equal(cliLogin.code, 1);
    assert.match(cliLogin.err, /This token is for the MCP server \(\/mcp\) only\./);
    assert.equal(fs.existsSync(path.join(cfg, 'credentials')), false, 'nothing kept');
    const ok = await cli(['mcp', 'login', srv.base, '--token-stdin'], `${secret}\n`);
    assert.equal(ok.code, 0, ok.err);
    const file = path.join(cfg, 'credentials');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const creds = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(creds.mcp[new URL(srv.base).origin].token, secret);
    assert.equal(creds.servers?.[new URL(srv.base).origin], undefined, 'not the command line’s token');
    // the only server kept: no URL needed either
    const r = await cli(['mcp'], `${line(1, 'ping')}\n`);
    assert.deepEqual(r.out, [{ jsonrpc: '2.0', id: 1, result: {} }]);
  });

  test('a server at another basePath (/cms): the address names it, kept with the token; status and the relay follow it', async () => {
    const fx2 = makeFixture();
    const other = await startServer(fx2, { overrides: { basePath: '/cms' } });
    try {
      const who = await as(other, 'editor', { authorSlug: 'alice' });
      const agentToken = await mcpToken(who, ['mcp:read'], 'At /cms');
      const cliToken = (await who.post('/me/tokens', { name: 'Laptop at /cms', scopes: ['env:read'] })).json.secret;
      const own = path.join(fx2.run, 'cli-config');
      const at = (args, input, env = {}) => cli(args, input, { MARKSTAGE_CONFIG_DIR: own, ...env });
      // the editor's address with its path: kept with the token
      const ok = await at(['mcp', 'login', `${other.base}/cms/`, '--token-stdin'], `${agentToken}\n`);
      assert.equal(ok.code, 0, ok.err);
      assert.equal(JSON.parse(fs.readFileSync(path.join(own, 'credentials'), 'utf8')).mcp[other.base].base, '/cms');
      // the relay: by the kept server alone, by its bare origin (the kept base), by the MCP address itself
      for (const args of [['mcp'], ['mcp', other.base], ['mcp', `${other.base}/cms/api/mcp`]]) {
        const r = await at(args, `${line(1, 'ping')}\n`);
        assert.deepEqual(r.out, [{ jsonrpc: '2.0', id: 1, result: {} }], `${args.join(' ')}: ${r.err}`);
      }
      // the bare origin with no token kept for it is Markstage at /markstage: not there
      const bare = await cli(['mcp', other.base], `${line(1, 'ping')}\n`, { MARKSTAGE_TOKEN: agentToken, MARKSTAGE_CONFIG_DIR: path.join(fx2.run, 'none') });
      assert.equal(bare.out[0].error.data.status, 404);
      // the command line's login and status follow it too
      const login = await at(['login', `${other.base}/cms/#/settings/tokens`, '--token-stdin'], `${cliToken}\n`);
      assert.equal(login.code, 0, login.err);
      assert.equal(JSON.parse(fs.readFileSync(path.join(own, 'credentials'), 'utf8')).servers[other.base].base, '/cms');
      const status = await at(['status'], '');
      assert.doesNotMatch(status.raw, /answered 404|Unknown API route/, status.raw);
      assert.match(status.raw, new RegExp(`\\(${other.base.replace(/[.]/g, '\\.')}\\)`));
    } finally {
      await other.close();
    }
  });

  test('refusals are JSON-RPC errors on stdout and words on stderr: a command line token, no token', async () => {
    const env = (await ed.post('/me/tokens', { name: 'Laptop', scopes: ['env:read'] })).json.secret;
    const r = await cli(['mcp', srv.base], `${line(7, 'ping')}\n`, { MARKSTAGE_TOKEN: env });
    assert.equal(r.code, 0);
    assert.deepEqual(r.out, [{ jsonrpc: '2.0', id: 7, error: { code: -32000, message: 'A token reaches the Environments routes only.', data: { status: 403 } } }]);
    assert.match(r.err, /^markstage mcp: A token reaches the Environments routes only\.$/m);
    fs.rmSync(path.join(cfg, 'credentials'));
    const none = await cli(['mcp', srv.base], `${line(1, 'ping')}\n`);
    assert.equal(none.code, 1);
    assert.match(none.err, /^No token for http:\/\/127\.0\.0\.1:\d+\. markstage mcp login <url>/);
    assert.equal(none.raw, '', 'nothing on stdout');
  });
});
