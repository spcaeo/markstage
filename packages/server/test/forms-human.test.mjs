// Bots that skip the page (forms/submit.mjs spamOf) and the human check (forms/human.mjs, Cloudflare Turnstile). Seen on
// a real site, Nov 2026: a script posted straight to the form with no start time, no page details and a forged Origin,
// and it was kept as a real lead and mailed to the team. Cloudflare is never called: a fake answers its address.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { makeFixture, startServer } from './helpers.mjs';
import { formsOf } from '../src/forms/config.mjs';
import { checkHuman, humanSettingsOf } from '../src/forms/human.mjs';
import { nanpOk, spamOf } from '../src/forms/submit.mjs';
import { smtpSink } from './smtp-sink.mjs';
import { CONTACT_CONFIG, SITE, sitePost } from './forms-support.mjs';

const ENV = 'TEST_HUMAN';
const SECRET = 'test-human-secret-value';
const VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITE_KEY = '1x00000000000000000000AA';

/** A fake Cloudflare: `answer(body)` decides; every call is kept in `calls`. */
function fakeCloudflare(answer) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), body: Object.fromEntries(new URLSearchParams(String(init.body))) });
    const a = await answer(Object.fromEntries(new URLSearchParams(String(init.body))));
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, impl };
}

describe('the human check, alone', () => {
  const human = { kind: 'turnstile', siteKey: SITE_KEY, env: ENV, field: 'cf-turnstile-response' };
  const env = { [`${ENV}_SECRET`]: SECRET };
  const opts = (impl, more = {}) => ({ env, fetchImpl: impl, hosts: [SITE], ip: '203.0.113.7', ...more });

  test('a good pass for one of the site hosts: human; the secret, the pass and the visitor address go to Cloudflare', async () => {
    const cf = fakeCloudflare(() => ({ json: { success: true, hostname: SITE } }));
    assert.deepEqual(await checkHuman(human, 'pass-1', opts(cf.impl)), { verdict: 'human' });
    assert.deepEqual(cf.calls, [{ url: VERIFY, body: { secret: SECRET, response: 'pass-1', remoteip: '203.0.113.7' } }]);
  });

  test('no pass, an over-long one, a refused one or one for another site: a bot', async () => {
    const cf = fakeCloudflare((b) => (b.response === 'other' ? { json: { success: true, hostname: 'evil.example' } } : { json: { success: false, 'error-codes': ['invalid-input-response'] } }));
    assert.equal((await checkHuman(human, '', opts(cf.impl))).verdict, 'bot');
    assert.equal((await checkHuman(human, 'x'.repeat(2049), opts(cf.impl))).verdict, 'bot');
    assert.equal(cf.calls.length, 0, 'no pass, or one too long: Cloudflare is not asked');
    assert.equal((await checkHuman(human, 'bad', opts(cf.impl))).verdict, 'bot');
    assert.equal((await checkHuman(human, 'other', opts(cf.impl))).verdict, 'bot');
    const reused = fakeCloudflare(() => ({ json: { success: false, 'error-codes': ['timeout-or-duplicate'] } }));
    assert.equal((await checkHuman(human, 'old', opts(reused.impl))).verdict, 'bot');
    // a refusal is a refusal whatever the HTTP status (Cloudflare does not document its statuses)
    for (const status of [400, 429, 500]) {
      const refused = fakeCloudflare(() => ({ status, json: { success: false, 'error-codes': ['invalid-input-response'] } }));
      assert.equal((await checkHuman(human, 'bad', opts(refused.impl))).verdict, 'bot', `status ${status}`);
    }
    const noReason = fakeCloudflare(() => ({ json: { success: false } }));
    assert.equal((await checkHuman(human, 'bad', opts(noReason.impl))).verdict, 'bot');
  });

  test('the widget action: a pass made for another action is refused when the form names one', async () => {
    const cf = fakeCloudflare((b) => ({ json: { success: true, hostname: SITE, action: b.response === 'mine' ? 'contact' : 'newsletter' } }));
    const withAction = { ...human, action: 'contact' };
    assert.equal((await checkHuman(withAction, 'mine', opts(cf.impl))).verdict, 'human');
    assert.equal((await checkHuman(withAction, 'theirs', opts(cf.impl))).verdict, 'bot');
    assert.equal((await checkHuman(human, 'theirs', opts(cf.impl))).verdict, 'human', 'no action named: any');
  });

  test('our side or Cloudflare at fault: unchecked (a real visitor is never lost), and the words hold no secret', async () => {
    const down = fakeCloudflare(() => new Error('connect ECONNREFUSED'));
    const ours = fakeCloudflare(() => ({ json: { success: false, 'error-codes': ['invalid-input-secret'] } }));
    const busy = fakeCloudflare(() => ({ status: 503, json: {} }));
    for (const cf of [down, ours, busy]) {
      const r = await checkHuman(human, 'pass', opts(cf.impl));
      assert.equal(r.verdict, 'unchecked');
      assert.ok(!r.why.includes(SECRET));
    }
    const none = await checkHuman(human, '', opts(down.impl, { env: {} }));
    assert.deepEqual(none, { verdict: 'unchecked', why: `${ENV}_SECRET is not set on this server, so the human check did not run.` });
    assert.equal(humanSettingsOf(human, {}).on, false);
  });

  test("Cloudflare's test secret: its answers name no real host, so the host is not compared", async () => {
    const cf = fakeCloudflare(() => ({ json: { success: true, hostname: 'example.com' } }));
    const r = await checkHuman(human, 'XXXX.DUMMY.TOKEN.XXXX', opts(cf.impl, { env: { [`${ENV}_SECRET`]: '1x0000000000000000000000000000000AA' } }));
    assert.equal(r.verdict, 'human');
  });

  test('config: the site key only, never the secret; the posted name must not be a field', () => {
    const fail = (m) => {
      throw new Error(m);
    };
    const form = (human) => ({ c: { fields: { name: {}, email: { type: 'email' } }, human } });
    assert.deepEqual(formsOf(form({ kind: 'turnstile', siteKey: SITE_KEY }), fail).c.human, { kind: 'turnstile', siteKey: SITE_KEY, env: 'TURNSTILE', field: 'cf-turnstile-response', action: null });
    assert.equal(formsOf(form({ kind: 'turnstile', siteKey: SITE_KEY, action: 'contact' }), fail).c.human.action, 'contact');
    assert.throws(() => formsOf(form({ kind: 'turnstile', siteKey: SITE_KEY, action: 'no spaces' }), fail), /human.action/);
    assert.throws(() => formsOf(form({ kind: 'turnstile', siteKey: '0x4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }), fail), /looks like the secret key/);
    assert.throws(() => formsOf(form({ kind: 'turnstile', siteKey: SITE_KEY, secret: 'x' }), fail), /human.secret: unknown/);
    assert.throws(() => formsOf(form({ kind: 'recaptcha', siteKey: SITE_KEY }), fail), /must be 'turnstile'/);
    assert.throws(() => formsOf(form({ kind: 'turnstile', siteKey: SITE_KEY, field: 'email' }), fail), /not a field/);
  });
});

describe('a bot that skips the page, and a visitor whose clock runs fast', () => {
  const form = { honeypot: 'hp_website', started: 'started', minSeconds: 3 };
  const now = Date.parse('2026-11-08T10:00:00Z');
  const p = (o) => new Map(Object.entries(o));
  test('spamOf: honeypot, no start time, too fast; a start time ahead of the server clock is let through', () => {
    assert.equal(spamOf(form, p({ hp_website: 'x', started: String(now - 60_000) }), now), 'honeypot');
    assert.equal(spamOf(form, p({}), now), 'no-page');
    assert.equal(spamOf(form, p({ started: '' }), now), 'no-page');
    assert.equal(spamOf(form, p({ started: 'soon' }), now), 'no-page');
    assert.equal(spamOf(form, p({ started: '0' }), now), 'no-page');
    assert.equal(spamOf(form, p({ started: String(now - 1000) }), now), 'too-fast');
    assert.equal(spamOf(form, p({ started: String(now - 20_000) }), now), null);
    assert.equal(spamOf(form, p({ started: String(now + 120_000) }), now), null, 'a visitor clock two minutes fast is a person');
    assert.equal(spamOf(form, p({ started: String(now + 23 * 3600_000) }), now), null, 'even hours fast');
    assert.equal(spamOf(form, p({ started: String(now + 25 * 3600_000) }), now), 'no-page', 'more than a day ahead is made up');
    assert.equal(spamOf({ honeypot: null, started: null, minSeconds: 3 }, p({}), now), null, 'a form without a start time asks for none');
  });
  test('nanpOk: made-up North American numbers fail; others are not judged', () => {
    for (const n of ['+1 (890) 755-9294', '+18907559294', '(890) 755-9294', '1-890-755-9294', '+1 (211) 555-0100', '+1 (416) 111-0100', '+1 (416) 411-2222', '+1 (055) 555-0100']) assert.equal(nanpOk(n), false, n);
    // real numbers: North American ones, and others that only look like them (a Chinese mobile, an Indian one)
    for (const n of ['+1 (416) 555-0100', '+14165550100', '(416) 555-0100', '1-800-555-0199', '+1 902 388 4599', '+91 98765 43210', '9876543210', '13812345678', '+86 138 1234 5678', '+44 20 7946 0958']) assert.equal(nanpOk(n), true, n);
  });
});

describe('on the server: the bot of Nov 2026, and the human check', () => {
  let fx, srv, sink, clock, cf;
  const realFetch = globalThis.fetch;
  const rows = () => srv.app.db.prepare('SELECT * FROM form_messages ORDER BY at, rowid').all();
  const events = (id) => srv.app.db.prepare('SELECT change FROM form_events WHERE message_id = ? ORDER BY id').all(id).map((e) => e.change);
  const settle = () => new Promise((r) => setTimeout(r, 200));
  let n = 0;
  const lead = (over = {}) => ({
    name: 'Jane Doe',
    email: `jane${++n}@client.example`,
    number: '+1 (416) 555-0100',
    comment: 'We need our boards moved from Asana, about 40 projects.',
    pageUrl: `https://${SITE}/contact-us/`,
    hp_website: '',
    started: String(clock.now - 20_000),
    'cf-turnstile-response': `good-${n}`,
    ...over,
  });
  const post = (body, ip) => sitePost(srv.port, '/markstage/forms/contact', body, { headers: { 'X-Forwarded-For': ip ?? `203.0.113.${n % 200}` } });

  before(async () => {
    clock = { now: Date.parse('2026-11-08T10:00:00Z') };
    // as Cloudflare: a good pass works once (a second use is timeout-or-duplicate), made for the action "contact"
    const used = new Set();
    cf = fakeCloudflare((b) => {
      if (!b.response.startsWith('good-')) return { json: { success: false, 'error-codes': ['invalid-input-response'] } };
      if (used.has(b.response)) return { json: { success: false, 'error-codes': ['timeout-or-duplicate'] } };
      used.add(b.response);
      return { json: { success: true, hostname: SITE, action: 'contact' } };
    });
    // Cloudflare's address answers from the fake; anything else goes out as usual (the test sends nothing else)
    globalThis.fetch = (url, init) => (String(url) === VERIFY ? cf.impl(url, init) : realFetch(url, init));
    process.env[`${ENV}_SECRET`] = SECRET;
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONTACT_CONFIG.replace("message: 'Data stored successfully',", `message: 'Data stored successfully', human: { kind: 'turnstile', siteKey: '${SITE_KEY}', env: '${ENV}', action: 'contact' },`));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A contact form with a human check');
    sink = await smtpSink();
    srv = await startServer(fx, { clock, overrides: { collections: [], siteHosts: [SITE], trustProxy: true, notify: { email: { host: '127.0.0.1', port: sink.port, security: 'none', from: 'Sales <sales@example.test>', to: ['team@example.test'] } } } });
  });
  after(async () => {
    // the last mails and pushes finish before the database closes
    await settle();
    globalThis.fetch = realFetch;
    delete process.env[`${ENV}_SECRET`];
    await srv?.close();
    await sink?.close();
  });

  test('the bot of Nov 2026 (no start time, no page details, the site\'s own Origin, as a forged one looks): spam, answered 200, nobody mailed, Cloudflare not asked', async () => {
    const mails = sink.messages.length;
    const calls = cf.calls.length;
    const r = await post({ name: 'Joannie Berge', email: 'bot@spam.example', number: '+1 (416) 555-0100', comment: 'I tried to scratch it but got cheeseburger all over it.' });
    assert.deepEqual([r.status, r.json.message], [200, 'Data stored successfully']);
    const m = rows().at(-1);
    assert.deepEqual([m.email, m.status, m.spam], ['bot@spam.example', 'spam', 'no-page']);
    assert.match(events(m.id)[0], /sent without the page/);
    await settle();
    assert.equal(sink.messages.length, mails, 'nobody mailed');
    assert.equal(cf.calls.length, calls, 'given away already: no call to Cloudflare');
  });

  test('a page post with a good pass: a real message, mailed; no pass or a bad one: spam, nobody mailed, the visitor asked to send it again', async () => {
    const good = await post(lead({ email: 'real@client.example' }));
    assert.equal(good.status, 200, good.text);
    assert.deepEqual([rows().at(-1).status, rows().at(-1).spam], ['new', null]);
    await settle();
    const mails = sink.messages.length;
    assert.ok(mails >= 1, 'the team was mailed');
    for (const [email, pass] of [['nopass@spam.example', ''], ['badpass@spam.example', 'forged']]) {
      const r = await post(lead({ email, 'cf-turnstile-response': pass }));
      assert.deepEqual([r.status, r.json.error], [400, 'Our spam check did not go through. Please reload the page and send the form again.'], 'never a thank-you for a message nobody reads');
      const m = rows().at(-1);
      assert.deepEqual([m.email, m.status, m.spam], [email, 'spam', 'no-human']);
      assert.match(events(m.id)[0], /no good human check/);
    }
    await settle();
    assert.equal(sink.messages.length, mails, 'spam mails nobody');
    assert.equal(cf.calls.at(-1).body.remoteip, rows().at(-1).ip, 'the visitor address as Markstage recorded it');
  });

  test('a second try: the used pass is refused (asked again), a new one goes through', async () => {
    const first = lead({ email: 'twice@client.example' });
    assert.equal((await post(first, '198.51.100.20')).status, 200);
    const again = await post({ ...first, comment: 'We need our boards moved from Asana, about 40 projects. Also docs.' }, '198.51.100.20');
    assert.equal(again.status, 400, 'the same pass twice: Cloudflare says duplicate');
    assert.equal(rows().at(-1).spam, 'no-human');
    const fresh = await post({ ...first, comment: 'We need our boards moved from Asana, about 40 projects. Also docs.', 'cf-turnstile-response': 'good-fresh' }, '198.51.100.20');
    assert.equal(fresh.status, 200);
    assert.equal(rows().at(-1).status, 'new');
  });

  test('over the day\'s cap for an address: 429, and Cloudflare is not asked', async () => {
    const ip = '198.51.100.77';
    const ins = srv.app.db.prepare("INSERT INTO form_messages (id, form, at, status, fields, meta, ip) VALUES (?, 'contact', ?, 'spam', '{}', '{}', ?)");
    for (let i = 0; i < 20; i++) ins.run(`fm_cap${i}`, new Date(clock.now - 60_000).toISOString(), ip);
    const calls = cf.calls.length;
    const r = await post(lead({ email: 'capped@client.example' }), ip);
    assert.equal(r.status, 429);
    assert.equal(cf.calls.length, calls);
  });

  test('a visitor whose clock runs two minutes fast is a person, not spam', async () => {
    const r = await post(lead({ email: 'fastclock@client.example', started: String(clock.now + 120_000) }));
    assert.equal(r.status, 200);
    assert.deepEqual([rows().at(-1).email, rows().at(-1).status], ['fastclock@client.example', 'new']);
  });

  test('a made-up North American phone number: a plain field message (400), nothing stored', async () => {
    const before = rows().length;
    const r = await post(lead({ email: 'typo@client.example', number: '+1 (890) 755-9294' }));
    assert.equal(r.status, 400);
    assert.equal(r.json.fields.number, 'Phone is not a phone number.');
    assert.equal(rows().length, before);
  });

  test('Cloudflare down, or no secret on the server: the message goes through, and its history says the check did not run', async () => {
    // the server took its fetch when it started (the wrapper above): a down Cloudflare is the fake's answer instead
    const down = fakeCloudflare(() => new Error('connect ETIMEDOUT'));
    const keep = cf.impl;
    cf.impl = down.impl;
    try {
      const r = await post(lead({ email: 'outage@client.example' }));
      assert.equal(r.status, 200);
      const m = rows().at(-1);
      assert.deepEqual([m.email, m.status], ['outage@client.example', 'new']);
      assert.match(events(m.id).join('\n'), /let through without the human check: Cloudflare could not be reached/);
    } finally {
      cf.impl = keep;
    }
    delete process.env[`${ENV}_SECRET`];
    try {
      const r = await post(lead({ email: 'nosecret@client.example', 'cf-turnstile-response': '' }));
      assert.equal(r.status, 200);
      const m = rows().at(-1);
      assert.equal(m.status, 'new');
      assert.match(events(m.id).join('\n'), new RegExp(`${ENV}_SECRET is not set on this server`));
    } finally {
      process.env[`${ENV}_SECRET`] = SECRET;
    }
  });
});
