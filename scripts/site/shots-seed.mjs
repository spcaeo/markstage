// The made-up content the site's screenshots show (scripts/site/capture-shots.mjs): one more post for the example
// blog, pictures drawn in the browser, and messages for the Inbox. Every name and address is invented (example.com).

/** A post that shows the editor at work: headings, a list, a table, a quote and a picture. */
export const DEMO_POST = `---
title: Plan a content calendar your whole team keeps
description: A simple weekly rhythm for drafting, reviewing and publishing posts without a spreadsheet.
date: 2026-10-28
author: sam-lee
pageType: article
topic: editing
cover:
  src: /uploads/calendar-cover.png
  alt: A wall calendar with coloured notes for drafts, reviews and published posts
---

A content calendar only works when the people writing can see it, change it and trust it. Keep it in the same place
as the posts, and every change is a clean, reviewable commit.

## Start with one weekly rhythm

1. **Monday:** pick the three posts for the week and open a draft for each.
2. **Wednesday:** a second person reviews the draft on the real page, not in a form.
3. **Friday:** put the finished posts live together, in one release.

## Who does what

| Step | Who | Time |
| :--- | :--- | ---: |
| Draft | Writer | 2 h |
| Review | Editor | 30 min |
| Go live | Editor | 5 min |

> Write on the page your readers will see. You catch the long headline and the broken table before they do.

## Keep the history

Every save is a git commit with your name on it, so you can see who changed what, compare two versions and bring an
older one back in a click.
`;

/** Messages people sent through the blog's contact form (Inbox). */
export const MESSAGES = [
  { name: 'Priya Shah', email: 'priya@example.com', topic: 'Guest post', comment: 'Hello! I would like to write a guest post about plain-text writing workflows. Is that something you publish?' },
  { name: 'Marco Bellini', email: 'marco@example.com', topic: 'Partnership', comment: 'We run a small design studio and use Astro for our clients. Could we talk about a partnership for next year?' },
  { name: 'Hannah Okafor', email: 'hannah@example.com', topic: 'Question', comment: 'Your post on keyboard shortcuts was great. Is there a printable list of the shortcuts somewhere?' },
];

/** The contact form, as the site's server config describes it (docs/CONFIG.md "Forms"). */
export const CONTACT_FORM = {
  label: 'Contact',
  fields: {
    name: { label: 'Name', required: true, max: 100 },
    email: { label: 'Email', type: 'email', required: true },
    topic: { label: 'Topic', max: 100 },
    comment: { label: 'Message', type: 'textarea', required: true, min: 14 },
  },
  service: 'topic',
  meta: { page: 'pageUrl', referrer: 'referrerURL' },
};

/**
 * Pictures for the media library and the post's cover, drawn as HTML and photographed by the browser (no image
 * library needed). Each is `{name, alt, html}` at 1200 x 675.
 */
export const PICTURES = [
  {
    name: 'calendar-cover.png',
    alt: 'A wall calendar with coloured notes for drafts, reviews and published posts',
    html: scene('#eef2ff', '#c7d2fe', [
      ['#4f46e5', 'Draft'],
      ['#0d9488', 'Review'],
      ['#ea580c', 'Live'],
    ]),
  },
  { name: 'mountain-lake.png', alt: 'A calm mountain lake at sunrise', html: landscape('#fde68a', '#f59e0b', '#1e3a8a') },
  { name: 'city-evening.png', alt: 'City buildings against an evening sky', html: city('#312e81', '#f472b6') },
  { name: 'team-desk.png', alt: 'A desk with a laptop, a notebook and a cup of coffee', html: desk('#f1f5f9', '#0f766e') },
  { name: 'forest-path.png', alt: 'A path through a green forest', html: landscape('#bbf7d0', '#16a34a', '#14532d') },
  { name: 'ocean-waves.png', alt: 'Blue ocean waves under a clear sky', html: landscape('#bae6fd', '#0284c7', '#0c4a6e') },
];

function frame(body) {
  return `<!doctype html><html><body style="margin:0;width:1200px;height:675px;overflow:hidden;font-family:system-ui,sans-serif">${body}</body></html>`;
}

