// Design & Code: the site's stylesheets, tokens and injected code. Everyone looks, owner/administrator write (audited);
// a code save is checked, committed, built, checked on the build and deployed as one job, and reverted to a private
// draft when it fails; tokens change surgically; a page's own code injection is refused on every other save path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { as, gitLog, makeFixture, readFile, startServer } from './helpers.mjs';

const SITE_CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  design: {
    tokens: 'src/styles/tokens.css',
    files: [
      { path: 'src/styles/global.css', label: 'Site styles' },
      { path: 'src/components/Header.astro', label: 'Header' },
    ],
    customCss: 'src/styles/custom.css',
    inject: { head: 'src/inject/head.html' },
  },
};
`;

const TOKENS = `/* Colours */
:root {
  --brand: #4f46e5; /* the accent */
  --ink: rgb(10 10 10);
  /* Type */
  --font-body: 'Inter', system-ui, sans-serif;
  --space-2: 0.5rem;
}
@media (prefers-color-scheme: dark) {
  :root { --brand: #a5b4fc; }
}
`;

// a post-build check of the whole site: fails when the custom CSS asks it to
const CONTRAST = `import fs from 'node:fs';
const css = fs.existsSync('src/styles/custom.css') ? fs.readFileSync('src/styles/custom.css', 'utf8') : '';
// a page's own job runs it per entry (the text on stdin); a design save once for the site, naming the file
if (process.env.MARKSTAGE_SCOPE === 'site' && !process.env.MARKSTAGE_FILE) process.exit(1);
if (css.includes('LOW-CONTRAST')) { console.log(JSON.stringify({ issues: [{ severity: 'error', message: 'Text contrast 2.1:1 on .lead' }] })); process.exit(1); }
`;

function designFixture() {
  const fx = makeFixture({ checks: false });
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(fx.site, rel)), { recursive: true });
    fs.writeFileSync(path.join(fx.site, rel), text);
  };
  put('markstage.config.mjs', SITE_CONFIG);
  put('src/styles/tokens.css', TOKENS);
  put('src/styles/global.css', 'body { color: var(--ink); }\n');
  put('src/components/Header.astro', '<header><slot /></header>\n');
  put('scripts/contrast.mjs', CONTRAST);
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Design files');
  return fx;
}

describe('Design & Code', () => {
  let fx;
  let srv;
  let admin;
  let editor;
  let contributor;
  before(async () => {
    fx = designFixture();
    // the real core: a page's codeInjection is a nested frontmatter map
    srv = await startServer(fx, {
      core: await loadCore(),
      overrides: {
        collections: [],
        checks: [{ id: 'contrast', label: 'Contrast', command: [process.execPath, 'scripts/contrast.mjs'], blocking: true, after: 'build' }],
      },
    });
    admin = await as(srv, 'administrator');
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    contributor = await as(srv, 'contributor', { authorSlug: 'cora' });
  });
  after(() => srv.close());

  const job = async (id) => {
    await srv.app.jobs.idle();
    return (await admin.get(`/jobs/${id}`)).json;
  };

  test('everyone sees the files in load order; only owner/administrator may edit, components never', async () => {
    const d = await contributor.get('/design');
    assert.equal(d.status, 200, d.text);
    assert.equal(d.json.enabled, true);
    assert.equal(d.json.canEdit, false);
    assert.deepEqual(d.json.order, ['tokens', 'src-styles-global-css', 'custom-css'], 'custom CSS loads last');
    assert.ok(d.json.files.every((f) => !f.editable));
    const a = (await admin.get('/design')).json;
    const by = Object.fromEntries(a.files.map((f) => [f.id, f]));
    assert.equal(by.tokens.editable, true);
    assert.equal(by['src-components-header-astro'].editable, false, 'component structure stays developer work');
    assert.equal(by['custom-css'].exists, false);
    assert.equal(by['inject-head'].kind, 'inject-head');
    const g = await contributor.get('/design/files/src-styles-global-css');
    assert.equal(g.json.source, 'body { color: var(--ink); }\n');
    assert.equal((await admin.put('/design/files/src-components-header-astro', { version: null, source: 'x' })).status, 403);
    assert.equal((await editor.put('/design/files/src-styles-global-css', { version: g.json.version, source: 'body{}' })).status, 403);
    assert.equal((await admin.get('/design/files/nope')).status, 404);
  });

  test('tokens are listed with their rule and group, and saved surgically', async () => {
    const t = await editor.get('/design/tokens');
    assert.equal(t.status, 200);
    const brand = t.json.tokens.filter((x) => x.name === '--brand');
    assert.deepEqual(brand.map((x) => [x.value, x.selector, x.context, x.type, x.group]), [
      ['#4f46e5', ':root', '', 'color', 'Colours'],
      ['#a5b4fc', ':root', '@media (prefers-color-scheme: dark)', 'color', 'Colours'],
    ]);
    assert.equal(t.json.tokens.find((x) => x.name === '--font-body').type, 'font');
    assert.equal(t.json.tokens.find((x) => x.name === '--space-2').group, 'Type');

    const values = [{ name: '--brand', selector: ':root', value: '#e11d48' }];
    assert.equal((await editor.put('/design/tokens', { version: t.json.version, values })).status, 403);
    assert.equal((await admin.put('/design/tokens', { version: 'stale', values })).status, 409);
    const bad = await admin.put('/design/tokens', { version: t.json.version, values: [{ name: '--brand', selector: ':root', value: 'red; } body { display: none' }] });
    assert.equal(bad.status, 422);
    const unknown = await admin.put('/design/tokens', { version: t.json.version, values: [{ name: '--nope', selector: ':root', value: 'red' }] });
    assert.equal(unknown.status, 422);
    assert.match(unknown.json.message, /no --nope/);

    const ok = await admin.put('/design/tokens', { version: t.json.version, values: [...values, { name: '--brand', selector: ':root', context: '@media (prefers-color-scheme: dark)', value: '#fda4af' }] });
    assert.equal(ok.status, 202, ok.text);
    assert.equal((await job(ok.json.job)).status, 'succeeded');
    assert.equal(readFile(fx, 'src/styles/tokens.css'), TOKENS.replace('#4f46e5', '#e11d48').replace('#a5b4fc', '#fda4af'), 'every other byte kept');
    assert.match(gitLog(fx, 'src/styles/tokens.css')[0], /\|Design tokens: --brand$/);
    const audit = await admin.get('/audit?action=design.');
    assert.ok(audit.json.items.some((a) => a.action === 'design.tokens' && a.target === 'src/styles/tokens.css'));
  });

  test('custom CSS: created by its first save, checked before writing, built, revisions and restore', async () => {
    const empty = await admin.get('/design/files/custom-css');
    assert.equal(empty.json.version, null);
    assert.equal(empty.json.exists, false);
    const broken = await admin.put('/design/files/custom-css', { version: null, source: '.a { color: red;\n.b { color: blue; }\n' });
    assert.equal(broken.status, 422);
    assert.equal(broken.json.issues[0].line, 1);
    const tag = await admin.put('/design/files/custom-css', { version: null, source: '.a::after { content: "</style>"; }' });
    assert.equal(tag.status, 422);
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/styles/custom.css')), 'nothing written');

    const one = await admin.put('/design/files/custom-css', { version: null, source: '.lead { color: #222; }\n' });
    assert.equal(one.status, 202, one.text);
    const j = await job(one.json.job);
    assert.equal(j.status, 'succeeded', JSON.stringify(j.steps));
    assert.deepEqual(j.steps.map((s) => s.name), ['commit', 'build', 'check: Contrast', 'deploy']);
    const two = await admin.put('/design/files/custom-css', { version: one.json.version, source: '.lead { color: #111; }\n' });
    assert.equal((await job(two.json.job)).status, 'succeeded');
    assert.equal((await admin.put('/design/files/custom-css', { version: one.json.version, source: 'x{}' })).status, 409);

    const revs = (await editor.get('/design/files/custom-css/revisions')).json;
    assert.equal(revs.length, 2);
    const cmp = await editor.get(`/design/files/custom-css/compare?from=${revs[1].sha}`);
    assert.equal(cmp.json.from.source, '.lead { color: #222; }\n');
    assert.equal(cmp.json.to.source, '.lead { color: #111; }\n');
    assert.match(cmp.json.diff, /-\.lead \{ color: #222; \}\n\+\.lead \{ color: #111; \}/);
    const live = await editor.get('/design/files/custom-css/compare?from=live');
    assert.equal(live.json.from.source, '.lead { color: #111; }\n', 'live is the last deployed commit');

    assert.equal((await editor.post(`/design/files/custom-css/revisions/${revs[1].sha}/restore`, { version: two.json.version })).status, 403);
    const back = await admin.post(`/design/files/custom-css/revisions/${revs[1].sha}/restore`, { version: two.json.version });
    assert.equal(back.status, 202, back.text);
    assert.equal((await job(back.json.job)).status, 'succeeded');
    assert.equal(readFile(fx, 'src/styles/custom.css'), '.lead { color: #222; }\n');
  });

  test('a save that fails its build or a check is reverted; the text waits as the person’s draft', async () => {
    const cur = (await admin.get('/design/files/custom-css')).json;
    const failing = '.lead { color: #eee; } /* LOW-CONTRAST */\n';
    const r = await admin.put('/design/files/custom-css', { version: cur.version, source: failing });
    assert.equal(r.status, 202);
    const j = await job(r.json.job);
    assert.equal(j.status, 'failed');
    assert.match(j.log, /Text contrast 2\.1:1/);
    assert.ok(!j.steps.some((s) => s.name === 'deploy' && s.status === 'succeeded'), 'never deployed');
    assert.equal(readFile(fx, 'src/styles/custom.css'), cur.source, 'reverted');
    assert.match(gitLog(fx, 'src/styles/custom.css')[0], /Revert src\/styles\/custom\.css/);
    const d = (await admin.get('/design/files/custom-css/draft')).json.draft;
    assert.equal(d.text, failing);
    assert.equal(d.baseVersion, cur.version);
    assert.equal((await editor.get('/design/files/custom-css/draft')).json.draft, null, 'drafts are private');
    const cmp = await admin.get('/design/files/custom-css/compare?from=draft');
    assert.equal(cmp.json.from.source, failing);
    // a later good save clears the draft
    const ok = await admin.put('/design/files/custom-css', { version: cur.version, source: '.lead { color: #000; }\n' });
    assert.equal((await job(ok.json.job)).status, 'succeeded');
    assert.equal((await admin.get('/design/files/custom-css/draft')).json.draft, null);
  });

  test('code injection: site-wide head file and per page, owner/administrator only, audited; other saves cannot change it', async () => {
    const head = await admin.put('/design/files/inject-head', { version: null, source: '<script src="https://stats.example/s.js" defer></script>\n' });
    assert.equal(head.status, 202, head.text);
    assert.equal((await job(head.json.job)).status, 'succeeded');

    const e = (await editor.get('/collections/posts/entries/hello-world/source')).json;
    const body = { version: e.version, head: '<meta name="x" content="y">', foot: '<script>console.log(1)</script>' };
    assert.equal((await editor.put('/collections/posts/entries/hello-world/code-injection', body)).status, 403);
    const set = await admin.put('/collections/posts/entries/hello-world/code-injection', body);
    assert.equal(set.status, 202, set.text);
    const sj = await job(set.json.job);
    assert.equal(sj.kind, 'code-injection');
    assert.equal(sj.status, 'succeeded', sj.log);
    const src = readFile(fx, 'src/content/blog/hello-world.md');
    assert.match(src, /codeInjection:/);
    assert.match(src, /console\.log\(1\)/);
    const audit = (await admin.get('/audit?action=code.')).json.items;
    assert.ok(audit.some((a) => a.target === 'src/inject/head.html'));
    assert.ok(audit.some((a) => a.target === 'posts/hello-world'));

    // an editor still edits the page; its code stays as it is
    const now = (await editor.get('/collections/posts/entries/hello-world/source')).json;
    const edit = await editor.put('/collections/posts/entries/hello-world/source', { version: now.version, source: now.source.replace('First paragraph.', 'First paragraph, edited.') });
    assert.equal(edit.status, 200, edit.text);
    const after1 = (await editor.get('/collections/posts/entries/hello-world/source')).json;
    const sneak = await editor.put('/collections/posts/entries/hello-world/source', { version: after1.version, source: after1.source.replace('console.log(1)', 'steal()') });
    assert.equal(sneak.status, 403);
    const fm = await editor.put('/collections/posts/entries/hello-world', { version: after1.version, frontmatter: { codeInjection: { head: '<script>steal()</script>' } } });
    assert.equal(fm.status, 403);
    const fresh = await editor.post('/collections/posts/entries', { title: 'Sneaky', frontmatter: { codeInjection: { foot: '<script>x()</script>' } } });
    assert.equal(fresh.status, 403);
    // a copy made by an editor leaves the code behind
    const copy = await editor.post('/collections/posts/entries/hello-world/duplicate', {});
    assert.equal(copy.status, 201, copy.text);
    assert.doesNotMatch(readFile(fx, `src/content/blog/${copy.json.id}.md`), /codeInjection/);
    // the preview takes the same rule
    const pv = await editor.put('/preview/posts/hello-world/state', { baseVersion: after1.version, source: after1.source.replace('console.log(1)', 'steal()') });
    assert.equal(pv.status, 403);

    // a new value replaces the old one as a whole
    const v2 = (await admin.get('/collections/posts/entries/hello-world/source')).json;
    const only = await admin.put('/collections/posts/entries/hello-world/code-injection', { version: v2.version, head: '<meta name="only" content="head">' });
    assert.equal(only.status, 202, only.text);
    await job(only.json.job);
    assert.doesNotMatch(readFile(fx, 'src/content/blog/hello-world.md'), /console\.log\(1\)/);

    // cleared by an empty head and foot
    const cur = (await admin.get('/collections/posts/entries/hello-world/source')).json;
    const clear = await admin.put('/collections/posts/entries/hello-world/code-injection', { version: cur.version, head: '', foot: ' ' });
    assert.equal(clear.status, 202);
    await job(clear.json.job);
    assert.doesNotMatch(readFile(fx, 'src/content/blog/hello-world.md'), /codeInjection/);
  });

  test('the preview takes unsaved stylesheets from owner/administrator only', async () => {
    const e = (await admin.get('/collections/posts/entries/hello-world/source')).json;
    const css = { 'custom-css': '.lead { color: tomato; ' };
    assert.equal((await editor.put('/preview/posts/hello-world/state', { baseVersion: e.version, css })).status, 403);
    assert.equal((await admin.put('/preview/posts/hello-world/state', { baseVersion: e.version, css: { 'src-components-header-astro': 'x' } })).status, 403);
    assert.equal((await admin.put('/preview/posts/hello-world/state', { baseVersion: e.version, css: { 'inject-head': 'x' } })).status, 400);
    const ok = await admin.put('/preview/posts/hello-world/state', { baseVersion: e.version, css });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await admin.put('/preview/posts/hello-world/state', { baseVersion: e.version })).status, 400);
  });
});

describe('Design & Code: the config is checked at start', () => {
  const start = async (design, files = {}) => {
    const fx = makeFixture({ checks: false });
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(fx.site, rel)), { recursive: true });
      fs.writeFileSync(path.join(fx.site, rel), text);
    }
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), `export default { collections: [{ id: 'posts', format: 'md', dir: 'src/content/blog', hasStatus: true }], design: ${JSON.stringify(design)} };\n`);
    try {
      const srv = await startServer(fx, { overrides: { collections: [] } });
      await srv.close();
      return null;
    } catch (e) {
      return e.message;
    }
  };

  test('paths outside the repo, in .git, symlinks, missing files and unknown kinds are refused', async () => {
    assert.match(await start({ customCss: '../outside.css' }), /inside the site repo/);
    assert.match(await start({ files: [{ path: '.git/config.css' }] }), /\.git|does not exist/);
    assert.match(await start({ files: [{ path: 'src/missing.css' }] }), /does not exist/);
    assert.match(await start({ files: [{ path: 'secret.txt' }] }), /not a stylesheet/);
    assert.match(await start({ tokens: 'src/a.js' }, { 'src/a.js': '' }), /not a css file/);
    const fx = makeFixture({ checks: false });
    fs.symlinkSync('/etc/hosts', path.join(fx.site, 'link.css'));
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), `export default { collections: [{ id: 'posts', format: 'md', dir: 'src/content/blog' }], design: { files: [{ path: 'link.css' }] } };\n`);
    await assert.rejects(startServer(fx, { overrides: { collections: [] } }), /symlink/);
    assert.equal(await start({ customCss: 'src/styles/custom.css', inject: { head: 'src/inject/head.html' } }), null, 'missing custom and inject files are fine');
  });
});
