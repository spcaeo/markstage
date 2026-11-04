// A page as a card on the Flow view (flow.ts; flow-river.ts places it): its code in a pill of its group's colour and
// its short title on top, one quiet line at its foot ("8 in · 11 out", or a lead's group name), "→ S" when it links
// straight to the service page, ⇄ when it links both ways with the page picked, its age (New, Stale) and a red dot
// for a missing link. The service page is the goal bar on top of the river. Also the code pill on its own (the chips,
// the trail and the side panel use it), the dates and the words for ages.
import { el } from '../ui';
import { shortTitle, type Age, type FlowGroup, type FlowNode } from './flow-model';
import type { Box } from './flow-river';
import { day } from './journey-card';

export const AGE_WORDS: Record<Age, string> = { new: 'New', updated: 'Updated', stale: 'Stale', steady: '', nodate: 'No date' };
export const AGE_HINTS: Record<Age, string> = {
  new: 'First published in the last 90 days.',
  updated: 'Published earlier, changed in the last 90 days.',
  stale: 'Not changed for 12 months or more.',
  steady: 'Changed in the last year, but not in the last 90 days.',
  nodate: 'Its entry gives no date.',
};
/** the ages a card shows (the rest are quiet) */
export const CARD_AGES: Age[] = ['new', 'stale'];
const ROLE_WORDS = { member: 'Article', lead: 'Group lead', pillar: 'Main page', money: 'Service page' };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The colour of a code: the custom properties the stylesheet picks from for the theme. */
export function tint<E extends HTMLElement>(e: E, c: FlowNode['colour']): E {
  e.style.setProperty('--fl-cl', c.light);
  e.style.setProperty('--fl-cd', c.dark);
  return e;
}

/** A code in its pill ("A2"); the code is the meaning, the colour only helps. */
export const codeDot = (n: { code: string; colour: FlowNode['colour'] }, small = false) => tint(el(`span.ms-fl-code${small ? '.is-small' : ''}`, n.code), n.colour);

/** Where a page sits, in words: "Article in Notion (G)", "Main page". */
export function placeWords(n: FlowNode, groups: FlowGroup[]): string {
  const g = groups.find((x) => x.key === n.group);
  return g ? `${ROLE_WORDS[n.role]} in ${g.name} (${g.letter})` : ROLE_WORDS[n.role];
}

/** First published and last changed, as the entry gives them ("no date" when it gives none). */
export function dates(p: { published: string | null; modified: string | null }): HTMLElement {
  return el('p.ms-fl-dates', [p.published ? `Published ${day(p.published)}` : 'Published: no date', p.modified ? `Changed ${day(p.modified)}` : 'Changed: no date'].join(' · '));
}

export function ageBadge(a: Age): HTMLElement | null {
  return CARD_AGES.includes(a) ? el(`span.ms-fl-age.ms-fl-age--${a}`, { title: AGE_HINTS[a] }, AGE_WORDS[a]) : null;
}

/** A box's place in the world, and the size and column the layout check reads back. */
export function placed<E extends HTMLElement>(e: E, b: Box): E {
  Object.assign(e.dataset, { x: String(b.x), y: String(b.y), w: String(b.w), h: String(b.h), col: b.col });
  e.style.left = `${b.x}px`;
  e.style.top = `${b.y}px`;
  e.style.width = `${b.w}px`;
  e.style.height = `${b.h}px`;
  return e;
}

export interface CardOpts {
  /** a group lead's group: its name at the foot; folded, with its page count; `fold` opens or folds it */
  lead?: { group: FlowGroup; folded: boolean; pages: number; fold: (() => void) | null };
  /** it links straight to the service page */
  toService: boolean;
  /** it links both ways with the page picked */
  both?: boolean;
  /** it has a missing link */
  missing: boolean;
}

