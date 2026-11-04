// Checks the public site (site/) for search basics, as built from the repo and from the sample site-content in
// fixtures/: every page has a unique title and description within length, one H1, a canonical, share tags, alt
// texts, JSON-LD that parses, headings in order and internal links that resolve; numbers in tables are
// right-aligned; copy icons come from the one shared helper; no private names and never "open source" for
// Markstage; and site/ equals a fresh build.   npm run site:test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { buildSite, imageSize, REPO_ROOT } from './build-site.mjs';
import { OG_IMAGES, OG_SIZE, SITE_URL } from './config.mjs';
import { DOCS, FAQ } from './content.mjs';
import { renderMarkdown } from './markdown.mjs';
import { licenceHits } from '../lib/licence-words.mjs';

const SITE = path.join(REPO_ROOT, 'site');
const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'site-content');
// written in pieces so that this file does not hold the words it looks for (scripts/check-generic.mjs)
const PRIVATE = new RegExp(['task' + 'rhino', 'rhino' + 'move', 'board' + 'bridge', 'cite' + 'fox', '\\bwel' + 'co\\b', 'spaceo\\.' + 'infocom', '/Users/'].join('|'), 'i');
// Markstage is source-available (scripts/check-licence.mjs): the other licence words only as what it is not. Built in
// pieces, as that check reads this file too. Ids and in-page links are made from headings, so they are left out.
const OTHER = new RegExp(['open', 'source'].join('[\\s-]?'), 'i');
const NOT_OTHER = new RegExp(`not ${OTHER.source}`, 'gi');
const claimsOther = (text) => OTHER.test(text.replace(/\s(id|href|aria-labelledby)="[^"]*"/g, '').replace(NOT_OTHER, ''));

const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
const meta = (html, key, value) => tags(html, 'meta').find((t) => attr(t, key) === value);
const text = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');

function checkSite(label, built) {
  const pages = built.files.filter((f) => f.file.endsWith('.html'));
  const byFile = Object.fromEntries(pages.map((p) => [p.file, p.content]));
  const ids = Object.fromEntries(pages.map((p) => [p.file, new Set([...p.content.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
  // pages from this build; the stylesheet, script, icon, share images and screenshots are committed files
  const exists = (rel) => byFile[rel] !== undefined || built.files.some((f) => f.file === rel) || (!rel.endsWith('.html') && fs.existsSync(path.join(SITE, rel)));

  describe(`${label}: the whole site`, () => {
    test('every page has its own title and description', () => {
      const titles = pages.map((p) => /<title>([^<]*)<\/title>/.exec(p.content)[1]);
      const descriptions = pages.map((p) => attr(meta(p.content, 'name', 'description'), 'content'));
      assert.equal(new Set(titles).size, pages.length, titles.join('\n'));
      assert.equal(new Set(descriptions).size, pages.length);
    });

    test('the sitemap lists every indexable page, and robots.txt and llms.txt point the way', () => {
      const sitemap = built.files.find((f) => f.file === 'sitemap.xml').content;
      for (const p of pages) {
        if (p.file === '404.html') continue;
        const canonical = attr(tags(p.content, 'link').find((t) => attr(t, 'rel') === 'canonical'), 'href');
        assert.ok(sitemap.includes(`<loc>${canonical}</loc>`), `${p.file} is not in the sitemap`);
      }
      assert.ok(!sitemap.includes('404'));
      assert.match(built.files.find((f) => f.file === 'robots.txt').content, new RegExp(`Sitemap: ${SITE_URL}sitemap\\.xml`));
      const llms = built.files.find((f) => f.file === 'llms.txt').content;
      assert.match(llms, /^# Markstage\n\n> /);
      for (const d of DOCS) assert.ok(llms.includes(`${SITE_URL}docs/${d.id}/`), `llms.txt misses docs/${d.id}/`);
      assert.equal(claimsOther(llms), false);
    });

    test('names no private site or person, and calls Markstage source-available only', () => {
      for (const f of built.files) {
        assert.doesNotMatch(f.content, PRIVATE, f.file);
        assert.equal(claimsOther(f.content), false, `${f.file} names another kind of licence`);
        // another product's licence name only on the comparison pages, never in Markstage's column or sentence
        assert.deepEqual(licenceHits(`site/${f.file}`, f.content), [], f.file);
      }
    });
  });

  for (const p of pages) {
    const html = p.content;
    describe(`${label}: ${p.file}`, () => {
      test('has lang, a title and a description within length, and one H1', () => {
        assert.match(html, /<html lang="en">/);
        const title = /<title>([^<]*)<\/title>/.exec(html)[1].replace(/&amp;/g, '&');
        assert.ok(title.length >= 15 && title.length <= 60, `title is ${title.length} characters: ${title}`);
        // the name once: a title that has it already gets no " | Markstage" suffix
        assert.ok((title.match(/markstage/gi) ?? []).length <= 1, `the name twice in the title: ${title}`);
        const description = attr(meta(html, 'name', 'description'), 'content');
        assert.ok(description.length >= 110 && description.length <= 160, `description is ${description.length} characters: ${description}`);
        assert.equal(tags(html, 'h1').length, 1);
      });

      test('has a canonical (or noindex), Open Graph and Twitter tags', () => {
        const canonical = tags(html, 'link').find((t) => attr(t, 'rel') === 'canonical');
        if (p.file === '404.html') assert.equal(attr(meta(html, 'name', 'robots'), 'content'), 'noindex');
        else assert.equal(attr(canonical, 'href'), `${SITE_URL}${p.file.replace(/index\.html$/, '')}`);
        for (const name of ['og:title', 'og:description', 'og:image', 'og:url', 'og:image:alt']) assert.ok(attr(meta(html, 'property', name), 'content'), name);
        assert.equal(attr(meta(html, 'name', 'twitter:card'), 'content'), 'summary_large_image');
        assert.equal(attr(meta(html, 'property', 'og:image'), 'content'), attr(meta(html, 'name', 'twitter:image'), 'content'));
      });

      test('gives every image an alt text, a width and a height', () => {
        for (const img of tags(html, 'img')) {
          assert.ok(attr(img, 'alt') !== null, img);
          if (!/class="logo"/.test(img)) assert.ok(attr(img, 'width') && attr(img, 'height'), img);
        }
      });

      test('has JSON-LD that parses, with the right types', () => {
        const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
        const types = blocks.map((b) => b['@type']);
        for (const b of blocks) assert.equal(b['@context'], 'https://schema.org');
        if (p.file === 'index.html') {
          assert.deepEqual(types, ['SoftwareApplication', 'FAQPage', 'Organization']);
          const app = blocks[0];
          assert.equal(app.offers.price, '0');
          assert.equal(app.publisher.name, 'Space-O Technologies');
          assert.ok(!('aggregateRating' in app));
        } else if (p.file !== '404.html') assert.ok(types.includes('BreadcrumbList'), types.join());
        // FAQPage markup matches questions shown on the page
        for (const faq of blocks.filter((b) => b['@type'] === 'FAQPage')) {
          assert.ok(faq.mainEntity.length > 0);
          for (const q of faq.mainEntity) assert.ok(text(html).includes(q.name), `FAQ question not on the page: ${q.name}`);
        }
      });

      test('keeps headings in order', () => {
        let last = 0;
        for (const m of html.matchAll(/<h([1-6])\b/g)) {
          const level = Number(m[1]);
          assert.ok(level - last <= 1, `h${level} after h${last}`);
          last = level;
        }
      });

      test('links only to pages, files and anchors that exist', () => {
        if (p.file === '404.html') return;
        for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
          const target = m[1].replace(/&amp;/g, '&');
          if (/^(https?:|mailto:)/.test(target)) continue;
          const [rel, hash] = target.split('#');
          let resolved = p.file;
          if (rel) {
            resolved = path.posix.normalize(path.posix.join(path.posix.dirname(p.file), rel));
            if (rel.endsWith('/') || resolved === '.') resolved = path.posix.join(resolved, 'index.html');
          }
          assert.ok(exists(resolved), `${p.file}: ${target}`);
          if (hash && ids[resolved]) assert.ok(ids[resolved].has(hash), `${p.file}: ${target} (no such id)`);
        }
      });

      test('makes copy icons only with the shared helper, and never on a secret', () => {
        for (const b of tags(html, 'button').filter((t) => /data-copy=/.test(t))) assert.match(b, /class="icon-btn copy-btn"/);
        assert.equal((html.match(/data-copy=/g) ?? []).length, (html.match(/class="copyable"/g) ?? []).length);
        assert.doesNotMatch(html, /data-copy="[^"]*(password|token|secret)/i);
      });

      test('right-aligns number columns', () => {
        for (const t of html.match(/<table>[\s\S]*?<\/table>/g) ?? []) {
          const rows = (t.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>[\s\S]*?<\/tr>/g) ?? []).map((r) => r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []);
          const width = Math.max(0, ...rows.map((r) => r.length));
          for (let i = 0; i < width; i++) {
            const cells = rows.map((r) => r[i]).filter((c) => c && !/^(|—|-)$/.test(text(c).trim()));
            // plain numbers (not code, not addresses) all the way down: a numeric column
            if (!cells.length || !cells.every((c) => !/<code>/.test(c) && /^\d{1,3}(,\d{3})+$|^\d+(\.\d+)?$/.test(text(c).trim()))) continue;
            for (const c of cells) assert.match(c, /^<t[dh][^>]*class="num"/, `column ${i + 1} of a table in ${p.file}: ${c}`);
          }
        }
      });
    });
  }
}

describe('site/ is built from its sources', () => {
  const built = buildSite();
  test('matches npm run site:build', () => {
    const stale = built.files.filter(({ file, content }) => {
      const at = path.join(SITE, file);
      return !fs.existsSync(at) || fs.readFileSync(at, 'utf8') !== content;
    });
    assert.deepEqual(stale.map((f) => f.file), []);
  });

  test('holds no page the build does not make', () => {
    const made = new Set(built.files.map((f) => f.file));
    const html = fs.readdirSync(SITE, { recursive: true }).filter((f) => f.endsWith('.html'));
    assert.deepEqual(html.filter((f) => !made.has(f.split(path.sep).join('/'))), []);
  });

  test('two builds are byte-identical', () => {
    const again = buildSite();
    assert.deepEqual(again.files, built.files);
  });

  test('has every share image at its real size, and screenshots under 250 KB', () => {
    for (const og of Object.values(OG_IMAGES)) {
      const size = imageSize(fs.readFileSync(path.join(SITE, og.path)));
      assert.deepEqual(size, OG_SIZE, og.path);
    }
    assert.deepEqual(imageSize(fs.readFileSync(path.join(REPO_ROOT, '.github', 'social-preview.png'))), { width: 1280, height: 640 });
    for (const [name, m] of Object.entries(built.media)) assert.ok(fs.statSync(path.join(SITE, 'media', m.file)).size <= 250 * 1024, name);
  });

  test('builds a page for each doc, and the home page shows the FAQ', () => {
    for (const d of DOCS) assert.ok(built.files.some((f) => f.file === `docs/${d.id}/index.html`), d.id);
    const home = built.files.find((f) => f.file === 'index.html').content;
    for (const { q } of FAQ) assert.ok(home.includes(q.replace(/’/g, '’')), q);
  });

  checkSite('repo', built);
});

describe('site-content files render (fixtures)', () => {
  const built = buildSite(REPO_ROOT, { contentDir: FIXTURES });
  const page = (file) => built.files.find((f) => f.file === file)?.content;

  test('an alternative page from its front matter, table and FAQ', () => {
    const html = page('alternatives/example-cms/index.html');
    assert.ok(html, 'no page for example-cms');
    assert.match(html, /<title>Markstage vs Example CMS: Test Fixture Comparison<\/title>/);
    assert.match(html, /<h1>Markstage vs Example CMS<\/h1>/);
    assert.match(html, /<time datetime="2026-11-03">/);
    assert.match(html, /"@type": "FAQPage"/);
    assert.match(html, /<td class="num">29<\/td>/);
    // site paths become relative, the full comparison is a site page, other repo files go to GitHub
    assert.match(html, /href="\.\.\/\.\.\/compare\/"/);
    assert.match(html, /href="\.\.\/\.\.\/alternatives\/second-cms\/"/);
    assert.match(html, /href="\.\.\/\.\.\/compare\/full\/"/);
    assert.match(html, /href="https:\/\/github\.com\/spcaeo\/markstage\/blob\/main\/LICENSE"/);
  });

  test('the alternatives index and the compare page list each alternative', () => {
    for (const file of ['alternatives/index.html', 'compare/index.html']) {
      assert.match(page(file), /alternatives\/example-cms\//, file);
      assert.match(page(file), /alternatives\/second-cms\//, file);
    }
  });

  test('the FAQ page adds the file’s questions once', () => {
    const html = page('faq/index.html');
    assert.match(html, /Can I try Markstage without a server\?/);
    assert.equal((html.match(/<h3>Is Markstage free\?<\/h3>/g) ?? []).length, 1);
  });

  test('the glossary takes one term per ## from the file, its front matter, then the built-in words it lacks', () => {
    const html = page('glossary/index.html');
    assert.match(html, /<title>Fixture Glossary: Terms for the Test Build<\/title>/);
    assert.match(html, /<h1>Fixture glossary<\/h1>/);
    assert.equal((html.match(/id="canvas"/g) ?? []).length, 1);
    assert.match(html, /"name": "Block"/);
    assert.match(html, /<div class="term" id="canvas"><h3>Canvas<\/h3><p>Where a writer edits an entry, drawn with the site's own CSS\. See the <a href="https:\/\/github\.com\/spcaeo\/markstage\/blob\/main\/docs\/WRITING\.md"/);
    // built-in terms the file does not define come after, once
    assert.ok(html.indexOf('>Block<') < html.indexOf('>Headless CMS<'));
    assert.equal((html.match(/<h3>Block<\/h3>/g) ?? []).length, 1);
  });

  test('a file whose front matter says publish: false is never a page or a link', () => {
    assert.equal(page('alternatives/draft-cms/index.html'), undefined);
    for (const f of built.files) {
      assert.doesNotMatch(f.content, /draft-cms|Draft CMS|fixture-only phrase|Notes that are never a page/i, f.file);
    }
  });

  checkSite('fixtures', built);
});

describe('markdown', () => {
  test('keeps the first # as the title, gives headings unique ids, never jumps a level', () => {
    const r = renderMarkdown('# Title\n\n## A\n\n#### Deep\n\n## A\n');
    assert.equal(r.title, 'Title');
    assert.deepEqual(
      r.headings.map((h) => [h.level, h.id]),
      [
        [2, 'a'],
        [3, 'deep'],
        [2, 'a-2'],
      ],
    );
  });

  test('keeps only safe HTML, and anchors with an id', () => {
    const r = renderMarkdown('<a id="x"></a>\n\nPress <kbd>K</kbd> <script>alert(1)</script> <img src=x onerror=alert(1)>\n');
    assert.match(r.html, /<a id="x"><\/a>/);
    assert.match(r.html, /<kbd>K<\/kbd>/);
    assert.doesNotMatch(r.html, /<script|onerror/);
  });

  test('numbers footnotes in the order they are defined and lists them as sources', () => {
    const r = renderMarkdown('| A |\n| --- |\n| x [^b] [^a] |\n\n## Sources\n\n[^a]: **A**: [a](https://a.example)\n[^b]: B.\n');
    assert.match(r.html, /x <sup class="fn"><a href="#fn-b" aria-label="Source 2">2<\/a><\/sup> <sup class="fn"><a href="#fn-a" aria-label="Source 1">1<\/a><\/sup>/);
    assert.match(r.html, /<ol class="sources"><li id="fn-a" value="1"><strong>A<\/strong>: <a href="https:\/\/a\.example" rel="noopener">a<\/a><\/li><li id="fn-b" value="2">B\.<\/li><\/ol>/);
  });

  test('a file with one ## per entry keeps each entry’s text and HTML', () => {
    const [first] = renderMarkdown('## Front matter\n\nThe `---` block. See [docs](x).\n\n## Next\n\nMore.\n').sections;
    assert.equal(first.text, 'The --- block. See docs.');
    assert.match(first.html, /^<p>The <code>---<\/code> block\. See <a href="x">docs<\/a>\.<\/p>$/);
  });

  test('right-aligns a column of numbers but not one of addresses', () => {
    const r = renderMarkdown('| Port | Host |\n| --- | --- |\n| 18231 | 127.0.0.1 |\n| 443 | example.com |\n');
    assert.match(r.html, /<td class="num">18231<\/td><td>127\.0\.0\.1<\/td>/);
  });
});
