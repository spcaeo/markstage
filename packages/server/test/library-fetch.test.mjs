// Fetching from the web for imports (src/library/fetch.mjs, docs/SECURITY.md "Fetching from the web"): no loopback,
// private, link-local or reserved address is ever contacted, whether written in the address, behind a name, hidden in
// an IPv6 or numeric form, or reached by a redirect; limits on size and time; robots.txt respected.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import { checkUrl, isPublicAddress, robotsAllow, robotsAllows, robotsMatch, robotsRules, safeFetch } from '../src/library/fetch.mjs';
import { startWebSite } from './web-site.mjs';

/** A resolver that answers from a table, as dns.lookup does with {all: true}. */
const resolver = (table) => (name, opts, cb) => {
  const list = table[name];
  if (!list) return cb(Object.assign(new Error(`no ${name}`), { code: 'ENOTFOUND' }));
  return cb(null, list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
};
const refused = (e) => e.status === 400 && e.code === 'unsafe-url';

describe('the SSRF guard', () => {
  let site;
  before(async () => {
    site = await startWebSite({
      '/ok': { body: '<p>hello</p>' },
      '/to-metadata': { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } },
      '/to-ten': { status: 301, headers: { Location: 'http://10.0.0.5/admin' } },
      '/to-loopback': { status: 307, headers: { Location: 'http://127.0.0.1:1/' } },
      '/to-localhost': { status: 308, headers: { Location: 'http://localhost/' } },
      '/to-name': { status: 302, headers: { Location: 'http://inside.example.test/' } },
      '/to-mapped': { status: 302, headers: { Location: 'http://[::ffff:127.0.0.1]/' } },
      '/hop': { status: 302, headers: { Location: '/ok' } },
      '/loop': { status: 302, headers: { Location: '/loop' } },
      '/big': { body: 'x'.repeat(2048) },
      '/bomb': { headers: { 'Content-Encoding': 'gzip' }, body: zlib.gzipSync(Buffer.alloc(5 * 1024 * 1024)) },
      '/slow': { delay: 600, body: 'late' },
    });
  });
  after(() => site.close());

  test('public and not public addresses, IPv4 and IPv6, with IPv4 hidden in IPv6', () => {
    for (const ip of ['127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '169.254.0.1', '100.64.0.1', '0.0.0.0', '255.255.255.255', '224.0.0.1', '192.0.2.1', '198.18.0.1', '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '64:ff9b::a00:1', '64:ff9b::a9fe:a9fe', '::127.0.0.1', '2001:db8::1', '2002:7f00:1::1', '2001::1', 'fe80::1%lo0', 'not an ip']) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
    for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '172.15.255.255', '100.128.0.1', '169.253.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8', '64:ff9b::808:808']) {
      assert.equal(isPublicAddress(ip), true, ip);
    }
  });

  test('addresses refused before anything is sent: written as an IP in any form, local names, other ports, credentials', () => {
    for (const u of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://10.1.2.3/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://0x7f000001/', 'http://127.1/', 'http://0177.0.0.1/', 'http://localhost/', 'http://app.localhost/', 'http://printer.local/', 'http://db.internal/', 'https://example.com:8443/', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pw@example.com/', 'no address']) {
      assert.throws(() => checkUrl(u), refused, u);
    }
    assert.equal(checkUrl('https://example.com/a?b=1').href, 'https://example.com/a?b=1');
  });

  test('a name that resolves to loopback, 169.254, 10/8, or to a public and a private address together, is refused', async () => {
    const lookup = resolver({ 'meta.example.test': ['169.254.169.254'], 'ten.example.test': ['10.9.8.7'], 'loop.example.test': ['127.0.0.1'], 'both.example.test': ['93.184.216.34', '10.0.0.1'], 'six.example.test': ['::1'] });
    for (const host of ['meta', 'ten', 'loop', 'both', 'six']) {
      await assert.rejects(safeFetch(`http://${host}.example.test/`, { outbound: { lookup } }), refused, host);
    }
    // the test site's own seam does not open the rest of loopback
    await assert.rejects(safeFetch('http://loop.example.test/', { outbound: { lookup, allow: site.outbound.allow } }), refused);
  });

  test('redirects to 169.254, 10/8, loopback (another port), localhost, a private name or a mapped IPv6 are refused, and never followed', async () => {
    const lookup = resolver({ 'inside.example.test': ['192.168.0.10'] });
    const outbound = { ...site.outbound, lookup };
    assert.equal((await safeFetch(`${site.base}/ok`, { outbound })).body.toString(), '<p>hello</p>');
    const before = site.hits.length;
    for (const p of ['/to-metadata', '/to-ten', '/to-loopback', '/to-localhost', '/to-name', '/to-mapped']) {
      await assert.rejects(safeFetch(`${site.base}${p}`, { outbound }), refused, p);
    }
    // only the redirecting pages themselves were asked for
    assert.deepEqual(site.hits.slice(before), ['/to-metadata', '/to-ten', '/to-loopback', '/to-localhost', '/to-name', '/to-mapped']);
    const hop = await safeFetch(`${site.base}/hop`, { outbound });
    assert.deepEqual([hop.url, hop.body.toString()], [`${site.base}/ok`, '<p>hello</p>']);
    await assert.rejects(safeFetch(`${site.base}/loop`, { outbound }), (e) => e.status === 502 && /redirects too many times/.test(e.message));
  });

  test('size and time limits: too large (also once unzipped) and too slow', async () => {
    const outbound = site.outbound;
    await assert.rejects(safeFetch(`${site.base}/big`, { outbound, maxBytes: 1024 }), (e) => e.status === 413);
    await assert.rejects(safeFetch(`${site.base}/bomb`, { outbound, maxBytes: 1024 * 1024 }), (e) => e.status === 413);
    await assert.rejects(safeFetch(`${site.base}/slow`, { outbound, timeoutMs: 150 }), (e) => e.status === 504);
    await assert.rejects(safeFetch('http://127.0.0.1:1/', { outbound: { allow: () => true }, timeoutMs: 2000 }), (e) => e.status === 502);
  });
});

