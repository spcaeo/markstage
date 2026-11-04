// Responsive checks, measured on the live page in the device frame (no imports: the same code can run inside a
// preview page on another origin, see agent.ts). Four kinds:
// - overflow: something is wider than the screen, so the page scrolls sideways or cuts it off;
// - image: an image, video or embed wider than the screen;
// - tap: a link or button smaller than 24 x 24 px without room around it (WCAG 2.5.8; links inside a sentence
//   are exempt, as WCAG exempts them);
// - font: text set under 12 px.
// What scrolls inside its own box (a table in a scrolling wrapper) is fine and not reported.

export type IssueKind = 'overflow' | 'image' | 'tap' | 'font';

export interface Issue {
  /** finds the element again (reveal) while the page is not reloaded */
  id: number;
  kind: IssueKind;
  /** what is wrong, in numbers */
  text: string;
  /** which element: tag and its text or address */
  label: string;
}

export interface Measured {
  width: number;
  /** how far the page scrolls sideways (0: it fits) */
  sideways: number;
  issues: Issue[];
}

const TAP = 24;
const FONT = 12;
const TARGETS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
const MEDIA = 'img, video, iframe, svg, canvas, embed, object';
const SKIP = 'script, style, noscript, template, astro-dev-toolbar, astro-dev-overlay, vite-error-overlay';

let found: Element[] = [];
let mark: HTMLElement | null = null;

const short = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function labelOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const src = el.getAttribute('src') ?? el.getAttribute('href');
  const text = short((el as HTMLElement).innerText ?? el.textContent ?? '');
  const alt = el.getAttribute('alt') ?? el.getAttribute('aria-label') ?? el.getAttribute('title');
  if (tag === 'img' || tag === 'video' || tag === 'iframe') return `${tag} ${short(alt || (src ?? '').split('/').pop() || '', 50)}`.trim();
  if (text) return `${tag} “${text}”`;
  if (alt) return `${tag} “${short(alt)}”`;
  if (src) return `${tag} ${short(src)}`;
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
  return cls ? `${tag}.${cls}` : tag;
}

function add(out: Issue[], kind: IssueKind, el: Element, text: string): void {
  out.push({ id: found.push(el) - 1, kind, text, label: labelOf(el) });
}

/** Laid out: has a box, is not hidden, and is not a 1 px "for screen readers only" box. (Transparent is still
 *  laid out: boxes that fade in as they scroll into view take their room before they show.) */
function shown(win: Window, el: Element, r: DOMRect): boolean {
  if (r.width < 2 && r.height < 2) return false;
  const s = win.getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
}

/** Inside a box that scrolls or clips sideways (below <body>): it cannot widen the page. */
function contained(win: Window, el: Element): boolean {
  const body = win.document.body;
  for (let p = el.parentElement; p && p !== body; p = p.parentElement) {
    const o = win.getComputedStyle(p).overflowX;
    if (o !== 'visible') return true;
  }
  return false;
}

function fixed(win: Window, el: Element): boolean {
  for (let p: Element | null = el; p && p !== win.document.body; p = p.parentElement) {
    const pos = win.getComputedStyle(p).position;
    if (pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

/** A link inside running text (a sentence): WCAG exempts its size. */
function inSentence(win: Window, el: Element): boolean {
  if (el.tagName !== 'A' || !win.getComputedStyle(el).display.startsWith('inline')) return false;
  const block = el.parentElement;
  if (!block) return false;
  const own = (el.textContent ?? '').trim().length;
  return (block.textContent ?? '').trim().length > own + 2;
}

const distToRect = (x: number, y: number, r: DOMRect) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));

/** Measures the page now. Elements found are kept for reveal() until the next measure(). */
export function measure(win: Window): Measured {
  const doc = win.document;
  const vw = doc.documentElement.clientWidth;
  const issues: Issue[] = [];
  found = [];
  const all = [...doc.body.querySelectorAll('*')].filter((el) => !el.closest(SKIP));
  const rects = new Map(all.map((el) => [el, el.getBoundingClientRect()]));
  const visible = new Set(all.filter((el) => shown(win, el, rects.get(el)!)));

  // images wider than the screen first: they explain the overflow of what holds them (an icon merely pushed past
  // the edge is not the cause: what pushes it is reported below)
  const wideMedia = new Set<Element>();
  for (const el of all) {
    if (!el.matches(MEDIA) || !visible.has(el) || el.parentElement?.closest('svg')) continue;
    const r = rects.get(el)!;
    if (r.width <= vw + 1 || contained(win, el) || fixed(win, el)) continue;
    wideMedia.add(el);
    add(issues, 'image', el, `${Math.round(r.width)} px wide on a ${vw} px screen`);
  }
  const wide: Element[] = [];
  for (const el of all) {
    if (!visible.has(el) || wideMedia.has(el)) continue;
    const r = rects.get(el)!;
    if (r.right <= vw + 1 || contained(win, el) || fixed(win, el)) continue;
    if (wide.some((w) => w.contains(el))) continue; // the outermost one is reported
    wide.push(el);
  }
  for (const el of wide) {
    if ([...wideMedia].some((m) => el.contains(m))) continue;
    add(issues, 'overflow', el, `Goes ${Math.round(rects.get(el)!.right - vw)} px past the right edge`);
  }

  // tap targets
  const targets = all.filter((el) => el.matches(TARGETS) && visible.has(el) && !(el as HTMLInputElement).disabled);
  const small = targets.filter((el) => {
    const r = rects.get(el)!;
    return (r.width < TAP || r.height < TAP) && !inSentence(win, el);
  });
  const smallSet = new Set(small);
  const centre = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2] as const;
  for (const el of small) {
    // a target inside another target (an icon in a link) is the same target
    if (targets.some((t) => t !== el && t.contains(el))) continue;
    const r = rects.get(el)!;
    const [x, y] = centre(r);
    const crowded = targets.some((t) => {
      if (t === el || t.contains(el) || el.contains(t)) return false;
      const q = rects.get(t)!;
      if (smallSet.has(t)) {
        const [a, b] = centre(q);
        return Math.hypot(a - x, b - y) < TAP;
      }
      return distToRect(x, y, q) < TAP / 2;
    });
    if (crowded) add(issues, 'tap', el, `${Math.round(r.width)} × ${Math.round(r.height)} px, next to another target`);
  }

  // text under 12 px
  const seen = new Set<Element>();
  const walk = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !(n.textContent ?? '').trim()) continue;
    seen.add(el);
    if (!visible.has(el) || el.closest(SKIP)) continue;
    const size = parseFloat(win.getComputedStyle(el).fontSize);
    if (size < FONT) add(issues, 'font', el, `${Math.round(size * 10) / 10} px text`);
  }

  return { width: vw, sideways: Math.max(0, doc.documentElement.scrollWidth - vw), issues };
}

