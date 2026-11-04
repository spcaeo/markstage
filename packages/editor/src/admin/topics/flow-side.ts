// The Flow view's side panel (flow.ts), shown while a page is picked: that page's details only. Its code and title,
// where it sits, its dates and age, its address (copy and open), its numbers, what is wrong with it, the ways to open
// it, and its shortest way to the service page along the topic's links. Its links are on the map beside it.
import type { ScreenCtx } from '../../host';
import type { JourneyMap } from '../../topics';
import { el, icon } from '../ui';
import { wayTo, type FlowConn, type FlowModel, type FlowNode } from './flow-model';
import { ageBadge, codeDot, dates, placeWords } from './flow-node';
import { pageFacts } from './journey-panel';

export interface SideOpts {
  d: JourneyMap;
  model: FlowModel;
  /** the page picked (none: the panel is hidden) */
  node: FlowNode | null;
  /** every connection of the topic (the way to the service page goes along any of them) */
  every: FlowConn[];
}

export function flowSide(ctx: ScreenCtx): { el: HTMLElement; draw(o: SideOpts): void } {
  const box = el('aside.ms-fl-side', { 'aria-label': 'The page picked' });

  function draw(o: SideOpts): void {
    box.replaceChildren();
    box.hidden = !o.node;
    const n = o.node;
    if (!n) return;
    const close = el('button.ms-iconbtn', { type: 'button', 'aria-label': 'Close the page', title: 'Back to every page (Esc)' }, icon('x', 16));
    close.addEventListener('click', () => ctx.go({ params: { page: null, trail: null } }, true));
    box.append(el('div.ms-fl-side__head', codeDot(n), el('h3.ms-fl-side__title', n.page.title), close), el('p.ms-fl-side__place', placeWords(n, o.model.groups)));
    box.append(el('div.ms-fl-side__dates', dates(n.page), ageBadge(n.age) ?? ''));
    box.append(...pageFacts(ctx, o.d, n.page).slice(1));
    // the way on: from this page to the service page, along the links there are
    const service = [...o.model.all.values()].find((x) => x.role === 'money');
    if (service && service.ref !== n.ref) {
      const way = wayTo(o.every, n.ref, service.ref);
      const codes = (way ?? []).map((r) => o.model.all.get(r)!);
      box.append(
        el(
          'p.ms-fl-way',
          el('span.ms-fl-way__label', 'Way to the service page: '),
          way ? el('span.ms-fl-route', ...codes.flatMap((x, i) => (i ? [el('span.ms-fl-route__arrow', { 'aria-hidden': 'true' }, '→'), codeDot(x, true)] : [codeDot(x, true)]))) : el('span', 'none'),
          way ? el('span.ms-fl-way__n', ` (${way.length - 1} ${way.length === 2 ? 'click' : 'clicks'})`) : '',
        ),
      );
    }
  }

  return { el: box, draw };
}
