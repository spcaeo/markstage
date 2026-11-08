// What has shipped stays on the site. The live /roadmap/ once showed only "Planned, later": fourteen shipped items were
// on no page, /roadmap/#import (a link the owner hands out) went nowhere, and docs/CANVAS-FIDELITY.md, which the
// newest item points to, was not a page at all. So: every shipped item of site-content/roadmap.md is on the built
// /roadmap/ by its id, under its release, and links to a page that is built; the README's Roadmap names the same
// items under the same release; and every docs/*.md is a page of the site or on the GitHub-only list with its reason.
//   npm run site:test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { buildSite, REPO_ROOT } from './build-site.mjs';
import { DOCS, GITHUB_ONLY, PRIVATE_ONLY, SITE_ELSEWHERE } from './content.mjs';
import { RELEASES, VERSION, readRoadmap, shippedGroups, shippedPath, stampShipped } from './roadmap.mjs';

const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
const built = buildSite();
const page = (file) => built.files.find((f) => f.file === file)?.content;
const { items } = readRoadmap(path.join(REPO_ROOT, 'site-content'), (md) => md);
const shipped = items.filter((i) => i.status === 'shipped');
const parts = (v) => v.split('.').map(Number);
const notAfter = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  return x[0] < y[0] || (x[0] === y[0] && (x[1] < y[1] || (x[1] === y[1] && x[2] <= y[2])));
};

describe('every shipped roadmap item is on /roadmap/', () => {
  const html = page('roadmap/index.html');
  const section = /<section aria-labelledby="rm-shipped">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';

  test('there are shipped items, and /roadmap/ has a Shipped section', () => {
    assert.ok(shipped.length > 0);
    assert.ok(section, '/roadmap/ has no Shipped section');
  });

  test('each says in which release: "next" (on main) or a version that is out, with its date in CHANGELOG.md', () => {
    for (const it of shipped) {
      if (it.shipped === 'next') continue;
      assert.match(String(it.shipped), /^\d+\.\d+\.\d+$/, it.id);
      assert.ok(notAfter(it.shipped, VERSION), `${it.id}: shipped in ${it.shipped}, but ${VERSION} is the newest release`);
      assert.ok(RELEASES.has(it.shipped), `${it.id}: CHANGELOG.md has no "## ${it.shipped} (date)"`);
    }
  });

  test('each is on the page by its id, under the heading of its release', () => {
    for (const g of shippedGroups(items)) {
      const at = section.indexOf(`<h3 id="${g.id}">`);
      assert.ok(at >= 0, `/roadmap/ has no heading for ${g.release}`);
      const list = section.slice(at).split('</ul>')[0];
      for (const it of g.items) assert.match(list, new RegExp(`<li class="rm-item" id="${it.id}">`), `${it.id} is not under "${g.title}"`);
    }
    for (const it of shipped) assert.equal(html.split(`id="${it.id}"`).length, 2, `${it.id}: one element with that id on /roadmap/`);
  });

  test('every item that is not shipped is on the page too, so every /roadmap/#id link lands', () => {
    for (const it of items) assert.match(html, new RegExp(`<li class="rm-item" id="${it.id}">`), it.id);
  });

  test('each links to its doc or feature, and that page (and its anchor) is built', () => {
    for (const it of shipped) {
      const target = shippedPath(it);
      assert.ok(target, `${it.id}: no doc or feature`);
      assert.ok(section.includes(`<a href="../${target}">`), `${it.id}: no link to ${target} on /roadmap/`);
      const [where, hash] = target.split('#');
      assert.match(where, /^([a-z0-9-]+\/)+$/, `${it.id}: "${target}" is not a site path such as docs/mdx/`);
      const built = page(`${where}index.html`);
      assert.ok(built, `${it.id}: ${where} is not a page of the site`);
      if (hash) assert.match(built, new RegExp(`\\sid="${hash}"`), `${it.id}: ${where} has no #${hash}`);
    }
  });

  test('a shipped item without a release or a link stops the build', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'roadmap-'));
    const write = (item) => fs.writeFileSync(path.join(dir, 'roadmap.md'), `---\ntitle: T\ndescription: D\nh1: H\nitems:\n${item}\n---\n`);
    try {
      write('  - { id: a, title: A, what: W, status: shipped, doc: docs/mdx/ }');
      assert.throws(() => readRoadmap(dir, (b) => b), /say in which release/);
      write('  - { id: a, title: A, what: W, status: shipped, shipped: next }');
      assert.throws(() => readRoadmap(dir, (b) => b), /link it/);
      write('  - { id: a, title: A, what: W, status: planned, shipped: next }');
      assert.throws(() => readRoadmap(dir, (b) => b), /its status is planned/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a release writes its version into the items on main, and leaves the rest alone', () => {
    const before = '  - id: a\n    status: shipped\n    shipped: next\n    doc: docs/a/\n  - id: b\n    shipped: 0.4.0\n    what: next\n';
    assert.equal(stampShipped(before, '0.5.0'), before.replace('shipped: next', 'shipped: 0.5.0'));
  });

  test("the README's Roadmap names the same shipped items, under the same release", () => {
    const roadmap = /^## Roadmap\n([\s\S]*?)(?=^## )/m.exec(read('README.md'))[1];
    const plain = (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').toLowerCase();
    // a release's block: from its line to the next "Shipped …", "Being built …" or "Planned …" line
    const block = (start) => {
      const at = roadmap.split('\n').findIndex((l) => l.startsWith(start));
      if (at < 0) return null;
      const rest = roadmap.split('\n').slice(at);
      const end = rest.findIndex((l, i) => i > 0 && /^(Shipped |Being built |Planned)/.test(l));
      return rest.slice(0, end < 0 ? undefined : end).join('\n');
    };
    // on main: a list with exactly these titles, in any order (none on main: no such line)
    const onMain = block(`Shipped since ${VERSION}, on main:`);
    const want = shipped.filter((i) => i.shipped === 'next').map((i) => i.title).sort();
    const got = onMain ? [...onMain.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1].replace(/[.:,]$/, '')).sort() : [];
    assert.deepEqual(got, want, `README "Shipped since ${VERSION}, on main:" should list ${JSON.stringify(want)}`);
    // each release: a paragraph or list that names every item of it
    for (const v of new Set(shipped.map((i) => i.shipped).filter((x) => x !== 'next'))) {
      const text = block(`Shipped in ${v}`);
      assert.ok(text, `README Roadmap has no "Shipped in ${v}"`);
      for (const it of shipped.filter((i) => i.shipped === v)) assert.ok(plain(text).includes(it.title.toLowerCase()), `README "Shipped in ${v}" does not name ${it.title}`);
    }
  });
});

