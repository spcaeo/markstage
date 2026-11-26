// The head kit's tracking loader (src/head/tracking.mjs): the tags per tool and together, every ID checked again, no
// CSP problem in what it writes, what a page's CSP <meta> gains from it, and a real browser run under a strict policy
// (default-src 'self') with the vendors' addresses answered by test stubs, so nothing leaves the machine.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { cspHash, cspHashes } from '@markstage/core/csp';
import { TRACKERS } from '@markstage/core/head';
import { rewritePage } from '../src/head/rewrite.mjs';
import { trackingTags } from '../src/head/tracking.mjs';

// fake IDs of the right shape (example values from core TRACKERS)
const IDS = { gtm: 'GTM-ABC1234', ga4: 'G-ABC123DEF4', ahrefs: 'a1B2c3D4e5F6g7H8i9J0kL', skald: 'www.example.com', plausible: 'example.com' };
const only = (k, extra = {}) => ({ [k]: IDS[k], ...extra });
const GOOGLE = 'https://www.googletagmanager.com';

const scriptText = (head) => head.replace(/^<script data-markstage-head>/, '').replace(/<\/script>$/, '');

test('no tracking: nothing is written', () => {
  const none = { tools: [], head: '', bodyStart: '', csp: { scriptOrigins: [], connectOrigins: [], imgOrigins: [], frameOrigins: [] } };
  assert.deepEqual(trackingTags({}), none);
  assert.deepEqual(trackingTags(undefined), none);
  assert.deepEqual(trackingTags({ gtm: '', ga4: '', ahrefs: '', skald: '', plausible: '', gtmLoad: 'first-interaction' }), none);
});

test('each tool alone: its script, its ID, its origins, and nothing of the others', () => {
  const urls = {
    gtm: `${GOOGLE}/gtm.js?id='+"GTM-ABC1234"`,
    ga4: `${GOOGLE}/gtag/js?id='+"G-ABC123DEF4"`,
    ahrefs: "https://analytics.ahrefs.com/analytics.js','data-key',\"a1B2c3D4e5F6g7H8i9J0kL\"",
    skald: "https://app.skaldanalytics.com/traffic-js/skald.js','data-site',\"www.example.com\"",
    plausible: "https://plausible.io/js/script.js','data-domain',\"example.com\"",
  };
  const origin = { gtm: GOOGLE, ga4: GOOGLE, ahrefs: 'https://analytics.ahrefs.com', skald: 'https://app.skaldanalytics.com', plausible: 'https://plausible.io' };
  for (const k of Object.keys(TRACKERS)) {
    const t = trackingTags(only(k));
    assert.deepEqual(t.tools, [k], k);
    assert.match(t.head, /^<script data-markstage-head>.*<\/script>$/s, k);
    assert.ok(t.head.includes(urls[k]), `${k}: ${t.head}`);
    for (const other of Object.keys(TRACKERS)) if (other !== k) assert.ok(!t.head.includes(urls[other].split("'")[0]), `${k} carries ${other}`);
    assert.deepEqual(t.csp.scriptOrigins, [origin[k]], k);
    assert.ok(t.csp.connectOrigins.includes(origin[k]), k);
    assert.equal(t.bodyStart !== '', k === 'gtm', `${k}: the <noscript> frame is Tag Manager's only`);
    new Function(scriptText(t.head)); // valid JavaScript
  }
});

test('Tag Manager: <noscript> frame with no style attribute; waits for the first interaction by default; "at-once" does not wait', () => {
  const wait = trackingTags(only('gtm'));
  assert.equal(wait.bodyStart, `<noscript data-markstage-head><iframe src="${GOOGLE}/ns.html?id=GTM-ABC1234" height="0" width="0" hidden tabindex="-1" aria-hidden="true" title="Google Tag Manager"></iframe></noscript>`);
  assert.ok(!/style\s*=/.test(wait.bodyStart));
  for (const e of ['pointerdown', 'keydown', 'scroll', 'touchstart']) assert.ok(wait.head.includes(`'${e}'`), e);
  assert.ok(wait.head.includes('3500') && wait.head.includes('requestIdleCallback'));
  assert.deepEqual(wait.csp.frameOrigins, [GOOGLE]);
  assert.ok(trackingTags(only('gtm', { gtmLoad: 'first-interaction' })).head === wait.head, 'first-interaction is the default');
  const now = trackingTags(only('gtm', { gtmLoad: 'at-once' }));
  assert.ok(now.head.includes('gtm();}'), 'started in the loader itself');
  assert.ok(!now.head.includes('pointerdown') && !now.head.includes('3500'));
  assert.equal(trackingTags(only('gtm', { gtmLoad: 'whenever' })).head, wait.head, 'an unknown mode falls back to the default');
});

