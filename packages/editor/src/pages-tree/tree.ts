// #/tree/<collection>?menu=<id>: the site's pages as a tree (docs/OPERATIONS.md "Page hierarchy"). A page sits under
// the page whose address its own begins with (/about-us/certifications/ under /about-us/); the pages a page lists
// in groups (its `group` field: "CRMs", "Project tools") sit under a row per group, in their `order`. On the order
// component: drag by the grip, Alt+↑/↓, Move to…, several at once. A move among a page's own pages, or into another
// of its groups, writes `order` (and `group`) for the pages whose number changes, in one commit through POST
// site/move, with Undo; moving a page under another page changes its address and waits for the server to take a
// new address for a site whose address is a single field (`{uri}`).
import { ApiError, getEntry, listEntries, type EntrySummary } from '../api';
import { moveMany, type MoveOne } from '../admin/api';
import { el, failure, isEditorPlus, link, page, state, whoami } from '../admin/ui';
import type { ScreenCtx } from '../host';
import { mountOrder, type OrderItem, type OrderList, type Place } from '../order';
import { moveItems, find } from '@markstage/core';
import { collection, config } from '../runtime';

interface Page {
  id: string;
  title: string;
  url: string;
  status?: string;
  version: string;
  group: string | null;
  order: number | null;
}
interface Row extends OrderItem {
  page?: Page;
  /** a group row: its name and the page it belongs to */
  group?: string;
  owner?: string | null;
  children?: Row[];
}

// a group row stays under its page (its pages move, it doesn't)
const GROUP_LOCK = { move: true, remove: true, by: 'its page' };
const words = (g: string) => g.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
// the home page first, then by number, then by title
const byOrder = (a: Page, b: Page) => Number(b.url === '/') - Number(a.url === '/') || (a.order ?? Infinity) - (b.order ?? Infinity) || a.title.localeCompare(b.title);

/** Pages into a tree: under the longest other address theirs starts with (the home page "/" parents nothing). */
function build(pages: Page[]): Row[] {
  const parentOf = (p: Page) => pages.filter((q) => q !== p && q.url !== '/' && p.url.startsWith(q.url)).sort((a, b) => b.url.length - a.url.length)[0] ?? null;
  const kids = new Map<string | null, Page[]>();
  for (const p of pages) {
    const k = parentOf(p)?.id ?? null;
    kids.set(k, [...(kids.get(k) ?? []), p]);
  }
  const rows = (owner: string | null): Row[] => {
    const list = (kids.get(owner) ?? []).sort(byOrder);
    const loose = list.filter((p) => !p.group).map(pageRow);
    // groups by name: their pages' numbers each start at 1, so they say nothing about which group comes first
    const groups = [...new Set(list.filter((p) => p.group).map((p) => p.group!))].sort();
    const grouped = groups.map((g): Row => ({ id: `group:${owner ?? ''}:${g}`, label: words(g), group: g, owner, lock: GROUP_LOCK, children: list.filter((p) => p.group === g).map(pageRow) }));
    return owner === null ? [...loose, ...grouped] : [...grouped, ...loose];
  };
  const pageRow = (p: Page): Row => {
    const children = rows(p.id);
    return { id: p.id, label: p.title, page: p, ...(children.length ? { children } : {}) };
  };
  return rows(null);
}