describe('robots.txt', () => {
  test('our group, else *; the longest rule wins, Allow on a tie; * and $', () => {
    const text = 'User-agent: *\nDisallow: /private\nAllow: /private/open\n\nUser-agent: OtherBot\nDisallow: /\n';
    const rules = robotsRules(text);
    assert.equal(robotsAllows(rules, '/blog/post'), true);
    assert.equal(robotsAllows(rules, '/private/x'), false);
    assert.equal(robotsAllows(rules, '/private/open/x'), true);
    const ours = robotsRules('User-agent: *\nDisallow:\n\nUser-agent: Markstage\nUser-agent: other\nDisallow: /*.pdf$\nDisallow: /drafts/\n');
    assert.equal(robotsAllows(ours, '/files/a.pdf'), false);
    assert.equal(robotsAllows(ours, '/files/a.pdf?x=1'), true);
    assert.equal(robotsAllows(ours, '/drafts/one'), false);
    assert.equal(robotsAllows(ours, '/'), true);
    assert.equal(robotsAllows(robotsRules('User-agent: *\nDisallow: /\n'), '/anything'), false);
    assert.equal(robotsAllows(robotsRules('# nothing'), '/anything'), true);
  });

  test('matching is linear: a hostile pattern against a long path finishes at once; long and many rules are capped', () => {
    for (const [pattern, p, want] of [['/a', '/abc', true], ['/a$', '/a', true], ['/a$', '/ab', false], ['/*.pdf$', '/x/y.pdf', true], ['/*.pdf$', '/x/y.pdf?z', false], ['/a*b*c', '/a-b-c-d', true], ['/a*b*c', '/a-c-b', false], ['/**x', '/yx', true], ['*', '/', true], ['/a*$', '/a', true], ['/ab*ba$', '/aba', false], ['/ab*ba$', '/abba', true]]) {
      assert.equal(robotsMatch(pattern, p), want, `${pattern} ${p}`);
    }
    const hostile = `/${'*a'.repeat(200)}*b`;
    const longPath = `/${'a'.repeat(2000)}`;
    const t = performance.now();
    const rules = robotsRules(`User-agent: *\nDisallow: ${hostile}\nDisallow: /${'*a'.repeat(30)}*b$\n`);
    assert.equal(robotsAllows(rules, longPath), true);
    assert.equal(robotsAllows(rules, `${longPath}b`), false);
    assert.ok(performance.now() - t < 50, `took ${performance.now() - t} ms`);
    assert.equal(robotsRules(`User-agent: *\nDisallow: /${'x'.repeat(2048)}\nDisallow: /ok\n`).length, 1, 'a rule over 2048 characters is skipped');
    assert.equal(robotsRules(`User-agent: *\n${'Disallow: /x\n'.repeat(1500)}`).length, 1000, 'at most 1000 rules');
  });

  test('read from the site: missing allows, a server error refuses, a rule refuses', async () => {
    const make = (robots) => startWebSite({ '/robots.txt': robots });
    const missing = await make({ status: 404, body: '' });
    const broken = await make({ status: 503, body: '' });
    const ruled = await make({ type: 'text/plain', body: 'User-agent: *\nDisallow: /members/\n' });
    try {
      assert.deepEqual(await robotsAllow(`${missing.base}/page`, { outbound: missing.outbound }), { allowed: true });
      const b = await robotsAllow(`${broken.base}/page`, { outbound: broken.outbound });
      assert.equal(b.allowed, false);
      assert.match(b.why, /robots\.txt answered 503/);
      assert.deepEqual(await robotsAllow(`${ruled.base}/blog/`, { outbound: ruled.outbound }), { allowed: true });
      const r = await robotsAllow(`${ruled.base}/members/list`, { outbound: ruled.outbound });
      assert.equal(r.allowed, false);
      assert.match(r.why, /asks robots not to fetch \/members\/list/);
    } finally {
      await Promise.all([missing.close(), broken.close(), ruled.close()]);
    }
  });
});