test('all tools together: one script, every origin once, in a fixed order', () => {
  const t = trackingTags(IDS);
  assert.deepEqual(t.tools, ['gtm', 'ga4', 'ahrefs', 'skald', 'plausible']);
  assert.equal((t.head.match(/<script/g) ?? []).length, 1);
  assert.deepEqual(t.csp.scriptOrigins, [GOOGLE, 'https://analytics.ahrefs.com', 'https://app.skaldanalytics.com', 'https://plausible.io']);
  assert.deepEqual(t.csp.connectOrigins, [GOOGLE, 'https://*.google-analytics.com', 'https://*.google.com', 'https://analytics.ahrefs.com', 'https://app.skaldanalytics.com', 'https://plausible.io']);
  assert.deepEqual(t.csp.imgOrigins, [GOOGLE, 'https://*.google-analytics.com']);
  assert.deepEqual(t.csp.frameOrigins, [GOOGLE]);
  assert.deepEqual(trackingTags(IDS), t, 'same IDs, same output');
});

test('every ID is checked again: one that does not fit its tool never reaches the output', () => {
  const evil = ['"></script><script>alert(1)</script>', "');alert(1);//", 'GTM-x', 'G-', 'a b', 'example.com/<x>', '<img src=x onerror=alert(1)>', 'Example.COM', 123, null, {}, ['GTM-ABC1234']];
  for (const k of Object.keys(TRACKERS)) {
    for (const v of evil) {
      const t = trackingTags({ [k]: v });
      assert.deepEqual(t, { tools: [], head: '', bodyStart: '', csp: { scriptOrigins: [], connectOrigins: [], imgOrigins: [], frameOrigins: [] } }, `${k}: ${JSON.stringify(v)}`);
    }
  }
  // a bad one beside a good one: the good one still loads, the bad one leaves no trace
  const t = trackingTags({ gtm: 'nope', plausible: 'example.com', skald: '<b>', ahrefs: "x'y" });
  assert.deepEqual(t.tools, ['plausible']);
  assert.ok(!/nope|<b>|x'y|googletagmanager/.test(t.head + t.bodyStart));
  assert.equal(t.bodyStart, '');
  // an ID with a "<" cannot end the script element, whatever the pattern allows
  assert.ok(!scriptText(trackingTags(IDS).head).includes('</'));
});

test('a stray space round an ID is trimmed, not kept', () => {
  assert.deepEqual(trackingTags({ plausible: ' example.com ' }).tools, ['plausible']);
  assert.ok(trackingTags({ plausible: ' example.com ' }).head.includes('"example.com"'));
});

test('the CSP check finds no problem and one hash in the head and body tags; no style attribute, handler or javascript: address', () => {
  for (const tracking of [IDS, only('gtm'), only('gtm', { gtmLoad: 'at-once' }), only('ga4'), only('ahrefs'), only('skald'), only('plausible')]) {
    const t = trackingTags(tracking);
    const n = cspHashes(t.head + t.bodyStart);
    assert.deepEqual(n.problems, [], JSON.stringify(tracking));
    assert.deepEqual(n.script, [cspHash(scriptText(t.head))]);
    assert.deepEqual(n.style, []);
  }
});

// ---- the page's own policy -------------------------------------------------------------------------------------

const policyOf = (html) => {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  assert.ok(m, 'the page keeps its CSP <meta>');
  return Object.fromEntries(m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([n, ...s]) => [n, s]));
};
const PAGE = (policy = "default-src 'self'") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>Example Co</title></head><body><main><h1>Example Co</h1><p>Hello</p></main></body></html>`;

test('a page with a CSP <meta> gains exactly the loader’s hash and each tool’s origins; running it again changes nothing', () => {
  const tags = trackingTags(IDS);
  const before = policyOf(PAGE());
  assert.deepEqual(before, { 'default-src': ["'self'"] });
  const html = rewritePage(PAGE(), { tags });
  const after = policyOf(html);
  const hash = cspHash(scriptText(tags.head));
  assert.deepEqual(after['default-src'], ["'self'"]);
  assert.deepEqual(after['script-src'], ["'self'", hash, ...tags.csp.scriptOrigins]);
  assert.deepEqual(after['connect-src'], ["'self'", ...tags.csp.connectOrigins]);
  assert.deepEqual(after['img-src'], ["'self'", ...tags.csp.imgOrigins]);
  assert.deepEqual(after['frame-src'], ["'self'", ...tags.csp.frameOrigins]);
  assert.deepEqual(Object.keys(after).sort(), ['connect-src', 'default-src', 'frame-src', 'img-src', 'script-src']);
  assert.ok(html.includes(tags.head) && html.indexOf(tags.head) < html.indexOf('</head>'), 'the script ends <head>');
  assert.ok(/<body[^>]*>\s*<noscript data-markstage-head>/.test(html), 'the frame follows <body>');
  assert.equal(rewritePage(html, { tags }), html, 'idempotent');
});

test('only what a tool needs is added: Plausible alone touches script-src and connect-src only', () => {
  const tags = trackingTags(only('plausible'));
  const after = policyOf(rewritePage(PAGE("default-src 'none'; img-src 'self'"), { tags }));
  assert.deepEqual(after['script-src'], [cspHash(scriptText(tags.head)), 'https://plausible.io']);
  assert.deepEqual(after['connect-src'], ['https://plausible.io']);
  assert.deepEqual(after['img-src'], ["'self'"]);
  assert.equal(after['frame-src'], undefined);
  assert.deepEqual(after['default-src'], ["'none'"]);
});

test('a page with no CSP <meta> gets the tags and no policy', () => {
  const tags = trackingTags(only('ahrefs'));
  const html = rewritePage('<!doctype html><html><head><title>x</title></head><body>b</body></html>', { tags });
  assert.ok(html.includes(tags.head));
  assert.ok(!/Content-Security-Policy/i.test(html));
});

// ---- a real browser --------------------------------------------------------------------------------------------

/** A server on 127.0.0.1 in 27501–27599 (odd ports) answering every path with `page`; {url, stop}. */
async function serve(pages) {
  const server = http.createServer((req, res) => {
    const html = pages[req.url.split('?')[0]];
    res.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html ?? 'not found');
  });
  for (let port = 27501; port <= 27599; port += 2) {
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      return { url: `http://127.0.0.1:${port}`, stop: () => new Promise((r) => server.close(r)) };
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error('no free port in 27501–27599');
}

