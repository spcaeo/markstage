// Image addresses in the content -> URLs the dev server serves. A path relative to the entry's file (as Markdown
// writes it) resolves from the entry's folder; a site path, a full URL or a data: URL stays as it is.
import { config, currentEntryDir } from './runtime';

export function assetUrl(src: string, fromDir = currentEntryDir()): string {
  if (!src || /^(https?:|\/|data:|blob:)/.test(src)) return src;
  return new URL(src, `http://repo/${fromDir.replace(/^\/+|\/+$/g, '')}/`).pathname;
}

/**
 * What to write in the content for an uploaded file at repo path `path` (src/assets/uploads/2026/10/x.webp): a path
 * relative to the entry's folder, as the site's other images are written; for media under public/, its site path.
 */
export function contentSrc(path: string, fromDir = currentEntryDir()): string {
  const p = path.replace(/^\/+/, '');
  if (p.startsWith('public/')) return `/${p.slice('public/'.length)}`;
  const from = fromDir.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const to = p.split('/');
  let k = 0;
  while (k < from.length && k < to.length - 1 && from[k] === to[k]) k++;
  return [...from.slice(k).map(() => '..'), ...to.slice(k)].join('/');
}

/** The repo folder uploads go to (config media.dir). */
export const mediaDir = () => config().media?.dir ?? (config().media?.url ?? '/src/assets/uploads/').replace(/^\/+|\/+$/g, '');

/** The frontmatter value for an uploaded file at repo path `path`: its path inside the media folder (2026/10/x.webp),
 * or the site path of a file under public/. */
export const mediaValue = (path: string) => {
  const dir = `${mediaDir()}/`;
  return path.startsWith(dir) ? path.slice(dir.length) : `/${path.replace(/^public\//, '')}`;
};