describe('every docs/*.md is on the site, or on GitHub only with a reason', () => {
  const files = fs.readdirSync(path.join(REPO_ROOT, 'docs')).filter((f) => f.endsWith('.md'));
  // the export's rules: only in the private repo (the public copy has no public-sync.config.json)
  const exportConfig = path.join(REPO_ROOT, 'public-sync.config.json');
  const onSite = new Set(DOCS.map((d) => d.file));

  test('each file is a doc page, drawn by another page, or GitHub-only with its reason', () => {
    for (const f of files) {
      const where = [onSite.has(f) && 'docs', SITE_ELSEWHERE[f] && 'elsewhere', GITHUB_ONLY[f] !== undefined && 'github', PRIVATE_ONLY[f] !== undefined && 'private'].filter(Boolean);
      assert.equal(where.length, 1, `docs/${f}: ${where.length ? `listed twice (${where.join(', ')})` : 'not on the site; add it to DOC_GROUPS in content.mjs, or to GITHUB_ONLY with the reason'}`);
    }
    for (const [f, reason] of Object.entries({ ...GITHUB_ONLY, ...PRIVATE_ONLY })) assert.ok(reason && reason.length > 20, `docs/${f}: say why it stays on GitHub or private`);
  });

  test('every listed file exists, and each is built where the list says', () => {
    // a private-only doc is absent from the public copy by design; everything else must be there in both repos
    for (const f of [...onSite, ...Object.keys(SITE_ELSEWHERE), ...Object.keys(GITHUB_ONLY)]) assert.ok(files.includes(f), `docs/${f} is listed but not there`);
    for (const d of DOCS) assert.ok(page(`docs/${d.id}/index.html`), `docs/${d.id}/ is not built`);
    for (const p of Object.values(SITE_ELSEWHERE)) assert.ok(page(`${p}index.html`), `${p} is not built`);
  });

  test('the private-only docs are exactly the docs the public export drops', { skip: !fs.existsSync(exportConfig) && 'the public copy has no export rules' }, () => {
    const drops = JSON.parse(fs.readFileSync(exportConfig, 'utf8')).exclude.map((e) => e.path).filter((p) => /^docs\/[^/*]+\.md$/.test(p)).map((p) => p.slice(5));
    assert.deepEqual([...drops].sort(), Object.keys(PRIVATE_ONLY).sort(), 'list each docs/*.md the export drops in PRIVATE_ONLY (content.mjs), and only those');
    for (const f of Object.keys(PRIVATE_ONLY)) assert.ok(files.includes(f), `docs/${f} is in PRIVATE_ONLY but not in this repo`);
  });

  test('the canvas note, with its "On a server" section, is a page', () => {
    assert.match(page('docs/canvas-fidelity/index.html') ?? '', /<h1>The canvas and the real page<\/h1>[\s\S]*id="on-a-server"/);
  });
});
