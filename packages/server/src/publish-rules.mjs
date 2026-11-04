// The publish rules of docs/SEO.md section 3, on the saved text: which findings stop a publish and which only warn
// (config publishRules: each 'block', 'warn' or 'off'). The publish sheet shows them; the publish and schedule routes
// enforce them, so a blocked entry cannot go live by another way.
//
//   altText     an image without a description (decorative images pass)                  default block
//   links       a link inside the site to a page that is not live, or to no page at all  default block
//   duplicates  the same search title or description as another live page               default block
//   headings    more than one H1 in the text, or a level skipped (H2 -> H4)               default warn

const textOf = (n) => (n?.text ?? '') + (n?.content ?? []).map(textOf).join('');
const squash = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Heading problems in the body: [{message, where}]. */
export function headingIssues(doc) {
  const out = [];
  let last = 0;
  let h1 = 0;
  (doc?.content ?? []).forEach((n, i) => {
    if (n.type !== 'heading') return;
    const level = Number(n.attrs?.level) || 1;
    const where = `block ${i + 1}`;
    const name = textOf(n).trim().slice(0, 60) || '(empty heading)';
    if (level === 1 && ++h1 === 2) out.push({ where, message: `A second main heading (H1): “${name}”. A page has one; make it an H2.` });
    if (last && level > last + 1) out.push({ where, message: `“${name}” is an H${level} right after an H${last}: an H${last + 1} is skipped.` });
    last = level;
  });
  return out;
}

/**
 * The search title and description (the seo field, else the title and excerpt) of an entry's fields.
 * `c.seo` = {title, description} keys from the site's settings; `c.fields` the collection's own keys.
 */
export function searchText(c, fields) {
  const get = (key) => (key ? key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), fields) : undefined);
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { title: str(get(c.seo?.title)) ?? str(get(c.fields.title)), description: str(get(c.seo?.description)) ?? str(get(c.fields.excerpt)) };
}

/**
 * An entry's address as a page (no host, query, hash or trailing slash), or null when it has none: an entry of a
 * collection without a URL (authors, menus) is not a page of the site.
 */
export function addressOf(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const bare = url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').replace(/[#?].*$/, '');
  return bare.length > 1 ? bare.replace(/\/+$/, '') : '/';
}

/**
 * Other live entries with the same search title or description: {title: [...], description: [...]}, each
 * [{collection, id, title}]. Drafts and scheduled entries do not count (they are not on the site), nor do entries
 * that are not pages: one with no URL, or one at this entry's own address (a topic whose address is its main
 * page's: one page, not two). `url` is this entry's; left out, only the others are looked at.
 */
export function duplicatesOf(store, c, id, fields, url) {
  const mine = searchText(c, fields);
  const out = { title: [], description: [] };
  if (!mine.title && !mine.description) return out;
  const here = url === undefined ? undefined : addressOf(url);
  if (here === null) return out;
  for (const other of store.collections) {
    for (const e of store.index(other).values()) {
      if (other.id === c.id && e.id === id) continue;
      const s = store.summaryOf(other, e);
      if ((s.status ?? 'published') !== 'published') continue;
      const there = addressOf(s.url);
      if (there === null || there === here) continue;
      const theirs = searchText(other, e.fields ?? {});
      for (const k of ['title', 'description']) {
        if (mine[k] && theirs[k] && squash(mine[k]) === squash(theirs[k])) out[k].push({ collection: other.id, id: e.id, title: s.title || e.id });
      }
    }
  }
  return out;
}

/** The rules' verdicts: [{rule, level, count, message}] for every rule with findings (level 'block' or 'warn'). */
export function verdicts(rules, found) {
  const out = [];
  const add = (rule, count, message) => {
    if (count && rules[rule] !== 'off') out.push({ rule, level: rules[rule], count, message });
  };
  add('altText', found.altText.length, `${found.altText.length} image${found.altText.length === 1 ? '' : 's'} without a description`);
  add('links', found.links.length, `${found.links.length} link${found.links.length === 1 ? '' : 's'} to a page that is not live or does not exist`);
  const dup = found.duplicates.title.length + found.duplicates.description.length;
  add('duplicates', dup, `the same ${[found.duplicates.title.length && 'search title', found.duplicates.description.length && 'description'].filter(Boolean).join(' and ')} as another page`);
  add('headings', found.headings.length, `${found.headings.length} heading problem${found.headings.length === 1 ? '' : 's'}`);
  return out;
}
