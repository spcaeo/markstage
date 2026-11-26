// Built pages for the head kit's tests: what Astro writes for a Markdown post, an MDX page with components, and a
// page built from typed JSON sections, plus the pages a site has that are left out. An example site (Example Co).
import fs from 'node:fs';
import path from 'node:path';

export const SITE = 'https://example.com';

const chrome = `<header class="site"><a href="/" class="logo"><img src="/logo.svg" alt="Example Co"></a>
  <nav aria-label="Main"><ul><li><a href="/pricing/">Pricing</a></li><li><a href="/blog/">Blog</a></li></ul></nav>
  <form action="/search/"><input name="q"><button>Search</button></form></header>`;
const footer = `<footer class="site"><p>© 2026 Example Co</p><nav><a href="/privacy/">Privacy</a></nav></footer>`;

/** One full page as Astro writes it. */
export function doc({ title = 'Example Co', description = '', canonical, robots, lang = 'en', head = '', body, main = true }) {
  const inner = main ? `${chrome}<main>${body}</main>${footer}` : body;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>${description ? `<meta name="description" content="${description}">` : ''}${canonical ? `<link rel="canonical" href="${canonical}">` : ''}${robots ? `<meta name="robots" content="${robots}">` : ''}${head}
<script type="application/ld+json">{"@type":"Article","dateModified":"2026-11-02T09:30:00Z"}</script><style>body{margin:0}</style></head><body>${inner}<script>window.x=1</script></body></html>`;
}

// 1. a post written in Markdown: headings with ids, a list, a table, a code block, images, links
export const POST = doc({
  title: 'Hello, Example Co &amp; friends | Example Co blog',
  description: 'How we write posts in Markdown.',
  canonical: `${SITE}/posts/hello/`,
  head: '<meta property="article:modified_time" content="2026-11-03T10:00:00Z">',
  body: `<article class="post"><h1>Hello, Example Co &amp; friends</h1>
<p class="post__date">2026-10-22 · by <a href="/author/sam-lee/">Sam Lee</a></p>
<nav class="post__contents" aria-label="Contents"><ol><li><a href="#why">Why</a></li><li><a href="#how">How</a></li></ol></nav>
<figure class="post__cover"><img src="/uploads/cover.jpg" alt="A desk with a laptop" width="1200" height="600"></figure>
<div class="post__body">
<h2 id="why">Why</h2>
<p>We keep posts as plain files. <strong>Nothing</strong> is hidden, and the <a href="#how">how</a> is below. See <a href="/posts/hello/#why">this part</a> or the <a href="/posts/second/#tips">tips</a>.</p>
<ul><li>One file per post</li><li>Reviewed like code
<ul><li>by a person</li></ul></li></ul>
<h2 id="how">How</h2>
<pre class="astro-code"><code><span class="line"><span>npm run build</span></span>
<span class="line"><span>npm run deploy</span></span></code></pre>
<table><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td>Basic</td><td>$10</td></tr><tr><td>Pro | Team</td><td>$30</td></tr></tbody></table>
<p><img src="/uploads/shot.png" alt="The editor, with a post open"> <img src="/uploads/spacer.png" alt=""> <img src="/uploads/tracking.gif"></p>
<p>Read <a href="https://docs.example.org/guide?a=1&amp;b=2">the docs</a>, write to <a href="mailto:hi@example.com">us</a>, or <a href="javascript:alert(1)">do not click</a>.</p>
</div>
<aside class="more-topic"><h2>More on this topic</h2><ul><li><a href="/posts/second/">Second post</a></li></ul></aside></article>`,
});

// 2. an MDX page: the words, plus what its components leave in the HTML (an island, a callout, a chart, a video embed)
export const MDX = doc({
  title: 'Writing in MDX',
  description: 'An MDX guide.',
  canonical: `${SITE}/guides/mdx/`,
  body: `<article class="post"><h1>Writing in MDX</h1>
<div class="post__body">
<p>This guide is an MDX file with <code>components</code> in it.</p>
<aside class="callout callout--tip" role="note"><strong class="callout__title">Try it</strong><div>Click this box. Its settings open on the right.</div></aside>
<astro-island uid="Z1" component-url="/_astro/Cards.js" client="visible" opts="{}"><div class="cards"><div class="card"><h3>Fast</h3><p>Builds in seconds.</p></div><div class="card"><h3>Plain</h3><p>Files you can read.</p></div></div><script>self.Astro=1</script></astro-island>
<div class="chart"><svg viewBox="0 0 10 10"><rect width="3" height="9"/></svg><div class="chart__labels"><span>Mon</span><span>Tue</span><span>Wed</span></div></div>
<iframe src="https://video.example.org/embed/abc123" title="Product tour" width="560" height="315" loading="lazy"></iframe>
<iframe src="javascript:alert(1)" title="Bad"></iframe>
<h2>What stays as written</h2>
<p>The imports and anything in curly braces are code.</p>
</div></article>`,
});

// 3. a page built from JSON sections: a hero, link cards, a FAQ in details, a table with no th, buttons
export const SECTIONS = doc({
  title: 'Example Co - Project tracking for small teams',
  description: 'Plan, track and ship work together.',
  canonical: `${SITE}/`,
  body: `<section class="hero"><p class="eyebrow">New</p><h1>Project tracking for small teams</h1><p>Plan, track and ship work together.</p>
<a class="btn" href="/signup/">Start free</a> <a class="btn btn--ghost" href="#plans">See plans</a><button type="button">Menu</button></section>
<section class="cards"><h2>What you get</h2>
<a class="card" href="/features/boards/"><div class="card__icon"><svg><path d="M0 0"/></svg></div><h3>Boards</h3><p>Cards in columns.</p></a>
<a class="card" href="/features/reports/"><h3>Reports</h3><p>See what is late.</p></a></section>
<section id="plans"><h2>Plans</h2><table class="plans"><tr><td><strong>Plan</strong></td><td><strong>Seats</strong></td><td>Notes</td></tr><tr><td>Starter</td><td>5</td><td>Free<br>forever</td></tr><tr><td>Team</td><td>50</td><td><ul><li>Reports</li><li>Boards</li></ul></td></tr></table></section>
<section class="faq"><h2>Questions</h2>
<details open><summary>Is there a free plan?</summary><p>Yes. <a href="/pricing/">See pricing</a>.</p></details>
<details><summary><span>Can I <em>export</em> my data?</span></summary><p>Any time, as CSV.</p><ul><li>Boards</li><li>Cards</li></ul></details></section>
<section class="logos"><h2>Used by</h2><div class="logos__row"><img src="/logos/a.svg" alt="Acme"><img src="/logos/b.svg" alt="Globex"></div></section>
<dl class="facts"><dt>Founded</dt><dd>2024</dd><dt>Team</dt><dd>12 people</dd></dl>`,
});

export const NOINDEX = doc({ title: 'Thanks', robots: 'noindex, follow', body: '<h1>Thanks for signing up</h1>' });
export const NOT_FOUND = doc({ title: 'Page not found', body: '<h1>404</h1><p>No such page.</p>' });
export const REDIRECT = `<!doctype html><title>Redirecting to: /new/</title><meta http-equiv="refresh" content="0;url=/new/"><meta name="robots" content="noindex"><link rel="canonical" href="${SITE}/new/"><body><a href="/new/">Redirecting from <code>/old/</code> to <code>/new/</code></a></body>`;
export const PRIVATE_NOTE = doc({ title: 'Press kit', description: 'Logos and facts.', body: '<h1>Press kit</h1><p>Logos.</p>' });
export const VERIFY = 'google-site-verification: google0123456789abcdef.html';
export const NO_MAIN = doc({
  title: 'About',
  description: 'Who we are.',
  main: false,
  body: `<header class="site"><nav><a href="/">Home</a></nav></header><div class="wrap"><h1>About us</h1><p>We make tools.</p>
<article><header><h2>Our story</h2></header><p>It began in a garage.</p></article></div><aside><p>Subscribe!</p></aside><footer><p>© Example Co</p></footer>`,
});

/** The site as files in `dir`: {"posts/hello/index.html": html, ...}. Returns dir. */
export function writeSite(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return dir;
}

/** A small site of the pages above, the way a build lays them out. */
export const SITE_FILES = {
  'index.html': SECTIONS,
  'posts/hello/index.html': POST,
  'guides/mdx/index.html': MDX,
  'about/index.html': NO_MAIN,
  'thanks/index.html': NOINDEX,
  '404.html': NOT_FOUND,
  'old/index.html': REDIRECT,
  'press/index.html': PRIVATE_NOTE,
  'google0123456789abcdef.html': VERIFY,
};
