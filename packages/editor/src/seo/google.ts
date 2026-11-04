// "What Google sees": the built page (the site's own HTML, as a search engine fetches it) read for its search title
// and description, canonical, robots, social tags and structured data (JSON-LD), and each structured data item
// judged by Google's required and recommended properties for its rich result. Nothing here guesses from the source:
// the page is fetched from the site (in dev mode the dev server, so it shows the last saved version).

export interface SchemaItem {
  type: string;
  data: Record<string, unknown>;
}

export interface BuiltPage {
  url: string;
  title: string;
  description: string;
  canonical: string;
  robots: string;
  h1: string[];
  /** og:*, twitter:*, article:* */
  meta: Record<string, string>;
  items: SchemaItem[];
  /** each JSON-LD block as written */
  raw: string[];
  /** blocks that are not valid JSON */
  broken: number;
}

const typeOf = (v: unknown): string => {
  const t = (v as { '@type'?: unknown })?.['@type'];
  return Array.isArray(t) ? String(t[0] ?? '') : String(t ?? '');
};

/** Reads the built page at `url`. */
export async function readBuilt(url: string): Promise<BuiltPage> {
  const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok) throw new Error(`the page answered ${r.status}`);
  const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  const meta: Record<string, string> = {};
  for (const m of doc.querySelectorAll<HTMLMetaElement>('meta[property], meta[name]')) {
    const k = m.getAttribute('property') ?? m.getAttribute('name') ?? '';
    if (/^(og|twitter|article):/.test(k) && !(k in meta)) meta[k] = m.content;
  }
  const items: SchemaItem[] = [];
  const raw: string[] = [];
  let broken = 0;
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const text = s.textContent ?? '';
    raw.push(text);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      broken++;
      continue;
    }
    const add = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(add);
      if (!v || typeof v !== 'object') return;
      const graph = (v as { '@graph'?: unknown })['@graph'];
      if (Array.isArray(graph)) return graph.forEach(add);
      items.push({ type: typeOf(v) || 'Thing', data: v as Record<string, unknown> });
    };
    add(json);
  }
  return {
    url,
    title: doc.title.trim(),
    description: doc.querySelector<HTMLMetaElement>('meta[name="description"]')?.content.trim() ?? '',
    canonical: doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href') ?? '',
    robots: doc.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? '',
    h1: [...doc.querySelectorAll('h1')].map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').trim()),
    meta,
    items,
    raw,
    broken,
  };
}

/** Types with a rich result of their own (or one Google retired): these get a card; the rest are listed by name. */
export const RICH = new Set(['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'FAQPage', 'BreadcrumbList', 'VideoObject', 'Product', 'HowTo', 'Review', 'AggregateRating']);

export interface Judged {
  /** what the item is for, in plain words */
  about: string;
  /** a few of its values, as the card lists them */
  fields: [string, string][];
  errors: string[];
  warnings: string[];
  /** what Google does with it today */
  note?: string;
}

const str = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(', ');
  const o = v as Record<string, unknown>;
  return str(o.name ?? o.headline ?? o.url ?? o['@id'] ?? o.text ?? '');
};
const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!str(v).trim());
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const ARTICLE = new Set(['Article', 'BlogPosting', 'NewsArticle', 'TechArticle']);

/** Google's required (errors) and recommended (warnings) properties for the item's rich result. `h1`: the page's
 *  visible main heading, which an article's headline should match. */
