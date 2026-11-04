// Small pieces the Authors screen draws in more than one place: an author's photo (or initials), and a post that
// names them, linked to the editor with its page address.
import { pageUrl, type Author, type AuthorPost } from '../../authors';
import { config } from '../../runtime';
import { el, link } from '../ui';

/** A stored picture (a path inside the media folder, a site path or an address) -> a URL the browser can show. */
export const mediaUrl = (src: string) => (/^(https?:)?\/\//.test(src) || src.startsWith('/') ? src : `${config().media?.url ?? '/'}${src}`);

const STATUS: Record<string, string> = { published: 'Live', draft: 'Draft', scheduled: 'Scheduled' };

const initials = (name: string) =>
  document.createTextNode(
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?',
  );

/** The author's photo (a media path or an address), or their initials when there is none or it does not load. */
export function avatar(a: Pick<Author, 'name' | 'photo'>, size = 40): HTMLElement {
  const box = el('span.ms-adm-avatar', { style: `--size:${size}px`, 'aria-hidden': 'true' });
  if (a.photo) {
    const img = el('img', { alt: '', loading: 'lazy', src: mediaUrl(a.photo) });
    img.addEventListener('error', () => img.replaceWith(initials(a.name)));
    box.append(img);
  } else box.append(initials(a.name));
  return box;
}

/** A post that names the author: its title opens it in the editor; its page address can be copied and opened. */
export function postRow(p: AuthorPost): HTMLElement {
  const label = config().collections.find((c) => c.id === p.collection)?.label ?? p.collection;
  return el(
    'li.ms-adm-authorpost',
    el('a', { href: `#/e/${encodeURIComponent(p.collection)}/${encodeURIComponent(p.id)}` }, p.title),
    el('span.ms-adm-sub', `${label} · ${STATUS[p.status] ?? p.status}${p.role === 'co-author' ? ' · co-author' : ''}`),
    p.url ? link(pageUrl(p.url), 'page URL', 'ms-adm-sub') : null,
  );
}