export function mountTree(host: HTMLElement, ctx: ScreenCtx) {
  const c = collection(ctx.args[0] ?? '') ?? config().collections.find((x) => x.format === 'json' && x.hasUrl) ?? null;
  const p = page(host, 'Page tree', 'Every page under the page its address starts with. Drag to change the order a page list shows them in.');
  let pages: Page[] = [];
  let tree: Row[] = [];
  let order: OrderList | null = null;
  let busy = false;

  const load = async () => {
    const me = await whoami().catch(() => null);
    if (me?.user && !isEditorPlus(me)) return void p.body.replaceChildren(state('denied', 'Not available to you', 'The page tree is for editors, administrators and the owner.'));
    if (!c) return void p.body.replaceChildren(state('empty', 'No pages here', 'This site has no collection of pages with addresses.'));
    if (ctx.args[0] !== c.id) ctx.go({ args: [c.id] });
    p.body.replaceChildren(state('loading', 'Loading the pages…'));
    try {
      const list = (await listEntries(c.id)).filter((e): e is EntrySummary & { url: string } => !!e.url);
      // each page's own number and group (six at a time)
      const out: Page[] = [];
      for (let i = 0; i < list.length; i += 6) {
        out.push(
          ...(await Promise.all(
            list.slice(i, i + 6).map(async (e) => {
              const full = await getEntry(c.id, e.id);
              const d = full.data ?? {};
              return { id: e.id, title: e.title, url: e.url, status: e.status, version: full.version, group: typeof d.group === 'string' ? d.group : null, order: typeof d.order === 'number' ? d.order : null };
            }),
          )),
        );
      }
      pages = out;
      draw();
    } catch (e) {
      p.body.replaceChildren(failure(e, () => void load()));
    }
  };

  const draw = () => {
    tree = build(pages);
    order?.destroy();
    const box = el('section.ms-adm-card.ms-tree');
    p.body.replaceChildren(box);
    order = mountOrder<Row>({
      root: box,
      noun: 'page',
      label: 'Pages',
      tree: true,
      maxDepth: 5,
      items: () => tree,
      row: (r) => (r.page ? pageLine(r.page) : el('div.ms-tree__group', el('strong', r.label), el('span.ms-adm-sub', ` · ${r.children?.length ?? 0} page${r.children?.length === 1 ? '' : 's'}, in this order on its page`))),
      fits: (ids, to) => fits(ids, to),
      badge: (r) => !r.group,
      move: (ids, to) => void move(ids, to),
      opened: (w) => {
        shown = 'menu' in w ? { menu: w.menu, moveto: null } : { menu: null, moveto: w.moveTo };
        ctx.go({ params: shown });
      },
    });
    follow();
  };

  /** The URL's open grip menu or Move to… dialog (a reload, Back), unless it is the one open now. */
  let shown: { menu: string | null; moveto: string | null } = { menu: null, moveto: null };
  const follow = () => {
    const q = ctx.params();
    const want = { menu: q.get('menu'), moveto: q.get('moveto') };
    if (want.menu === shown.menu && want.moveto === shown.moveto) return;
    shown = want;
    if (want.menu) order?.openMenu(want.menu);
    else if (want.moveto) order?.openMoveTo(want.moveto);
  };

  const pageLine = (pg: Page) => {
    const title = el('a.ms-tree__title', { href: `#/p/${c!.id}/${pg.id}` }, pg.title);
    return el('div.ms-tree__page', title, link(pg.url, `the address of ${pg.title}`, 'ms-tree__url'), pg.status && pg.status !== 'published' ? el('span.ms-adm-badge', pg.status) : null);
  };

  /** The page (or group) a place is under, as a page id; and the group it lands in. */
  const owner = (parent: string | null): { page: string | null; group: string | null } => {
    if (parent === null) return { page: null, group: null };
    const r = find(tree, parent)?.item;
    return r?.group !== undefined ? { page: r.owner ?? null, group: r.group } : { page: parent, group: null };
  };
  const parentPage = (id: string) => owner(find(tree, id)?.parent ?? null).page;

  /** Only among a page's own pages for now: another page's would change the address (waits on the server). */
  const fits = (ids: string[], to: Place) => {
    const rows = ids.map((id) => find(tree, id)?.item);
    if (rows.some((r) => !r?.page)) return false;
    const there = owner(to.parent);
    return ids.every((id) => parentPage(id) === there.page);
  };

  /** The numbers (and groups) the pages under one place have after a move; only what changed is sent. */
  async function move(ids: string[], to: Place): Promise<void> {
    if (busy || !fits(ids, to)) return;
    const next = moveItems(tree, ids, to);
    const before = new Map(pages.map((pg) => [pg.id, { order: pg.order, group: pg.group }]));
    const want = new Map<string, { order: number; group: string | null }>();
    // every list the moved pages left or joined is numbered 1, 2, 3… again
    const lists = new Set([find(tree, ids[0]!)?.parent ?? null, to.parent]);
    for (const parent of lists) {
      const siblings = parent === null ? next : (find(next, parent)?.item.children ?? []);
      const g = owner(parent).group;
      siblings.filter((r) => r.page).forEach((r, i) => want.set(r.id, { order: i + 1, group: g }));
    }
    const moves: MoveOne[] = [];
    for (const [id, w] of want) {
      const pg = pages.find((x) => x.id === id)!;
      const set: Record<string, string | number | null> = {};
      if (pg.order !== w.order) set.order = w.order;
      if (pg.group !== w.group) set.group = w.group;
      if (Object.keys(set).length) moves.push({ collection: c!.id, id, version: pg.version, set });
    }
    if (!moves.length) return;
    const ok = await send(moves, ids[0]!);
    if (!ok) return;
    // Undo: the numbers and groups as they were (a page that had none gets none again)
    ctx.toast(`${moves.length} page${moves.length === 1 ? '' : 's'} renumbered.`, 'ok', {
      action: {
        label: 'Undo',
        run: () =>
          void send(
            moves.map((m) => {
              const was = before.get(m.id)!;
              const set: Record<string, string | number | null> = {};
              if ('order' in m.set!) set.order = was.order;
              if ('group' in m.set!) set.group = was.group;
              return { collection: c!.id, id: m.id, version: pages.find((x) => x.id === m.id)!.version, set };
            }),
            ids[0]!,
          ),
      },
    });
  }

  /** One request for all of it; the pages take their new numbers and versions. */
  async function send(moves: MoveOne[], focus: string): Promise<boolean> {
    busy = true;
    try {
      const r = await moveMany(moves);
      for (const m of moves) {
        const pg = pages.find((x) => x.id === m.id)!;
        if (m.set && 'order' in m.set) pg.order = m.set.order as number | null;
        if (m.set && 'group' in m.set) pg.group = m.set.group as string | null;
        pg.version = r.moved.find((x) => x.id === m.id)?.version ?? pg.version;
      }
      draw();
      order?.focus(focus);
      return true;
    } catch (e) {
      const why = e instanceof ApiError && (e.status === 404 || e.status === 405) ? 'Reordering pages needs the Markstage server.' : (e as Error).message;
      ctx.toast(`Not moved: ${why}`, 'error');
      return false;
    } finally {
      busy = false;
    }
  }

  void load();
  return {
    update: () => follow(),
    destroy: () => order?.destroy(),
  };
}
