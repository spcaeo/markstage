// One topic as a river (index.ts, the Topic map's Flow view; docs/API-LINKS.md GET /links/map). It reads top down:
// the service page as the goal bar, the main page under it, the group leads in rows, each group's articles stacked
// under its lead, each branch in its group's colour and each line as wide as the links it carries (flow-river.ts
// places everything on an 8px grid; flow-node.ts draws the cards). It is calm: no line across the map until a card is
// pointed at, then that page's links show thin and grey. A big topic opens with its groups folded but the largest
// three ("N pages ▸" opens one). A click on a page shows the step round it: the pages linking to it on the left, the
// page with its To fix box (flow-fix.ts) and the pages linking both ways in the middle, the pages it links to on the
// right; pointing at one lights its line with the link words; a click walks on, the trail above keeps the way back.
// The side panel (flow-side.ts) gives the picked page's details; the toolbar (flow-tools.ts) picks what is shown.
// Zoom: fitted (the width filled, 93% to 125%, a tall map at 100% scrolling down), or the URL's.
// The URL keeps the state (index.ts leaves these to the view): group, open (the groups open: keys with commas, none,
// all), page (the page picked), trail (the pages walked through to it, refs with commas), zoom (in %), options (the
// View popover open), side, deep, age, asof.
import type { ScreenCtx } from '../../host';
import '../../styles/journey.css';
import '../../styles/flow.css';
import '../../styles/flow-side.css';
import { topicJourney, type JourneyMap } from '../../topics';
import { button, el, failure, state } from '../ui';
import { fixBox, stepText } from './flow-fix';
import { buildFlow, countLinks, FOLD_OVER, openFrom, openParam, shortTitle, stepSides, walk, type FlowModel, type FlowNode } from './flow-model';
import { codeDot, emptyCard, fitCard, flowCard, goalBar, tint } from './flow-node';
import { CARD, crossLine, fitZoom, MARGIN, perRow, riverLayout, stepGap, stepLayout, ZOOM_MAX, ZOOM_MIN, type Box, type Layout } from './flow-river';
import { flowSide } from './flow-side';
import { ageOn, extraOn, flowTools } from './flow-tools';

const SVG = 'http://www.w3.org/2000/svg';
/** the zoom steps of the − and + buttons, in % */
const STEPS = [93, 100, 110, 125, 150];

export interface Flow {
  el: HTMLElement;
  update(): void;
  destroy(): void;
}

