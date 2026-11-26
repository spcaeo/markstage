// A built page as Markdown for AI tools (head/markdown.mjs, md-tree.mjs): a Markdown post, an MDX page with components
// and a page built from JSON sections, all as Astro writes them (head-fixtures.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { parseHtml } from '@markstage/core/html-tree';
import { pageMarkdown } from '../src/head/markdown.mjs';
import { contentOf, dropTitleHeading, findFirst, selectorTest } from '../src/head/md-tree.mjs';
import { readPages } from '../src/head/pages.mjs';
import { SITE, SITE_FILES, doc, writeSite } from './head-fixtures.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-head-md-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let md;
const lines = (s) => s.split('\n');
before(async () => {
  writeSite(tmp, SITE_FILES);
  const pages = await readPages(tmp, { siteUrl: SITE });
  md = Object.fromEntries(pages.filter((p) => p.indexed).map((p) => [p.path, pageMarkdown(p, { siteUrl: SITE })]));
});
const render = (html, over = {}, opts = {}) => {
  const page = { path: '/t/', title: 'T', canonical: `${SITE}/t/`, description: '', html: doc({ body: html, ...over }), ...over };
  return pageMarkdown(page, { siteUrl: SITE, ...opts });
};

test('every document starts with the title, the canonical address and the description', () => {
  for (const [p, text] of Object.entries(md)) {
    const [h, blank, canon, blank2, quote] = lines(text);
    assert.match(h, /^# \S/, p);
    assert.equal(blank, '');
    assert.match(canon, /^Canonical: https:\/\/example\.com\//, p);
    assert.equal(blank2, '');
    assert.match(quote, /^> \S/, p);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), 'ends with one newline');
    assert.doesNotMatch(text, /\n{3,}/);
  }
  assert.equal(lines(md['/posts/hello/'])[0], '# Hello, Example Co & friends | Example Co blog');
  assert.equal(lines(md['/posts/hello/'])[2], 'Canonical: https://example.com/posts/hello/');
});

test('a page with no description has no quote line; with no title its h1 is the title', () => {
  const text = render('<h1>Plain page</h1><p>Words.</p>', { title: '' });
  assert.equal(text, '# Plain page\n\nCanonical: https://example.com/t/\n\nWords.\n');
});

