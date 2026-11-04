// #/gallery/<collection>?w=both|1440|390&theme=dark&kind=<type>&s=<sample>&whole=<sample>: every section type and
// variation the site's pages use or its schema declares, each drawn alone by the site's own components (a throwaway
// page in the preview's private clone, GET preview/gallery/:c), framed from the preview origin at 1440 and 390 px,
// light or dark. The preview agent (gallery/agent.ts) hides the rest of the page and says how tall the section is;
// "Whole page" shows the page around it. For developers and reviewers: nothing here changes the site.
import { ApiError, request } from '../api';
import { button, chips, el, failure, link, page, state } from '../admin/ui';
import type { ScreenCtx } from '../host';
import { humanize } from '../pages/schema';
import { config } from '../runtime';

interface Sample {
  key: string;
  kind: string;
  variant: string | null;
  from: { id: string; title: string; url: string | null; index: number } | null;
  path: string;
  url: string;
}
interface Gallery {
  collection: string;
  samples: Sample[];
  problems: { kind: string; variant: string | null; message: string }[];
}

/** The two widths, each with the height of its screen (the frame's height until the section says its own). */
const SCREENS = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
] as const;

export const sampleLabel = (s: { kind: string; variant: string | null }) => `${humanize(s.kind)}${s.variant ? ` · ${s.variant}` : ''}`;

/** Sets a frame's src when it comes within a screen of the viewport, one at a time, so a phone is not flooded. */
const watching = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((hits) => {
      for (const h of hits) {
        const f = h.target as HTMLIFrameElement;
        if (!h.isIntersecting || !f.dataset.src) continue;
        f.src = f.dataset.src;
        delete f.dataset.src;
        watching?.unobserve(f);
      }
    }, { rootMargin: '600px 0px' })
  : null;
function watchFrame(frame: HTMLIFrameElement): void {
  if (watching) watching.observe(frame);
  else {
    frame.src = frame.dataset.src!;
    delete frame.dataset.src;
  }
}