/** A page as a card. */
export function flowCard(n: FlowNode, b: Box, groups: FlowGroup[], o: CardOpts): HTMLElement {
  const p = n.page;
  const facts = [
    o.lead?.folded ? `${o.lead.group.name}, folded: ${plural(o.lead.pages, 'page', 'pages')}` : '',
    `${p.in} links in, ${p.out} out`,
    o.toService ? 'Links straight to the service page' : '',
    o.both ? 'Links both ways with the page picked' : '',
    AGE_WORDS[n.age] && CARD_AGES.includes(n.age) ? AGE_WORDS[n.age] : '',
    o.missing ? 'Has a missing link' : '',
  ].filter(Boolean);
  const say = `${n.code}, ${placeWords(n, groups)}: ${p.title}. ${facts.join('. ')}.`;
  const card = tint(placed(el('article.ms-fl-card', { 'data-ref': n.ref, 'data-role': n.role, tabindex: '0', 'aria-label': say, title: p.title }), b), n.colour);
  if (o.lead?.folded) card.classList.add('is-folded');
  card.append(el('p.ms-fl-card__title', codeDot(n), el('span', shortTitle(p.title))));
  const foot = el('div.ms-fl-card__foot');
  if (o.lead) {
    const g = o.lead.group;
    const name = el('b.ms-fl-card__group', g.name);
    if (o.lead.fold) {
      const f = el('button.ms-fl-fold', { type: 'button', 'aria-expanded': String(!o.lead.folded), 'aria-label': o.lead.folded ? `Open ${g.name}: ${plural(o.lead.pages, 'page', 'pages')}` : `Fold ${g.name}`, title: o.lead.folded ? 'Show its pages' : 'Fold its pages' }, name, o.lead.folded ? ` · ${plural(o.lead.pages, 'page', 'pages')} ▸` : ' ▾');
      f.addEventListener('click', (ev) => (ev.stopPropagation(), o.lead!.fold!()));
      foot.append(el('span.ms-fl-card__count', f));
    } else foot.append(el('span.ms-fl-card__count', name));
  } else foot.append(el('span.ms-fl-card__count.ms-num', `${p.in} in · ${p.out} out`));
  if (o.toService) foot.append(el('span.ms-fl-tos', { title: 'Links straight to the service page' }, '→ S'));
  if (o.both) foot.append(el('span.ms-fl-both', { title: 'Links both ways' }, '⇄'));
  const age = ageBadge(n.age);
  if (age) foot.append(age);
  if (!p.live) foot.append(el('span.ms-fl-age.ms-fl-age--draft', p.status === 'scheduled' ? 'Scheduled' : 'Draft'));
  if (o.missing) foot.append(el('span.ms-fl-dot', { title: 'Has a missing link' }));
  card.append(foot);
  return card;
}

/**
 * A card whose title and foot line do not fit at their size (a long title, a long group name): its title one size
 * smaller, as many lines as the room leaves. Run once the card is on the page (it measures), and again once the
 * fonts are in.
 */
export function fitCard(card: HTMLElement): void {
  const title = card.querySelector<HTMLElement>('.ms-fl-card__title');
  const foot = card.querySelector<HTMLElement>('.ms-fl-card__foot');
  if (!title || !foot) return;
  card.classList.remove('is-long');
  title.style.maxHeight = '';
  if (title.scrollHeight <= Math.min(60, card.clientHeight - 32 - foot.offsetHeight - 4)) return;
  // smaller words, and less room above and below them
  card.classList.add('is-long');
  title.style.maxHeight = `${Math.floor((card.clientHeight - 24 - foot.offsetHeight - 2) / 18) * 18}px`;
}

/** The place of a page the topic has none of yet: a group with no lead page, a topic with no main page. */
export function emptyCard(code: string, colour: FlowNode['colour'], title: string, b: Box, foot: Node | string): HTMLElement {
  const card = tint(placed(el('article.ms-fl-card.is-empty', { 'aria-label': `${code}: ${title}` }), b), colour);
  card.append(el('p.ms-fl-card__title', codeDot({ code, colour }), el('span', title)), el('div.ms-fl-card__foot', el('span.ms-fl-card__count', foot)));
  return card;
}

/** The service page as the goal bar on top of the river: what every page leads to. */
export function goalBar(n: FlowNode, b: Box, linksIn: number): HTMLElement {
  const say = `${n.code}, the service page, the goal: ${n.page.title}. ${plural(linksIn, 'link', 'links')} in from this topic.`;
  const bar = tint(placed(el('div.ms-fl-goal', { 'data-ref': n.ref, tabindex: '0', 'aria-label': say, title: n.page.title }), b), n.colour);
  bar.append(codeDot(n), el('span.ms-fl-goal__label', 'Goal'), el('span.ms-fl-goal__title', shortTitle(n.page.title)), el('span.ms-fl-goal__n.ms-num', `${plural(linksIn, 'link', 'links')} in`));
  return bar;
}
