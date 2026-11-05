// How the comparison data (comparison-data.mjs) is drawn: mark badges, product cards, the "Markstage vs X" card
// pair, the verdict tiles, the grouped comparison tables and the filter above them. Plain HTML that holds every
// fact without script; site/compare.js only adds the filter, and site/compare.css the look.
import { LOGO } from './brand.mjs';
import { CARD_FACTS, GLYPH, KINDS, MARKS, MARKSTAGE, findCell, inline, productInfo, productTags } from './comparison-data.mjs';
import { escapeHtml as e, slugify } from './markdown.mjs';

const LABEL = Object.fromEntries(Object.values(MARKS).map((m) => [m.key, m.label]));

/** A mark as a badge: the glyph for the eye, and its word ("Yes", "Partly") for everyone. */
export const markBadge = (key) => `<span class="mk ${key}"><span class="mk-g" aria-hidden="true">${GLYPH[key]}</span><span class="mk-l">${LABEL[key]}</span></span>`;

/** `ref(id)`: a numbered link to a source in the list of /compare/full/ (`base` is how to reach that page). */
export function sourceRef(notes, base) {
  return (id) => {
    const n = notes.get(id);
    return n ? `<sup class="fn"><a href="${base}#${n.id}" aria-label="Source ${n.number}">${n.number}</a></sup>` : '';
  };
}

/** A cell's HTML: badge, value, the roadmap badge when one applies, the note, its sources. */
export function cellHtml(cell, ref, soon = '') {
  if (!cell) return '<span class="mk-none">Not in this table</span>';
  const parts = [];
  if (cell.mark) parts.push(markBadge(cell.mark));
  if (cell.value) parts.push(`<span class="val">${cell.value}</span>`);
  if (soon) parts.push(`<span class="soon-wrap"><span class="today">today</span> ${soon}</span>`);
  const refs = cell.refs.map(ref).join(' ');
  // the sources follow the last words of the cell: its note when it has one
  if (cell.note) return `${parts.join(' ')} <span class="note">${cell.note}${refs ? ` ${refs}` : ''}</span>`;
  return parts.join(' ') + (refs ? ` ${refs}` : '');
}

/** Two letters for a product's tile: its words' initials, or its first letter and next capital. No vendor logos. */
export function monogram(name) {
  const words = name.replace(/\bCMS\b/g, '').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0];
  const cap = /[A-Z]/.exec(w.slice(1))?.[0];
  const rest = name.slice(w.length).match(/[A-Z]/)?.[0];
  return w[0].toUpperCase() + (cap ?? rest ?? w[1]);
}

const kindOf = (id) => KINDS.find((k) => k.id === id);

/**
 * One product card: tile, name, kind, what it is, the CARD_FACTS as badges and words, and its "Markstage vs X"
 * page when there is one. Each fact is on its own line, so another product's licence never shares a line with
 * Markstage's name (scripts/lib/licence-words.mjs).
 */
export function productCard({ name, data, ref, root, pages, soonFor = () => '', tag = 'h3', cls = '' }) {
  const info = productInfo(name);
  const ms = name === MARKSTAGE;
  const tags = productTags(data, name);
  const tile = ms ? `<span class="tile ms" aria-hidden="true">${LOGO}</span>` : `<span class="tile ${info.kind}" aria-hidden="true">${e(monogram(name))}</span>`;
  const kind = ms ? 'Visual editor' : kindOf(info.kind).one;
  const facts = CARD_FACTS.map((f) => {
    const cell = findCell(data, name, f.feature);
    return `          <div class="fact"><dt>${e(f.label)}</dt><dd>${cellHtml(cell, ref, cell && soonFor(f.feature))}</dd></div>`;
  }).join('\n');
  const page = !ms && pages.has(info.slug) ? `${root}alternatives/${info.slug}/` : null;
  const link = page ? `\n        <p class="pcard-link"><a href="${page}">Markstage vs ${e(name)}</a></p>` : '';
  return `      <li class="pcard${ms ? ' ms' : ''}${cls ? ` ${cls}` : ''}" data-p="${ms ? 'markstage' : e(info.slug)}" data-k="${tags.join(' ')}">
        <div class="pcard-top">${tile}<div><${tag} class="pcard-name">${e(name)}</${tag}><p class="pcard-kind">${e(kind)}</p></div></div>
        <p class="pcard-what">${e(info.what)}</p>
        <dl class="facts">
${facts}
        </dl>${link}
      </li>`;
}

/** The "Markstage vs X" pair at the top of an alternatives page (null when X is not in the tables). */
export function cardPair({ name, data, ref, root, soonFor }) {
  if (!data || !name) return '';
  try {
    productInfo(name);
  } catch {
    return '';
  }
  if (!findCell(data, name, CARD_FACTS[0].feature)) return '';
  const card = (n) => productCard({ name: n, data, ref, root, pages: new Set(), soonFor: n === MARKSTAGE ? soonFor : () => '', tag: 'p' });
  return `      <ul class="pcards pair" aria-label="Markstage and ${e(name)} at a glance">
${card(MARKSTAGE)}
${card(name)}
      </ul>`;
}

