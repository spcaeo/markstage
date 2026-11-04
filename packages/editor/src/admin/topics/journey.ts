// One topic as a journey (index.ts, the Topic map's first view; docs/API-LINKS.md GET /links/map): its pages left to
// right the way a reader travels (articles and guides, group lead pages, the main page, the service page), each a
// card (journey-card.ts), and the links between them as lines with their words on a chip. Dashed lines are links the
// topic expects that are not there yet; amber ones go through a redirect; a chip with a mark has words to change.
// Links back (the main page down to its articles) are lighter lines, so the way on stays easy to follow. Links
// between two articles and from other topics show when a page is picked and in its "+" list, never as lines, so the
// map never turns into a hairball. The URL keeps the state (index.ts leaves these to the view):
//   group=<g>       one group only (its articles and its lead; the main and service pages stay)
//   page=<ref>      the page picked: the pages it links with stand out, the rest fade
//   details=1       the picked page's links in the side panel
//   link=<id>       a connection (its pair id) or a missing link (its id) in the side panel
//   more=<g>,<g>    groups shown whole (else their first pages and "+N more")
import type { ScreenCtx } from '../../host';
import '../../styles/journey.css';
import { topicJourney, type JourneyEdge, type JourneyMap, type JourneyMissing, type JourneyPage } from '../../topics';
import { el, failure, icon, state } from '../ui';
import { gaps, groupRow, legend, pageCard } from './journey-card';
import { journeyPanel } from './journey-panel';

/** pages a group shows before "+N more" */
const SHOWN = 4;
const COLS = ['member', 'lead', 'pillar', 'money'] as const;
type Col = (typeof COLS)[number];
const SVG = 'http://www.w3.org/2000/svg';
const COL_WORDS: Record<Col, string> = { member: 'Article', lead: 'Group lead', pillar: 'Main page', money: 'Service page' };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const WORDING = new Set(['generic-anchor', 'anchor-clash']);

/** A line on the map: from a card (or a folded group) to a card, with its chip. */
interface Conn {
  key: string;
  from: HTMLElement;
  to: HTMLElement;
  fromRef: string | null;
  toRef: string;
  links: JourneyEdge[];
  missing: JourneyMissing[];
  /** a folded group's line: its chip opens the group */
  group: string | null;
  /** it passes a column on the way (an article straight to the service page): a chip naming where, no line */
  skip: string | null;
  chip: HTMLButtonElement;
}

/** A link back, to the column just before: a light line, no chip. */
interface Back {
  from: HTMLElement;
  to: HTMLElement;
  fromRef: string;
  toRef: string;
}

export interface Journey {
  el: HTMLElement;
  update(): void;
  destroy(): void;
}

