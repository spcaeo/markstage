// The SEO check's sections about the built page: "What Google sees" (the head's search tags and each structured
// data item as a card, with what Google requires and recommends) and "When shared" (the share image as each place
// cuts it). They read the page the site serves (seo/google.ts), so they show the last saved version.
import { copyable } from '../copy';
import { h } from '../panel-form';
import { config } from '../runtime';
import { judge, RICH, testers, type BuiltPage } from './google';
import { imageSize, shapeNote, sharePreviews } from './social';
import type { Finding } from './text';
import { note, rows } from './view';

/** An address of the live site as this server serves it (the dev server, when the page names the live site). */
export function here(url: string): string {
  const site = config().siteUrl?.replace(/\/+$/, '');
  return site && url.startsWith(site) ? `${location.origin}${url.slice(site.length)}` : url;
}

/** The live address of a page path. */
export const live = (path: string) => `${(config().siteUrl || location.origin).replace(/\/+$/, '')}${path}`;

/** A page's address as Google shows it in a result: the live site's host, then the path's parts
 *  ("example.com › guides › setup"), never the address this editor runs on. */
export function crumbs(path: string): string {
  const host = new URL(config().siteUrl || location.origin).host.replace(/^www\./, '');
  return [host, ...path.split(/[?#]/)[0]!.split('/').filter(Boolean).map(decodeURIComponent)].join(' › ');
}

const value = (label: string, v: string, url = false) => {
  const el = h('div', 'ms-seo-kv');
  el.append(Object.assign(h('span', 'ms-seo-kv__k'), { textContent: label }));
  el.append(v ? copyable(v, { label, open: url ? here(v) : undefined, className: url ? 'ms-copyable--url ms-seo-kv__v' : 'ms-seo-kv__v' }) : Object.assign(h('span', 'ms-seo-kv__v is-none'), { textContent: 'none' }));
  return el;
};

/** "What Google sees": returns its findings (for the section's count). */
export function drawGoogle(body: HTMLElement, p: BuiltPage, path: string): Finding[] {
  body.replaceChildren();
  const found: Finding[] = [];
  const head = h('div', 'ms-seo-kvs');
  head.append(value('Title', p.title), value('Description', p.description), value('Canonical', p.canonical, true), value('Robots', p.robots || 'index, follow (no tag)'));
  body.append(head);
  if (/noindex/i.test(p.robots)) found.push({ level: 'warn', text: 'The page asks search engines not to list it (noindex).' });
  if (p.canonical && p.canonical.replace(/\/+$/, '') !== live(path).replace(/\/+$/, ''))
    found.push({ level: 'warn', text: `The canonical address is another page (${p.canonical}): search engines list that one instead.` });
  if (p.h1.length !== 1) found.push({ level: 'warn', text: p.h1.length ? `The page has ${p.h1.length} main headings (H1); one is best.` : 'The page has no main heading (H1).' });
  if (p.broken) found.push({ level: 'error', text: `${p.broken} structured data block${p.broken === 1 ? ' is' : 's are'} not valid JSON: search engines skip ${p.broken === 1 ? 'it' : 'them'}.` });
  if (!p.items.length) found.push({ level: 'warn', text: 'No structured data (JSON-LD): search engines guess what the page is.' });
  // the items that only describe the page or the site (WebPage, Organization, Person…) are named in one line
  const plain = h('div', 'ms-seo-also');
  for (const item of p.items) {
    const j = judge(item, p.h1);
    if (!RICH.has(item.type) && !j.errors.length && !j.warnings.length) {
      plain.append(copyable(item.type, { label: `${item.type} JSON-LD`, copy: JSON.stringify(item.data, null, 2), className: 'ms-seo-also__item' }));
      continue;
    }
    const card = h('article', `ms-seo-schema${j.errors.length ? ' is-error' : j.warnings.length ? ' is-warn' : ''}`);
    const top = h('div', 'ms-seo-schema__top');
    top.append(Object.assign(h('strong', 'ms-seo-schema__type'), { textContent: item.type }), copyable(JSON.stringify(item.data, null, 2), { label: `${item.type} JSON-LD`, iconsOnly: true }));
    card.append(top, Object.assign(h('p', 'ms-seo-schema__about'), { textContent: j.about }));
    for (const [k, v] of j.fields) card.append(value(k, v, /^https?:\/\//.test(v)));
    const mine: Finding[] = [...j.errors.map((text) => ({ level: 'error' as const, text: `${item.type}: ${text}` })), ...j.warnings.map((text) => ({ level: 'warn' as const, text: `${item.type}: ${text}` }))];
    rows(card, mine);
    if (j.note) card.append(note(j.note));
    found.push(...mine);
    body.append(card);
  }
  if (plain.childElementCount) {
    plain.prepend(Object.assign(h('span', 'ms-seo-also__k'), { textContent: 'Also describes the page:' }));
    body.append(plain);
  }
  const tools = h('div', 'ms-seo-tools');
  for (const t of testers(live(path))) {
    const a = Object.assign(h('a', 'ms-btn ms-btn--sm'), { href: t.url, target: '_blank', rel: 'noopener', textContent: t.label });
    a.title = `${t.label} for the live page (it reads what is published)`;
    tools.append(a);
  }
  body.append(tools);
  return found;
}

export interface ShareFallback {
  image: string;
  title: string;
  description: string;
  focal: string;
}

/** "When shared": returns its findings. The built page's og tags, else the fields (`fb`) before a save. */
export async function drawShare(body: HTMLElement, p: BuiltPage | null, fb: ShareFallback): Promise<Finding[]> {
  const image = here(p?.meta['og:image'] || fb.image);
  const title = p?.meta['og:title'] || fb.title;
  const desc = p?.meta['og:description'] || fb.description;
  const host = new URL(config().siteUrl || location.origin).host.replace(/^www\./, '');
  const found: Finding[] = [];
  const size = image ? await imageSize(image) : null;
  if (!image) found.push({ level: 'warn', text: 'No share image: the link shows as text only. Add a cover or a card image.' });
  else {
    const n = shapeNote(size);
    found.push({ level: n.level, text: n.text });
    if (p && !p.meta['og:image:alt']) found.push({ level: 'warn', text: 'The share image has no description (og:image:alt).' });
  }
  if (p && !p.meta['twitter:card']) found.push({ level: 'warn', text: 'No twitter:card tag: X shows a small card.' });
  body.replaceChildren();
  rows(body, found);
  body.append(sharePreviews({ image, alt: p?.meta['og:image:alt'] ?? '', title, description: desc, host, focal: fb.focal }));
  return found;
}