/** The "How to choose" list of COMPARISON.md as tiles: "Pick WordPress if ...". */
export function verdictTiles(data, ref, root, pages) {
  return data.choose
    .map(({ name, nodes }) => {
      const info = name === MARKSTAGE ? null : productInfo(name);
      const href = info && pages.has(info.slug) ? `${root}alternatives/${info.slug}/` : null;
      const title = href ? `<a href="${href}">${e(name)}</a>` : e(name);
      return `        <li class="vtile${name === MARKSTAGE ? ' ms' : ''}"><p class="vtile-name">Pick <strong>${title}</strong></p><p>${inline(nodes, ref).trim()}</p></li>`;
    })
    .join('\n');
}

/** The segments of the filter, and which products each shows (Markstage always). */
export const SEGMENTS = [
  { id: 'all', label: 'All' },
  { id: 'lead', label: 'Lead three' },
  { id: 'git', label: 'Git-based' },
  { id: 'hosted', label: 'Hosted' },
  { id: 'app', label: 'Self-hosted apps' },
  { id: 'publishing', label: 'Publishing' },
];

/**
 * The filter bar (hidden until site/compare.js runs): one button per segment, and on tables the "only rows where
 * they differ" switch. Its state is in the address (?show=git&diff=1), so a link opens the same view.
 */
export function filterBar({ segments, diff = false, label = 'Show' }) {
  const buttons = SEGMENTS.filter((s) => segments.includes(s.id))
    .map((s) => `<button type="button" class="seg-btn" data-show="${s.id}" aria-pressed="${s.id === 'all'}">${e(s.label)}</button>`)
    .join('');
  const sw = diff ? `<label class="diff-switch"><input type="checkbox" data-diff /> Only rows where they differ</label>` : '';
  return `<div class="cmp-filter" hidden><span class="cmp-filter-label">${e(label)}</span><div class="seg" role="group" aria-label="${e(label)} products">${buttons}</div>${sw}<span class="cmp-filter-count" aria-live="polite"></span></div>`;
}

/**
 * A comparison table on one line (scripts/lib/licence-words.mjs reads a table's columns from one line): a sticky
 * header row and first column, a row of its own for each group heading, Markstage's column marked, every cell a
 * badge, a value, a muted note and its sources.
 */
export function comparisonTable({ caption, captionId, products, sections, data, ref, root, pages, soonFor = () => '' }) {
  const cols = products.length + 1;
  const head = products
    .map((p) => {
      const ms = p === MARKSTAGE;
      const info = productInfo(p);
      const href = !ms && pages.has(info.slug) ? `${root}alternatives/${info.slug}/` : null;
      const name = href ? `<a href="${href}">${e(p)}</a>` : e(p);
      return `<th scope="col" class="${ms ? 'ms' : 'pc'}" data-p="${ms ? 'markstage' : e(info.slug)}" data-k="${productTags(data, p).join(' ')}">${name}</th>`;
    })
    .join('');
  const bodies = sections
    .map((s) => {
      const rows = s.rows
        .map((r) => {
          const cells = products
            .map((p) => {
              const ms = p === MARKSTAGE;
              const cell = r.cells[p];
              const badge = ms ? soonFor(r.feature, cell) : '';
              return `<td class="${ms ? 'ms' : 'pc'}" data-p="${ms ? 'markstage' : e(productInfo(p).slug)}" data-m="${cell?.mark ?? 'val'}">${cellHtml(cell, ref, badge)}</td>`;
            })
            .join('');
          const note = r.featureNote ? `<span class="note">${r.featureNote}</span>` : '';
          return `<tr data-row="${e(slugify(r.feature))}"><th scope="row" class="feat">${e(r.feature)}${note}</th>${cells}</tr>`;
        })
        .join('');
      const id = s.id ? ` id="${e(s.id)}"` : '';
      return `<tbody><tr class="grp"${id}><th scope="colgroup" colspan="${cols}"><span>${e(s.title)}</span></th></tr>${rows}</tbody>`;
    })
    .join('');
  return `<div class="cmp-wrap" role="region" aria-labelledby="${e(captionId)}" tabindex="0"><table class="cmp" data-cols="${products.length}"><caption id="${e(captionId)}">${e(caption)}</caption><thead><tr><th scope="col" class="feat">Feature</th>${head}</tr></thead>${bodies}</table></div><p class="cmp-empty" hidden>No product of this kind is in this table. Choose All to see it again.</p>`;
}

/** The legend of the marks, as badges. */
export const legend = () =>
  `<ul class="mk-legend" aria-label="What the marks mean">${Object.values(MARKS)
    .map((m) => `<li>${markBadge(m.key)}</li>`)
    .join('')}</ul>`;

/**
 * The rows of the lead table in groups: each row goes under the ### heading Group A gives the same feature
 * (Group B's when A lacks it), "What you run" under hosting; groups in Group A's order.
 */
export function leadSections(data) {
  const where = new Map();
  for (const g of data.groups) for (const s of g.sections) for (const r of s.rows) if (!where.has(r.feature)) where.set(r.feature, s.title);
  const RENAME = { 'Editing and content': 'Editing', 'Hosting, price and licence': 'Hosting and price' };
  const order = data.groups[0].sections.map((s) => s.title);
  const groups = new Map(order.map((t) => [t, []]));
  for (const r of data.lead.rows) {
    let t = r.feature === 'What you run' ? 'Hosting and price' : where.get(r.feature) ?? 'Hosting and price';
    t = RENAME[t] ?? t;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(r);
  }
  return [...groups].filter(([, rows]) => rows.length).map(([title, rows]) => ({ title, rows }));
}
