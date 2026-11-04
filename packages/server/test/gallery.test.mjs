// The section gallery: every section type and variation a JSON collection's pages use (the first real use is the
// sample) or its schema declares (placeholder words), each as a throwaway page in the preview's private clone, drawn
// by the site's dev server. The content repo, its remote and its build never see those pages, and the clone cannot push.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { placeholder } from '../src/preview/gallery.mjs';
import { as, client, freePort, makeFixture, startServer } from './helpers.mjs';

const text = (label) => `{ kind: 'form', label: ${JSON.stringify(label)}, defaultValue: () => '', validate: (v) => v }`;
const KEYSTATIC = `const select = (label, values, d) => ({ kind: 'form', label, options: values.map((v) => ({ label: v, value: v })), defaultValue: () => d });
const object = (fields, label) => ({ kind: 'object', fields, label });
export default {
  collections: {
    pages: {
      label: 'Pages', path: 'src/content/pages/*', format: { data: 'json' },
      schema: {
        title: ${text('Title')},
        uri: ${text('URI')},
        sections: { kind: 'array', label: 'Sections', element: { kind: 'conditional', discriminant: select('Kind', ['hero', 'cards', 'cta'], 'hero'),
          values: {
            hero: object({ heading: ${text('Heading')}, variant: ${text('Variant')} }),
            cards: object({ heading: ${text('Heading')}, variant: select('Variant', ['', 'plain', 'blue'], ''), items: { kind: 'array', label: 'Items', element: object({ title: ${text('Title')} }) } }),
            cta: object({ heading: ${text('Heading')} }),
          } } },
      },
    },
  },
};
`;
const SITE_CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', url: '{uri}', gallery: { variant: 'variant' } },
  ],
  schema: { keystatic: './keystatic.config.mjs' },
};
`;
const sec = (discriminant, value) => ({ discriminant, value });
const PAGES = {
  about: { title: 'About', uri: '/about/', sections: [sec('hero', { heading: 'We are here' }), sec('cards', { heading: 'What we do', variant: 'blue', items: [{ title: 'One' }] })] },
  team: { title: 'Team', uri: '/team/', sections: [sec('hero', { heading: 'Our team', variant: 'tall' }), sec('cards', { heading: 'Again', variant: 'blue' }), sec('legacy', { html: '<p>Old</p>' })] },
};

// stands in for `astro dev`: a page by its uri, each section as a block with the outline marker
const FAKE_DEV = `import fs from 'node:fs';
import http from 'node:http';
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  for (const f of fs.readdirSync('src/content/pages')) {
    const d = JSON.parse(fs.readFileSync('src/content/pages/' + f, 'utf8'));
    if (d.uri !== url) continue;
    const body = (d.sections ?? []).map((s, i) => '<section data-ms-section="' + i + '" data-kind="' + s.discriminant + '" data-variant="' + (s.value?.variant ?? '') + '"><h2>' + (s.value?.heading ?? s.discriminant) + '</h2></section>').join('');
    return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><html><head><title>' + d.title + '</title></head><body><header>Site header</header><main>' + body + '</main></body></html>');
  }
  res.writeHead(404).end('not found');
}).listen(Number(process.argv[2]), '127.0.0.1');
`;
const HTML = { Accept: 'text/html' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('placeholder: words where text goes, three items in a list, the select default', () => {
  assert.deepEqual(placeholder({ type: 'object', fields: { heading: { type: 'text', label: 'Heading' }, items: { type: 'array', item: { type: 'object', fields: { title: { type: 'text' } } } }, tone: { type: 'select', options: [{ value: 'a' }, { value: 'b' }], default: 'b' } } }), {
    heading: 'Sample heading',
    items: [{ title: 'Sample title' }, { title: 'Sample title' }, { title: 'Sample title' }],
    tone: 'b',
  });
  assert.match(placeholder({ type: 'text', label: 'Lead (HTML)', rich: true }), /^<p>Sample lead \(html\): /);
});

describe('section gallery', () => {
  let fx, srv, ed, pOrigin, origin, gallery, previewCookie;
  const viewer = client('');

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'keystatic.config.mjs'), KEYSTATIC);
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    for (const [id, d] of Object.entries(PAGES)) fs.writeFileSync(path.join(fx.site, `src/content/pages/${id}.json`), `${JSON.stringify(d, null, 2)}\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Pages with sections');
    // the content repo's remote: a bare repo the gallery must never reach
    origin = path.join(fx.run, 'origin.git');
    git(fx.run, 'clone', '-q', '--bare', fx.site, origin);
    fx.git('remote', 'add', 'origin', origin);
    const fake = path.join(fx.run, 'fake-dev.mjs');
    fs.writeFileSync(fake, FAKE_DEV);
    const editorDir = path.join(fx.run, 'editor-dist');
    fs.mkdirSync(editorDir);
    fs.writeFileSync(path.join(editorDir, 'index.html'), '<!doctype html><title>editor</title>');
    const pport = await freePort();
    const lo = (await freePort()) | 1;
    pOrigin = `http://127.0.0.1:${pport}`;
    srv = await startServer(fx, {
      core: await loadCore(),
      overrides: { collections: [], editorDir, preview: { origin: pOrigin, port: pport, command: [process.execPath, fake, '{port}'], ports: [lo, lo + 40], settleFile: null, settleMs: 50, idleMinutes: 5 } },
    });
    ed = await as(srv, 'contributor');
  });
  after(() => srv.close());

  test('the collections with page sections; every role may look', async () => {
    const r = await ed.get('/preview/gallery');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.collections, [{ id: 'pages', label: 'Pages' }]);
    assert.equal((await ed.get('/preview/gallery/posts')).status, 404);
    assert.equal((await client(srv.base).get('/preview/gallery/pages')).status, 401);
  });

  test('every type and variation: the first real use, else placeholder words; in the schema’s order', async () => {
    const r = await ed.get('/preview/gallery/pages');
    assert.equal(r.status, 200, r.text);
    gallery = r.json;
    assert.deepEqual(gallery.problems, []);
    assert.deepEqual(
      gallery.samples.map((s) => [s.kind, s.variant, s.from && `${s.from.id}#${s.from.index}`]),
      [
        ['hero', null, 'about#0'],
        ['hero', 'tall', 'team#0'],
        ['cards', 'blue', 'about#1'],
        ['cards', 'plain', null],
        ['cta', null, null],
        ['legacy', null, 'team#2'],
      ],
    );
    assert.deepEqual(gallery.samples[0].from, { id: 'about', title: 'About', url: '/about/', index: 0 });
    for (const [i, s] of gallery.samples.entries()) {
      assert.equal(s.path, `/markstage-gallery-${i + 1}/`);
      assert.equal(s.url, `${pOrigin}${s.path}`);
      assert.match(s.key, /^[0-9a-f]{10}$/);
    }
    // the keys stay put when the content changes around them (they are the URL state)
    assert.equal((await ed.get('/preview/gallery/pages')).json.samples[2].key, gallery.samples[2].key);
  });

  test('each sample is drawn alone by the dev server, in a copy of its page', async () => {
    const first = await viewer.get(gallery.samples[0].url, { headers: HTML });
    assert.equal(first.status, 303, 'the preview asks for sign-in first');
    // sign in to the preview as a browser does: CMS hand-off page, ticket in a form body
    const auth = await ed.get(first.headers.get('location'));
    const ticket = /name="ticket" value="([^"]+)"/.exec(auth.text)[1];
    const enter = await ed.post(`${pOrigin}/markstage/preview-enter`, new URLSearchParams({ ticket }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(enter.status, 303);
    previewCookie = enter.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    for (const s of gallery.samples) {
      const r = await ed.get(s.url, { headers: HTML });
      assert.equal(r.status, 200, `${s.kind} ${s.variant}: ${r.text}`);
      const kinds = [...r.text.matchAll(/data-kind="([^"]+)" data-variant="([^"]*)"/g)].map((m) => [m[1], m[2] || null]);
      assert.deepEqual(kinds, [[s.kind, s.variant]], `${s.path} holds only that section`);
    }
    const blue = await ed.get(gallery.samples[2].url, { headers: HTML });
    assert.match(blue.text, /<title>About<\/title>/, 'a copy of the page it comes from');
    assert.match(blue.text, /<h2>What we do<\/h2>/, 'with its real content');
    assert.match((await ed.get(gallery.samples[4].url, { headers: HTML })).text, /<h2>Sample heading<\/h2>/);
  });

  test('a frame the browser gives up on while it waits for the clone does not hold the preview up', async () => {
    // hold the clone (another viewer's page being drawn), send a page request, and drop it while it waits
    let release;
    const held = srv.app.preview.site.lock.run(() => new Promise((r) => (release = r)));
    const gone = new AbortController();
    const waiting = fetch(gallery.samples[1].url, { headers: { ...HTML, Cookie: previewCookie }, signal: gone.signal }).then((r) => r.status, (e) => e.name);
    await new Promise((r) => setTimeout(r, 150));
    gone.abort();
    assert.equal(await waiting, 'AbortError');
    release();
    await held;
    const t0 = Date.now();
    const next = await fetch(gallery.samples[0].url, { headers: { ...HTML, Cookie: previewCookie }, signal: AbortSignal.timeout(5000) });
    assert.equal(next.status, 200);
    assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
  });

  test('the throwaway pages stay in the clone: the repo, its remote and its build never see them; the clone cannot push', async () => {
    const clone = srv.app.preview.site.dir;
    assert.ok(fs.existsSync(path.join(clone, 'src/content/pages/markstage-gallery-1.json')), 'they are in the clone');
    assert.equal(git(fx.site, 'status', '--porcelain'), '', 'the content repo is clean');
    assert.ok(!fs.readdirSync(path.join(fx.site, 'src/content/pages')).some((f) => f.startsWith('markstage-gallery')));
    assert.equal(git(origin, 'for-each-ref', '--format=%(refname) %(objectname)'), git(fx.site, 'for-each-ref', 'refs/heads', '--format=%(refname) %(objectname)'), 'the remote has exactly what the repo has');
    const refsBefore = git(origin, 'for-each-ref');
    // a push from the clone, even by hand, goes nowhere
    git(clone, 'add', '-A');
    git(clone, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '-m', 'gallery pages');
    assert.throws(() => git(clone, 'push', 'origin', 'HEAD:refs/heads/gallery'));
    assert.equal(git(clone, 'config', 'remote.origin.pushurl'), path.join(clone, '.git', 'markstage-preview-never-pushes'));
    assert.equal(git(origin, 'for-each-ref'), refsBefore, 'the remote is unchanged');
    assert.equal(git(fx.site, 'for-each-ref', 'refs/heads/gallery'), '', 'the content repo has no such branch');
    // the site's build (the content repo's scripts/build.mjs) is built from the repo: no gallery page in it
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: fx.site, stdio: 'ignore' });
    const out = fs.readdirSync(path.join(fx.site, 'dist'), { recursive: true }).map(String);
    assert.ok(out.length > 0 && !out.some((f) => f.includes('markstage-gallery')), out.join());
  });

  test('without a preview origin: a plain answer', async () => {
    const fx2 = makeFixture({ checks: false });
    const srv2 = await startServer(fx2);
    try {
      const r = await (await as(srv2, 'editor')).get('/preview/gallery/pages');
      assert.equal(r.status, 409);
      assert.match(r.json.message, /needs the preview/);
    } finally {
      await srv2.close();
    }
  });
});
