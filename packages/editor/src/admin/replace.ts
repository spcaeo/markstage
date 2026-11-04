// Find and replace across the site (editors and above), docs/OPERATIONS.md "Writing and finding":
//   #/replace?find=&with=&case=1&words=1&keep=0&collection=&flip=<kind:c/id,…>   every entry with the text, in groups by
//                         where it sits: plain text (ticked), then inside a link address, in an image file name,
//                         inside HTML, in code and in a field's name (each unticked, so an address never changes by
//                         accident). Each place shows its field and the words around it (old struck through, new
//                         beside it): plain text as it reads, a link as a chip with its address to copy or open; the
//                         other groups as written. "Keep the case of each match" (on unless keep=0; only without
//                         Match case) writes the new text as ACME, Acme or acme was. `flip` holds the ticks changed from those defaults, so a reload keeps them. A
//                         new text too long for the address stays out of it (a reload asks for it again).
import type { ScreenCtx } from '../host';
import { copyable, siteUrl } from '../copy';
import { config } from '../runtime';
import * as api from './api';
import { button, chips, el, failure, link, message, page, state, undoToast, value } from './ui';

const ref = (e: { collection: string; id: string }) => `${e.collection}/${e.id}`;
const STATUS: Record<string, string> = { published: 'Live', draft: 'Draft', scheduled: 'Scheduled' };
/** Each group: its heading, and for the unticked ones what ticking it would change. */
const GROUPS: [api.FindKind, string, string][] = [
  ['text', 'In the text', ''],
  ['link', 'Inside a link address', 'Changing these changes where a link goes. Tick only the ones you mean to change.'],
  ['image', 'In an image file name', 'Changing these points the page at another file, which may not exist.'],
  ['html', 'Inside HTML (a tag or its attributes)', 'These are part of the page’s HTML, not its words.'],
  ['code', 'In code', 'Code samples and inline code are shown as written.'],
  ['key', 'In a field name', 'A field’s name, not its value: the site may stop reading that field.'],
];
/** Longer new texts stay out of the address (they are kept in this tab only). */
const URL_MAX = 300;

