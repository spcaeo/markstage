// Two real server processes on one data dir behave as one (docs/SCALING.md). Each runs the server's own code in a
// child process on its own 127.0.0.1 port (two-process.mjs); requests are spread across both. The limits count
// across both (sign-in misses per address, share-link tries, AI asks a minute, MCP publishes an hour), an edit lock
// taken on one is seen on the other, one job runs at a time whichever process started it, saves on both at the same
// moment are clean commits, a process frozen for longer than the lease keeps its role and its job (nothing is run
// twice), and a process killed mid-job leaves its job failed with a reason while the other takes over. Every process is stopped when the file ends, pass or fail. Test users get random passwords made here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openDb } from '../src/db.mjs';
import { client, makeFixture, testPassword } from './helpers.mjs';
import { mcpClient, mcpToken } from './mcp-support.mjs';
import { oddPort, startPair, startProcess, stopAll } from './two-process.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A build that says when it ran (start and end, in a file) and takes a while; a deploy that does nothing. */
const SLOW_BUILD = `import fs from 'node:fs';
const ms = Number(process.env.SLOW_MS ?? 1500);
fs.appendFileSync(process.env.RUNS_FILE, 'start ' + Date.now() + '\\n');
console.log('building, slowly');
setTimeout(() => { fs.appendFileSync(process.env.RUNS_FILE, 'end ' + Date.now() + '\\n'); console.log('built'); }, ms);
`;

/** A fixture whose config is set for these tests: few sign-in misses, the stub AI, a share origin, a slow build. */
async function clusterFixture({ slowMs = 1500 } = {}) {
  const fx = makeFixture({ checks: false });
  const build = path.join(fx.run, 'slow-build.mjs');
  fs.writeFileSync(build, SLOW_BUILD);
  const runs = path.join(fx.run, 'runs.txt');
  const sharePort = await oddPort();
  const cfg = JSON.parse(fs.readFileSync(path.join(fx.data, 'config.json'), 'utf8'));
  Object.assign(cfg, {
    commands: { ...cfg.commands, build: [process.execPath, build], deploy: [process.execPath, '-e', '0'], env: { ...cfg.commands.env, RUNS_FILE: runs, SLOW_MS: String(slowMs) } },
    login: { ipMaxAttempts: 4 },
    ai: { provider: 'stub', perMinute: 3, perDay: 1000 },
    share: { origin: `http://127.0.0.1:${sharePort}`, port: sharePort },
    processes: { leaseSeconds: 3 },
  });
  fs.writeFileSync(path.join(fx.data, 'config.json'), JSON.stringify(cfg, null, 2));
  const users = {
    owner: { email: 'owner@example.test', name: 'Olga Owner', role: 'owner', password: testPassword() },
    ed: { email: 'ed@example.test', name: 'Ed Editor', role: 'editor', password: testPassword() },
    ed2: { email: 'eve@example.test', name: 'Eve Editor', role: 'editor', password: testPassword() },
  };
  /** The [start, end] of each build that ran, in order. */
  const builds = () => {
    const lines = fs.existsSync(runs) ? fs.readFileSync(runs, 'utf8').trim().split('\n') : [];
    const out = [];
    for (const l of lines) {
      const [what, at] = l.split(' ');
      if (what === 'start') out.push([Number(at), null]);
      else out.find((b) => b[1] === null)[1] = Number(at);
    }
    return out;
  };
  return { fx, users, sharePort, builds };
}

/** A signed-in browser on this process. */
async function signIn(proc, u) {
  const c = client(proc.base);
  await c.login(u.email, u.password);
  return c;
}