function scene(bg, line, notes) {
  const cells = Array.from({ length: 28 }, (_, i) => {
    const note = notes[i % 5 === 1 ? 0 : i % 7 === 3 ? 1 : i % 9 === 5 ? 2 : -1];
    return `<div style="border:2px solid ${line};border-radius:10px;padding:10px;background:#fff;font-size:20px;color:#334155">${i + 1}${note ? `<div style="margin-top:12px;background:${note[0]};color:#fff;border-radius:6px;padding:6px 8px;font-size:17px">${note[1]}</div>` : ''}</div>`;
  }).join('');
  return frame(`<div style="background:${bg};width:100%;height:100%;padding:40px;box-sizing:border-box;display:grid;grid-template-columns:repeat(7,1fr);gap:12px">${cells}</div>`);
}

function landscape(sky, hill, deep) {
  return frame(`<div style="position:relative;width:100%;height:100%;background:linear-gradient(${sky},#fff)">
<div style="position:absolute;left:760px;top:120px;width:150px;height:150px;border-radius:50%;background:#fff7ed;opacity:.9"></div>
<div style="position:absolute;left:-200px;top:300px;width:900px;height:700px;border-radius:50%;background:${hill}"></div>
<div style="position:absolute;left:450px;top:360px;width:1100px;height:800px;border-radius:50%;background:${deep}"></div></div>`);
}

function city(sky, glow) {
  const towers = [80, 200, 120, 260, 160, 300, 140, 220, 180, 100]
    .map((h, i) => `<div style="position:absolute;bottom:0;left:${i * 120 + 10}px;width:100px;height:${h + 160}px;background:#1e1b4b;border-top:4px solid ${glow}"></div>`)
    .join('');
  return frame(`<div style="position:relative;width:100%;height:100%;background:linear-gradient(${sky},${glow})">${towers}</div>`);
}

function desk(bg, accent) {
  return frame(`<div style="position:relative;width:100%;height:100%;background:${bg}">
<div style="position:absolute;left:330px;top:150px;width:540px;height:340px;border-radius:18px;background:#1f2937"><div style="margin:20px;height:300px;border-radius:8px;background:linear-gradient(135deg,#e0e7ff,#ccfbf1)"></div></div>
<div style="position:absolute;left:300px;top:490px;width:600px;height:26px;border-radius:0 0 18px 18px;background:#374151"></div>
<div style="position:absolute;left:940px;top:330px;width:110px;height:130px;border-radius:0 0 30px 30px;background:${accent}"></div>
<div style="position:absolute;left:110px;top:300px;width:160px;height:210px;border-radius:8px;background:#fde68a;transform:rotate(-8deg)"></div></div>`);
}

const text = (t, marks) => (marks ? { type: 'text', text: t, marks: marks.map((type) => ({ type })) } : { type: 'text', text: t });
const para = (...parts) => ({ type: 'paragraph', content: parts.map((t) => (typeof t === 'string' ? text(t) : t)) });
const heading = (t, level = 2) => ({ type: 'heading', attrs: { level }, content: [text(t)] });
const bullets = (...items) => ({ type: 'bulletList', attrs: { tight: true }, content: items.map((t) => ({ type: 'listItem', content: [para(t)] })) });
const quote = (t) => ({ type: 'blockquote', content: [para(t)] });
const cell = (type, t) => ({ type, content: [para(t)] });
const table = (head, ...rows) => ({
  type: 'table',
  content: [{ type: 'tableRow', content: head.map((t) => cell('tableHeader', t)) }, ...rows.map((r) => ({ type: 'tableRow', content: r.map((t) => cell('tableCell', t)) }))],
});
const doc = (...content) => ({ type: 'doc', content });

