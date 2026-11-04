// #/groups/<collection>?g=<group>&menu=<id>&moveto=<id>&move=<id>&to=<group>: the entries a site sorts into groups
// (topic clusters: config `groups`, docs/CONFIG.md), one group at a time, in the order the group's page shows them.
// On the order component: drag by the grip, Alt+↑/↓, Move to…; a move writes the group's `order` (the ids that keep a
// place of their own; the rest follow, newest first) in one save, with Undo. "Move to another topic…" moves an entry
// into another group through POST site/move: a dry run first (its new address, the redirects, the links that follow),
// then the move, and the entry leaves the old group's order. The server decides who may do either and says why not.
import { ApiError, getEntry, listEntries, request, type EntrySummary } from '../api';
import { saveChanges } from '../pages/api';
import { button, chips, drawer, el, failure, link, message, page, state, value } from '../admin/ui';
import type { ScreenCtx } from '../host';
import { mountOrder, type OrderItem, type OrderList, type Place } from '../order';
import { moveItems } from '@markstage/core';
import { collection, config, type CollectionInfo } from '../runtime';
import { arrange, orderAfterMove, placeWords, sameOrder, withoutOne, type Member } from './model';

type Groups = NonNullable<CollectionInfo['groups']>;
interface Row extends OrderItem {
  m: Member;
}
interface MoveAnswer {
  dry?: boolean;
  moved: { collection: string; id: string; url: string | null; oldUrl: string | null; version?: string }[];
  linksUpdated: { collection: string; id: string }[];
  links?: number;
  redirects: { from: string; to: string }[];
}