/** Poll until fn() is truthy (or fail after `ms`). */
async function until(fn, ms = 15_000, what = 'the condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('two server processes on one data dir', () => {
  let fx, users, builds, a, b, edA, edB;
  const db = () => openDb(fx.data);
  const audits = (action) => {
    const d = db();
    try {
      return d.prepare('SELECT * FROM audit WHERE action = ? ORDER BY id').all(action);
    } finally {
      d.close();
    }
  };

  before(async () => {
    ({ fx, users, builds } = await clusterFixture());
    ({ a, b } = await startPair(fx, { seed: Object.values(users) }));
    edA = await signIn(a, users.ed);
    // the session made on A is good on B: the editor's next request may land on either
    edB = client(b.base);
    for (const [k, v] of edA.cookies) edB.cookies.set(k, v);
    edB.csrf = edA.csrf;
  });
  after(stopAll);

  test('one process holds the primary role; both serve; a session made on one is good on the other', async () => {
    assert.deepEqual([a.role, b.role], ['primary', 'secondary']);
    const meA = await edA.get('/auth/me');
    const meB = await edB.get('/auth/me');
    assert.equal(meA.status, 200);
    assert.equal(meB.status, 200, meB.text);
    assert.equal(meB.json.user.email, users.ed.email);
  });

  test('an edit lock taken on A is seen on B: the second editor views, and is told who edits', async () => {
    const eve = await signIn(b, users.ed2);
    const mine = await edA.post('/collections/posts/entries/hello-world/presence', { tab: 'tab-a-1', mode: 'editing' });
    assert.equal(mine.status, 200, mine.text);
    assert.equal(mine.json.mode, 'editing');
    const theirs = await eve.post('/collections/posts/entries/hello-world/presence', { tab: 'tab-b-1', mode: 'editing' });
    assert.equal(theirs.json.mode, 'viewing', 'the lock is the first tab’s, on the other process');
    assert.equal(theirs.json.lock.name, users.ed.name);
    assert.deepEqual(theirs.json.people.map((p) => [p.name, p.mode]), [[users.ed.name, 'editing']]);
    // the list of open entries, asked on B, names the editor from A
    const list = await eve.get('/presence');
    assert.equal(list.json.entries.find((e) => e.id === 'hello-world').editing.name, users.ed.name);
    // taken over from B: A hears it on its next heartbeat
    const take = await eve.post('/collections/posts/entries/hello-world/presence', { tab: 'tab-b-1', mode: 'editing', take: true });
    assert.equal(take.json.mode, 'editing');
    const told = await edA.post('/collections/posts/entries/hello-world/presence', { tab: 'tab-a-1', mode: 'editing' });
    assert.equal(told.json.mode, 'viewing');
    assert.equal(told.json.takenOver.by, users.ed2.name);
    await eve.del('/collections/posts/entries/hello-world/presence?tab=tab-b-1');
    await edA.del('/collections/posts/entries/hello-world/presence?tab=tab-a-1');
  });

  test('two saves of different files at the same moment, one on A and one on B, land as clean commits (no index.lock)', async () => {
    const head0 = fx.git('rev-parse', 'HEAD').trim();
    for (let i = 0; i < 6; i++) {
      const [va, vb] = await Promise.all([edA.get('/collections/posts/entries/hello-world'), edB.get('/collections/posts/entries/with-html')]);
      const [sa, sb] = await Promise.all([
        edA.put('/collections/posts/entries/hello-world', { version: va.json.version, doc: doc(`Saved on A, round ${i}.`) }),
        edB.put('/collections/posts/entries/with-html', { version: vb.json.version, doc: doc(`Saved on B, round ${i}.`) }),
      ]);
      assert.equal(sa.status, 200, sa.text);
      assert.equal(sb.status, 200, sb.text);
    }
    const commits = fx.git('rev-list', `${head0}..HEAD`).trim().split('\n');
    assert.equal(commits.length, 12, 'one commit per save');
    for (const c of commits) assert.equal(fx.git('show', '--name-only', '--format=', c).trim().split('\n').length, 1, 'each commit holds its own file only');
    assert.equal(fx.git('status', '--porcelain', '--', 'src').trim(), '', 'nothing left uncommitted');
    assert.equal(fs.existsSync(path.join(fx.site, '.git/index.lock')), false);
    assert.equal(fs.existsSync(path.join(fx.data, 'repo.lock')), false, 'the repo lock let go');
    assert.match(fs.readFileSync(path.join(fx.site, 'src/content/blog/hello-world.md'), 'utf8'), /Saved on A, round 5\./);
    assert.match(fs.readFileSync(path.join(fx.site, 'src/content/blog/with-html.md'), 'utf8'), /Saved on B, round 5\./);
  });

  test('two job starts at once, one on each process: one runs, the other waits queued, then runs; the log is live on both', async () => {
    const before = builds().length;
    const [ja, jb] = await Promise.all([edA.post('/site/publish', {}), edB.post('/site/publish', {})]);
    assert.deepEqual([ja.status, jb.status], [202, 202]);
    const ids = [ja.json.job, jb.json.job];
    // while one runs, the other is queued; asked on either process, the same answer
    const seen = await until(async () => {
      const [x, y] = await Promise.all(ids.map((id, i) => [edB, edA][i].get(`/jobs/${id}`)));
      return x.json.status === 'running' || y.json.status === 'running' ? [x.json, y.json] : null;
    }, 15_000, 'a job to run');
    assert.deepEqual(seen.map((j) => j.status).sort(), ['queued', 'running']);
    // the running job's log, written by its process, read on the other (at most a second behind)
    const run = seen.find((j) => j.status === 'running');
    const other = ids.indexOf(run.id) === 0 ? edB : edA;
    await until(async () => (await other.get(`/jobs/${run.id}`)).json.log?.includes('building, slowly'), 5_000, 'the live log on the other process');
    // both finish, one after the other
    const done = await until(async () => {
      const js = await Promise.all(ids.map((id) => edA.get(`/jobs/${id}`)));
      return js.every((j) => ['succeeded', 'failed'].includes(j.json.status)) ? js.map((j) => j.json) : null;
    }, 30_000, 'both jobs to end');
    assert.deepEqual(done.map((j) => j.status), ['succeeded', 'succeeded'], JSON.stringify(done.map((j) => j.error)));
    const ran = builds().slice(before);
    assert.equal(ran.length, 2);
    assert.ok(ran[0][1] <= ran[1][0], `never at once: ${JSON.stringify(ran)}`);
  });

  test('the AI’s asks a minute count across both: 3 a minute, the 4th refused whichever process gets it; audited once', async () => {
    const ask = (c) => c.post('/ai/suggest', { kind: 'seo', collection: 'posts', id: 'hello-world' });
    for (const c of [edA, edB, edA]) {
      const r = await ask(c);
      assert.equal(r.status, 200, r.text);
    }
    const over = await ask(edB);
    assert.equal(over.status, 429, over.text);
    assert.equal(over.json.error, 'ai-rate');
    assert.equal((await ask(edA)).status, 429);
    assert.equal(audits('ai.limited').length, 1, 'audited once a minute, not by each process');
  });

  test('MCP: 5 publishes an hour per token across both processes; the 6th is refused with 429', async () => {
    const owner = await signIn(a, users.owner);
    const secret = await mcpToken(owner, ['mcp:publish'], 'Two-process bot');
    const [botA, botB] = [mcpClient(a.base, secret), mcpClient(b.base, secret)];
    // asks count whatever the answer (here: no such release)
    for (const bot of [botA, botB, botA, botB, botA]) {
      const r = await bot.rpc('tools/call', { name: 'publish_release', arguments: { release: 'rl_none', version: 'x' } });
      assert.equal(r.status, 200, r.text);
    }
    const over = await botB.rpc('tools/call', { name: 'publish_release', arguments: { release: 'rl_none', version: 'x' } });
    assert.equal(over.status, 429, over.text);
    assert.match(over.json.message, /At most 5 publishes an hour/);
    assert.equal((await botA.rpc('tools/call', { name: 'publish_release', arguments: { release: 'rl_none', version: 'x' } })).status, 429);
    assert.equal(audits('mcp.limited').filter((x) => JSON.parse(x.detail).publishesPerHour === 5).length, 1);
  });

  test('sign-in misses from one address count across both: 4 allowed, then 429 on either process', async () => {
    const wrong = (p) => client(p.base).post('/auth/login', { email: users.ed.email, password: 'not-the-password' });
    const r = [];
    for (const p of [a, b, a, b]) r.push((await wrong(p)).status);
    assert.deepEqual(r, [401, 401, 401, 401]);
    const overA = await wrong(a);
    const overB = await wrong(b);
    assert.deepEqual([overA.status, overB.status], [429, 429]);
    assert.ok(Number(overB.json.retryAfter) > 0);
    // even the right password waits, on either process, while the address is limited
    const right = await client(b.base).post('/auth/login', { email: users.ed.email, password: users.ed.password });
    assert.equal(right.status, 429);
  });
});