/** The vendors' scripts as stubs: each records what it read from its own tag (document.currentScript), as the real ones do. */
const STUBS = [
  [/^https:\/\/analytics\.ahrefs\.com\/analytics\.js$/, "(window.__ran=window.__ran||[]).push('ahrefs:'+document.currentScript.getAttribute('data-key'))"],
  [/^https:\/\/app\.skaldanalytics\.com\/traffic-js\/skald\.js$/, "(window.__ran=window.__ran||[]).push('skald:'+document.currentScript.getAttribute('data-site'))"],
  [/^https:\/\/plausible\.io\/js\/script\.js$/, "(window.__ran=window.__ran||[]).push('plausible:'+document.currentScript.getAttribute('data-domain'))"],
  [/^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-ABC123DEF4$/, "(window.__ran=window.__ran||[]).push('gtag')"],
  [/^https:\/\/www\.googletagmanager\.com\/gtm\.js\?id=GTM-ABC1234$/, "(window.__ran=window.__ran||[]).push('gtm')"],
];

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: 'chrome' });
  }
}

/** Opens `path` of the server in a fresh page with the vendors stubbed; {page, requests, violations}. */
async function open(browser, base, path, { prerendering = false, javaScript = true } = {}) {
  const context = await browser.newContext({ javaScriptEnabled: javaScript });
  const requests = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1')) return route.continue();
    requests.push(url);
    const stub = STUBS.find(([re]) => re.test(url));
    return route.fulfill(stub ? { status: 200, contentType: 'application/javascript', body: stub[1] } : { status: 204, body: '' });
  });
  const page = await context.newPage();
  await page.addInitScript((pre) => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
    // a prerendering page, as far as the loader can tell: document.prerendering until the test shows it
    if (pre) {
      window.__pre = true;
      Object.defineProperty(document, 'prerendering', { get: () => window.__pre, configurable: true });
    }
  }, prerendering);
  await page.goto(`${base}${path}`);
  return { page, requests, violations: () => page.evaluate(() => window.__violations), ran: () => page.evaluate(() => window.__ran ?? []) };
}

const pageFor = (tracking, policy) => rewritePage(PAGE(policy), { tags: trackingTags(tracking) });