/** The collections whose entries sit in groups. */
export const grouped = () => config().collections.filter((c): c is CollectionInfo & { groups: Groups } => !!c.groups);
/** "Topics" → "topic": one group, in a sentence. */
const one = (g: Groups) => g.label.replace(/ies$/, 'y').replace(/s$/, '').toLowerCase();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function mountGroups(host: HTMLElement, ctx: ScreenCtx) {
  const c = grouped().find((x) => x.id === ctx.args[0]) ?? grouped()[0] ?? null;
  const G = c?.groups ?? null;
  const p = page(host, G?.label ?? 'Groups', G ? `Each ${one(G)}’s ${c!.label.toLowerCase()} in the order its page shows them. Drag one to give it a place of its own; the rest follow, newest first.` : '');
  let groups: EntrySummary[] = [];
  let members: (EntrySummary & Member)[] = [];
  let open: { id: string; version: string; order: string[] } | null = null;
  let rows: Row[] = [];
  let pinned = 0;
  let list: OrderList | null = null;
  let busy = false;
  let shown = { menu: null as string | null, moveto: null as string | null };
  let drawn = '';
  // the list, and the move drawer beside it
  const layout = el('div.ms-adm-split');
  let drawerEl: HTMLElement | null = null;
  let drawerFor = '';

  const load = async () => {
    if (!c || !G) return void p.body.replaceChildren(state('empty', 'Nothing sorted into groups', 'This site’s config gives no collection `groups`.'));
    if (ctx.args[0] !== c.id) ctx.go({ args: [c.id] });
    p.body.replaceChildren(state('loading', `Loading the ${G.label.toLowerCase()}…`));
    try {
      [groups, members] = await Promise.all([listEntries(G.collection), listEntries(c.id) as Promise<(EntrySummary & Member)[]>]);
      groups.sort((a, b) => a.title.localeCompare(b.title));
      await openGroup();
    } catch (e) {
      p.body.replaceChildren(failure(e, () => void load()));
    }
  };

  /** The group the URL names (the first when it names none): its order, read fresh. */
  const openGroup = async () => {
    const want = ctx.params().get('g') ?? groups[0]?.id ?? null;
    if (!want) return void p.body.replaceChildren(state('empty', `No ${G!.label.toLowerCase()} yet`, `Add one in ${collection(G!.collection)?.label ?? G!.collection} first.`));
    if (!groups.some((x) => x.id === want)) return void p.body.replaceChildren(state('denied', 'Not available to you', `There is no ${one(G!)} “${want}” here, or it is not yours to see.`));
    const e = await getEntry(G!.collection, want);
    const raw = (e.data ?? {})[G!.order];
    open = { id: want, version: e.version, order: Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [] };
    draw();
  };

  const draw = () => {
    const g = groups.find((x) => x.id === open!.id)!;
    const mine = members.filter((m) => m.groupId === open!.id);
    const a = arrange(mine, open!.order);
    pinned = a.pinned;
    rows = a.list.map((m) => ({ id: m.id, label: m.title, m }));
    const counts = new Map<string, number>();
    for (const m of members) if (m.groupId) counts.set(m.groupId, (counts.get(m.groupId) ?? 0) + 1);
    const pick = chips(ctx, 'g', G!.label, groups.map((x): [string, string] => [x.id, `${x.title} (${counts.get(x.id) ?? 0})`]));
    // the open group's chip is pressed even when the URL names none (the first)
    pick.querySelectorAll<HTMLButtonElement>('button').forEach((b, i) => b.setAttribute('aria-pressed', String(groups[i]!.id === g.id)));
    const loose = members.filter((m) => !m.groupId || !groups.some((x) => x.id === m.groupId)).length;
    const head = el('div.ms-groups__head',
      el('div.ms-groups__name', el('h2.ms-adm-h2', g.title), g.url ? link(g.url, `the address of ${g.title}`) : null, el('a.ms-adm-sub', { href: `#/p/${G!.collection}/${g.id}` }, `Open the ${one(G!)}`)),
      el('p.ms-adm-sub', placeWords(rows.length, pinned, c!.label.toLowerCase(), one(G!))),
    );
    const box = el('section.ms-adm-card.ms-groups__list');
    list?.destroy();
    layout.replaceChildren(el('div.ms-adm-split__main', pick, loose ? el('p.ms-adm-sub', `${plural(loose, c!.label.toLowerCase().replace(/s$/, ''))} in no ${one(G!)}.`) : '', head, box));
    p.body.replaceChildren(layout);
    drawerEl = null;
    drawerFor = '';
    list = mountOrder<Row>({
      root: box,
      noun: c!.label.toLowerCase().replace(/s$/, ''),
      label: `${g.title}: ${c!.label}`,
      items: () => rows,
      row: (r) => line(r, rows.indexOf(r)),
      move: (ids, to) => void move(ids, to),
      extra: (id) => [
        ...(rows.findIndex((r) => r.id === id) < pinned ? [{ label: 'Back to newest first', icon: 'clock', run: () => void setOrder(withoutOne(open!.order, id), id, 'back among the newest first') }] : []),
        { label: `Move to another ${one(G!)}…`, icon: 'layers', run: () => ctx.go({ params: { move: id, to: null, menu: null } }, true) },
      ],
      opened: (w) => {
        shown = 'menu' in w ? { menu: w.menu, moveto: null } : { menu: null, moveto: w.moveTo };
        ctx.go({ params: shown });
      },
    });
    drawn = open!.id;
    ctx.setTitle(`${G!.label} · ${g.title}`);
    follow();
  };

  const line = (r: Row, i: number) => {
    const m = r.m;
    return el(`div.ms-groups__row${i < pinned ? '.is-pinned' : ''}`,
      el('a.ms-groups__title', { href: `#/e/${c!.id}/${m.id}` }, m.title),
      m.url ? link(m.url, `the address of ${m.title}`, 'ms-groups__url') : null,
      m.status && m.status !== 'published' ? el('span.ms-adm-badge', m.status === 'draft' ? 'Draft' : m.status === 'scheduled' ? 'Scheduled' : m.status) : null,
      el('span.ms-adm-grow'),
      i < pinned ? el('span.ms-groups__place', { title: 'Keeps this place on its page' }, `Place ${i + 1}`) : el('span.ms-adm-sub', m.date ? `${m.date.slice(0, 10)}` : ''),
    );
  };

  /** The URL's open grip menu, Move to… or move drawer (a reload, Back). */
  const follow = () => {
    const q = ctx.params();
    const want = { menu: q.get('menu'), moveto: q.get('moveto') };
    if (want.menu !== shown.menu || want.moveto !== shown.moveto) {
      shown = want;
      if (want.menu) list?.openMenu(want.menu);
      else if (want.moveto) list?.openMoveTo(want.moveto);
    }
    moveDrawer();
  };

  async function move(ids: string[], to: Place): Promise<void> {
    if (busy) return;
    const after = moveItems(rows, ids, to).map((r) => r.id);
    const next = orderAfterMove(after, rows.slice(0, pinned).map((r) => r.id), ids);
    await setOrder(next, ids[0]!, ids.length === 1 ? `to place ${after.indexOf(ids[0]!) + 1}` : `${ids.length} moved`);
  }

  /** One save of the group's order; Undo puts the old one back. */
  async function setOrder(next: string[], focus: string, what: string, undo = true): Promise<boolean> {
    const was = open!.order;
    if (sameOrder(next, was)) return true;
    busy = true;
    try {
      const r = await saveChanges(G!.collection, open!.id, [{ op: 'set', path: G!.order, value: next }], open!.version);
      open = { ...open!, version: r.version, order: next };
      draw();
      list?.focus(focus);
      const title = members.find((m) => m.id === focus)?.title ?? focus;
      if (undo) ctx.toast(`“${title}”: ${what}.`, 'ok', { action: { label: 'Undo', run: () => void setOrder(was, focus, 'as it was', false) } });
      return true;
    } catch (e) {
      ctx.toast(`Not changed: ${message(e)}`, 'error');
      // changed elsewhere: read it again
      if (e instanceof ApiError && e.status === 409) void openGroup();
      return false;
    } finally {
      busy = false;
    }
  }

  // ---------- into another group ----------
  function moveDrawer(): void {
    const q = ctx.params();
    const id = q.get('move');
    const to = q.get('to');
    const key = `${id}|${to}`;
    if (!id) return void (drawerEl?.remove(), (drawerEl = null), (drawerFor = ''));
    if (key === drawerFor && drawerEl?.isConnected) return;
    drawerEl?.remove();
    drawerFor = key;
    const m = members.find((x) => x.id === id);
    const close = () => ctx.go({ params: { move: null, to: null } }, true);
    const d = drawer(layout, `Move to another ${one(G!)}`, close);
    drawerEl = d.el;
    if (!m) return void d.body.append(state('denied', 'Not available to you', `There is no ${c!.label.toLowerCase().replace(/s$/, '')} “${id}” here.`));
    const sid = 'ms-groups-to';
    const sel = el('select.ms-input', { id: sid }, el('option', { value: '' }, `Choose a ${one(G!)}…`), ...groups.filter((x) => x.id !== m.groupId).map((x) => el('option', { value: x.id, selected: x.id === to }, x.title)));
    sel.addEventListener('change', () => ctx.go({ params: { to: (sel as HTMLSelectElement).value || null } }, true));
    const out = el('div.ms-groups__plan');
    d.body.append(el('p', el('strong', m.title), ' ', m.url ? link(m.url, `the address of ${m.title}`) : ''), el('label.ms-adm-label', { for: sid }, `The ${one(G!)} it goes to`), sel, out);
    d.el.focus();
    if (to) void plan(m, to, out);
  }

  const moveBody = (m: Member, to: string, dry: boolean) => ({ moves: [{ collection: c!.id, id: m.id, version: m.version, set: { [G!.field]: to } }], ...(dry ? { dry: true } : {}) });

  async function plan(m: Member & EntrySummary, to: string, out: HTMLElement): Promise<void> {
    const dest = groups.find((x) => x.id === to);
    if (!dest) return void out.replaceChildren(el('p.ms-adm-note.is-bad', `There is no ${one(G!)} “${to}”.`));
    out.replaceChildren(state('loading', 'Working out what changes…'));
    let r: MoveAnswer;
    try {
      r = await request<MoveAnswer>('site/move', { method: 'POST', body: JSON.stringify(moveBody(m, to, true)) });
    } catch (e) {
      return void out.replaceChildren(refusal(e));
    }
    // with no redirects hook the server writes none: say so, the old address stops working
    const hook = await request<{ on: boolean }>('site/redirects').then((x) => x.on, () => null);
    const mv = r.moved.find((x) => x.id === m.id);
    const facts = el('dl.ms-adm-facts');
    const fact = (k: string, v: Node | string) => facts.append(el('dt', k), el('dd', v));
    if (mv?.oldUrl && mv.url && mv.oldUrl !== mv.url) fact('Address', fromTo(mv.oldUrl, mv.url));
    else fact('Address', 'Stays the same');
    if (hook === false && r.redirects.length) fact('Redirects', el('p.ms-adm-note.is-bad', `None: this site has no redirects hook, so ${r.redirects.length === 1 ? 'the old address' : `its ${r.redirects.length} old addresses`} would stop working (${r.redirects.map((x) => x.from).join(', ')}). Ask whoever runs the site to set one up.`));
    else fact('Redirects', r.redirects.length ? el('ul.ms-groups__redirects', ...r.redirects.map((x) => el('li', fromTo(x.from, x.to)))) : 'None needed');
    const n = r.links ?? r.linksUpdated.length;
    fact('Links to it', n ? `${plural(n, 'page')} ${n === 1 ? 'has' : 'have'} a link that follows to the new address` : 'No page links to it');
    if (open!.order.includes(m.id) && m.groupId === open!.id) fact('Its place', `It leaves this ${one(G!)}’s order; in ${dest.title} it follows by date until you give it a place.`);
    const go = button(`Move to ${dest.title}`, async () => {
      go.disabled = true;
      go.classList.add('is-busy');
      try {
        const done = await request<MoveAnswer>('site/move', { method: 'POST', body: JSON.stringify(moveBody(m, to, false)) });
        const from = m.groupId;
        // out of the old group's order, so its page does not list an entry it no longer has
        if (from === open!.id && open!.order.includes(m.id)) await setOrder(withoutOne(open!.order, m.id), m.id, `left the order of ${groups.find((x) => x.id === from)?.title ?? from}`, false);
        const now = done.moved.find((x) => x.id === m.id);
        ctx.toast(`Moved “${m.title}” to ${dest.title}${now?.url && now.oldUrl && now.url !== now.oldUrl ? `: ${now.url}, with a redirect from ${now.oldUrl}` : ''}.`, 'ok');
        ctx.go({ params: { move: null, to: null } }, true);
        await load();
      } catch (e) {
        go.disabled = false;
        go.classList.remove('is-busy');
        out.append(refusal(e));
      }
    }, { kind: 'primary', icon: 'layers' });
    out.replaceChildren(facts, el('div.ms-adm-actions', go, button('Cancel', () => ctx.go({ params: { move: null, to: null } }, true), { kind: 'quiet' })));
  }

  /** An old address over its new one, each with its copy and open icons. */
  const fromTo = (from: string, to: string) => el('div.ms-groups__fromto', el('div', el('span.ms-adm-sub', 'from '), link(from, 'old address')), el('div', el('span.ms-adm-sub', 'to '), link(to, 'new address')));

  /** The server's words: a refusal (422 lists what stops it), or that moving needs the server (astro dev). */
  const refusal = (e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405) && !e.data?.problems) return el('p.ms-adm-note.is-bad', 'Moving needs the Markstage server.');
    const problems = e instanceof ApiError && Array.isArray(e.data?.problems) ? (e.data!.problems as { message: string }[]) : [];
    return el('div.ms-adm-note.is-bad', { role: 'alert' }, el('p', `Not moved: ${message(e)}`), problems.length ? el('ul', ...problems.map((x) => el('li', value(x.message, 'reason')))) : '');
  };

  void load();
  return {
    update: () => {
      // another group in the URL: read it; else the open menu or drawer
      if (open && (ctx.params().get('g') ?? groups[0]?.id) !== drawn) void openGroup().catch((e) => p.body.replaceChildren(failure(e, () => void load())));
      else follow();
    },
    destroy: () => {
      list?.destroy();
      drawerEl?.remove();
    },
  };
}
