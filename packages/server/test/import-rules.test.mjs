// A site's converter rules (docs/IMPORT.md "Converter rules"): old HTML patterns, found by a class on a wrapper, as
// MDX components with props taken from inside them; what no rule matches keeps the usual conversion. Also the SEO
// head an SEO plugin draws, and the text MDX needs escaped. Every output is parsed with the MDX reader the editor
// uses (core's remark-mdx), so a rule can never write a file the site cannot build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { mdxParser } from '../../core/src/markdown/mdx.mjs';
import { htmlToMarkdown } from '../src/import/convert/html.mjs';
import { checkRules, componentMdx } from '../src/import/convert/rules.mjs';
import { wpContentToHtml } from '../src/import/convert/wp-content.mjs';
import { readSeoHead } from '../src/import/convert/wp-head.mjs';

const BASE = 'https://cms.example.com';
const RULES = checkRules({
  components: { CtaBand: { import: '../../components/CtaBand.astro' }, Faq: { import: '../../components/Faq.astro' } },
  report: ['ex-'],
  rules: [
    { match: 'ex-progress', drop: true },
    { match: 'ex-head', keep: true },
    { match: ['ex-cta', 'light'], component: 'CtaBand', props: { tone: { value: 'light' }, heading: { from: 'text', select: '.ex-title', required: true }, text: { from: 'markdown', exclude: '.ex-title, .ex-btn' }, action: { from: 'link', select: '.ex-btn' } } },
    { match: 'callout_box', component: 'CtaBand', props: { heading: { from: 'text', select: '.call_heading', required: true }, text: { from: 'markdown', exclude: '.call_heading, .wp-block-buttons' }, action: { from: 'link', select: '.wp-block-buttons' } } },
    { match: 'callout_box', component: 'Callout', children: { from: 'markdown', required: true } },
    { match: 'faq_blog', component: 'Faq', props: { heading: { from: 'heading', select: 'h2' }, items: { from: 'qa', question: 'h3', trimNumber: true, required: true } } },
    { match: 'ex-faq', component: 'Faq', props: { items: { from: 'qa', required: true } } },
    { match: 'ex-cards', component: 'CardGrid', props: { cards: { from: 'items', select: 'li', fields: { title: 'heading', text: { from: 'markdown', select: 'p' }, image: 'image', featured: { from: 'hasClass', name: 'featured' } } } } },
    { match: 'ex-*-awards', component: 'AwardsRow', props: { heading: 'heading', badges: 'images' } },
    { match: 'ex-hero', component: 'Hero', props: { title: { from: 'heading', select: 'h1', required: true } }, children: { from: 'markdown', exclude: 'h1' } },
    { match: 'ex-rating', component: 'RatingBadges', wordsFrom: 'src/data/ratings.json' },
  ],
});

/** The HTML through the rules: {markdown, notes, components}; the markdown must parse as MDX. */
function convert(html, { rules = RULES, link = (u) => u, image = (u) => u } = {}) {
  const out = htmlToMarkdown(html, { base: BASE, mdx: true, rules, link, image });
  mdxParser.parse(out.markdown);
  return out;
}
const kinds = (notes, kind) => notes.filter((n) => n.kind === kind).map((n) => n.text);