export function mountReplace(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Change many at once', 'Search every page and post for a piece of text, see each place it would change, then replace it in the places you tick, in one step.');
  let hits: api.FindHit[] = [];
  let shownFor = '';
  let alive = true;
  let longWith: string | null = null;
  let result: HTMLElement | null = null;

  const opts = (): api.FindOptions & { lost: boolean } => {
    const q = ctx.params();
    const long = q.get('long') === '1';
    const matchCase = q.get('case') === '1';
    return { q: q.get('find') ?? '', with: long ? longWith ?? '' : q.get('with') ?? '', case: matchCase, whole: q.get('words') === '1', keep: !matchCase && q.get('keep') !== '0', lost: long && longWith === null };
  };
  const flipped = () => new Set((ctx.params().get('flip') ?? '').split(',').filter(Boolean));
  const ticked = (k: api.FindKind, h: api.FindHit) => (k === 'text') !== flipped().has(`${k}:${ref(h)}`) && !problemOf(k, h);
  const problemOf = (k: api.FindKind, h: api.FindHit) => (k === 'text' ? h.problem : h.problems?.[k]) ?? null;
  /** Set the ticks of these rows in one group, as `flip` records them. */
  const setTicks = (k: api.FindKind, rows: api.FindHit[], on: boolean) => {
    const f = flipped();
    for (const h of rows) {
      const key = `${k}:${ref(h)}`;
      if (on === (k === 'text')) f.delete(key);
      else f.add(key);
    }
    ctx.go({ params: { flip: [...f].join(',') || null } });
  };

  function searchForm(): HTMLElement {
    const o = opts();
    const find = el('input.ms-input', { name: 'find', type: 'text', required: true, maxlength: 200, spellcheck: 'false', 'aria-label': 'Find' });
    find.value = o.q;
    const repl = el('input.ms-input', { name: 'with', type: 'text', maxlength: 2000, spellcheck: 'false', 'aria-label': 'Replace with' });
    repl.value = o.with ?? '';
    const box = (name: string, label: string, on: boolean, off = false) => el('label.ms-adm-checkline', el('input', { type: 'checkbox', name, checked: on, disabled: off }), el('span', label));
    const f = el(
      'form.ms-adm-card.ms-adm-findform',
      el('label.ms-field.ms-adm-field', el('span.ms-field__label', 'Find'), find),
      el('label.ms-field.ms-adm-field', el('span.ms-field__label', 'Replace with'), repl, o.lost ? el('span.ms-adm-field__err', { role: 'alert' }, 'The new text was too long to keep in the address: type it again.') : null),
      el('div.ms-adm-row', box('case', 'Match case', Boolean(o.case)), box('words', 'Whole words only', Boolean(o.whole)), box('keep', 'Keep the case of each match', Boolean(o.keep), Boolean(o.case)), button('Search', () => undefined, { kind: 'primary', type: 'submit', icon: 'search' })),
    );
    // with Match case, every match is as typed: there is no case to keep
    const caseBox = f.elements.namedItem('case') as HTMLInputElement;
    const keepBox = f.elements.namedItem('keep') as HTMLInputElement;
    caseBox.addEventListener('change', () => {
      keepBox.disabled = caseBox.checked;
      keepBox.checked = !caseBox.checked && ctx.params().get('keep') !== '0';
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (n: string) => f.elements.namedItem(n) as HTMLInputElement;
      if (!v('find').value.trim()) return v('find').focus();
      result = null;
      const w = v('with').value;
      longWith = w.length > URL_MAX ? w : null;
      ctx.go({ params: { find: v('find').value, with: longWith === null ? w : null, long: longWith === null ? null : '1', case: v('case').checked ? '1' : null, words: v('words').checked ? '1' : null, keep: v('case').checked || v('keep').checked ? null : '0', flip: null, collection: null } }, true);
    });
    return f;
  }

  async function search(): Promise<void> {
    const o = opts();
    const key = JSON.stringify(o);
    if (!o.q.trim()) {
      hits = [];
      shownFor = key;
      return render();
    }
    if (key === shownFor) return render();
    p.body.replaceChildren(searchForm(), state('loading', 'Searching every entry…'));
    try {
      hits = (await api.find(o)).entries;
      shownFor = key;
    } catch (e) {
      p.body.replaceChildren(searchForm(), failure(e, () => void search()));
      return;
    }
    if (alive) render();
  }

  function sample(s: api.FindSample, w: string): HTMLElement {
    const to = s.to ?? w;
    type Bit = Node | string | null;
    const swap = (m: string): Bit[] => [el('del', m), to ? el('ins', to) : null];
    if (!s.read) return el('li.ms-adm-sample', el('span.ms-adm-sample__where', s.field), el('code.ms-adm-sample__text', s.before, ...swap(s.match), s.after));
    // as it reads: a link is a chip with its words, and its address to copy or open
    const words = (parts: (string | { match: string })[]): Bit[] => parts.flatMap((x): Bit[] => (typeof x === 'string' ? [x] : swap(x.match)));
    const shown = s.read.flatMap((x): Bit[] =>
      typeof x === 'string' || 'match' in x
        ? words([x])
        : [el('span.ms-adm-sample__chip', el('span', ...words(x.label)), copyable(x.link, { label: 'link address', open: /^https?:/.test(x.link) ? x.link : x.link.startsWith('/') ? siteUrl(x.link) : undefined, iconsOnly: true }))],
    );
    return el('li.ms-adm-sample', el('span.ms-adm-sample__where', s.field), el('span.ms-adm-sample__text.ms-adm-sample__text--read', ...shown));
  }

  /** One group: its rows (an entry each, with its places in this group), Select all / none. */
  function group(k: api.FindKind, title: string, note: string, rows: api.FindHit[], names: Map<string, string>, w: string): HTMLElement {
    const places = rows.reduce((n, h) => n + (h.kinds[k] ?? 0), 0);
    const list = el('div.ms-adm-findlist');
    for (const h of rows) {
      const problem = problemOf(k, h);
      const tick = el('input', { type: 'checkbox', checked: ticked(k, h), disabled: Boolean(problem), 'aria-label': `Replace in “${h.title}”, ${title.toLowerCase()}` });
      tick.addEventListener('change', () => setTicks(k, [h], tick.checked));
      const shown = h.samples.filter((s) => s.kind === k);
      const n = h.kinds[k] ?? 0;
      list.append(
        el('section.ms-adm-card.ms-adm-findhit',
          el('header.ms-adm-findhit__head',
            tick,
            value(h.title, 'title', 'ms-adm-findhit__title'),
            el('a.ms-adm-sub', { href: `#/e/${encodeURIComponent(h.collection)}/${encodeURIComponent(h.id)}` }, 'Edit'),
            el('span.ms-adm-badge', STATUS[h.status] ?? h.status),
            el('span.ms-adm-sub', `${names.get(h.collection) ?? h.collection} · ${n} place${n === 1 ? '' : 's'}`),
            h.url ? link(h.url, 'address', 'ms-adm-sub') : null,
          ),
          problem ? el('p.ms-adm-warnline', { role: 'note' }, `Left as it is: ${problem}`) : null,
          el('ol.ms-adm-samples', ...shown.map((s) => sample(s, w))),
          shown.length < n ? el('p.ms-adm-sub', `And ${n - shown.length} more place${n - shown.length === 1 ? '' : 's'}.`) : null,
        ),
      );
    }
    const can = rows.filter((h) => !problemOf(k, h));
    const all = button('Select all', () => setTicks(k, can, true), { small: true, kind: 'quiet' });
    const none = button('Select none', () => setTicks(k, can, false), { small: true, kind: 'quiet' });
    all.disabled = can.every((h) => ticked(k, h));
    none.disabled = can.every((h) => !ticked(k, h));
    return el(`section.ms-adm-findgroup${k === 'text' ? '' : '.ms-adm-findgroup--careful'}`, { 'aria-label': title },
      el('div.ms-adm-findgroup__head', el('h2.ms-adm-h2', `${title} · ${places} place${places === 1 ? '' : 's'}`), el('span.ms-adm-grow'), all, none),
      note ? el('p.ms-adm-warnline', { role: 'note' }, note) : null,
      list,
    );
  }

  function render(): void {
    const o = opts();
    const parts: HTMLElement[] = [searchForm()];
    if (result) parts.push(result);
    if (!o.q.trim()) return void p.body.replaceChildren(...parts, state('empty', 'Type what to find', 'Every entry is searched: titles, fields and text.'));
    const only = ctx.params().get('collection') ?? '';
    const names = new Map(config().collections.map((c) => [c.id, c.label]));
    const present = [...new Set(hits.map((h) => h.collection))];
    p.bar.hidden = present.length < 2;
    p.bar.replaceChildren(present.length > 1 ? chips(ctx, 'collection', 'Collection', [['', 'All'], ...present.map((c) => [c, names.get(c) ?? c] as [string, string])]) : el('span'));
    const rows = hits.filter((h) => !only || h.collection === only);
    if (!rows.length) return void p.body.replaceChildren(...parts, state('empty', `“${o.q}” is not in any entry`, o.case || o.whole ? 'Try without Match case or Whole words.' : ''));
    // what is ticked: per entry, the groups to change, and how many places that is
    const chosen = rows.map((h) => ({ h, kinds: GROUPS.map(([k]) => k).filter((k) => (h.kinds[k] ?? 0) > 0 && ticked(k, h)) })).filter((c) => c.kinds.length);
    const places = chosen.reduce((n, c) => n + c.kinds.reduce((m, k) => m + (c.h.kinds[k] ?? 0), 0), 0);
    const all = rows.reduce((n, h) => n + h.count, 0);
    const live = chosen.filter((c) => c.h.status === 'published').length;
    const many = chosen.length;
    const apply = button(`${o.with ? 'Replace' : 'Remove'} ${places} place${places === 1 ? '' : 's'} in ${many} entr${many === 1 ? 'y' : 'ies'}`, () => void run(chosen, places), { kind: 'primary', icon: 'check' });
    apply.disabled = !many || o.lost;
    const bulk = el('a.ms-btn', { href: `#/bulk?items=${encodeURIComponent(rows.map(ref).join(','))}` }, 'Change these entries…');
    parts.push(
      el('div.ms-adm-findsum',
        el('p', `${all} place${all === 1 ? '' : 's'} in ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}, ${places} ticked.${live ? ` ${live} of the ticked entries ${live === 1 ? 'is' : 'are'} live: the site is rebuilt and the change goes live.` : ''}`),
        el('div.ms-adm-row', bulk, apply)),
    );
    for (const [k, title, note] of GROUPS) {
      const inGroup = rows.filter((h) => (h.kinds[k] ?? 0) > 0);
      if (inGroup.length) parts.push(group(k, title, note, inGroup, names, o.with ?? ''));
    }
    p.body.replaceChildren(...parts);
  }

  async function run(chosen: { h: api.FindHit; kinds: api.FindKind[] }[], places: number): Promise<void> {
    const o = opts();
    const n = chosen.length;
    const careful = chosen.some((c) => c.kinds.some((k) => k !== 'text'));
    const what = `${o.with ? `Replace “${o.q}” with “${o.with}”` : `Remove “${o.q}”`} in ${places} place${places === 1 ? '' : 's'}, ${n} entr${n === 1 ? 'y' : 'ies'}?`;
    const ok = await ctx.ask(what, `${careful ? 'Some ticked places are addresses, file names, HTML, code or field names, not plain text. ' : ''}All of it is one change in the site’s history: Undo on the note that follows puts every entry back.`, [['cancel', 'Cancel'], ['go', o.with ? 'Replace' : 'Remove', 'ms-btn ms-btn--primary']]);
    if (ok !== 'go') return;
    try {
      const r = await api.replaceAll(o, chosen.map(({ h, kinds }) => ({ collection: h.collection, id: h.id, version: h.version, kinds })));
      result = el(
        'section.ms-adm-card.ms-adm-findresult',
        { role: 'status' },
        el('h2.ms-adm-h2', r.changed.length ? `Changed ${r.changed.length} entr${r.changed.length === 1 ? 'y' : 'ies'}` : 'Nothing was changed'),
        r.job ? el('p', 'The live ones are being rebuilt. ', el('a', { href: `#/jobs/${encodeURIComponent(r.job)}` }, 'Follow it on the Publishing page')) : null,
        r.skipped.length ? el('ul.ms-adm-findskips', ...r.skipped.map((s) => el('li', el('strong', s.title), ` — ${s.reason ?? s.problem ?? ''}`))) : null,
      );
      if (r.changed.length) {
        undoToast(ctx, `Changed ${r.changed.length} entr${r.changed.length === 1 ? 'y' : 'ies'}.`, r.commit, () => {
          shownFor = '';
          result = null;
          if (alive) void search();
        });
      } else ctx.toast('Nothing was changed.', 'info');
      shownFor = '';
      if (ctx.params().has('flip')) ctx.go({ params: { flip: null } });
      else void search();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  ctx.setTitle('Change many at once');
  void search();
  return {
    update: () => void search(),
    destroy: () => {
      alive = false;
    },
  };
}
