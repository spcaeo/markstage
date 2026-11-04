// The Flow view's toolbar above the map (flow.ts), each control a URL parameter, a click a history entry:
//   group=<g>              one group's branch only (none: every group)
//   options=1              the View popover open, with (all off at first):
//     side=1               also draw the links between pages of one level (article to article, lead to lead), as faint
//                          dashed curves
//     deep=1               also draw the links from the main or service page down to a deep page, as arcs
//     age=new|stale        the other pages fade
//     asof=YYYY-MM-DD      the site as it was on that day: pages published after it are left out
// One row of group chips (the key to the codes; a folded group has ▸), then one row: the View button, the one-line
// key, and how to read the map.
import type { ScreenCtx } from '../../host';
import type { JourneyMap } from '../../topics';
import { el, icon } from '../ui';
import { dateRange, DAY_MS, outBy, type Age, type FlowModel } from './flow-model';
import { AGE_HINTS, AGE_WORDS, codeDot } from './flow-node';
import { day } from './journey-card';

/** the extra lines the View popover draws, with their URL key (1: on) */
export const EXTRAS: { key: 'side' | 'deep'; label: string; hint: string }[] = [
  { key: 'side', label: 'Show side links', hint: 'Links between two pages of one level (article to article, lead to lead), as faint dashed curves.' },
  { key: 'deep', label: 'Show deep links', hint: 'Links from the main page or the service page straight down to an article, as arcs.' },
];
export const AGES: Age[] = ['new', 'stale'];
export const ageOn = (q: URLSearchParams): Age | null => ((AGES as string[]).includes(q.get('age') ?? '') ? (q.get('age') as Age) : null);
export const extraOn = (q: URLSearchParams, key: 'side' | 'deep') => q.get(key) === '1';

export interface ToolsOpts {
  /** the group shown alone (null: every group) */
  only: string | null;
  /** the groups folded */
  folded: Set<string>;
  /** a page is picked (the step round it is shown) */
  picked: boolean;
}

