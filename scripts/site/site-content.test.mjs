// The real site-content/ files on the built site: every FAQ question and glossary term is on its page, a file with
// `publish: false` (keywords.md) is never published, and each page carries the search phrase keywords.md gives it,
// in its title and its H1.   npm run site:test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { buildSite, REPO_ROOT } from './build-site.mjs';
import { compareSection, LEAD_ALTERNATIVES } from './compare.mjs';
import { parseFrontMatter } from './markdown.mjs';

const CONTENT = path.join(REPO_ROOT, 'site-content');
const built = buildSite();
const page = (file) => built.files.find((f) => f.file === file)?.content;
const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const titleOf = (html) => unescape(/<title>([^<]*)<\/title>/.exec(html)[1]);
const h1Of = (html) => unescape(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)[1].replace(/<[^>]+>/g, ''));
const read = (file) => fs.readFileSync(path.join(CONTENT, file), 'utf8');
const headings = (file, level) => [...parseFrontMatter(read(file)).body.matchAll(new RegExp(`^${'#'.repeat(level)} (.+)$`, 'gm'))].map((m) => m[1].trim());

describe('site-content/ on the site', { skip: !fs.existsSync(CONTENT) && 'no site-content/' }, () => {
  test('the FAQ page shows every question of faq.md, with its front matter', () => {
    const html = page('faq/index.html');
    const { meta } = parseFrontMatter(read('faq.md'));
    assert.equal(titleOf(html), meta.title);
    assert.equal(h1Of(html), meta.h1);
    const questions = headings('faq.md', 2);
    assert.ok(questions.length > 0);
    for (const q of questions) assert.ok(unescape(html).includes(`<h3>${q}</h3>`), q);
  });

  test('the glossary shows every term of glossary.md, with its front matter', () => {
    const html = page('glossary/index.html');
    const { meta } = parseFrontMatter(read('glossary.md'));
    assert.equal(titleOf(html), meta.title);
    const terms = headings('glossary.md', 2);
    assert.ok(terms.length > 0);
    for (const t of terms) assert.ok(unescape(html).includes(`<h3>${t}</h3>`), t);
    assert.equal((html.match(/class="term"/g) ?? []).length >= terms.length, true);
  });

  test('every alternatives file is a page, and the full comparison is one too', () => {
    const files = fs.readdirSync(path.join(CONTENT, 'alternatives')).filter((f) => f.endsWith('.md'));
    for (const f of files) assert.ok(page(`alternatives/${f.replace(/\.md$/, '')}/index.html`), f);
    assert.ok(page('compare/full/index.html'));
  });

  test('WordPress, Ghost and Prismic lead every list of products a reader starts from', () => {
    const lead = LEAD_ALTERNATIVES.map((slug) => `alternatives/${slug}/`);
    for (const slug of LEAD_ALTERNATIVES) assert.ok(page(`alternatives/${slug}/index.html`), `${slug} has no page`);
    // the first links to alternative pages on these pages, in order (the index links "wordpress/", the compare
    // page "../alternatives/wordpress/")
    const isAlternative = (h) => h !== 'alternatives/' && Boolean(page(`${h}index.html`));
    for (const file of ['alternatives/index.html', 'compare/index.html']) {
      const hrefs = [...page(file).matchAll(/href="(?:\.\.\/)?(?:alternatives\/)?([a-z0-9-]+\/)"/g)].map((m) => `alternatives/${m[1]}`);
      assert.deepEqual([...new Set(hrefs.filter(isAlternative))].slice(0, lead.length), lead, file);
    }
    // the README section (/compare/) and docs/COMPARISON.md name the three first
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    const head = /^\|[^\n]*\*\*Markstage\*\*[^\n]*$/m.exec(compareSection(readme))[0].split('|').map((c) => c.trim()).filter(Boolean);
    assert.deepEqual(head.slice(0, 4), ['**Markstage**', 'WordPress', 'Ghost', 'Prismic']);
    const comparison = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'COMPARISON.md'), 'utf8');
    const sections = [...comparison.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.equal(sections[1], 'Markstage vs WordPress, Ghost and Prismic');
    for (const row of comparison.matchAll(/^\| Feature \| \*\*Markstage\*\* \| (EmDash|WordPress)[^\n]*$/gm)) assert.match(row[0], /\| WordPress \| Ghost \| Prismic \|/);
  });

  describe('keywords.md',{ skip: !fs.existsSync(path.join(CONTENT, 'keywords.md')) && 'no keywords.md' }, () => {
    const source = read('keywords.md');
    const { meta, body } = parseFrontMatter(source);
    // "## Home page" / "## /compare/ ..." with "- Main: **phrase**", and a table of alternative pages
    const mains = Object.fromEntries([...body.matchAll(/^## (.+)\n\n- Main: \*\*(.+?)\*\*/gm)].map((m) => [m[1].trim(), m[2]]));
    const targets = [
      ['index.html', mains['Home page']],
      ['compare/index.html', Object.entries(mains).find(([k]) => k.startsWith('/compare/'))?.[1]],
      ['features/index.html', mains['/features/']],
      ['ai/index.html', mains['/ai/']],
      ...[...body.matchAll(/^\| ([a-z0-9][a-z0-9-]*) \| ([^|]+?) \|/gm)].map((m) => [`alternatives/${m[1]}/index.html`, m[2]]),
    ];

    test('is never published', () => {
      assert.equal(meta.publish, false);
      for (const f of built.files) assert.ok(!f.content.includes(meta.title) && !f.content.includes(meta.h1), f.file);
    });

    test('names a page for every alternative, and each page it names exists', () => {
      const files = fs.readdirSync(path.join(CONTENT, 'alternatives')).filter((f) => f.endsWith('.md'));
      for (const f of files) assert.ok(targets.some(([p]) => p === `alternatives/${f.replace(/\.md$/, '')}/index.html`), `${f} has no phrase in keywords.md`);
      for (const [file, phrase] of targets) {
        assert.ok(phrase, `${file}: no main phrase`);
        assert.ok(page(file), `${file} is not built`);
      }
    });

    test('each page has its main phrase in its title and its H1', () => {
      for (const [file, phrase] of targets) {
        const html = page(file);
        const want = phrase.toLowerCase();
        assert.ok(titleOf(html).toLowerCase().includes(want), `${file} title "${titleOf(html)}" lacks "${phrase}"`);
        assert.ok(h1Of(html).toLowerCase().includes(want), `${file} H1 "${h1Of(html)}" lacks "${phrase}"`);
      }
    });
  });
});

test('every "we compared N other editors" line matches the products in COMPARISON.md', () => {
  const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
  const n = /\n1\. \*\*Editing on the site's own design, from your own server, with no database server\.\*\* Of the (\d+) products/.exec(read('docs/COMPARISON.md'))?.[1];
  assert.ok(n, 'COMPARISON.md "Where Markstage leads" names how many products it compares');
  for (const f of ['README.md', 'site-content/why.md']) {
    const said = [...read(f).matchAll(/(?:compared|with) (\d+) other editors/g)].map((m) => m[1]);
    assert.ok(said.length, `${f} says how many editors were compared`);
    for (const s of said) assert.equal(s, n, `${f} says ${s} other editors; COMPARISON.md compares ${n}`);
  }
});