export function judge(item: SchemaItem, h1: string[]): Judged {
  const d = item.data;
  const t = item.type;
  const errors: string[] = [];
  const warnings: string[] = [];
  const need = (keys: string[], into: string[], what = 'Missing') => {
    for (const k of keys) if (!filled(d[k])) into.push(`${what} ${k}.`);
  };
  const fields = (keys: string[]): [string, string][] => keys.filter((k) => filled(d[k])).map((k) => [k, short(str(d[k]))]);
  if (ARTICLE.has(t)) {
    need(['headline', 'image', 'datePublished', 'dateModified', 'author'], warnings, 'Recommended:');
    for (const a of list(d.author)) if (!str(a.name)) warnings.push('An author has no name.');
    const head = str(d.headline);
    if (head && h1.length && !h1.some((h) => squash(h) === squash(head))) warnings.push(`The headline differs from the page's H1 (“${short(h1[0]!, 70)}”). Google may show either; keep them the same.`);
    return { about: 'An article: its headline, image, dates and author can show in search and in Google News.', fields: fields(['headline', 'datePublished', 'dateModified', 'author', 'image', 'description']), errors, warnings };
  }
  if (t === 'FAQPage') {
    const qs = list(d.mainEntity);
    if (!qs.length) errors.push('Missing mainEntity: the questions.');
    qs.forEach((q, i) => {
      if (!str(q.name)) errors.push(`Question ${i + 1} has no name (the question).`);
      if (!str((q.acceptedAnswer as Record<string, unknown> | undefined)?.text)) errors.push(`Question ${i + 1} has no acceptedAnswer text.`);
    });
    return {
      about: `Questions and answers (${qs.length}).`,
      fields: qs.slice(0, 4).map((q, i) => [`Q${i + 1}`, short(str(q.name), 80)]),
      errors,
      warnings,
      note: 'Google shows FAQ results only for well-known government and health sites now. It still tells search engines and AI answers what the page answers.',
    };
  }
  if (t === 'BreadcrumbList') {
    const items = list(d.itemListElement);
    if (!items.length) errors.push('Missing itemListElement: the steps of the trail.');
    items.forEach((it, i) => {
      if (!filled(it.position)) errors.push(`Step ${i + 1} has no position.`);
      if (!str(it.name) && !str((it.item as Record<string, unknown> | undefined)?.name)) errors.push(`Step ${i + 1} has no name.`);
      if (i < items.length - 1 && !filled(it.item)) errors.push(`Step ${i + 1} has no item (its address); only the last step may leave it out.`);
    });
    return { about: 'The breadcrumb trail Google shows above the result.', fields: [['trail', items.map((it) => str(it.name) || str(it.item)).join(' › ')]], errors, warnings };
  }
  if (t === 'VideoObject') {
    need(['name', 'thumbnailUrl', 'uploadDate'], errors);
    need(['description', 'duration'], warnings, 'Recommended:');
    if (!filled(d.contentUrl) && !filled(d.embedUrl)) warnings.push('Recommended: contentUrl or embedUrl.');
    return { about: 'A video: it can show with its thumbnail in search and in Videos.', fields: fields(['name', 'uploadDate', 'duration', 'embedUrl']), errors, warnings };
  }
  if (t === 'Product') {
    need(['name'], errors);
    if (!filled(d.offers) && !filled(d.review) && !filled(d.aggregateRating)) errors.push('A product needs offers, review or aggregateRating.');
    return { about: 'A product: price and availability can show in search.', fields: fields(['name', 'brand', 'offers']), errors, warnings };
  }
  if (t === 'Organization' || t === 'LocalBusiness' || t === 'Corporation') {
    need(['name', 'url', 'logo'], warnings, 'Recommended:');
    return { about: 'Who runs the site: its name and logo for Google’s knowledge panel.', fields: fields(['name', 'url', 'logo', 'sameAs']), errors, warnings };
  }
  if (t === 'HowTo') return { about: 'Steps.', fields: fields(['name']), errors, warnings, note: 'Google no longer shows HowTo results; it does no harm.' };
  if (t === 'Review' || t === 'AggregateRating')
    return { about: 'A rating.', fields: fields(['ratingValue', 'reviewCount', 'author']), errors, warnings, note: 'Ratings must be real ones from real people; Google penalises made-up or self-written ratings.' };
  return { about: 'Describes the page for search engines; no rich result of its own.', fields: fields(['name', 'headline', 'url', 'description']), errors, warnings };
}

/** Google's Rich Results Test and the Schema.org validator for a live address. */
export const testers = (live: string) => [
  { label: 'Rich Results Test', url: `https://search.google.com/test/rich-results?url=${encodeURIComponent(live)}` },
  { label: 'Schema validator', url: `https://validator.schema.org/#url=${encodeURIComponent(live)}` },
];
