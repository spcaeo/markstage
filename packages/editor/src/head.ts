// What the canvas shows above the text: the block pack's `head` (the site's own title, byline and cover), or a plain
// title. The title is edited in place (title.ts); the byline, date and cover open Post settings at their field.
// The head is drawn from the frontmatter with the pending changes, so a new cover or date shows before saving.
import type { Entry } from './api';
import { getEntry } from './api';
import { assetUrl } from './assets';
import { imageKeys } from './field-access';
import type { HeadCtx } from './pack';
import { headImage } from './head-image';
import { fieldName } from './image-picker';
import { collection, config, editorPacks, type SettingField } from './runtime';
import type { FrontmatterEdits } from './settings/state';

type ImageField = Extract<SettingField, { type: 'image' }>;

export interface HeadHooks {
  /** the frontmatter as the writer sees it (saved plus pending changes) */
  frontmatter: Record<string, unknown>;
  title: (tag?: string, className?: string) => HTMLElement;
  /** opens Post settings at a frontmatter key */
  openSetting: (key: string) => void;
  edits: FrontmatterEdits;
  /** a frontmatter key the head draws in place (no redraw when it changes) */
  live: (key: string, sync?: () => void) => void;
  /** the page's own element for a part of the head (canvas-shell/page.ts), when the canvas is in the page */
  page?: (selector: string) => HTMLElement | null;
}

/** The title, and the collection's first image setting (its cover) under it, as `.post__cover` draws it. */
function plainHead(ctx: HeadCtx, coverKey: string | null): HTMLElement {
  const wrap = document.createElement('header');
  wrap.className = 'ms-dochead';
  wrap.append(ctx.title('h1', 'ms-dochead__title'));
  if (!coverKey) return wrap;
  const src = String(getPath(ctx.entry.frontmatter, coverKey) ?? '');
  let fig: HTMLElement | null = null;
  if (src) {
    fig = document.createElement('figure');
    fig.className = 'post__cover ms-dochead__cover';
    fig.append(Object.assign(document.createElement('img'), { src: ctx.media(src), alt: '' }));
  }
  wrap.append(ctx.image(fig, coverKey));
  return wrap;
}

const getPath = (o: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);

/** A frontmatter image path (relative to the media folder), a site path or a full URL -> what the browser loads. */
const mediaUrl = (src: string) => (/^(https?:)?\/\//.test(src) || src.startsWith('/') ? src : `${config().media?.url ?? '/'}${src}`);

/** Makes `el` a button that opens Post settings at `key`. */
function settingTarget(el: HTMLElement, key: string, label: string, open: (key: string) => void): HTMLElement {
  el.classList.add('ms-settarget');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.title = `${label}: change it in Post settings`;
  el.addEventListener('click', (e) => {
    e.preventDefault();
    open(key);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(key);
    }
  });
  return el;
}

/** Draws the head of `entry` into `slot` (the pack's when it has one). */
export async function drawHead(slot: HTMLElement, entry: Entry, hooks: HeadHooks): Promise<void> {
  const dir = collection(entry.collection)?.dir ?? '';
  const ctx: HeadCtx = {
    entry: { id: entry.id, collection: entry.collection, title: entry.title, url: entry.url, frontmatter: hooks.frontmatter },
    asset: (src) => assetUrl(src, dir),
    media: mediaUrl,
    getEntry: (c, id) => getEntry(c, id).catch(() => null),
    title: hooks.title,
    setting: (el, key, label = 'Setting') => settingTarget(el, key, label, hooks.openSetting),
    page: (selector) => hooks.page?.(selector) ?? null,
    image: (el, key) => {
      const f = collection(entry.collection)?.settings?.find((x): x is ImageField => x.type === 'image' && x.key === key);
      // a role that may not change every key the picture writes: a link to its (greyed-out) setting, no editing parts
      if (!f || !imageKeys(f).every((k) => hooks.edits.may(k))) return el ? settingTarget(el, key, 'Image', hooks.openSetting) : document.createElement('span');
      return headImage(el, f, { edits: hooks.edits, live: hooks.live, altName: f.altFallback ? fieldName(entry.collection, f.altFallback) : undefined });
    },
  };
  const pack = editorPacks().find((p) => p.head);
  const cover = collection(entry.collection)?.settings?.find((x) => x.type === 'image')?.key ?? null;
  let head: HTMLElement;
  try {
    head = pack ? await pack.head!(ctx) : plainHead(ctx, cover);
  } catch {
    head = plainHead(ctx, cover);
  }
  slot.replaceChildren(head);
}
