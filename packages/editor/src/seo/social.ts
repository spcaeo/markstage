// How a shared link looks: the share image cut the way each place cuts it (Facebook and LinkedIn 1.91:1, X 2:1, a
// chat app's square thumbnail), around the image's focal point when the site keeps one, with the title and the
// site's address. The image's own shape is measured: one far from 1.91:1 loses its sides or gets bars.
import { h } from '../panel-form';

export interface ShareCard {
  image: string;
  /** the image's alt text (og:image:alt) */
  alt: string;
  title: string;
  description: string;
  host: string;
  /** "x% y%", the part of the image that stays in view */
  focal: string;
}

const SHAPES = [
  { id: 'wide', label: 'Facebook, LinkedIn', ratio: 1.91 },
  { id: 'x', label: 'X (Twitter)', ratio: 2 },
  { id: 'chat', label: 'Chat apps (WhatsApp, iMessage)', ratio: 1 },
] as const;

/** The image's size once loaded (null when it does not load). */
export const imageSize = (src: string) =>
  new Promise<{ w: number; h: number } | null>((done) => {
    const img = new Image();
    img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => done(null);
    img.src = src;
  });

/** What the image's shape and size mean for sharing. */
export function shapeNote(size: { w: number; h: number } | null): { level: 'ok' | 'warn' | 'error'; text: string } {
  if (!size) return { level: 'error', text: 'The share image does not load.' };
  const r = size.w / size.h;
  const what = `${size.w} × ${size.h} px, ${r.toFixed(2)}:1`;
  if (size.w < 600) return { level: 'error', text: `${what}: under 600 px wide, Facebook and LinkedIn show it as a small thumbnail. Use 1200 × 630.` };
  if (Math.abs(r - 1.91) > 0.15) return { level: 'warn', text: `${what}: Facebook and LinkedIn cut it to 1.91:1, so ${r > 1.91 ? 'its sides are lost' : 'its top and bottom are lost'}. The previews show the cut; 1200 × 630 fits.` };
  return { level: 'ok', text: `${what}: fits Facebook and LinkedIn.` };
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The three previews. */
export function sharePreviews(c: ShareCard): HTMLElement {
  const box = h('div', 'ms-seo-share');
  for (const s of SHAPES) {
    const card = h('figure', `ms-seo-share__card ms-seo-share__card--${s.id}`);
    const pic = h('div', 'ms-seo-share__img');
    pic.style.aspectRatio = String(s.ratio);
    if (c.image) {
      const img = Object.assign(h('img'), { src: c.image, alt: c.alt, loading: 'lazy' as const });
      img.style.objectPosition = c.focal || '50% 50%';
      pic.append(img);
    } else pic.textContent = 'No image';
    const text = h('div', 'ms-seo-share__text');
    if (s.id === 'wide') text.append(Object.assign(h('span', 'ms-seo-share__host'), { textContent: c.host.toUpperCase() }));
    text.append(Object.assign(h('strong', 'ms-seo-share__title'), { textContent: cut(c.title, s.id === 'chat' ? 70 : 90) }));
    if (s.id === 'wide' && c.description) text.append(Object.assign(h('span', 'ms-seo-share__desc'), { textContent: cut(c.description, 110) }));
    if (s.id !== 'wide') text.append(Object.assign(h('span', 'ms-seo-share__host'), { textContent: c.host }));
    card.append(pic, text, Object.assign(h('figcaption', 'ms-seo-share__label'), { textContent: s.label }));
    box.append(card);
  }
  return box;
}