export function mountGallery(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Section gallery', 'Every section type and variation the site’s pages use, each drawn alone by the site’s own components. Sample text is marked; the rest comes from a real page.');
  ctx.setTitle('Section gallery');
  let collections: { id: string; label: string }[] = [];
  let data: Gallery | null = null;
  /** each sample's frames: what the page says goes to the frame it came from */
  let frames: { win: () => Window | null; frame: HTMLIFrameElement; box: HTMLElement; sample: Sample; w: number; h: number }[] = [];
  let drawnFor = '';
  const dark = config().themes?.dark ?? null;

  const params = () => {
    const q = ctx.params();
    const w = q.get('w');
    return { w: w === '1440' || w === '390' ? w : 'both', theme: dark && q.get('theme') === 'dark' ? 'dark' : 'light', kind: q.get('kind') ?? '', s: q.get('s'), whole: q.get('whole') };
  };

  /** What each frame is told when its page loads, and again when the theme or "Whole page" changes. */
  function tell(f: (typeof frames)[number]) {
    const win = f.win();
    if (!win) return;
    const origin = new URL(f.sample.url).origin;
    const q = params();
    if (dark) win.postMessage({ markstage: 'theme', attr: dark.attr, value: dark.value, on: q.theme === 'dark' }, origin);
    win.postMessage({ markstage: 'gallery', alone: q.whole !== f.sample.key }, origin);
  }

  const onMessage = (e: MessageEvent) => {
    const f = frames.find((x) => x.win() === e.source);
    if (!f || e.origin !== new URL(f.sample.url).origin) return;
    const msg = e.data as { markstage?: string; found?: boolean; height?: number } | null;
    if (msg?.markstage === 'rendered') tell(f);
    else if (msg?.markstage === 'gallery:shown') {
      const whole = params().whole === f.sample.key;
      const h = !whole && msg.found && Number.isFinite(msg.height) ? Math.max(40, Math.min(8000, Number(msg.height))) : f.h;
      f.frame.style.height = `${h}px`;
      size(f, h);
      f.box.closest('.ms-gallery__item')?.querySelector('.ms-gallery__nomark')?.toggleAttribute('hidden', !!msg.found);
    }
  };
  window.addEventListener('message', onMessage);

  /** The scale that fits a frame of width w in its column. */
  function scaleOf(w: number): number {
    const avail = (p.body.clientWidth || 1000) - 2;
    const both = params().w === 'both';
    const room = both ? (w === 1440 ? avail * 0.7 : avail * 0.27) : avail;
    return Math.min(1, room / w);
  }
  function size(f: (typeof frames)[number], h: number) {
    const s = scaleOf(f.w);
    f.frame.style.transform = `scale(${s})`;
    f.box.style.width = `${Math.round(f.w * s)}px`;
    f.box.style.height = `${Math.round(h * s)}px`;
  }
  const resize = new ResizeObserver(() => frames.forEach((f) => size(f, parseFloat(f.frame.style.height) || f.h)));
  resize.observe(p.body);

  function item(s: Sample): HTMLElement {
    const q = params();
    const whole = q.whole === s.key;
    const from = s.from
      ? el('span.ms-gallery__from', 'From “', s.from.title, '” ', s.from.url ? link(s.from.url, `the address of ${s.from.title}`) : '', el('a.ms-adm-sub', { href: `#/p/${encodeURIComponent(data!.collection)}/${encodeURIComponent(s.from.id)}?sec=${s.from.index}` }, 'Edit it there'))
      : el('span.ms-gallery__sample', { title: 'No page uses this yet: the words are placeholders' }, 'Sample text');
    const toggle = button(whole ? 'Section only' : 'Whole page', () => ctx.go({ params: { whole: whole ? null : s.key, s: s.key } }), { small: true, kind: 'quiet', icon: whole ? 'sections' : 'file' });
    const widths = SCREENS.filter((x) => q.w === 'both' || String(x.w) === q.w);
    const row = el('div.ms-gallery__frames');
    for (const x of widths) {
      // the page loads once the frame comes on screen (QA F21: every frame at once overwhelmed a phone)
      const frame = el('iframe.ms-gallery__frame', { 'data-src': s.url, loading: 'lazy', title: `${sampleLabel(s)} at ${x.w} px`, width: String(x.w), height: String(x.h) });
      watchFrame(frame);
      frame.style.width = `${x.w}px`;
      frame.style.height = `${x.h}px`;
      const box = el('div.ms-gallery__box', frame);
      const f = { win: () => frame.contentWindow, frame, box, sample: s, w: x.w, h: x.h };
      frames.push(f);
      row.append(el('figure.ms-gallery__screen', el('figcaption.ms-adm-sub', `${x.w} px`), box));
    }
    const nomark = el('p.ms-gallery__nomark.ms-adm-sub', { hidden: true }, 'This page has no section marker (data-ms-section), so the whole page is shown.');
    const card = el(`section.ms-gallery__item${q.s === s.key ? '.is-current' : ''}`, { id: `s-${s.key}`, 'data-key': s.key }, el('header.ms-gallery__head', el('h2.ms-adm-h2', sampleLabel(s)), from, el('span.ms-gallery__actions', toggle, link(s.url, `the sample page of ${sampleLabel(s)}`))), nomark, row);
    return card;
  }

  function draw() {
    if (!data) return;
    const q = params();
    const kinds = [...new Set(data.samples.map((s) => s.kind))];
    const count = (k: string) => data!.samples.filter((s) => s.kind === k).length;
    p.bar.hidden = false;
    p.bar.replaceChildren(
      collections.length > 1 ? chips(ctx, 'c', 'Collection', collections.map((c) => [c.id, c.label])) : '',
      chips(ctx, 'w', 'Width', [['', '1440 and 390'], ['1440', '1440 px'], ['390', '390 px']]),
      dark ? chips(ctx, 'theme', 'Colours', [['', 'Light'], ['dark', 'Dark']]) : '',
      chips(ctx, 'kind', 'Type', [['', `All (${data.samples.length})`], ...kinds.map((k): [string, string] => [k, `${humanize(k)} (${count(k)})`])]),
    );
    const key = JSON.stringify([data.collection, q.w, q.kind, q.whole, data.samples.length]);
    // the theme alone changes nothing but the pages: tell the frames, keep them
    if (key === drawnFor) {
      frames.forEach(tell);
      for (const c of p.body.querySelectorAll<HTMLElement>('.ms-gallery__item')) c.classList.toggle('is-current', c.dataset.key === q.s);
      return;
    }
    drawnFor = key;
    frames = [];
    const shown = data.samples.filter((s) => !q.kind || s.kind === q.kind);
    const problems = data.problems.length
      ? el('section.ms-adm-card', el('h2.ms-adm-h2', 'Not shown'), el('ul', ...data.problems.map((x) => el('li', `${sampleLabel(x)}: ${x.message}`))))
      : '';
    p.body.replaceChildren(problems, shown.length ? el('div.ms-gallery', ...shown.map(item)) : state('empty', 'No sections', 'No page of this collection has sections yet.'));
    if (q.s) document.getElementById(`s-${q.s}`)?.scrollIntoView({ block: 'start' });
  }

  async function load() {
    p.body.replaceChildren(state('loading', 'Building the samples…'));
    try {
      collections = (await request<{ collections: { id: string; label: string }[] }>('preview/gallery')).collections;
      const c = collections.find((x) => x.id === ctx.args[0]) ?? collections[0];
      if (!c) return void p.body.replaceChildren(state('empty', 'No page sections', 'No collection of this site has pages made of sections.'));
      if (ctx.args[0] !== c.id) ctx.go({ args: [c.id] });
      data = await request<Gallery>(`preview/gallery/${encodeURIComponent(c.id)}`);
      drawnFor = '';
      draw();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return void p.body.replaceChildren(state('empty', 'The gallery needs the preview', e.message));
      if (e instanceof ApiError && e.status === 404 && !collections.length) return void p.body.replaceChildren(state('empty', 'The gallery needs the Markstage server', 'It draws the samples through the server’s preview of the site.'));
      p.body.replaceChildren(failure(e, () => void load()));
    }
  }
  void load();

  return {
    update(next: ScreenCtx) {
      ctx = next;
      if (data && next.args[0] && next.args[0] !== data.collection) return void load();
      const c = next.params().get('c');
      if (c && c !== data?.collection) return void ctx.go({ args: [c], params: { c: null, kind: null, s: null, whole: null } });
      draw();
    },
    destroy() {
      window.removeEventListener('message', onMessage);
      resize.disconnect();
    },
  };
}