describe('converter rules: old patterns as MDX components', () => {
  test('a call-to-action box becomes a component with its heading, words and link; its import line comes first', () => {
    const html = `<div class="wp-block-group callout_box has-background"><p class="call_heading">Ready to start?</p><p>We build it <strong>end to end</strong>, with <a href="${BASE}/about/">our team</a>.</p><div class="wp-block-buttons"><div class="wp-block-button"><a class="wp-block-button__link" href="/contact/"><strong>Book a call</strong></a></div></div></div><p>After it.</p>`;
    const out = convert(html, { link: (u) => (u === `${BASE}/about/` ? '/about-us/' : u) });
    assert.equal(out.markdown, `import CtaBand from '../../components/CtaBand.astro';\n\n<CtaBand heading="Ready to start?" text="We build it **end to end**, with [our team](/about-us/)." action={{"href":"${BASE}/contact/","text":"Book a call"}} />\n\nAfter it.`);
    assert.deepEqual(out.components, { CtaBand: 1 });
    assert.deepEqual(kinds(out.notes, 'rule'), []);
  });

  test('the first rule that finds what it requires is used; a rule that does not is noted and the next one tried', () => {
    const out = convert('<div class="callout_box"><ul><li>One point</li><li>Another</li></ul></div>');
    assert.match(out.markdown, /^<Callout>\n\n- One point\n- Another\n\n<\/Callout>$/m);
    assert.match(kinds(out.notes, 'rule')[0], /rule for “callout_box” \(CtaBand\) was not used: it found no heading/);
  });

  test('all classes must match, and a * matches any letters of one', () => {
    const light = convert('<section class="ex-cta light"><p class="ex-title">Talk to us</p><p>Today.</p><a class="ex-btn" href="/contact/">Go</a></section>');
    assert.match(light.markdown, /^<CtaBand tone="light" heading="Talk to us" text="Today\." action=\{\{"href":"https:\/\/cms\.example\.com\/contact\/","text":"Go"\}\} \/>$/m);
    const dark = convert('<section class="ex-cta"><p class="ex-title">Talk</p></section>');
    assert.doesNotMatch(dark.markdown, /CtaBand/, 'ex-cta alone has no rule here');
    const awards = convert('<section class="ex-services-awards"><h2>Awards</h2><img src="/a.png" alt="A"><img src="/b.png" alt="B"></section>');
    assert.match(awards.markdown, /<AwardsRow heading="Awards" badges=\{\[\{"src":"https:\/\/cms\.example\.com\/a\.png","alt":"A"\},\{"src":"https:\/\/cms\.example\.com\/b\.png","alt":"B"\}\]\} \/>/);
  });

  test('FAQs: heading questions with what follows them, numbering taken off; toggles with the answer inside or after', () => {
    const blog = convert('<div class="faq_blog"><h2>Questions</h2><h3>1. Is it safe?</h3><p>Yes, <a href="https://docs.example.com/">see the docs</a>.</p><p>Always.</p><h3>2. How long?</h3><p>Weeks.</p></div>');
    const items = (md) => JSON.parse(/items=\{(\[.*\])\}/.exec(md)[1]);
    assert.deepEqual(items(blog.markdown), [{ question: 'Is it safe?', answer: 'Yes, [see the docs](https://docs.example.com/).\n\nAlways.' }, { question: 'How long?', answer: 'Weeks.' }]);
    assert.match(blog.markdown, /<Faq heading="Questions" items=/);
    assert.deepEqual(kinds(blog.notes, 'rule'), [], 'the numbers taken off are not lost words');
    // a toggle whose answer is inside it, and one whose answer follows it (an empty toggle, then a group)
    const toggles = convert('<section class="ex-faq"><details><summary><strong>Inside?</strong></summary><p>Yes.</p></details><details><summary>After?</summary><p></p></details><div class="wp-block-group"><p>It follows.</p></div></section>');
    assert.deepEqual(items(toggles.markdown), [{ question: 'Inside?', answer: 'Yes.' }, { question: 'After?', answer: 'It follows.' }]);
  });

  test('repeated cards are items with their own fields; a class can be a yes or no', () => {
    const out = convert('<ul class="ex-cards"><li class="featured"><img src="/i/one.png" alt="One"><h3>First</h3><p>The first card.</p></li><li><h3>Second</h3><p>The second.</p></li></ul>', { image: (u) => `media:${u.split('/').pop()}` });
    const cards = JSON.parse(/cards=\{(\[.*\])\}/.exec(out.markdown)[1]);
    assert.deepEqual(cards, [{ title: 'First', text: 'The first card.', image: { src: 'media:one.png', alt: 'One' }, featured: true }, { title: 'Second', text: 'The second.' }]);
  });

  test('a component’s children may hold other rules’ components; words no prop keeps are noted, unless they come from data', () => {
    const out = convert('<div class="ex-hero"><h1>Build it</h1><p>Our lead.</p><div class="ex-rating"><a href="https://reviews.example.com/">Rated 5</a></div><div class="ex-progress"></div><span class="ex-extra">An extra line.</span></div>');
    assert.match(out.markdown, /^<Hero title="Build it">\n\nOur lead\.\n\n<RatingBadges \/>\n\nAn extra line\.\n\n<\/Hero>$/m);
    assert.deepEqual(kinds(out.notes, 'rule'), [], 'the rating words come from the data file');
    const lost = convert('<ul class="ex-cards"><li><h3>Card</h3><p>Kept.</p><p>Not kept.</p></li></ul>');
    assert.match(kinds(lost.notes, 'rule')[0], /CardGrid \(from “ex-cards”\) did not keep some of the old words: “Not kept\.”/);
  });

  test('drop leaves a wrapper out (noted when it had words), keep says Markdown is right, report names what has no rule', () => {
    const out = convert('<div class="ex-progress"></div><div class="ex-head"><h2>Section</h2><p class="ex-lead">Lead.</p></div><section class="ex-about"><h2>About the client</h2><p>Words.</p></section><nav class="ex-progress">Skip</nav>');
    assert.equal(out.markdown, '## Section\n\nLead.\n\n## About the client\n\nWords.');
    assert.deepEqual(kinds(out.notes, 'rule'), ['The old block “ex-about” (“About the client”) has no converter rule, so it came in as plain Markdown.', 'The old block “ex-progress” was left out by the converter rules (it said: “Skip”).']);
  });

  test('text MDX would read as code is escaped; props are written so the editor can change the literal ones', () => {
    const out = convert('<p>Use {name} and <code>{x}</code> and a &lt;tag&gt;.</p>');
    assert.equal(out.markdown, 'Use \\{name\\} and `{x}` and a \\<tag\\>.');
    assert.equal(componentMdx('Box', { a: 'say "hi" & <b>', n: 3, on: true, off: false, list: ['x'], multi: 'one\ntwo' }), '<Box a="say &quot;hi&quot; &amp; &lt;b&gt;" n={3} on off={false} list={["x"]} multi={"one\\ntwo"} />');
    mdxParser.parse(componentMdx('Box', { a: 'say "hi" & <b>', n: 3, on: true, off: false, list: ['x'], multi: 'one\ntwo' }));
  });

  test('without MDX (a Markdown collection) no rule applies: the usual conversion', () => {
    const out = htmlToMarkdown('<div class="callout_box"><p class="call_heading">Hi</p></div>', { base: BASE, rules: RULES });
    assert.equal(out.markdown, 'Hi');
    assert.deepEqual(out.components, {});
  });

  test('a chat assistant’s citation markers are taken out, and noted once', () => {
    const out = htmlToMarkdown('<p>Providers such as :contentReference[oaicite:0]{index=0} and :contentReference[oaicite:1]{index=1} offer it.</p>', { base: BASE });
    assert.equal(out.markdown, 'Providers such as and offer it.');
    assert.deepEqual(kinds(out.notes, 'text'), ['2 citation markers left by a chat assistant (“:contentReference[oaicite:…]”) were taken out of the text.']);
  });

  test('a rules file that is not right is refused with the place named', () => {
    const bad = (v) => assert.throws(() => checkRules(v), (e) => (assert.match(e.message, /^rules/), true));
    bad('not json');
    bad({ rules: 'x' });
    bad({ rules: [{ match: 'a', component: 'lowercase' }] });
    bad({ rules: [{ match: 'a b', component: 'A' }] });
    bad({ rules: [{ match: 'a', component: 'A', props: { p: { from: 'nothing' } } }] });
    bad({ rules: [{ match: 'a', component: 'A', props: { p: { from: 'text', select: 'div > p' } } }] });
    bad({ rules: [{ match: 'a', component: 'A', props: { p: { from: 'items' } } }] });
    bad({ components: { A: { import: "x'; alert(1); '" } }, rules: [] });
    assert.throws(() => checkRules({ rules: [{ match: 'a', component: 'A', props: { 'bad-name': 'text' } }] }), /rules\.rules\[0\]\.props\.bad-name/);
    assert.equal(checkRules(null), null);
  });

  test('a rules file in a real site\u2019s shape is valid, and turns its patterns into components', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/import');
    for (const f of fs.readdirSync(dir).filter((x) => /^rules-.*\.json$/.test(x))) {
      const rules = checkRules(fs.readFileSync(path.join(dir, f), 'utf8'));
      assert.ok(rules.rules.length >= 3, f);
      const { html } = wpContentToHtml('<!-- wp:group {"className":"callout_box"} --><div class="wp-block-group callout_box"><!-- wp:paragraph --><p class="call_heading">Ready?</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>Words.</p><!-- /wp:paragraph --><!-- wp:buttons --><div class="wp-block-buttons"><div class="wp-block-button open-quoteform"><a class="wp-block-button__link" href="/contact-us/">Book</a></div></div><!-- /wp:buttons --></div><!-- /wp:group --><!-- wp:html --><div class="faq_blog"><h2>FAQ</h2><h3>1. Q?</h3><p>A.</p></div><!-- /wp:html -->');
      const out = convert(html, { rules });
      assert.deepEqual(Object.keys(out.components).sort(), ['CtaBand', 'Faq'], f);
    }
  });
});

describe('an SEO plugin’s head', () => {
  test('title (og:title without a <title>), description, robots, share picture and canonical; JSON-LD left out', () => {
    const head = `<meta name="description" content="Hire &amp; build."/>
<meta name="robots" content="follow, index"/>
<link rel="canonical" href="https://cms.example.com/services/build/" />
<meta property="og:title" content="Build | Example Co" />
<meta property="og:image" content="https://cms.example.com/wp-content/uploads/2026/01/build.jpg" />
<script type="application/ld+json">{"@type":"Organization","name":"<title>Not this</title>"}</script>`;
    assert.deepEqual(readSeoHead(head), { title: 'Build | Example Co', description: 'Hire & build.', robots: 'follow, index', image: 'https://cms.example.com/wp-content/uploads/2026/01/build.jpg', canonical: 'https://cms.example.com/services/build/' });
    assert.equal(readSeoHead('<title>Own &amp; title</title><meta property="og:title" content="Other">').title, 'Own & title');
    assert.deepEqual(readSeoHead(''), { title: null, description: null, robots: null, image: null, canonical: null });
  });
});