export function flowTools(ctx: ScreenCtx, d: JourneyMap, m: FlowModel, now: number, o: ToolsOpts): HTMLElement {
  const q = ctx.params();
  const go = (params: Record<string, string | null>) => ctx.go({ params }, true);
  // every group, then one group at a time, each with its letter and colour (the key to the codes); M and S after
  const row = el('div.ms-fl-groups', { role: 'group', 'aria-label': 'Groups' });
  const all = el('button.ms-adm-chip', { type: 'button', 'aria-pressed': String(!o.only), title: 'Every group of the topic' }, 'All groups');
  all.addEventListener('click', () => go({ group: null, page: null, trail: null }));
  row.append(all);
  for (const g of m.groups) {
    const pages = g.members.length + (g.lead ? 1 : 0);
    const folded = !o.only && o.folded.has(g.key);
    const b = el('button.ms-adm-chip', { type: 'button', 'aria-pressed': String(o.only === g.key), title: `${g.name}: ${pages} ${pages === 1 ? 'page' : 'pages'}${folded ? ', folded on the map' : ''}. Show this group only.` }, codeDot({ code: g.letter, colour: g.colour }, true), g.name, folded ? el('span.ms-fl-groups__fold', { 'aria-label': ', folded' }, ' ▸') : '');
    b.addEventListener('click', () => go({ group: o.only === g.key ? null : g.key, page: null, trail: null }));
    row.append(b);
  }
  for (const x of [...m.all.values()].filter((x) => x.role === 'pillar' || x.role === 'money')) row.append(el('span.ms-fl-fixed', codeDot(x, true), x.role === 'pillar' ? 'Main page' : 'Service page'));

  // the extra lines
  const extras = el('div.ms-adm-chips.ms-fl-toggles', { role: 'group', 'aria-label': 'Extra lines' }, el('span.ms-fl-tools__label', 'Lines:'));
  for (const t of EXTRAS) {
    const on = extraOn(q, t.key);
    const b = el('button.ms-adm-chip', { type: 'button', 'aria-pressed': String(on), title: t.hint }, t.label);
    b.addEventListener('click', () => go({ [t.key]: on ? null : '1' }));
    extras.append(b);
  }
  // old and new pages
  const age = ageOn(q);
  const n = (a: Age) => m.nodes.filter((x) => x.age === a).length;
  const ages = el('div.ms-adm-chips.ms-fl-ages', { role: 'group', 'aria-label': 'Old and new pages' }, el('span.ms-fl-tools__label', 'Pages:'));
  const chip = (a: Age | null, label: string, count: number, hint: string) => {
    const b = el('button.ms-adm-chip', { type: 'button', 'aria-pressed': String(age === a), title: hint }, label, el('span.ms-links-count.ms-num', String(count)));
    b.addEventListener('click', () => go({ age: a }));
    ages.append(b);
  };
  chip(null, 'Any age', m.nodes.length, 'Every page on the map now, whatever its age.');
  for (const a of AGES) chip(a, AGE_WORDS[a], n(a), AGE_HINTS[a]);

  // the site as it was on a day
  const range = dateRange(d, now);
  const asOf = q.get('asof');
  const when = el('div.ms-fl-when');
  if (range) {
    const t0 = Date.parse(range.first);
    const t1 = Date.parse(range.last);
    const days = Math.max(1, Math.round((t1 - t0) / DAY_MS));
    const at = asOf && Number.isFinite(Date.parse(asOf)) ? Math.min(days, Math.max(0, Math.round((Date.parse(asOf) - t0) / DAY_MS))) : days;
    const iso = (i: number) => new Date(t0 + i * DAY_MS).toISOString().slice(0, 10);
    // a day as people read it, the same day wherever the browser is
    const dayOf = (i: number) => day(`${iso(i)}T12:00:00Z`);
    const say = el('output.ms-fl-when__day', asOf ? dayOf(at) : 'today');
    const slider = el('input.ms-fl-when__slider', { type: 'range', min: '0', max: String(days), step: '1', value: String(at), 'aria-label': 'Show the site as it was on', 'aria-valuetext': asOf ? dayOf(at) : 'today' });
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      say.textContent = v >= days ? 'today' : dayOf(v);
      slider.setAttribute('aria-valuetext', say.textContent);
    });
    slider.addEventListener('change', () => {
      const v = Number(slider.value);
      go({ asof: v >= days ? null : iso(v), page: null, trail: null });
    });
    when.append(el('span.ms-fl-tools__label', { 'aria-hidden': 'true' }, 'The site as it was on'), slider, say);
    if (asOf) {
      const hidden = [...m.all.values()].filter((x) => !outBy(x.page, asOf)).length;
      const back = el('button.ms-adm-chip', { type: 'button' }, 'Back to today');
      back.addEventListener('click', () => go({ asof: null }));
      when.append(el('span.ms-fl-when__note', `${hidden} ${hidden === 1 ? 'page of the topic was' : 'pages of the topic were'} not out yet. Links are drawn as they are today.`), back);
    }
  } else when.append(el('span.ms-fl-when__note', 'No page of this topic gives a publish date, so the map cannot go back in time.'));

  // the View popover
  const open = q.get('options') === '1';
  const on = EXTRAS.filter((t) => extraOn(q, t.key)).length + (age ? 1 : 0) + (asOf ? 1 : 0);
  const view = el('button.ms-btn.ms-btn--sm.ms-fl-viewbtn', { type: 'button', 'aria-expanded': String(open), 'aria-controls': 'ms-fl-options' }, icon('sliders', 14), 'View', on ? el('span.ms-fl-viewbtn__n.ms-num', `· ${on} on`) : '');
  view.addEventListener('click', () => go({ options: open ? null : '1' }));
  const panel = el('div.ms-fl-options', { id: 'ms-fl-options', role: 'group', 'aria-label': 'View' }, el('div.ms-fl-options__row', extras), el('div.ms-fl-options__row', ages), el('div.ms-fl-options__row', when));
  panel.hidden = !open;
  const folded = o.only ? 0 : o.folded.size;
  const how = o.picked ? 'Click a page on either side to walk on.' : folded ? `${folded} ${folded === 1 ? 'group' : 'groups'} folded (▸ opens one). Click a page to see its links.` : 'Click a page to see where it comes from and where it goes.';
  const bar = el('div.ms-fl-bar', el('div.ms-fl-viewwrap', view, panel), flowKey(), el('p.ms-fl-how', how));
  return el('div.ms-fl-tools', row, bar);
}

/** The key, one line: lines, the red dot, the age badges (the group chips are the key to the codes). */
export function flowKey(): HTMLElement {
  return el(
    'p.ms-fl-key',
    { role: 'note', 'aria-label': 'How to read the map' },
    el('span', el('i.ms-fl-key__line', { 'aria-hidden': 'true' }), 'Line = a link (thicker = more links)'),
    el('span', el('i.ms-fl-dot', { 'aria-hidden': 'true' }), 'Red dot = a missing link'),
    el('span', el('span.ms-fl-age.ms-fl-age--new', AGE_WORDS.new), ' / ', el('span.ms-fl-age.ms-fl-age--stale', AGE_WORDS.stale), ' = page age'),
  );
}
