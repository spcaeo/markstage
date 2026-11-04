#!/usr/bin/env node
// markstage: Environments from a developer's laptop (docs/ENVIRONMENTS.md "What people do"). Node and git only.
//   markstage pull [--from main]                 merge the latest production content into this branch
//   markstage login <url> [--token-stdin]        keep a personal token for a Markstage server (made in the editor)
//   markstage status                             this branch, and each server you are signed in to
//   markstage promote <branch> <env> [--run] [--reason "…"]
//                                                make a promotion plan on that environment's server, show what it
//                                                would change, and run it when the rules allow (--run)
//   markstage mcp login <url> [--token-stdin]    keep an AI agent's token (scopes mcp:read, mcp:draft) for a server
//   markstage mcp [<url>]                        the MCP server over stdio, for an AI client (Claude and others):
//                                                each JSON-RPC line relayed to the server's <base>/api/mcp
//   markstage build-editor --out <dir> [--root <site>]
//                                                build the editor for a Markstage server (its editorDir), from the
//                                                site's markstage.config; run in the site, after npm install
// <url> is the editor's address: https://cms.example.com (Markstage at /markstage) or, for a server with another
// basePath, that path (https://example.com/cms/); it is kept with the token.
// Tokens are kept in ~/.config/markstage/credentials (0600), or $MARKSTAGE_CONFIG_DIR/credentials; an agent's token
// apart from the command line's, so a `login` never turns into agent access. `markstage mcp` also takes the token
// from MARKSTAGE_TOKEN. Nothing else is stored, and no token ever goes on a command line or in a URL.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

// the server's basePath when the address names none (config.mjs basePath)
const BASE = '/markstage';
const POLL_MS = Number(process.env.MARKSTAGE_POLL_MS ?? 1500);
const WAIT_MS = 15 * 60_000;

const configDir = () => process.env.MARKSTAGE_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'markstage');
const credFile = () => path.join(configDir(), 'credentials');

function readCreds() {
  try {
    return JSON.parse(fs.readFileSync(credFile(), 'utf8'));
  } catch {
    return { servers: {} };
  }
}

function writeCreds(c) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const tmp = `${credFile()}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, credFile());
  fs.chmodSync(credFile(), 0o600);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitOk = (...args) => {
  try {
    return { ok: true, out: git(...args) };
  } catch (e) {
    return { ok: false, out: String(e.stderr ?? e.message).trim() };
  }
};

/**
 * The server from what the person typed: {origin, base, named}. https://cms.example.com is Markstage at /markstage;
 * a path names the server's basePath (https://example.com/cms/, …/cms/api or …/cms/api/mcp, an editor link with #/…).
 */
function serverOf(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`"${url}" is not a URL, such as https://cms.example.com`);
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !loopback) throw new Error('Use the https address of the Markstage server.');
  const p = u.pathname.replace(/\/+$/, '').replace(/\/api(\/mcp)?$/, '');
  return { origin: u.origin, base: p || BASE, named: Boolean(p) };
}
const baseOf = (server) => server.base ?? BASE;

