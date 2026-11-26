// The SEO head an SEO plugin draws for a page (Rank Math's GET /wp-json/rankmath/v1/getHead?url=<permalink>: {success,
// head}), read for what the import keeps: the title (og:title when there is no <title>), the description, robots, the
// share picture (og:image) and the canonical address. Only <title>, <meta> and <link> tags are read; JSON-LD and
// anything else in the head are left out. Pure.
import { attrsOf } from '../../library/html.mjs';
import { decodeEntities } from './bundle.mjs';

const MAX = 512 * 1024;

/** {title, description, robots, image, canonical} from the head's HTML; a value not there is null. */
export function readSeoHead(head) {
  const html = String(head ?? '').slice(0, MAX).replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  const metas = [...html.matchAll(/<meta\b([^<>]*)>/gi)].map((m) => attrsOf(m[1].replace(/\/\s*$/, '')));
  const meta = (key, value) => {
    const m = metas.find((x) => String(x[key] ?? '').toLowerCase() === value);
    const v = m?.content;
    // attrsOf has decoded the value's entities
    return typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null;
  };
  const title = /<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  const canonical = [...html.matchAll(/<link\b([^<>]*)>/gi)].map((m) => attrsOf(m[1].replace(/\/\s*$/, ''))).find((a) => String(a.rel ?? '').toLowerCase() === 'canonical')?.href;
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null);
  return {
    title: clean(decodeEntities(title ?? '')) ?? meta('property', 'og:title') ?? meta('name', 'twitter:title'),
    description: meta('name', 'description') ?? meta('property', 'og:description'),
    robots: meta('name', 'robots'),
    image: meta('property', 'og:image') ?? meta('name', 'twitter:image'),
    canonical: clean(canonical),
  };
}
