// The site import in plain words (no DOM, so it is tested on its own): what a plan would do, what a run did, and the
// name of each kind of note in the review list.
import type { Counts, Product, SitePlan, SiteResult } from './api';

export const PRODUCT: Record<Product, string> = { wordpress: 'WordPress', ghost: 'Ghost', prismic: 'Prismic' };

const nf = new Intl.NumberFormat('en-US');
/** "1 post", "1,204 images" */
export const count = (n: number, one: string, many = `${one}s`) => `${nf.format(n)} ${n === 1 ? one : many}`;

/** A source's own word for a kind of item, as a count: post, page, blog_post (Prismic's custom types as they are). */
const kindWord = (t: string, n: number) => count(n, t.replace(/_/g, ' '));

export const COLLISION_WORD: Record<string, string> = { both: 'kept both', skip: 'skip', replace: 'replace' };

/**
 * The dry run in one line: "142 posts, 18 pages, 1,204 images; 6 slugs already exist (kept both); 31 images need alt
 * text; 4 blocks we could not convert".
 */
export function planSentence(plan: Pick<SitePlan, 'counts' | 'mapping' | 'media'>): string {
  const c: Counts = plan.counts;
  const files = plan.media.filter((m) => /\.pdf(?:$|[?#])/i.test(m.url)).length;
  const what = [...Object.entries(c.types).map(([t, n]) => kindWord(t, n)), count(plan.media.length - files, 'image'), ...(files ? [count(files, 'file')] : [])].join(', ');
  const parts = [what];
  if (c.collisions) parts.push(`${count(c.collisions, 'slug')} already ${c.collisions === 1 ? 'exists' : 'exist'} (${COLLISION_WORD[plan.mapping.onCollision]})`);
  if (c.needsAlt) parts.push(`${count(c.needsAlt, 'image')} ${c.needsAlt === 1 ? 'needs' : 'need'} alt text`);
  if (c.notConverted) parts.push(`${count(c.notConverted, 'block')} we could not convert`);
  return parts.join('; ');
}

const n = (o: Partial<Record<string, number>> | undefined, k: string) => o?.[k] ?? 0;

/** What the run would do, line by line. */
export function planLines(plan: SitePlan): string[] {
  const c = plan.counts;
  const lines = [
    `${count(n(c.entries, 'create'), 'entry', 'entries')} to create, ${nf.format(n(c.entries, 'update'))} to update, ${nf.format(n(c.entries, 'unchanged'))} unchanged, ${nf.format(n(c.entries, 'skip'))} left out.`,
    `${count(n(c.media, 'fetch'), 'image or file', 'images and files')} to bring in${n(c.media, 'reuse') ? `, ${nf.format(n(c.media, 'reuse'))} already here` : ''}${n(c.media, 'skip') ? `, ${nf.format(n(c.media, 'skip'))} that cannot come in` : ''}.`,
    `${count(n(c.authors, 'create'), 'new author')}${n(c.authors, 'existing') ? `, ${nf.format(n(c.authors, 'existing'))} already here` : ''}.`,
    `${count(c.redirects + c.ids, 'old address', 'old addresses')} will send visitors to the new pages.`,
  ];
  if (c.published) lines.push(`Everything comes in as a draft: ${count(c.published, 'entry that was published', 'entries that were published')} on ${PRODUCT[plan.product]} ${c.published === 1 ? 'is' : 'are'} ready to publish once checked.`);
  if (c.embeds) lines.push(`${count(c.embeds, 'embed')} (videos, maps) ${c.embeds === 1 ? 'is a link' : 'are links'} now.`);
  for (const [t, k] of Object.entries(c.left)) lines.push(`${kindWord(t, k)} left out: no collection is chosen for ${k === 1 ? 'it' : 'them'}.`);
  for (const [t, k] of Object.entries(c.other)) lines.push(`${kindWord(t, k)} not brought over (menus, forms and the like belong to the old site).`);
  return lines;
}

/** What the run did, line by line. */
export function resultLines(r: SiteResult, product: Product): string[] {
  const c = r.counts;
  const lines = [
    `${count(n(c.entries, 'create'), 'entry', 'entries')} created, ${nf.format(n(c.entries, 'update'))} updated, ${nf.format(n(c.entries, 'unchanged'))} unchanged, ${nf.format(n(c.entries, 'skip'))} left out.`,
    `${count(n(c.media, 'fetch'), 'image or file', 'images and files')} brought in${n(c.media, 'reuse') ? `, ${nf.format(n(c.media, 'reuse'))} already here` : ''}${n(c.media, 'skip') ? `, ${nf.format(n(c.media, 'skip'))} could not come in` : ''}.`,
    `${count(n(c.authors, 'create'), 'author')} added.`,
    `${count(c.redirects + c.ids, 'old address', 'old addresses')} now ${c.redirects + c.ids === 1 ? 'points' : 'point'} to the new pages; they go live with the next publish.`,
    `${count(c.commits, 'change')} in the site’s history, by you, from ${PRODUCT[product]}.`,
  ];
  return lines;
}

/** The review list's kinds, in the words the screen shows. */
export const REVIEW_KIND: Record<string, string> = {
  alt: 'Needs alt text',
  block: 'Block not converted',
  shortcode: 'Shortcode not converted',
  card: 'Card not converted',
  slice: 'Slice not converted',
  embed: 'Embed is a link now',
  html: 'Custom HTML: check it',
  image: 'Picture from another site',
  link: 'Link to a page not imported',
  file: 'Link to a file on the old site',
  collision: 'Address already taken',
  cover: 'Cover picture not kept',
  seo: 'Search title not kept',
  status: 'Was not public',
  author: 'More than one author',
  media: 'Could not be brought in',
};
export const reviewKind = (k: string) => REVIEW_KIND[k] ?? 'Check this';

/** An action in words for the tables. */
export const ACTION_WORD: Record<string, string> = { create: 'New', update: 'Update', unchanged: 'Unchanged', skip: 'Left out', fetch: 'Bring in', reuse: 'Already here', existing: 'Already here' };