describe('a server process that freezes (SIGSTOP, a VM pause) for longer than the lease', () => {
  let fx, users, builds, a, b;
  before(async () => {
    ({ fx, users, builds } = await clusterFixture({ slowMs: 2500 }));
    ({ a, b } = await startPair(fx, { seed: Object.values(users) }));
  });
  after(stopAll);

  test('the other process takes nothing over: the primary role and the running job stay with the frozen one, which finishes its job once it wakes', async () => {
    const holderOf = (name) => {
      const d = openDb(fx.data);
      try {
        return d.prepare('SELECT owner FROM leases WHERE name = ?').get(name)?.owner ?? null;
      } finally {
        d.close();
      }
    };
    const edA = await signIn(a, users.ed);
    const edB = await signIn(b, users.ed);
    const job = (await edA.post('/site/publish', {})).json.job;
    await until(() => builds().length === 1, 10_000, 'the build to start on A');
    assert.equal(holderOf('primary'), a.id);
    a.proc.kill('SIGSTOP');
    let queued;
    try {
      // twice the 3 s lease without a heartbeat from A: before, B took A for stopped here
      await sleep(6500);
      assert.equal(holderOf('primary'), a.id, 'the primary role stays A’s');
      assert.equal(holderOf('jobs'), a.id, 'the job lease stays A’s');
      const seen = (await edB.get(`/jobs/${job}`)).json;
      assert.equal(seen.status, 'running', `A’s job is not failed for it: ${seen.error ?? ''}`);
      // a job asked on B waits, queued, behind A's
      queued = (await edB.post('/site/publish', {})).json.job;
      await sleep(1000);
      assert.equal((await edB.get(`/jobs/${queued}`)).json.status, 'queued');
    } finally {
      a.proc.kill('SIGCONT');
    }
    // A wakes: its job ends as it would have; then B's runs; never two builds at once
    const done = await until(async () => {
      const js = await Promise.all([job, queued].map((id) => edB.get(`/jobs/${id}`)));
      return js.every((j) => ['succeeded', 'failed'].includes(j.json.status)) ? js.map((j) => j.json) : null;
    }, 30_000, 'both jobs to end');
    assert.deepEqual(done.map((j) => j.status), ['succeeded', 'succeeded'], JSON.stringify(done.map((j) => j.error)));
    const ran = builds();
    assert.equal(ran.length, 2);
    assert.ok(ran[0][1] <= ran[1][0], `never at once: ${JSON.stringify(ran)}`);
    assert.equal(holderOf('primary'), a.id);
  });
});

