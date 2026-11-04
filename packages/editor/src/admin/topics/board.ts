// One topic as a board (index.ts): its main page, its pages without a group, each group with its lead and pages, and
// the pages in no topic yet, to drag in. A page moves by dragging it onto another place, or with its "Move to" list
// (keyboard and touch). Every move is saved straight away (POST /topics/place); the board draws again from the answer.
import type { PageRow, Topic } from '../../topics';
import { el, icon, link } from '../ui';

export interface Place {
  topic: string | null;
  group: string | null;
  role: 'member' | 'lead' | 'pillar';
  index?: number;
}

export interface BoardOpts {
  topic: Topic;
  pages: Map<string, PageRow>;
  /** pages in no topic (the "add" column), already filtered by the search */
  loose: PageRow[];
  manage: boolean;
  /** the page to show picked (URL `page`) */
  focus: string | null;
  move: (ref: string, to: Place) => void;
  pick: (ref: string | null) => void;
}

const placeKey = (p: Place) => `${p.topic ?? ''}|${p.group ?? ''}|${p.role}`;

/** Every place a page can go in this topic, for the "Move to" list. */
function places(t: Topic): [string, string, Place][] {
  const out: [string, string, Place][] = [
    ['pillar', 'The main page', { topic: t.id, group: null, role: 'pillar' }],
    ['member', 'Pages without a group', { topic: t.id, group: null, role: 'member' }],
  ];
  for (const g of t.groups) {
    out.push([`lead:${g.id}`, `Lead of “${g.name}”`, { topic: t.id, group: g.id, role: 'lead' }]);
    out.push([`group:${g.id}`, `In “${g.name}”`, { topic: t.id, group: g.id, role: 'member' }]);
  }
  out.push(['none', 'Not in a topic', { topic: null, group: null, role: 'member' }]);
  return out;
}

export function board(o: BoardOpts): HTMLElement {
  const t = o.topic;
  const opts = places(t);
  let dragging: string | null = null;

  /** A page as a card: title, address (copy, open), links in, and its Move to list. */
  const card = (ref: string, here: Place) => {
    const p = o.pages.get(ref);
    const weak = p && p.live && p.in <= 1;
    const c = el('div.ms-tb-card', { 'data-ref': ref, draggable: o.manage ? 'true' : null, tabindex: '0', 'aria-selected': String(o.focus === ref) });
    c.classList.toggle('is-weak', !!weak);
    c.classList.toggle('is-picked', o.focus === ref);
    const title = el('a.ms-tb-card__title', { href: p?.edit ?? '#' }, p?.title ?? ref);
    const meta = el('div.ms-tb-card__meta', el('span.ms-num', { title: 'Pages that link here in their text' }, `${p?.in ?? 0} in`), el('span.ms-num', { title: 'Links in its text to pages of the site' }, `${p?.out ?? 0} out`), p && !p.live ? el('span.ms-tb-card__draft', 'Draft') : null, p?.money ? el('span.ms-tb-card__money', 'Service page') : null, weak ? el('span.ms-tb-card__weak', p!.in === 0 ? 'No links in' : 'One link in') : null);
    c.append(title);
    if (p?.url) c.append(link(p.url, 'page address', 'ms-tb-card__url'));
    c.append(meta);
    if (!p) c.append(el('p.ms-tb-card__gone', 'This page is gone. Move it out of the topic.'));
    if (o.manage) {
      const sel = el('select.ms-input.ms-tb-move', { 'aria-label': `Move “${p?.title ?? ref}” to` });
      sel.append(new Option('Move to…', ''));
      for (const [v, label, to] of opts) if (placeKey(to) !== placeKey(here)) sel.append(new Option(label, v));
      sel.addEventListener('change', () => {
        const to = opts.find(([v]) => v === sel.value)?.[2];
        if (to) o.move(ref, to);
      });
      c.append(sel);
      c.addEventListener('dragstart', (e) => {
        dragging = ref;
        e.dataTransfer?.setData('text/plain', ref);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        c.classList.add('is-dragging');
      });
      c.addEventListener('dragend', () => {
        dragging = null;
        c.classList.remove('is-dragging');
      });
    }
    c.addEventListener('focus', () => o.focus !== ref && o.pick(ref));
    return c;
  };

  /** A place pages are dropped on (its cards in order; a drop lands before the card under the pointer). */
  const zone = (label: string, hint: string, to: Place, refs: string[], opts2: { single?: boolean } = {}) => {
    const list = el('div.ms-tb-zone__list');
    for (const r of refs) list.append(card(r, to));
    if (!refs.length) list.append(el('p.ms-tb-zone__empty', o.manage ? hint : 'None.'));
    const z = el('section.ms-tb-zone', { 'data-place': placeKey(to), 'aria-label': label }, el('h3.ms-tb-zone__title', label), list);
    if (o.manage) {
      z.addEventListener('dragover', (e) => {
        if (!dragging) return;
        e.preventDefault();
        z.classList.add('is-over');
      });
      z.addEventListener('dragleave', () => z.classList.remove('is-over'));
      z.addEventListener('drop', (e) => {
        e.preventDefault();
        z.classList.remove('is-over');
        const ref = e.dataTransfer?.getData('text/plain') || dragging;
        if (!ref) return;
        const over = (e.target as HTMLElement).closest?.('.ms-tb-card') as HTMLElement | null;
        const at = over && !opts2.single ? refs.indexOf(over.dataset.ref!) : -1;
        o.move(ref, at >= 0 ? { ...to, index: at } : to);
      });
    }
    return z;
  };

  const main = el('div.ms-tb-main');
  main.append(zone('The main page', 'Drop the page that covers the whole topic here.', { topic: t.id, group: null, role: 'pillar' }, t.pillar ? [t.pillar] : [], { single: true }));
  main.append(zone('Pages without a group', 'Drop pages here.', { topic: t.id, group: null, role: 'member' }, t.members));
  for (const g of t.groups) {
    const box = el('div.ms-tb-group', { 'data-group': g.id }, el('h3.ms-tb-group__name', icon('layers', 15), el('span', g.name)));
    box.append(zone(`Lead of “${g.name}”`, 'Drop the page that leads this group here.', { topic: t.id, group: g.id, role: 'lead' }, g.lead ? [g.lead] : [], { single: true }));
    box.append(zone(`In “${g.name}”`, 'Drop pages here.', { topic: t.id, group: g.id, role: 'member' }, g.members));
    main.append(box);
  }
  const side = el('aside.ms-tb-side', zone('Not in a topic', 'Every page is in a topic.', { topic: null, group: null, role: 'member' }, o.loose.map((p) => p.ref)));
  return el('div.ms-tb', main, side);
}