async function api(server, method, p, body) {
  const res = await fetch(`${server.origin}${baseOf(server)}/api${p}`, {
    method,
    headers: { Authorization: `Bearer ${server.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const fail = (r, what) => {
  throw new Error(`${what}: ${r.json?.words ?? r.json?.message ?? `the server answered ${r.status}`}`);
};

/** A line typed at the terminal, not echoed (a token), or the first line of stdin. */
function ask(question, { hidden = false, stdin = false } = {}) {
  return new Promise((resolve) => {
    if (stdin || !process.stdin.isTTY) {
      let data = '';
      process.stdin.on('data', (d) => (data += d));
      process.stdin.on('end', () => resolve(data.split('\n')[0].trim()));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '');
    rl.question(question, (a) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(a.trim());
    });
  });
}

async function login(args) {
  const url = args.find((a) => !a.startsWith('--'));
  if (!url) throw new Error('Usage: markstage login <url of the Markstage server>');
  const { origin, base } = serverOf(url);
  if (!args.includes('--token-stdin')) console.log(`Make a token in Markstage: ${origin}${base}/#/settings/tokens?new=cli (scopes env:read and env:promote).`);
  const token = await ask('Paste the token: ', { hidden: true, stdin: args.includes('--token-stdin') });
  if (!/^mst_[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('That is not a Markstage token (they start with mst_).');
  const r = await api({ origin, base, token }, 'GET', '/env');
  if (r.status !== 200) fail(r, 'The server did not take the token');
  const creds = readCreds();
  creds.servers[origin] = { token, base, env: r.json.name, branch: r.json.branch, savedAt: new Date().toISOString() };
  writeCreds(creds);
  console.log(`Signed in to ${r.json.name} (${origin}), branch ${r.json.branch}. Token kept in ${credFile()}.`);
}

function serverFor(env) {
  const all = Object.entries(readCreds().servers).map(([origin, s]) => ({ origin, ...s }));
  const s = all.find((x) => x.env === env);
  if (!s) throw new Error(`You are not signed in to ${env}${all.length ? ` (you are to ${all.map((x) => x.env).join(', ')})` : ''}. Run: markstage login <its url>`);
  return s;
}

async function status() {
  const branch = gitOk('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch.ok) {
    gitOk('fetch', '--quiet', 'origin');
    const counts = gitOk('rev-list', '--left-right', '--count', `HEAD...origin/${branch.out}`);
    const [ahead, behind] = counts.ok ? counts.out.split(/\s+/) : ['?', '?'];
    console.log(`This copy: ${branch.out}${counts.ok ? `, ${ahead} to push, ${behind} to pull` : ' (not on the remote yet)'}`);
  }
  for (const [origin, s] of Object.entries(readCreds().servers)) {
    const r = await api({ origin, base: s.base, token: s.token }, 'GET', '/env').catch((e) => ({ status: 0, json: { message: e.message } }));
    if (r.status !== 200) console.log(`${s.env} (${origin}): ${r.json?.message ?? `answered ${r.status}`}`);
    else console.log(`${r.json.name} (${origin}): ${r.json.branch} at ${r.json.head?.slice(0, 7)}, live ${r.json.live?.slice(0, 7) ?? '-'}${r.json.upstream ? `; ${r.json.behind ?? '?'} to sync down from ${r.json.upstream}` : ''}`);
  }
}

function pull(args) {
  const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : 'main';
  if (git('status', '--porcelain')) throw new Error('This copy has changes that are not committed. Commit or stash them first.');
  const f = gitOk('fetch', '--quiet', 'origin', from);
  if (!f.ok) throw new Error(`Could not fetch ${from} from origin: ${f.out}`);
  const m = gitOk('merge', '--no-edit', `origin/${from}`);
  if (m.ok) return console.log(m.out.includes('Already up to date') ? `Already up to date with ${from}.` : `Merged the latest ${from} into ${git('rev-parse', '--abbrev-ref', 'HEAD')}.`);
  const files = gitOk('diff', '--name-only', '--diff-filter=U').out.split('\n').filter(Boolean);
  console.log(`Both sides changed ${files.length} file${files.length === 1 ? '' : 's'}; git marked the places in them:\n${files.map((f) => `  ${f}`).join('\n')}\nFix them, then git add and git commit (or git merge --abort to go back).`);
  process.exitCode = 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPlan(server, id, until) {
  const end = Date.now() + WAIT_MS;
  for (;;) {
    const r = await api(server, 'GET', `/env/plans/${id}`);
    if (r.status !== 200) fail(r, 'Reading the plan failed');
    if (until(r.json) || Date.now() > end) return r.json;
    await sleep(POLL_MS);
  }
}

function show(p) {
  console.log(`${p.action} ${p.from.branch} → ${p.to.env}: ${p.status}${p.note ? ` (${p.note})` : ''}`);
  if (p.summary) console.log(`  ${p.summary.text}`);
  for (const c of p.conflicts ?? []) console.log(`  conflict: ${c.words}`);
  for (const c of p.checks ?? []) if (c.status !== 'passed') console.log(`  ${c.status}: ${c.label}: ${c.words}`);
  if (p.decision) console.log(`  ${p.decision.words}`);
}

async function promote(args) {
  const [branch, env] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--reason');
  if (!branch || !env) throw new Error('Usage: markstage promote <branch> <env> [--run] [--reason "…"]');
  const reason = args.includes('--reason') ? args[args.indexOf('--reason') + 1] : undefined;
  const server = serverFor(env);
  gitOk('fetch', '--quiet', 'origin', branch);
  const local = gitOk('rev-parse', '--verify', '--quiet', branch);
  const remote = gitOk('rev-parse', '--verify', '--quiet', `origin/${branch}`);
  if (!remote.ok) throw new Error(`${branch} is not on the remote. Push it first: git push origin ${branch}`);
  if (local.ok && local.out !== remote.out) console.log(`Note: your ${branch} differs from origin/${branch}; the plan uses what is pushed (${remote.out.slice(0, 7)}).`);
  const made = await api(server, 'POST', '/env/plans', { action: 'promote', source: branch, ...(reason ? { reason } : {}) });
  if (made.status !== 202) fail(made, 'The plan was refused');
  console.log(`Preparing the plan on ${env}…`);
  let p = await waitPlan(server, made.json.plan.id, (x) => x.status !== 'preparing');
  show(p);
  const link = `${server.origin}${baseOf(server)}/#/environments/plans/${p.id}`;
  if (!args.includes('--run') || p.status !== 'ready' || p.decision?.effect !== 'allow') {
    console.log(`\n${p.status === 'ready' && p.decision?.effect === 'allow' ? 'Ready. Run it with --run, or open' : 'Open'} ${link}`);
    process.exitCode = p.status === 'ready' ? 0 : 1;
    return;
  }
  const run = await api(server, 'POST', `/env/plans/${p.id}/run`, { version: p.version, ...(reason ? { reason } : {}) });
  if (run.status !== 202) fail(run, 'The run was refused');
  console.log('Running: merge, build, checks, deploy…');
  p = await waitPlan(server, p.id, (x) => ['done', 'failed'].includes(x.status));
  console.log(p.status === 'done' ? `Live on ${env}.` : `Not live: ${p.error ?? p.status}. ${link}`);
  process.exitCode = p.status === 'done' ? 0 : 1;
}

const MCP_HINT = 'markstage mcp login <url> | markstage mcp [<url>] (token from MARKSTAGE_TOKEN or `markstage mcp login`)';

/** POST one JSON-RPC message to the server's MCP endpoint: {status, text}. The token goes in the header only. */
async function mcpPost(server, token, line) {
  const res = await fetch(`${server.origin}${baseOf(server)}/api/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: line,
    signal: AbortSignal.timeout(120_000),
  });
  return { status: res.status, text: await res.text() };
}

async function mcpLogin(args) {
  const url = args.find((a) => !a.startsWith('--'));
  if (!url) throw new Error('Usage: markstage mcp login <url of the Markstage server>');
  const server = serverOf(url);
  const { origin } = server;
  if (!args.includes('--token-stdin')) console.log(`Make a token for an AI agent in Markstage: ${origin}${server.base}/#/settings/tokens?new=mcp (mcp:read; mcp:draft to let it draft).`);
  const token = await ask('Paste the token: ', { hidden: true, stdin: args.includes('--token-stdin') });
  if (!/^mst_[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('That is not a Markstage token (they start with mst_).');
  const r = await mcpPost(server, token, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
  if (r.status !== 200) throw new Error(`The server did not take the token: ${JSON.parse(r.text || '{}').message ?? `it answered ${r.status}`}`);
  const creds = readCreds();
  creds.mcp = { ...(creds.mcp ?? {}), [origin]: { token, base: server.base, savedAt: new Date().toISOString() } };
  writeCreds(creds);
  console.log(`An AI agent can now use ${origin} through \`markstage mcp ${origin}\`. Token kept in ${credFile()}.`);
}

/**
 * The stdio relay: one JSON-RPC message per line in, each answer on one line out, in order. Nothing else is
 * written to stdout (an MCP client reads it); what goes wrong is said on stderr and, for a request, as its error.
 */
async function mcpRelay(args) {
  const stored = readCreds().mcp ?? {};
  const url = args.find((a) => !a.startsWith('--')) ?? process.env.MARKSTAGE_URL ?? (Object.keys(stored).length === 1 ? Object.keys(stored)[0] : null);
  if (!url) throw new Error(`Which server? ${MCP_HINT}`);
  const typed = serverOf(url);
  const { origin } = typed;
  // an address with no path takes the base kept with its token (a server with another basePath)
  const server = { origin, base: typed.named ? typed.base : (stored[origin]?.base ?? typed.base) };
  const token = process.env.MARKSTAGE_TOKEN || stored[origin]?.token;
  if (!token) throw new Error(`No token for ${origin}. ${MCP_HINT}`);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    let id = null;
    try {
      id = JSON.parse(line).id ?? null;
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Not JSON.' } })}\n`);
      continue;
    }
    let r;
    try {
      r = await mcpPost(server, token, line);
    } catch (e) {
      r = { status: 0, text: JSON.stringify({ message: `The Markstage server cannot be reached: ${e.message}` }) };
    }
    if (r.status === 202) continue;
    if (r.status === 200) {
      process.stdout.write(`${r.text.replace(/\n/g, ' ')}\n`);
      continue;
    }
    let words;
    try {
      words = JSON.parse(r.text).message;
    } catch {
      words = null;
    }
    words ??= `The Markstage server answered ${r.status}.`;
    console.error(`markstage mcp: ${words}`);
    if (id !== null) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: words, data: { status: r.status } } })}\n`);
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'mcp') return args[0] === 'login' ? mcpLogin(args.slice(1)) : mcpRelay(args);
  if (cmd === 'login') return login(args);
  if (cmd === 'status') return status();
  if (cmd === 'pull') return pull(args);
  if (cmd === 'promote') return promote(args);
  if (cmd === 'build-editor') return buildEditorCli(args);
  console.log('markstage pull [--from main] | login <url> | status | promote <branch> <env> [--run] [--reason "…"] | mcp login <url> | mcp [<url>] | build-editor --out <dir>');
  process.exitCode = cmd ? 1 : 0;
}

async function buildEditorCli(args) {
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // Vite comes with the site's Astro: loaded only for this command
  const { buildEditor } = await import('../src/build-editor.mjs');
  const r = await buildEditor({ root: opt('--root') ?? process.cwd(), out: opt('--out') });
  console.log(`markstage: editor built in ${(r.ms / 1000).toFixed(1)} s: ${r.out} (set editorDir to it)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