describe('a server process that stops', () => {
  let fx, users, builds, sharePort, a, b;
  before(async () => {
    ({ fx, users, builds, sharePort } = await clusterFixture({ slowMs: 4000 }));
    ({ a, b } = await startPair(fx, { seed: Object.values(users) }));
  });
  after(stopAll);

  test('killed mid-job: the other process marks the job failed with a reason, takes the primary role, and runs new jobs; share-link tries counted on both', async () => {
    const shareTry = async (i) => (await fetch(`http://127.0.0.1:${sharePort}/share/${String(i).padStart(43, 'x')}`)).status;
    // the share listener is the primary's (A's): 20 tries there
    for (let i = 0; i < 20; i++) assert.equal(await shareTry(i), 404, `try ${i + 1}`);
    const edA = await signIn(a, users.ed);
    const job = (await edA.post('/site/publish', {})).json.job;
    await until(() => builds().length === 1, 10_000, 'the build to start on A');
    await a.kill();
    // B hears of it on its next heartbeat (A's pid is gone): the job is failed, with a reason
    const edB = await signIn(b, users.ed);
    const failed = await until(async () => {
      const j = (await edB.get(`/jobs/${job}`)).json;
      return j.status === 'failed' ? j : null;
    }, 10_000, 'the job to be marked failed');
    assert.equal(failed.error, 'The server process running this job stopped.');
    // B took the primary role: its share listener answers, and the 20 tries made on A still count
    await until(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${sharePort}/robots.txt`)).status === 200;
      } catch {
        return false;
      }
    }, 10_000, 'B to listen for share links');
    for (let i = 20; i < 30; i++) assert.equal(await shareTry(i), 404, `try ${i + 1}`);
    assert.equal(await shareTry(30), 429, 'the 31st try in the minute, the first 20 made on the other process');
    // a lock file A left (its pid gone) does not hold B up: a save goes through
    fs.writeFileSync(path.join(fx.data, 'repo.lock'), JSON.stringify({ owner: a.id, pid: a.proc.pid, host: 'here', what: 'commit' }), { mode: 0o600 });
    const v = (await edB.get('/collections/posts/entries/hello-world')).json.version;
    const saved = await edB.put('/collections/posts/entries/hello-world', { version: v, doc: doc('After the crash.') });
    assert.equal(saved.status, 200, saved.text);
    // and a new job runs to the end
    await sleep(4500); // the build A started (its child outlived A) ends first
    const next = (await edB.post('/site/publish', {})).json.job;
    const done = await until(async () => {
      const j = (await edB.get(`/jobs/${next}`)).json;
      return ['succeeded', 'failed'].includes(j.status) ? j : null;
    }, 20_000, 'the new job to end');
    assert.equal(done.status, 'succeeded', done.error ?? '');
  });

  test('a clean stop lets the roles go at once: a process started after takes the primary role', async () => {
    const c = await startProcess(fx);
    assert.equal(c.role, 'secondary', 'B holds it');
    await b.stop();
    // C takes the role on its next heartbeat (half a second with a 3 s lease)
    const edC = await signIn(c, users.ed);
    await until(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${sharePort}/robots.txt`)).status === 200;
      } catch {
        return false;
      }
    }, 10_000, 'C to take the primary role');
    assert.equal((await edC.get('/auth/me')).status, 200);
    await c.stop();
  });
});
