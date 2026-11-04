// Who may make the server fetch the shared remote, how often, and who sees git's own words when it fails (security
// review 3 Nov 2026, S9). GET /env?fetch=1 ran `git fetch` for any role, as often as asked, and every role saw the
// last lines of git's stderr (which can name the remote's host and path). Now: only those an allowing rule names for
// promote or sync (and owners and administrators) may ask, at most once per 30 s for the whole server; git's words
// go to administrators only; GET /env/branches says the same. The test people are made up here.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as } from './helpers.mjs';
import { STAGING, makeEnvFixture, startEnv } from './env-fixture.mjs';

describe('environments: fetching the remote (S9)', () => {
  let fx, staging, owner, editor, author, contributor;
  const offset = { ms: 0 };
  const clock = { get now() { return Date.now() + offset.ms; } };
  const fetchedAt = () => staging.app.db.prepare("SELECT value FROM kv WHERE key = 'env.fetch'").get()?.value ?? null;
  const setLast = (v) => staging.app.db.prepare("INSERT INTO kv (key, value) VALUES ('env.fetch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(v));

  before(async () => {
    fx = makeEnvFixture();
    staging = await startEnv(fx, 'staging', { environment: STAGING('http://127.0.0.1:1'), clock });
    owner = await as(staging, 'owner');
    editor = await as(staging, 'editor');
    author = await as(staging, 'author', { authorSlug: 'alice' });
    contributor = await as(staging, 'contributor', { authorSlug: 'carol' });
  });
  after(() => staging?.close());

  test('a contributor or an author may read the status but not make the server fetch', async () => {
    for (const who of [contributor, author]) {
      const r = await who.get('/env?fetch=1');
      assert.equal(r.status, 403, r.text);
      const s = await who.get('/env');
      assert.equal(s.status, 200);
      assert.equal(s.json.canFetch, false);
    }
    assert.equal(fetchedAt(), null, 'no fetch ran');
  });

  test('an editor (the starter rules let editors sync down) and the owner may; once per 30 s for the whole server', async () => {
    assert.equal((await editor.get('/env')).json.canFetch, true);
    const first = await editor.get('/env?fetch=1');
    assert.equal(first.status, 200, first.text);
    const at = JSON.parse(fetchedAt()).lastFetchAt;
    assert.ok(at);
    offset.ms += 10_000;
    assert.equal((await owner.get('/env?fetch=1')).status, 200);
    assert.equal(JSON.parse(fetchedAt()).lastFetchAt, at, 'asked again within 30 s: the last fetch stands');
    offset.ms += 25_000;
    await owner.get('/env?fetch=1');
    assert.notEqual(JSON.parse(fetchedAt()).lastFetchAt, at, 'after 30 s it fetches again');
  });

  test("git's own words when a fetch failed go to administrators only (status and branches)", async () => {
    const words = 'fatal: could not read from remote repository git@internal-host.example:/srv/git/site.git';
    setLast({ ok: false, lastFetchAt: new Date(clock.now).toISOString(), error: words });
    for (const who of [contributor, author, editor]) {
      const s = (await who.get('/env')).json;
      assert.equal(s.remote.ok, false);
      assert.doesNotMatch(JSON.stringify(s), /internal-host|srv\/git/, 'no host or path');
      assert.match(s.remote.error, /could not be reached/);
      assert.doesNotMatch(JSON.stringify((await who.get('/env/branches')).json), /internal-host/);
    }
    assert.equal((await owner.get('/env')).json.remote.error, words);
    const admin = await as(staging, 'administrator');
    assert.equal((await admin.get('/env/branches')).json.lastFetch.error, words);
  });
});