export function flow(ctx: ScreenCtx, topicId: string): Flow {
  const root = el('div.ms-fl-wrap');
  let data: JourneyMap | null = null;
  let alive = true;
  const now = Date.now();
  /** what is drawn: the model of the whole topic, the layout, the page picked, the zoom */
  let whole: FlowModel | null = null;
  let layout: Layout | null = null;
  let focus: string | null = null;
  let k = 1;
  const boxes = new Map<string, Box>();
  const cards = new Map<string, HTMLElement>();
  /** where the river was scrolled when a page was picked */
  let riverAt: { left: number; top: number } | null = null;
  const keys = { map: '', tools: '', zoom: '', width: 0 };

  const tools = el('div.ms-fl-toolslot');
  const world = el('div.ms-fl-world');
  const svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('ms-fl-lines');
  svg.setAttribute('aria-hidden', 'true');
  const hoverLines = document.createElementNS(SVG, 'g');
  const cardLayer = el('div.ms-fl-cards', { role: 'list', 'aria-label': 'Pages' });
  const tip = el('div.ms-fl-tip', { role: 'status' });
  tip.hidden = true;
  world.append(svg, cardLayer, tip);
  const sizer = el('div.ms-fl-sizer');
  const scroll = el('div.ms-fl-canvas', { tabindex: '-1', 'aria-label': 'Map of the topic’s pages and links' }, world, sizer);
  const trail = el('nav.ms-fl-trail', { 'aria-label': 'Trail' });
  const pct = el('output.ms-fl-zoom__pct.ms-num');
  const zoomBar = el(
    'div.ms-fl-zoom',
    { role: 'group', 'aria-label': 'Zoom' },
    el('button.ms-btn.ms-btn--sm', { type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out (−)' }, '−'),
    pct,
    el('button.ms-btn.ms-btn--sm', { type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in (+)' }, '+'),
    button('Fit to screen', () => fitByHand(), { small: true, title: 'Fit the map to the screen (0)' }),
  );
  const [out, inn] = zoomBar.querySelectorAll('button');
  out.addEventListener('click', () => zoomStep(-1));
  inn.addEventListener('click', () => zoomStep(1));
  const help = el('p.ms-fl-help', { id: 'ms-fl-keys' }, 'Tab goes through the pages; Enter shows the links of one; Esc goes back to every page. + and − zoom, 0 fits the map.');
  // under the map, never over it: the zoom, then the keys
  const main = el('div.ms-fl-main', trail, el('div.ms-fl-canvaswrap', scroll), el('div.ms-fl-foot', zoomBar, help));
  const side = flowSide(ctx);
  const body = el('div.ms-fl-body', main, side.el);
  root.append(tools, body);

  const params = () => ctx.params();
  const go = (p: Record<string, string | null>, push = true) => ctx.go({ params: p }, push);

  async function load(): Promise<void> {
    if (!data) tools.replaceChildren(state('loading', 'Reading the topic’s links…'));
    try {
      const r = await topicJourney(topicId);
      if (!alive) return;
      data = r;
      keys.map = '';
      update();
    } catch (e) {
      if (alive) tools.replaceChildren(failure(e, () => void load()));
    }
  }

  /** What the URL changed decides what is drawn again: the map, the toolbar, or the zoom only. */
  function update(): void {
    if (!data) return;
    const q = params();
    const pick = (...x: string[]) => x.map((y) => q.get(y) ?? '').join('|');
    const mapKey = pick('group', 'open', 'page', 'trail', 'side', 'deep', 'age', 'asof');
    const toolsKey = `${mapKey}|${pick('options')}`;
    const zoom = q.get('zoom') ?? '';
    const fresh = mapKey !== keys.map;
    if (fresh || toolsKey !== keys.tools) drawTools();
    if (fresh) drawMap();
    if (fresh || zoom !== keys.zoom) applyZoom();
    keys.map = mapKey;
    keys.tools = toolsKey;
    keys.zoom = zoom;
  }

  /** The group shown alone, the groups open, the page picked (each as the URL says, when it is there). */
  function scope() {
    const q = params();
    whole = buildFlow(data!, { group: null, asOf: q.get('asof'), now });
    const m = whole;
    const only = m.groups.some((g) => g.key === q.get('group')) ? q.get('group') : null;
    const pages = m.nodes.length;
    const open = only ? new Set([only]) : openFrom(q.get('open'), m.groups, pages);
    const page = q.get('page');
    const picked = page && m.nodes.some((n) => n.ref === page) ? page : null;
    // a big topic folds; a small one only when the URL folded some (so they can be opened again)
    return { m, only, pages, open, picked, foldable: !only && (pages > FOLD_OVER || open.size < m.groups.length) };
  }

  function drawTools(): void {
    const s = scope();
    const folded = new Set(s.m.groups.filter((g) => !s.open.has(g.key)).map((g) => g.key));
    tools.replaceChildren(flowTools(ctx, data!, s.m, now, { only: s.only, folded, picked: !!s.picked }));
  }

  function drawMap(): void {
    const s = scope();
    const was = focus;
    focus = s.picked;
    body.classList.toggle('has-side', !!focus);
    if (focus && !was) riverAt = { left: scroll.scrollLeft, top: scroll.scrollTop };
    sizeCanvas();
    keys.width = scroll.clientWidth;
    const hadFocus = scroll.contains(document.activeElement);
    layout = focus ? drawStep(s.m, focus) : drawRiver(s);
    side.draw({ d: data!, model: s.m, node: focus ? s.m.all.get(focus)! : null, every: s.m.conns });
    drawTrail(s.m);
    // the change seen: the map comes in from a little below (not when motion is reduced)
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) world.animate([{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 220, easing: 'ease-out' });
    applyZoom();
    if (focus) scroll.scrollTo({ left: 0, top: 0 });
    else if (was && riverAt) (scroll.scrollTo(riverAt), (riverAt = null));
    if (hadFocus) (cards.get(focus ?? was ?? '') ?? scroll).focus({ preventScroll: true });
    toToolbar();
  }

  /** Every page shown: a card where the layout put it, wired for hover, focus and a click. */
  function reset(): void {
    cardLayer.replaceChildren();
    svg.replaceChildren();
    hoverLines.replaceChildren();
    boxes.clear();
    cards.clear();
    tip.hidden = true;
  }

  function drawRiver(s: ReturnType<typeof scope>): Layout {
    reset();
    const m = s.m;
    const shown = new Set(m.nodes.map((n) => n.ref));
    const count = countLinks(m.conns);
    const groups = m.groups
      .filter((g) => !s.only || g.key === s.only)
      .map((g) => ({ ...g, lead: g.lead && shown.has(g.lead) ? g.lead : null, members: g.members.filter((r) => shown.has(r)) }))
      .filter((g) => g.lead || g.members.length);
    const pillar = m.nodes.find((n) => n.role === 'pillar') ?? null;
    const money = m.nodes.find((n) => n.role === 'money') ?? null;
    const l = riverLayout({ groups, main: pillar?.ref ?? null, service: money?.ref ?? null, mainColour: pillar?.colour ?? { light: '#2b2f36', dark: '#e8e9ec' }, count, open: s.open, perRow: perRow(scroll.clientWidth - 16) });
    const toggle = (key: string) => {
      const open = new Set(s.open);
      if (open.has(key)) open.delete(key);
      else open.add(key);
      go({ open: openParam(open, m.groups, s.pages) });
    };
    for (const b of l.boxes) {
      boxes.set(b.id, b);
      const n = b.ref ? m.all.get(b.ref) : undefined;
      if (b.kind === 'goal' && n) {
        const into = m.conns.filter((c) => c.to === n.ref && c.kind !== 'missing').reduce((a, c) => a + c.links.length, 0);
        add(goalBar(n, b, into), n);
        continue;
      }
      const g = b.group ? groups.find((x) => x.key === b.group) : undefined;
      const isLead = !!g && b.col.startsWith('b:');
      if (!n) {
        const foot = g ? g.name : 'The topic has no main page yet';
        cardLayer.append(emptyCard(g ? g.letter : 'M', g ? g.colour : { light: '#2b2f36', dark: '#e8e9ec' }, g ? (g.key === '-' ? 'Pages in no group' : 'No lead page yet') : 'No main page yet', b, foldFoot(g, b, s, toggle) ?? foot));
        continue;
      }
      const pages = g ? g.members.length + (g.lead ? 1 : 0) : 0;
      add(flowCard(n, b, m.groups, { lead: isLead ? { group: g!, folded: !!b.folded, pages, fold: s.foldable ? () => toggle(g!.key) : null } : undefined, toService: toService(m, n, count), missing: missingFrom(n.ref) }), n);
    }
    drawLines(l);
    fitCards();
    // the View popover's extra lines: side links and deep links, faint
    const extra = (on: boolean, cls: string, ok: (a: FlowNode, z: FlowNode) => boolean) => {
      if (!on) return;
      for (const c of m.conns) {
        const [a, z] = [boxes.get(c.from), boxes.get(c.to)];
        if (c.kind === 'missing' || !a || !z || !ok(m.all.get(c.from)!, m.all.get(c.to)!)) continue;
        svg.append(path(crossLine(a, z), `ms-fl-ln ${cls}`));
      }
    };
    const q = params();
    extra(extraOn(q, 'side'), 'is-side', (a, z) => a.role === z.role && (a.role === 'member' || a.role === 'lead'));
    extra(extraOn(q, 'deep'), 'is-deep', (a, z) => (a.role === 'pillar' || a.role === 'money') && z.role === 'member');
    svg.append(hoverLines);
    return l;
  }

  /** A folded group with no lead page: its name and page count open it. */
  function foldFoot(g: { key: string; name: string; members: string[] } | undefined, b: Box, s: ReturnType<typeof scope>, toggle: (k: string) => void): HTMLElement | null {
    if (!g || !s.foldable) return null;
    const n = g.members.length;
    const f = el('button.ms-fl-fold', { type: 'button', 'aria-expanded': String(!b.folded), 'aria-label': b.folded ? `Open ${g.name}: ${n} ${n === 1 ? 'page' : 'pages'}` : `Fold ${g.name}` }, el('b.ms-fl-card__group', g.name), b.folded ? ` · ${n} ${n === 1 ? 'page' : 'pages'} ▸` : ' ▾');
    f.addEventListener('click', () => toggle(g.key));
    return f;
  }

  function drawStep(m: FlowModel, page: string): Layout {
    reset();
    const sides = stepSides(m, page);
    const fixes = data!.missing.filter((x) => (x.from === page || x.to === page) && m.all.has(x.from) && m.all.has(x.to));
    const l = stepLayout({ focus: page, gap: stepGap(scroll.clientWidth - 16), ...sides, fixes: fixes.length });
    const count = countLinks(m.conns);
    const me = m.all.get(page)!;
    const n = { from: sides.from.length, to: sides.to.length, both: sides.both.length };
    for (const b of l.boxes) {
      boxes.set(b.id, b);
      if (b.kind === 'head' || b.kind === 'note') cardLayer.append(stepText(b, me, n));
      else if (b.kind === 'fix') cardLayer.append(fixBox(ctx, m, fixes, b, () => void load()));
      else {
        const x = m.all.get(b.ref!)!;
        const c = flowCard(x, b, m.groups, { toService: toService(m, x, count), both: sides.both.includes(x.ref), missing: missingFrom(x.ref) });
        if (x.ref === page) c.classList.add('is-picked'), c.setAttribute('aria-current', 'page');
        add(c, x);
      }
    }
    drawLines(l);
    fitCards();
    svg.append(hoverLines);
    return l;
  }

  /** Long titles one size smaller: now, and again once the fonts are in (they wrap otherwise). */
  function fitCards(): void {
    const fit = () => cardLayer.querySelectorAll<HTMLElement>('.ms-fl-card').forEach(fitCard);
    fit();
    void document.fonts?.ready.then(() => alive && fit());
  }

  const toService = (m: FlowModel, n: FlowNode, count: (a: string, b: string) => number) => {
    const s = [...m.all.values()].find((x) => x.role === 'money');
    return !!s && n.role !== 'money' && n.role !== 'pillar' && count(n.ref, s.ref) > 0;
  };
  const missingFrom = (ref: string) => data!.missing.some((x) => x.from === ref);

  function path(d: string, cls: string): SVGPathElement {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', cls);
    return p;
  }

  function drawLines(l: Layout): void {
    svg.setAttribute('width', String(l.w));
    svg.setAttribute('height', String(l.h));
    for (const ln of l.lines) {
      const p = path(ln.d, `ms-fl-ln${ln.colour ? '' : ' is-calm'}${ln.none ? ' is-none' : ''}`);
      p.dataset.from = ln.from;
      p.dataset.to = ln.to;
      if (ln.colour) tint(p as unknown as HTMLElement, ln.colour);
      p.style.strokeWidth = String(ln.width);
      svg.append(p);
    }
  }

  function add(e: HTMLElement, n: FlowNode): void {
    e.setAttribute('role', 'listitem');
    e.setAttribute('aria-describedby', 'ms-fl-keys');
    cards.set(n.ref, e);
    cardLayer.append(e);
    const age = ageOn(params());
    if (age && n.age !== age) e.classList.add('is-dim');
    const pickIt = () => {
      if (!focus) return go({ page: n.ref, trail: null });
      if (n.ref === focus) return;
      const t = walk((params().get('trail') ?? '').split(',').filter(Boolean), focus, n.ref);
      go({ page: n.ref, trail: t.length ? t.join(',') : null });
    };
    e.addEventListener('click', (ev) => !(ev.target as HTMLElement).closest('button') && pickIt());
    e.addEventListener('keydown', (ev) => {
      if (ev.target !== e || (ev.key !== 'Enter' && ev.key !== ' ')) return;
      ev.preventDefault();
      pickIt();
    });
    e.addEventListener('pointerenter', () => point(n.ref));
    e.addEventListener('pointerleave', () => point(null));
    e.addEventListener('focus', () => point(n.ref));
    e.addEventListener('blur', () => point(null));
  }

  /** A card pointed at. On the river: its links, thin and grey. Round a page: its line lit, with the link words. */
  function point(ref: string | null): void {
    hoverLines.replaceChildren();
    tip.hidden = true;
    for (const e of cards.values()) e.classList.remove('is-near');
    for (const p of svg.querySelectorAll('.ms-fl-ln.is-hot')) p.classList.remove('is-hot');
    if (!ref || !whole || !layout) return;
    const m = whole;
    if (!focus) {
      const here = boxes.get(ref);
      if (!here) return;
      for (const c of m.conns) {
        if (c.kind === 'missing' || (c.from !== ref && c.to !== ref)) continue;
        const other = c.from === ref ? c.to : c.from;
        const there = boxes.get(other);
        if (!there) continue;
        cards.get(other)?.classList.add('is-near');
        hoverLines.append(path(crossLine(c.from === ref ? here : there, c.from === ref ? there : here), 'ms-fl-ln is-hover'));
      }
      return;
    }
    if (ref === focus) return;
    const ins = m.conns.filter((c) => c.kind !== 'missing' && c.from === ref && c.to === focus).flatMap((c) => c.links);
    const outs = m.conns.filter((c) => c.kind !== 'missing' && c.from === focus && c.to === ref).flatMap((c) => c.links);
    const n = m.all.get(ref)!;
    const me = m.all.get(focus)!;
    for (const p of svg.querySelectorAll<SVGPathElement>('.ms-fl-ln')) {
      if ((p.dataset.from === ref && p.dataset.to === focus) || (p.dataset.from === focus && p.dataset.to === ref)) {
        p.classList.add('is-hot');
        tint(p as unknown as HTMLElement, n.colour);
      }
    }
    const say = (a: FlowNode, z: FlowNode, links: typeof ins) => {
      if (!links.length) return [];
      const shown = links.slice(0, 3);
      return [
        el('p.ms-fl-tip__route', el('b', `${a.code} → ${z.code}`), ` ${links.length} ${links.length === 1 ? 'link' : 'links'}`),
        ...shown.map((x) => el('p.ms-fl-tip__link', `“${x.anchor || 'no words'}”`, el('span', x.section ? ` under “${x.section}”` : ' near the top'))),
        ...(links.length > shown.length ? [el('p.ms-fl-tip__more', `and ${links.length - shown.length} more`)] : []),
      ];
    };
    tip.replaceChildren(...say(n, me, ins), ...say(me, n, outs));
    const b = boxes.get(ref)!;
    tip.style.left = `${b.x + 16}px`;
    tip.style.top = `${b.y + CARD.h + 4}px`;
    tip.hidden = !tip.childElementCount;
  }

  /** Round a page: the way back to every page, and the pages walked through to it. */
  function drawTrail(m: FlowModel): void {
    trail.replaceChildren();
    trail.hidden = !focus;
    if (!focus) return;
    const back = el('button.ms-btn.ms-btn--sm.ms-fl-trail__back', { type: 'button', title: 'Back to every page (Esc)' }, '← All pages');
    back.addEventListener('click', () => go({ page: null, trail: null }));
    trail.append(back, el('span.ms-fl-trail__label', 'Trail:'));
    const steps = (params().get('trail') ?? '').split(',').filter((r) => m.all.has(r));
    steps.forEach((r, i) => {
      const n = m.all.get(r)!;
      const b = el('button.ms-fl-trail__step', { type: 'button', title: n.page.title, 'aria-label': `Back to ${n.code}: ${n.page.title}` }, codeDot(n, true));
      b.addEventListener('click', () => go({ page: r, trail: i ? steps.slice(0, i).join(',') : null }));
      trail.append(b, el('span.ms-fl-trail__arrow', { 'aria-hidden': 'true' }, '→'));
    });
    const me = m.all.get(focus)!;
    trail.append(el('span.ms-fl-trail__here', { 'aria-current': 'page' }, codeDot(me, true), shortTitle(me.page.title)));
  }

  /** The map as high as the screen under the toolbar (with the toolbar scrolled to the top, the map fills the rest). */
  function sizeCanvas(): void {
    const h = Math.max(480, window.innerHeight - tools.offsetHeight - 100 - (focus ? 56 : 0));
    scroll.style.height = `${h}px`;
  }

  /** On opening: the toolbar to the top of the screen when the map would end below it. */
  let scrolled = false;
  function toToolbar(): void {
    if (scrolled) return;
    scrolled = true;
    if (scroll.getBoundingClientRect().bottom > window.innerHeight) tools.scrollIntoView({ block: 'start' });
  }

  /** The URL's zoom (in %), else the zoom that fits; the world placed in the middle, the scroll room round it. */
  function applyZoom(): void {
    if (!layout) return;
    const z = Number(params().get('zoom'));
    k = z > 0 ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z / 100)) : fitZoom({ w: scroll.clientWidth, h: scroll.clientHeight }, layout, !!focus);
    const left = Math.max(MARGIN, Math.floor((scroll.clientWidth - layout.w * k) / 2));
    world.style.transform = `translate(${left}px, ${MARGIN}px) scale(${k})`;
    world.dataset.k = String(k);
    sizer.style.width = `${Math.ceil(left + layout.w * k + MARGIN)}px`;
    sizer.style.height = `${Math.ceil(MARGIN + layout.h * k + MARGIN)}px`;
    pct.textContent = `${Math.round(k * 100)}%`;
  }

  function zoomStep(dir: 1 | -1): void {
    const now = Math.round(k * 100);
    const next = dir > 0 ? STEPS.find((s) => s > now) : [...STEPS].reverse().find((s) => s < now);
    if (next) go({ zoom: String(next) }, false);
  }

  function fitByHand(): void {
    if (params().get('zoom')) go({ zoom: null }, false);
  }

  scroll.addEventListener('keydown', (ev) => {
    if ((ev.target as HTMLElement).closest('input, select, textarea')) return;
    if (ev.key === 'Escape' && params().get('page')) {
      ev.preventDefault();
      go({ page: null, trail: null });
    } else if (ev.key === '+' || ev.key === '=') zoomStep(1);
    else if (ev.key === '-') zoomStep(-1);
    else if (ev.key === '0') fitByHand();
  });

  // a new width: rows of another length, columns closer or further apart, so the map is laid out again
  const resize = new ResizeObserver(() => {
    if (!layout || Math.abs(scroll.clientWidth - keys.width) < 8) return applyZoom();
    keys.width = scroll.clientWidth;
    keys.map = '';
    update();
  });
  resize.observe(scroll);
  const onWindow = () => (sizeCanvas(), applyZoom());
  window.addEventListener('resize', onWindow);

  void load();
  return {
    el: root,
    update,
    destroy() {
      alive = false;
      resize.disconnect();
      window.removeEventListener('resize', onWindow);
    },
  };
}