export function journey(ctx: ScreenCtx, topicId: string): Journey {
  const root = el('div.ms-jr-wrap');
  let data: JourneyMap | null = null;
  let alive = true;
  let conns: Conn[] = [];
  let backs: Back[] = [];
  let picked: string | null = null;
  let canvas: HTMLElement | null = null;
  let svg: SVGSVGElement | null = null;
  let frame = 0;
  const resize = new ResizeObserver(() => relayout());
  const onScroll = () => relayout();
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', onScroll);

  async function load(): Promise<void> {
    if (!data) root.replaceChildren(state('loading', 'Reading the topic’s links…'));
    try {
      const r = await topicJourney(topicId);
      if (!alive) return;
      data = r;
      draw();
    } catch (e) {
      if (alive) root.replaceChildren(failure(e, () => void load()));
    }
  }

  const params = () => ctx.params();
  const opened = () => new Set((params().get('more') ?? '').split(',').filter(Boolean));

  /** The whole view from the data and the URL (cheap: a topic has tens of pages). */
  function draw(): void {
    if (!data) return;
    const d = data;
    const had = (document.activeElement as HTMLElement | null)?.dataset?.key ?? null;
    const byRef = new Map(d.pages.map((p) => [p.ref, p]));
    picked = params().get('page');
    const linkId = params().get('link');
    // the page the open link is on: shown even in a folded group
    const linkFrom = linkId ? (d.missing.find((m) => m.id === linkId)?.from ?? d.edges.find((e) => e.pair === linkId)?.from ?? null) : null;
    const more = opened();
    const pillarIsMoney = !!d.topic.money && d.topic.money === d.topic.pillar;

    // the groups (the pages in no group first), and the one asked for
    const allMembers = d.pages.filter((p) => p.place === 'member');
    const groups = [{ id: '', name: 'Pages without a group', lead: null as string | null }, ...d.topic.groups]
      .map((g) => ({ ...g, key: g.id || '-', pages: allMembers.filter((p) => (p.group ?? '') === g.id) }))
      .filter((g) => g.pages.length || (g.lead && byRef.has(g.lead)));
    const only = groups.find((g) => g.key === params().get('group'))?.key ?? null;
    const shownGroups = only ? groups.filter((g) => g.key === only) : groups;
    const members = shownGroups.flatMap((g) => g.pages);
    const leads = d.pages.filter((p) => p.place === 'lead' && (!only || (p.group ?? '-') === only));
    const pillar = d.pages.find((p) => p.place === 'pillar') ?? null;
    const money = d.pages.find((p) => p.place === 'money') ?? null;
    const shown = new Set([...members, ...leads, ...(pillar ? [pillar] : []), ...(money ? [money] : [])].map((p) => p.ref));
    const colOf = (ref: string | null): Col | null => {
      const p = ref ? byRef.get(ref) : null;
      return p && p.place !== 'outside' && shown.has(p.ref) ? p.place : null;
    };

    // links back to a column that is not next to it: named on the card (no line across the cards in between)
    const shownColsOf = (): Col[] => COLS.filter((c) => c === 'member' || c === 'pillar' || (c === 'lead' && leads.length) || (c === 'money' && money));
    const visibleCols = shownColsOf();
    const step = (a: Col, b: Col) => visibleCols.indexOf(b) - visibleCols.indexOf(a);
    const backFrom = new Map<string, Set<string>>();
    for (const e of d.edges) {
      const a = colOf(e.from);
      const b = colOf(e.to);
      if (a && b && step(b, a) > 1) backFrom.set(e.to!, (backFrom.get(e.to!) ?? new Set()).add(COL_WORDS[a]));
    }

    const nodes = new Map<string, HTMLElement>(); // a page's card, or its folded group's "+N more"
    const groupOf = new Map<string, string>(); // a folded page -> its group key
    const card = (p: JourneyPage) => {
      const c = pageCard(p, {
        leads: d.numbers.leads,
        broken: d.edges.filter((e) => e.from === p.ref && !e.to),
        backFrom: [...(backFrom.get(p.ref) ?? [])],
        pick: () => ctx.go({ params: { page: params().get('page') === p.ref ? null : p.ref, details: null, link: null } }, true),
        details: () => ctx.go({ params: { page: p.ref, details: '1', link: null } }, true),
      });
      nodes.set(p.ref, c);
      return c;
    };
    canvas = el('div.ms-jr');
    const col = (c: Col, title: string, hint: string, body: HTMLElement[]) => el('section.ms-jr-col', { 'data-col': c, 'aria-label': title }, el('h3.ms-jr-col__title', title), el('p.ms-jr-col__hint', hint), ...body);

    // articles and guides, in their groups
    const boxes: HTMLElement[] = [];
    for (const g of shownGroups) {
      if (!g.pages.length) continue;
      const fold = !only && g.pages.length > SHOWN + 1 && !more.has(g.key);
      // a folded group shows its first pages, and the picked page (or the open link's) wherever it is
      const visible = fold ? g.pages.filter((p, i) => i < SHOWN || p.ref === picked || p.ref === linkFrom) : g.pages;
      const box = el('section.ms-jr-group', { 'aria-label': g.name }, el('h4.ms-jr-group__name', icon('layers', 14), el('span', g.name), el('span.ms-jr-group__n.ms-num', String(g.pages.length))));
      for (const p of visible) box.append(card(p));
      if (!only && g.pages.length > SHOWN + 1) {
        const hidden = g.pages.filter((p) => !visible.includes(p));
        const toggle = el('button.ms-jr-more', { type: 'button', 'aria-expanded': String(!fold), 'data-key': `more:${g.key}` }, fold ? `+${hidden.length} more` : 'Show fewer');
        toggle.addEventListener('click', () => setMore(g.key, fold));
        box.append(toggle);
        for (const p of hidden) (nodes.set(p.ref, toggle), groupOf.set(p.ref, g.key));
      }
      boxes.push(box);
    }
    const cols: HTMLElement[] = [col('member', 'Articles and guides', 'Where readers arrive from search.', boxes.length ? boxes : [el('p.ms-jr-empty', only ? 'This group has no articles yet.' : 'No pages yet. Put some in this topic in Arrange.')])];
    if (leads.length) cols.push(col('lead', 'Group lead pages', 'Each sums up one group.', leads.map(card)));
    cols.push(col('pillar', pillarIsMoney ? 'Main page and service page' : 'Main page', pillarIsMoney ? 'Covers the whole topic, and readers get in touch here.' : 'Covers the whole topic.', pillar ? [card(pillar)] : [el('p.ms-jr-empty', 'No main page yet. Pick one in Arrange.')]));
    if (money) cols.push(col('money', 'Service page', d.topic.moneyGuessed ? 'The topic names none; this is the one its pages link to most.' : 'Where readers get in touch.', [card(money)]));
    svg = document.createElementNS(SVG, 'svg');
    svg.classList.add('ms-jr-lines');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<defs><marker id="ms-jr-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 8 4 0 8z" fill="context-stroke"/></marker></defs>';
    const chips = el('div.ms-jr-chips');
    canvas.append(svg, ...cols, chips);

    // the lines: links that move a reader on (to a column further right), the expected ones that are missing, and
    // the links back to the column just before
    const byKey = new Map<string, Conn>();
    const connFor = (fromRef: string, toRef: string, dashed: boolean) => {
      const from = nodes.get(fromRef);
      const to = nodes.get(toRef);
      if (!from || !to) return null;
      const group = groupOf.get(fromRef) ?? null;
      const key = `${dashed ? 'm' : 'l'}:${group ? `g:${group}` : fromRef}>${toRef}`;
      let c = byKey.get(key);
      if (!c) {
        const skip = step(colOf(fromRef)!, colOf(toRef)!) > 1 ? COL_WORDS[colOf(toRef)!] : null;
        c = { key, from, to, fromRef: group ? null : fromRef, toRef, links: [], missing: [], group, skip, chip: el('button.ms-jr-chip', { type: 'button', 'data-key': key }) };
        byKey.set(key, c);
      }
      return c;
    };
    const backKeys = new Set<string>();
    backs = [];
    for (const e of d.edges) {
      const a = colOf(e.from);
      const b = colOf(e.to);
      if (!a || !b || a === b) continue;
      if (step(a, b) > 0) connFor(e.from, e.to!, false)?.links.push(e);
      else if (step(b, a) === 1) {
        const from = nodes.get(e.from);
        const to = nodes.get(e.to!);
        const k = `${e.from}>${groupOf.get(e.to!) ?? e.to}`;
        if (from && to && !backKeys.has(k)) (backKeys.add(k), backs.push({ from, to, fromRef: e.from, toRef: e.to! }));
      }
    }
    for (const m of d.missing) if (colOf(m.from) && colOf(m.to)) connFor(m.from, m.to, true)?.missing.push(m);
    conns = [...byKey.values()];
    for (const c of conns) {
      chipOf(c, byRef);
      if (!c.skip) chips.append(c.chip);
      else if (!c.group) {
        // straight past a column: on the card itself, no line across the cards in between
        let row = c.from.querySelector('.ms-jr-card__skip');
        if (!row) c.from.append((row = el('div.ms-jr-card__skip', el('span.ms-jr-card__skiplabel', 'Also links straight to'))));
        row.append(c.chip);
      }
    }
    conns = conns.filter((c) => !c.skip || !c.group);

    // the picked page: the pages it links with stand out, with the words, the rest fade; the open link's chip marked
    if (picked && byRef.has(picked)) markPicked(picked);
    const openChip = linkId ? conns.find((c) => (c.missing[0]?.id ?? c.links[0]?.pair) === linkId)?.chip : null;
    openChip?.classList.add('is-open');
    openChip?.setAttribute('aria-pressed', 'true');

    const filter = groups.length > 1 ? groupRow(ctx, groups.map((g) => ({ key: g.key, name: g.name, n: g.pages.length })), only) : null;
    const split = el('div.ms-adm-split', el('div.ms-adm-split__main', filter, gaps(d, shown, members, pillar), legend(d.numbers), el('div.ms-jr-scroll', canvas)));
    root.replaceChildren(split);
    journeyPanel(split, ctx, d, { reload: () => void load() });
    resize.disconnect();
    resize.observe(canvas);
    relayout();
    if (had) root.querySelector<HTMLElement>(`[data-key="${CSS.escape(had)}"]`)?.focus({ preventScroll: true });
    else if (picked || linkFrom) nodes.get((picked ?? linkFrom)!)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /**
   * The chip of a line: the link words (and how many more), "Missing link", or a folded group's count; marked when a
   * link goes through a redirect or to a hidden page, or its words are vague or name another page too.
   */
  function chipOf(c: Conn, byRef: Map<string, JourneyPage>): void {
    const from = c.fromRef ? byRef.get(c.fromRef)?.title : 'pages of this group';
    const to = byRef.get(c.toRef)?.title ?? c.toRef;
    const chip = c.chip;
    const notes: string[] = [];
    if (c.links.some((l) => l.status === 'redirect' || l.status === 'noindex')) {
      chip.classList.add('is-redirect');
      notes.push(c.links.some((l) => l.status === 'redirect') ? 'A link goes through a redirect.' : 'A link goes to a page search engines are told not to show.');
    }
    if (c.links.some((l) => l.warn.some((w) => WORDING.has(w.kind)))) {
      chip.classList.add('is-wording');
      chip.append(el('span.ms-jr-chip__mark', { 'aria-hidden': 'true' }, icon('alert', 12)));
      notes.push('Change the link words: they are vague, or name another page too.');
    }
    if (c.skip) {
      chip.classList.add('is-skip');
      chip.append(el('span.ms-jr-chip__to', c.skip));
    }
    let say: string;
    if (c.missing.length) {
      chip.classList.add('is-missing');
      chip.append(el('span.ms-jr-chip__text', c.group ? `${c.missing.length} missing` : 'Missing link'));
      say = c.group ? `${plural(c.missing.length, 'page does', 'pages do')} not link to “${to}” yet. Show them.` : `“${from}” does not link to “${to}” yet. Show how to add it.`;
    } else if (c.group) {
      const pages = new Set(c.links.map((l) => l.from)).size;
      chip.append(el('span.ms-jr-chip__text', `${plural(pages, 'page', 'pages')}`));
      say = `${plural(pages, 'more page links', 'more pages link')} to “${to}”. Show them.`;
    } else {
      const words = c.links[0].anchor || '(no words)';
      chip.append(el('span.ms-jr-chip__text', words));
      if (c.links.length > 1) chip.append(el('span.ms-jr-chip__n.ms-num', `+${c.links.length - 1}`));
      say = `${plural(c.links.length, 'link', 'links')} from “${from}” to “${to}”: “${words}”. Show where.`;
    }
    if (c.skip) say = `Straight to the ${c.skip.toLowerCase()}. ${say}`;
    chip.setAttribute('aria-label', [say, ...notes].join(' '));
    chip.title = chip.getAttribute('aria-label') ?? '';
    chip.append(icon(c.group ? 'down' : 'plus', 12));
    chip.addEventListener('click', () => {
      if (c.group) return setMore(c.group, true);
      ctx.go({ params: { link: c.missing.length ? c.missing[0].id : c.links[0].pair, details: null } }, true);
    });
  }

  /** The picked page marked; the cards it links with say so, with the words. */
  function markPicked(ref: string): void {
    if (!data || !canvas) return;
    const out = new Map<string, string[]>();
    const inn = new Map<string, string[]>();
    for (const e of data.edges) {
      if (e.from === ref && e.to) out.set(e.to, [...(out.get(e.to) ?? []), e.anchor]);
      if (e.to === ref) inn.set(e.from, [...(inn.get(e.from) ?? []), e.anchor]);
    }
    canvas.classList.add('has-picked');
    for (const c of canvas.querySelectorAll<HTMLElement>('.ms-jr-card')) {
      const r = c.dataset.ref!;
      if (r === ref) {
        c.classList.add('is-picked');
        c.setAttribute('aria-current', 'true');
        continue;
      }
      if (!out.has(r) && !inn.has(r)) continue;
      c.classList.add('is-linked');
      const rel = el('div.ms-jr-card__rel');
      const say = (words: string[]) => `“${words[0] || '(no words)'}”${words.length > 1 ? ` +${words.length - 1}` : ''}`;
      if (out.has(r)) rel.append(el('p', el('span.ms-jr-rel__dir', 'Linked from the picked page: '), say(out.get(r)!)));
      if (inn.has(r)) rel.append(el('p', el('span.ms-jr-rel__dir', 'Links to the picked page: '), say(inn.get(r)!)));
      c.append(rel);
    }
    for (const c of conns) c.chip.classList.toggle('is-hot', c.fromRef === ref || c.toRef === ref);
  }

  function setMore(group: string, open: boolean): void {
    const m = opened();
    if (open) m.add(group);
    else m.delete(group);
    ctx.go({ params: { more: [...m].join(',') || null } }, true);
  }

  /**
   * Lines drawn again where the cards are now (after a resize, or a scroll moved the sticky columns). Each card's chips
   * stack in the gap after it; a line runs from the card through its chip to its target's trunk (one upright line per
   * target, in the gap before it) and into the target's middle, so many links into one page read as one comb. A link
   * back leaves a card's left side, runs down the near edge of the gap and enters the card before low on its right.
   */
  function relayout(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!canvas || !svg || !canvas.isConnected) return;
      const box = canvas.getBoundingClientRect();
      // measured without the old drawing, so the lines never keep the map wider than it now is
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('width', String(canvas.scrollWidth));
      svg.setAttribute('height', String(canvas.scrollHeight));
      for (const p of [...svg.querySelectorAll('path.ms-jr-line')]) p.remove();
      const rel = (e: Element) => {
        const r = e.getBoundingClientRect();
        return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
      };
      /** a line with rounded corners: across at y1, up or down at x, across at y2 */
      const elbow = (x1: number, y1: number, x: number, y2: number, x2: number) => {
        const r = Math.min(6, Math.abs(y2 - y1) / 2);
        if (r < 1) return `M${x1} ${y1}H${x2}`;
        const dy = Math.sign(y2 - y1);
        const dx = Math.sign(x - x1);
        return `M${x1} ${y1}H${x - dx * r}Q${x} ${y1} ${x} ${y1 + dy * r}V${y2 - dy * r}Q${x} ${y2} ${x + Math.sign(x2 - x) * r} ${y2}H${x2}`;
      };
      // each target's trunk: in the gap before its column, the targets of one column side by side
      const trunk = new Map<HTMLElement, number>();
      // the leftmost line before each column: the chips stop short of it
      const lefts = new Map<Element, number>();
      const targets = [...new Set(conns.filter((c) => !c.skip).map((c) => c.to))];
      for (const col of new Set(targets.map((t) => t.closest('.ms-jr-col')!))) {
        const left = rel(col).x;
        const here = targets.filter((t) => t.closest('.ms-jr-col') === col).sort((a, b) => rel(a).y - rel(b).y);
        // side by side in the 14px between the chips and the column (closer when a column has many targets)
        const step = Math.min(5, 14 / Math.max(1, here.length - 1));
        here.forEach((t, i) => trunk.set(t, left - 14 - i * step));
        lefts.set(col, left - 14 - (here.length - 1) * step);
      }
      const bySource = new Map<HTMLElement, Conn[]>();
      for (const c of conns) if (!c.skip) bySource.set(c.from, [...(bySource.get(c.from) ?? []), c]);
      const paths: [string, string, boolean][] = []; // class, d, arrow
      const hot = (from: string | null, to: string) => !!picked && (from === picked || to === picked);
      for (const b of backs) {
        const s = rel(b.from);
        const t = rel(b.to);
        paths.push([`ms-jr-line is-back${hot(b.fromRef, b.toRef) ? ' is-hot' : ''}`, elbow(s.x, Math.round(s.y + s.h - 14), s.x - 9, Math.round(t.y + t.h - 10), t.x + t.w + 3), true]);
      }
      for (const [from, list] of bySource) {
        const s = rel(from);
        list.sort((a, b) => rel(a.to).y - rel(b.to).y || Number(a.missing.length > 0) - Number(b.missing.length > 0));
        // each chip as wide as the gap allows (up to the next column's lines), so its words wrap, never cut; the chips
        // one under the other, centred on the card
        for (const c of list) c.chip.style.maxWidth = `${Math.max(90, (lefts.get(c.to.closest('.ms-jr-col')!) ?? 0) - (s.x + s.w + 10) - 5)}px`;
        const hs = list.map((c) => c.chip.offsetHeight);
        let top = s.y + s.h / 2 - (hs.reduce((a, h) => a + h, 0) + 6 * (list.length - 1)) / 2;
        list.forEach((c, i) => {
          const y = Math.round(top + hs[i] / 2);
          top += hs[i] + 6;
          const x = s.x + s.w + 10;
          c.chip.style.transform = `translate(${x}px, ${y - hs[i] / 2}px)`;
          const t = rel(c.to);
          const X = trunk.get(c.to)! + (c.missing.length ? 5 : 0);
          const ty = Math.round(t.y + t.h / 2) + (c.missing.length ? 10 : 0);
          const cls = `ms-jr-line${c.missing.length ? ' is-missing' : ''}${c.chip.classList.contains('is-redirect') ? ' is-redirect' : ''}${c.chip.classList.contains('is-hot') ? ' is-hot' : ''}`;
          paths.push([cls, elbow(s.x + s.w, y, X, ty, t.x - 3), true]);
        });
      }
      // the picked page's lines last, so they are drawn on top
      paths.sort((a, b) => Number(a[0].includes('is-hot')) - Number(b[0].includes('is-hot')));
      for (const [cls, d, arrow] of paths) {
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', cls);
        if (arrow) path.setAttribute('marker-end', 'url(#ms-jr-arrow)');
        svg.append(path);
      }
    });
  }

  void load();
  return {
    el: root,
    update: () => draw(),
    destroy() {
      alive = false;
      resize.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
    },
  };
}