test('real browser, strict policy: the loader runs with no violation; the tools start at once, Tag Manager waits for the first interaction', { timeout: 60_000 }, async () => {
  const server = await serve({ '/': pageFor(IDS), '/at-once': pageFor({ ...IDS, gtmLoad: 'at-once' }), '/idle': pageFor(only('gtm')), '/pre': pageFor(IDS) });
  const browser = await launch();
  try {
    // 1. first interaction (the default)
    {
      const { page, requests, violations, ran } = await open(browser, server.url, '/');
      await page.waitForFunction(() => (window.__ran ?? []).length >= 4, null, { timeout: 5000 });
      assert.deepEqual((await ran()).sort(), ['ahrefs:a1B2c3D4e5F6g7H8i9J0kL', 'gtag', 'plausible:example.com', 'skald:www.example.com']);
      assert.deepEqual(await violations(), [], 'no securitypolicyviolation');
      assert.ok(requests.includes('https://analytics.ahrefs.com/analytics.js'));
      assert.ok(requests.includes('https://app.skaldanalytics.com/traffic-js/skald.js'));
      assert.ok(requests.includes('https://plausible.io/js/script.js'));
      assert.ok(requests.includes(`${GOOGLE}/gtag/js?id=G-ABC123DEF4`));
      assert.ok(!requests.some((u) => u.includes('gtm.js')), 'Tag Manager has not started: nobody has touched the page');
      assert.ok(!requests.some((u) => u.includes('ns.html')), 'the <noscript> frame is for visitors without JavaScript only');
      await page.mouse.click(5, 5); // pointerdown
      await page.waitForFunction(() => (window.__ran ?? []).includes('gtm'), null, { timeout: 5000 });
      assert.ok(requests.includes(`${GOOGLE}/gtm.js?id=GTM-ABC1234`));
      assert.deepEqual(await page.evaluate(() => Object.keys(window.dataLayer.find((e) => e && e.event === 'gtm.js') ?? {})), ['gtm.start', 'event'], 'the start event is in the dataLayer');
      assert.deepEqual(await violations(), []);
      await page.context().close();
    }
    // 2. at-once: Tag Manager starts with the rest, nobody has touched the page
    {
      const { page, requests, violations } = await open(browser, server.url, '/at-once');
      await page.waitForFunction(() => (window.__ran ?? []).includes('gtm'), null, { timeout: 5000 });
      assert.ok(requests.includes(`${GOOGLE}/gtm.js?id=GTM-ABC1234`));
      assert.deepEqual(await violations(), []);
      await page.context().close();
    }
    // 3. nobody touches the page: Tag Manager starts about 3.5 s after the load
    {
      const t0 = Date.now();
      const { page, requests, violations } = await open(browser, server.url, '/idle');
      await page.waitForTimeout(1500);
      assert.ok(!requests.some((u) => u.includes('gtm.js')), 'not yet, after 1.5 s');
      await page.waitForFunction(() => (window.__ran ?? []).includes('gtm'), null, { timeout: 10_000 });
      assert.ok(Date.now() - t0 >= 3000, `the idle fallback came after ${Date.now() - t0} ms`);
      assert.deepEqual(await violations(), []);
      await page.context().close();
    }
    // 4. a prerendered page sends nothing until it is shown
    {
      const { page, requests, violations, ran } = await open(browser, server.url, '/pre', { prerendering: true });
      await page.waitForTimeout(800);
      assert.deepEqual(requests, [], 'nothing leaves a page nobody has opened');
      assert.deepEqual(await ran(), []);
      await page.evaluate(() => {
        window.__pre = false;
        document.dispatchEvent(new Event('prerenderingchange'));
      });
      await page.waitForFunction(() => (window.__ran ?? []).length >= 4, null, { timeout: 5000 });
      assert.ok(requests.includes('https://plausible.io/js/script.js'));
      assert.deepEqual(await violations(), []);
      await page.context().close();
    }
    // 5. a visitor without JavaScript: the <noscript> frame loads, the policy lets it in
    {
      const { page, requests } = await open(browser, server.url, '/', { javaScript: false });
      await page.waitForTimeout(800);
      assert.deepEqual(requests, [`${GOOGLE}/ns.html?id=GTM-ABC1234`]);
      await page.context().close();
    }
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('real browser, the test can fail: the same loader under a policy that was not widened is blocked', { timeout: 30_000 }, async () => {
  // the tags in, the policy left as the page had it
  const tags = trackingTags(only('plausible'));
  const html = PAGE().replace('</head>', `${tags.head}</head>`);
  const server = await serve({ '/': html });
  const browser = await launch();
  try {
    const { page, requests, violations } = await open(browser, server.url, '/');
    await page.waitForTimeout(800);
    const v = await violations();
    assert.ok(v.some((x) => x.startsWith('script-src')), `blocked: ${JSON.stringify(v)}`);
    assert.deepEqual(requests, []);
    await page.context().close();
  } finally {
    await browser.close();
    await server.stop();
  }
});
