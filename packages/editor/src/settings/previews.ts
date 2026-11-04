// Search engine and social card settings, each with a live preview: the title and description fields have
// character counters (60 / 160 by default) and show what is used when they are empty (the post title, the excerpt);
// the Google result and the social card are drawn from what is typed, before anything is saved.
import { copyable, siteUrl } from '../copy';
import { h } from '../panel-form';
import { config } from '../runtime';
import type { DrawnField, FieldCtx } from './fields';
import { textInput } from './fields';

export interface Fallbacks {
  /** the post title, the excerpt and the cover image (frontmatter keys) */
  title?: string;
  excerpt?: string;
  image?: string;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The site's address for previews: the configured one, else this server's. */
const site = () => (config().siteUrl || location.origin).replace(/\/+$/, '');

function group(label: string, parts: HTMLElement[]): HTMLElement {
  const box = h('section', 'ms-setgroup');
  box.append(Object.assign(h('h3', 'ms-setgroup__title'), { textContent: label }), ...parts);
  return box;
}

export function seoField(
  f: { label: string; title: string; description: string; titleMax?: number; descriptionMax?: number },
  ctx: FieldCtx,
  fb: Fallbacks,
): DrawnField {
  const get = (k?: string) => (k ? str(ctx.edits.get(k)) : '');
  const title = textInput({ key: f.title, label: 'Meta title', max: f.titleMax ?? 60 }, ctx, false, () => get(fb.title));
  const desc = textInput({ key: f.description, label: 'Meta description', max: f.descriptionMax ?? 160 }, ctx, true, () => get(fb.excerpt));
  const preview = h('div', 'ms-serp');
  preview.setAttribute('aria-label', 'Google result preview');
  const el = group(f.label, [title.el, desc.el, Object.assign(h('p', 'ms-setgroup__sub'), { textContent: 'Google result' }), preview]);
  const sync = () => {
    title.sync();
    desc.sync();
    const url = ctx.url();
    const host = new URL(site()).host.replace(/^www\./, '');
    const crumbs = (url ?? '/').split('/').filter(Boolean);
    preview.replaceChildren();
    const head = h('div', 'ms-serp__site');
    head.append(Object.assign(h('span', 'ms-serp__favicon'), { textContent: host.slice(0, 1).toUpperCase() }));
    const where = h('span', 'ms-serp__where');
    where.append(Object.assign(h('span', 'ms-serp__name'), { textContent: config().siteName }));
    where.append(Object.assign(h('span', 'ms-serp__url'), { textContent: [site(), ...crumbs].join(' › ') }));
    head.append(where);
    preview.append(
      head,
      Object.assign(h('div', 'ms-serp__title'), { textContent: cut(get(f.title) || get(fb.title), 60) }),
      Object.assign(h('div', 'ms-serp__desc'), { textContent: cut(get(f.description) || get(fb.excerpt), 160) }),
    );
    if (url) preview.append(copyable(`${site()}${url}`, { label: 'page URL', open: siteUrl(url), className: 'ms-copyable--url ms-serp__copy' }));
  };
  sync();
  return { el, sync, focus: title.focus };
}

export function socialField(f: { label: string; title: string; description: string; image: string }, ctx: FieldCtx, fb: Fallbacks & { seoTitle?: string; seoDescription?: string }): DrawnField {
  const get = (k?: string) => (k ? str(ctx.edits.get(k)) : '');
  const title = textInput({ key: f.title, label: 'Card title' }, ctx, false, () => get(fb.seoTitle) || get(fb.title));
  const desc = textInput({ key: f.description, label: 'Card description' }, ctx, true, () => get(fb.seoDescription) || get(fb.excerpt));
  const image = textInput({ key: f.image, label: 'Card image', hint: 'Empty: the cover image is used.' }, ctx, false, () => get(fb.image));
  image.el.querySelector('input')!.spellcheck = false;
  const card = h('div', 'ms-card');
  card.setAttribute('aria-label', 'Social card preview');
  const el = group(f.label, [Object.assign(h('p', 'ms-setgroup__sub'), { textContent: 'How a shared link looks' }), card, title.el, desc.el, image.el]);
  const sync = () => {
    title.sync();
    desc.sync();
    image.sync();
    const src = get(f.image) || get(fb.image);
    card.replaceChildren();
    const pic = h('div', 'ms-card__image');
    if (src) pic.append(Object.assign(h('img'), { src: ctx.media(src), alt: '' }));
    else pic.textContent = 'No image';
    const text = h('div', 'ms-card__text');
    text.append(
      Object.assign(h('span', 'ms-card__host'), { textContent: new URL(site()).host.toUpperCase() }),
      Object.assign(h('span', 'ms-card__title'), { textContent: cut(get(f.title) || get(fb.seoTitle) || get(fb.title), 90) }),
      Object.assign(h('span', 'ms-card__desc'), { textContent: cut(get(f.description) || get(fb.seoDescription) || get(fb.excerpt), 120) }),
    );
    card.append(pic, text);
  };
  sync();
  return { el, sync, focus: title.focus };
}