/** Library items: a page template, article sections and snippets in folders (docs/API-LIBRARY.md). */
export const LIBRARY = [
  {
    kind: 'section',
    name: 'Key takeaways',
    description: 'Three points a reader keeps, at the top of a long post.',
    folder: 'Article parts',
    tags: ['summary'],
    synced: true,
    body: { doc: doc(heading('Key takeaways', 3), bullets('Write on the page your readers will see.', 'Every save is a commit with your name on it.', 'Put related posts live together, in one release.')) },
  },
  {
    kind: 'section',
    name: 'Compare two ways',
    description: 'A small table that sets two options side by side.',
    folder: 'Article parts',
    tags: ['table'],
    body: { doc: doc(heading('Which way fits you', 3), table(['', 'Forms', 'On the page'], ['You see', 'Fields', 'The real design'], ['A review shows', 'The whole file', 'Only what changed'], ['Set-up', 'Minutes', 'Minutes'])) },
  },
  {
    kind: 'section',
    name: 'Reader quote',
    description: 'A short quote from a reader, with their name.',
    folder: 'Article parts',
    tags: ['quote'],
    body: { doc: doc(quote('We moved our team blog in an afternoon, and nobody had to learn Markdown.'), para(text('Robin Park, editor at Example Co', ['italic']))) },
  },
  {
    kind: 'template',
    name: 'How-to article',
    description: 'One task, step by step, with what you need first.',
    collection: 'posts',
    body: { frontmatter: { pageType: 'article', topic: 'editing' }, doc: doc(para('What you will be able to do, in one sentence.'), heading('What you need'), para('The tools and access to have ready.'), heading('Steps'), para('Each step in one short paragraph.')) },
  },
  { kind: 'snippet', name: 'Newsletter sign-up', folder: 'Calls to action', tags: ['footer'], synced: true, body: { doc: doc(para('Get one practical writing tip a week. No spam, unsubscribe any time.')) } },
  { kind: 'snippet', name: 'Before you start', folder: 'Boxes', tags: ['note'], body: { doc: doc(para('Before you start: save a copy of your draft. Every save is kept in the history anyway.')) } },
  { kind: 'snippet', name: 'Ask the team', folder: 'Calls to action', body: { doc: doc(para('Questions about this post? Write to us through the contact form and a person will answer.')) } },
  { kind: 'snippet', name: 'Updated note', folder: 'Boxes', tags: ['note'], body: { doc: doc(para('Updated this month with the newest steps and screenshots.')) } },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TAGS = { paragraph: 'p', bulletList: 'ul', orderedList: 'ol', listItem: 'li', blockquote: 'blockquote', table: 'table', tableRow: 'tr', tableHeader: 'th', tableCell: 'td' };

/** A Library item's blocks as HTML, for its picture (only the node types the items above use). */
export function docHtml(node) {
  if (node.type === 'text') {
    let out = esc(node.text);
    for (const m of node.marks ?? []) out = m.type === 'bold' ? `<strong>${out}</strong>` : m.type === 'italic' ? `<em>${out}</em>` : out;
    return out;
  }
  const inner = (node.content ?? []).map(docHtml).join('');
  if (node.type === 'doc') return inner;
  if (node.type === 'heading') return `<h${node.attrs.level}>${inner}</h${node.attrs.level}>`;
  const tag = TAGS[node.type];
  return tag ? `<${tag}>${inner}</${tag}>` : inner;
}

/** A Library card's picture: the item drawn with the site's own CSS, at 16:9 (the card's shape), `{html, width, height}`
 * in CSS pixels; the browser takes it at 2x, so the words read at the card's size. */
export function thumbPage(item, css) {
  const body = item.body?.doc ? docHtml(item.body.doc) : '';
  const title = item.kind === 'template' ? `<h1 style="font-size:1.3rem;margin:0 0 .3em">${esc(item.name)}</h1>` : '';
  return {
    width: 400,
    height: 225,
    html: `<!doctype html><html><head><style>${css}</style><style>body{max-width:none;margin:0;padding:16px 22px;height:225px;box-sizing:border-box;overflow:hidden;font-size:15px;line-height:1.5}.post__body h2,.post__body h3{margin:.2em 0 .4em}.post__body table{width:100%}</style></head><body><article class="post"><div class="post__body">${title}${body}</div></article></body></html>`,
  };
}