/** Scrolls the page to an issue's element and outlines it for a moment. */
export function reveal(win: Window, id: number): boolean {
  return outline(win, found[id]);
}

function outline(win: Window, el: Element | undefined): boolean {
  const doc = win.document;
  if (!el || !el.isConnected) return false;
  // to it, but from the left edge, as a visitor sees it (something past the right edge shows cut off)
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  win.scrollTo({ left: 0, top: win.scrollY });
  mark?.remove();
  const m = doc.createElement('div');
  mark = m;
  const place = () => {
    const r = el.getBoundingClientRect();
    Object.assign(m.style, {
      position: 'fixed',
      left: `${r.left - 4}px`,
      top: `${r.top - 4}px`,
      width: `${r.width + 8}px`,
      height: `${r.height + 8}px`,
      zIndex: '2147483647',
      pointerEvents: 'none',
      border: '2px solid #6161ff',
      borderRadius: '6px',
      boxShadow: '0 0 0 4px rgb(97 97 255 / 0.25)',
      transition: 'opacity 400ms',
    });
  };
  place();
  doc.body.append(m);
  win.addEventListener('scroll', place, { passive: true });
  win.setTimeout(() => (m.style.opacity = '0'), 2200);
  win.setTimeout(() => {
    m.remove();
    win.removeEventListener('scroll', place);
  }, 2700);
  return true;
}

// ---------- respelled words (the region preview) ----------
const MARK = 'data-ms-spell';
const VERBATIM = 'script, style, noscript, template, code, pre, kbd, samp, textarea, svg, math';

/** Highlights every occurrence of `words` (as the page spells them) in the page's text; returns how many. */
export function markWords(win: Window, words: string[]): number {
  const doc = win.document;
  for (const m of doc.querySelectorAll(`mark[${MARK}]`)) m.replaceWith(...m.childNodes);
  doc.body.normalize();
  const list = [...new Set(words.map((w) => w.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!list.length) return 0;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${list.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  if (!doc.getElementById('ms-spell-css')) {
    const st = doc.createElement('style');
    st.id = 'ms-spell-css';
    st.textContent = `mark[${MARK}]{background:rgb(255 214 102/.55);color:inherit;border-radius:2px;box-shadow:0 0 0 1px rgb(214 150 0/.5)}`;
    doc.head.append(st);
  }
  const nodes: Text[] = [];
  const walk = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (el && !el.closest(`${VERBATIM}, ${SKIP}, [translate="no"]`) && re.test(n.textContent ?? '')) nodes.push(n as Text);
    re.lastIndex = 0;
  }
  let count = 0;
  for (const node of nodes) {
    const text = node.textContent ?? '';
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(re)) {
      frag.append(text.slice(last, m.index));
      const mark = doc.createElement('mark');
      mark.setAttribute(MARK, m[0].toLowerCase());
      mark.textContent = m[0];
      frag.append(mark);
      last = m.index! + m[0].length;
      count++;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return count;
}

const nth = new Map<string, number>();

/** Scrolls to the next highlighted occurrence of `word` (each call goes one further, then round again). */
export function revealWord(win: Window, word: string): boolean {
  const marks = [...win.document.querySelectorAll(`mark[${MARK}]`)].filter((m) => m.getAttribute(MARK) === word.toLowerCase() && m.getBoundingClientRect().height > 0);
  if (!marks.length) return false;
  const i = (nth.get(word) ?? -1) + 1;
  nth.set(word, i % marks.length);
  return outline(win, marks[i % marks.length]);
}