test('a Markdown post: headings, lists, nested lists, a code block, a table, images and links', () => {
  const t = md['/posts/hello/'];
  assert.match(t, /^## Why$/m);
  assert.match(t, /^## How$/m);
  assert.match(t, /^- One file per post\n- Reviewed like code\n {2}- by a person$/m);
  assert.match(t, /^```\nnpm run build\nnpm run deploy\n```$/m);
  assert.match(t, /^\| Plan \| Price \|\n\| --- \| --- \|\n\| Basic \| \$10 \|\n\| Pro \\\| Team \| \$30 \|$/m, 'a pipe in a cell is escaped');
  assert.match(t, /We keep posts as plain files\. \*\*Nothing\*\* is hidden/);
  assert.match(t, /^2026-10-22 · by \[Sam Lee\]\(https:\/\/example\.com\/author\/sam-lee\/\)$/m, 'a relative link is made absolute');
  assert.match(t, /\[the docs\]\(https:\/\/docs\.example\.org\/guide\?a=1&b=2\)/);
  assert.match(t, /\[us\]\(mailto:hi@example\.com\)/);
});

test('the title is not said twice: the h1 that repeats it is dropped, a different one is kept', () => {
  assert.doesNotMatch(md['/posts/hello/'], /^# Hello, Example Co & friends$/m);
  assert.equal([...md['/posts/hello/'].matchAll(/^# /gm)].length, 1);
  const kept = render('<h1>Welcome to Example Co</h1><p>x</p>', { title: 'Home' });
  assert.match(kept, /^# Welcome to Example Co$/m, 'a heading that says something else stays');
});

test('links: relative to absolute; a place on the same page is plain text (Markdown has no ids); other pages keep theirs', () => {
  const t = md['/posts/hello/'];
  assert.match(t, /and the how is below\. See this part or the \[tips\]\(https:\/\/example\.com\/posts\/second\/#tips\)/);
  assert.doesNotMatch(t, /\(#/, 'no link to an id');
  assert.doesNotMatch(t, /javascript:/, 'a script address is not a link');
  assert.match(t, /or do not click\./);
  assert.doesNotMatch(md['/'], /\(#plans\)/);
  assert.match(md['/'], /\[Start free\]\(https:\/\/example\.com\/signup\/\) See plans/);
});

test('images are absolute; one without alt (or with an empty alt) is left out; the cover and content images stay', () => {
  const t = md['/posts/hello/'];
  assert.match(t, /!\[A desk with a laptop\]\(https:\/\/example\.com\/uploads\/cover\.jpg\)/);
  assert.match(t, /!\[The editor, with a post open\]\(https:\/\/example\.com\/uploads\/shot\.png\)/);
  assert.doesNotMatch(t, /spacer|tracking\.gif/);
  assert.doesNotMatch(t, /logo\.svg/, 'the header logo is outside main');
  const lazy = render('<h1>x</h1><img src="data:image/gif;base64,R0lG" data-src="/img/a.png" alt="Lazy one"><img src="data:image/gif;base64,R0lG" alt="No source">');
  assert.match(lazy, /!\[Lazy one\]\(https:\/\/example\.com\/img\/a\.png\)/);
  assert.doesNotMatch(lazy, /No source|base64/);
});

test('menus, header, footer, scripts, styles, forms and buttons are not in the text', () => {
  for (const t of Object.values(md)) {
    assert.doesNotMatch(t, /Pricing|© 2026|Privacy|window\.x|margin:0|Search|dateModified|@type/, t.slice(0, 40));
  }
  assert.doesNotMatch(md['/'], /Menu/, 'a button is not content');
  assert.doesNotMatch(md['/posts/hello/'], /Contents|^1\. /m, 'the page’s own table of contents (a nav) is left out');
});

test('an MDX page: the words, a callout, components with their HTML, a chart’s labels and an embed', () => {
  const t = md['/guides/mdx/'];
  assert.match(t, /This guide is an MDX file with `components` in it\./);
  assert.match(t, /^\*\*Try it\*\*$/m);
  assert.match(t, /^Click this box\. Its settings open on the right\.$/m);
  assert.match(t, /^### Fast\n\nBuilds in seconds\.\n\n### Plain\n\nFiles you can read\.$/m, 'an island’s cards are separate blocks, not glued');
  assert.match(t, /^Mon Tue Wed$/m, 'spans side by side are separate words');
  assert.doesNotMatch(t, /self\.Astro|<svg|viewBox/);
});

test('an iframe becomes a link to its src; one with a script address is dropped', () => {
  const t = md['/guides/mdx/'];
  assert.match(t, /^\[Product tour\]\(https:\/\/video\.example\.org\/embed\/abc123\)$/m);
  assert.doesNotMatch(t, /Bad|javascript/);
  assert.match(render('<iframe src="//maps.example.org/x"></iframe>'), /\[Embedded content\]\(https:\/\/maps\.example\.org\/x\)/, 'no title: a plain name');
});

test('a page of JSON sections: hero, link cards, FAQ details, a table with no th, a definition list', () => {
  const t = md['/'];
  assert.match(t, /^\[Start free\]\(https:\/\/example\.com\/signup\/\) See plans$/m, 'the hero’s buttons');
  assert.match(t, /^### \[Boards\]\(https:\/\/example\.com\/features\/boards\/\)\n\nCards in columns\.$/m, 'a card that is one big link keeps the link on its heading');
  assert.match(t, /^### \[Reports\]\(https:\/\/example\.com\/features\/reports\/\)\n\nSee what is late\.$/m);
  assert.match(t, /^\*\*Is there a free plan\?\*\*\n\nYes\. \[See pricing\]\(https:\/\/example\.com\/pricing\/\)\.$/m, 'details: the summary in bold, then the body');
  assert.match(t, /^\*\*Can I export my data\?\*\*\n\nAny time, as CSV\.\n\n- Boards\n- Cards$/m);
  assert.doesNotMatch(t, /<details|<summary/);
  assert.match(t, /^\| \*\*Plan\*\* \| \*\*Seats\*\* \| Notes \|\n\| --- \| --- \| --- \|\n\| Starter \| 5 \| Free forever \|\n\| Team \| 50 \| Reports Boards \|$/m, 'the first row is the header; breaks and lists in a cell stay on its line');
  assert.match(t, /^\*\*Founded\*\*\n\n2024\n\n\*\*Team\*\*\n\n12 people$/m);
  assert.match(t, /!\[Acme\]\(https:\/\/example\.com\/logos\/a\.svg\)/);
});

test('a card link with no heading or paragraph still keeps its link, named by its image or its address', () => {
  const t = render('<h1>x</h1><a href="/go/"><div><img src="/i.png" alt="Pic"></div></a><a href="/bare/"><div><span>1</span></div></a>');
  assert.match(t, /^\[Pic\]\(https:\/\/example\.com\/go\/\)$/m);
  assert.match(t, /^\[\/bare\/\]\(https:\/\/example\.com\/bare\/\)\n\n1$/m, 'no image either: the link names its own address');
});

test('the main selector: a tag, #id, .class, [attr], [attr="v"] and a tag with those; no match falls back to body', () => {
  const body = '<div id="a" class="x y" data-k="1"><h2>First</h2></div><div id="b" class="z" data-k="2"><h2>Second</h2></div>';
  const text = (main) => render(body, { main: false }, { main });
  assert.match(text('#b'), /Second/);
  assert.doesNotMatch(text('#b'), /First/);
  assert.match(text('.y'), /First/);
  assert.doesNotMatch(text('.y'), /Second/);
  assert.match(text('div.z'), /Second/);
  assert.match(text('[data-k="2"]'), /Second/);
  assert.doesNotMatch(text('[data-k="2"]'), /First/);
  assert.match(text('div#a.x[data-k]'), /First/);
  assert.match(text('#none'), /First[\s\S]*Second/, 'nothing matched: the body');
  assert.match(text('not a selector!'), /First[\s\S]*Second/);
});

test('no <main>: the body without its own header, footer, nav and aside, but an article’s header stays', () => {
  const t = md['/about/'];
  assert.match(t, /^We make tools\.$/m);
  assert.match(t, /^## Our story\n\nIt began in a garage\.$/m);
  assert.doesNotMatch(t, /Home|Subscribe|© Example Co/);
});

test('roles: a navigation, banner or search landmark is left out even when it is a div', () => {
  const t = render('<div role="navigation"><a href="/a/">Menu item</a></div><div role="search">Find</div><p>Body</p>');
  assert.match(t, /Body/);
  assert.doesNotMatch(t, /Menu item|Find/);
});

test('custom elements and spans around blocks do not glue their text; inline ones stay in the sentence', () => {
  const t = render('<h1>x</h1><my-card><h3>A</h3><p>B</p></my-card><span><div>C</div><div>D</div></span><p>See <ui-tip>this tip</ui-tip> now.</p>');
  assert.match(t, /### A\n\nB\n\nC\n\nD\n\nSee this tip now\./);
});

test('text is escaped as Markdown, so a page’s own * _ [ < characters stay text', () => {
  const t = render('<h1>x</h1><p>2 * 3 = 6, snake_case, [not a link], a &lt;tag&gt;</p>');
  assert.match(t, /^2 \\\* 3 = 6, snake\\_case, \\\[not a link\\\], a \\<tag\\>$/m);
});

test('an empty page body still gives a header and no body', () => {
  assert.equal(render('', { title: 'Empty' }), '# Empty\n\nCanonical: https://example.com/t/\n');
});

test('hostile or broken HTML does not throw: unclosed tags, a stray <, deep nesting', () => {
  const deep = '<div>'.repeat(300) + 'deep' + '</div>'.repeat(300);
  const t = render(`<h1>x</h1><p>one < two<p>three<ul><li>a<li>b</ul>${deep}<table><tr><td>unclosed`);
  assert.match(t, /one < two|one \\< two/);
  assert.match(t, /- a\n- b/);
  assert.match(t, /deep/);
});

test('md-tree: selectorTest, findFirst, contentOf and dropTitleHeading', () => {
  assert.equal(selectorTest(''), null);
  assert.equal(selectorTest('a b'), null);
  assert.equal(typeof selectorTest('main#x.y[z="1"]'), 'function');
  const root = parseHtml('<html><body><header><h1>Site</h1></header><div class="c"><h1>The Page</h1><p>t</p></div></body></html>');
  assert.equal(findFirst(root, (n) => n.tag === 'p').tag, 'p');
  assert.equal(findFirst(root, (n) => n.tag === 'table'), null);
  const tree = contentOf(root, { main: 'main', base: SITE });
  assert.equal(tree.children.filter((c) => c.tag).map((c) => c.tag).join(), 'div', 'the page’s own header was left out');
  assert.equal(dropTitleHeading(tree, 'The Page | Example Co'), 'The Page');
  assert.equal(findFirst(tree, (n) => n.tag === 'h1'), null);
  assert.equal(dropTitleHeading(tree, 'x'), '', 'no h1 left');
});
