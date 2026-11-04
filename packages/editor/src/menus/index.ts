// The Menus screen (#/menus/<entry>?m=<list>&item=<id>&add=1, and grip=<id> / move=<id> while an item's grip menu
// or its Move to… is open): the links in the site's header and footer, from the `navigation` collection (one JSON entry per language, docs/CONFIG.md "Menus"). Each list of links is a menu; the
// shared order component draws it (drag, keyboard, the grip menu, nesting where the site shows it). The open item
// is edited on the right (label, link); "Add a link" finds a page or post, or takes any address.
// Every change is one save of that one list (a `set` change, docs/API.md "Save"), so the file changes only where the
// menu did, and one undo step (⌘Z / ⇧⌘Z). Ids are in memory only (model.ts).
import '../styles/menus.css';
import { ApiError, getEntry, listEntries, type EntrySummary } from '../api';
import { copyable } from '../copy';
import { registerScreen, type ScreenCtx } from '../host';
import { ic } from '../icons';
import { mountOrder, type OrderList } from '../order';
import { h, ht, input, openUrl, textBtn } from '../panel-form';
import { saveChanges } from '../pages/api';
import { collection } from '../runtime';
import { copyItem, findMenus, fromItems, idOfKey, keyOf, linkOf, listAt, newItem, toItems, useLinkKeys, withLink, type Link, type MenuDef, type MenuItem, type Raw } from './model';
import { loadTargets, search, targetOf, type Target } from './targets';
import { find, moveItems, removeItems, restoreItems } from '@markstage/core';

/** The collection the menus are in (one entry per language). */
export const MENUS_COLLECTION = 'navigation';
const EDITORS = ['owner', 'administrator', 'editor'];

export function registerMenusScreen(): void {
  if (!collection(MENUS_COLLECTION)) return;
  registerScreen({ name: 'menus', label: 'Site menus', icon: 'list', nav: 'main', group: 'content', menuLabel: 'Site menus', roles: EDITORS, mount: mountMenus });
}

function mountMenus(el: HTMLElement, ctx: ScreenCtx) {
  useLinkKeys(collection(MENUS_COLLECTION)?.linkKeys);
  const root = h('div', 'ms-menus');
  const head = h('div', 'ms-menus__head');
  const status = h('span', 'ms-menus__status');
  status.setAttribute('aria-live', 'polite');
  const intro = h('div');
  head.append(intro, status);
  intro.append(h('h1', 'ms-menus__title', 'Menus'), h('p', 'ms-menus__intro', 'The links in the site’s header and footer. Drag by the grip to reorder or nest, or use the grip’s menu; ⌘Z undoes.'));
  const bar = h('div', 'ms-menus__bar');
  const main = h('div', 'ms-menus__main');
  const card = h('div', 'ms-menus__card');
  const side = h('aside', 'ms-menus__side');
  side.hidden = true;
  main.append(card, side);
  root.append(head, bar, main);
  el.append(root);

  let entries: EntrySummary[] = [];
  /** the pages and posts an item can link to */
  let targets: Target[] = [];
  let entryId = '';
  let data: Raw = {};
  let version = '';
  let menus: MenuDef[] = [];
  let menu: MenuDef | null = null;
  let items: MenuItem[] = [];
  let order: OrderList | null = null;
  const undo: MenuItem[][] = [];
  const redo: MenuItem[][] = [];
  let saving: Promise<void> = Promise.resolve();
  let pending = 0;
  let typing = 0;
  /** saves the typing that has not rested yet (leaving, reloading) */
  let flush: (() => void) | null = null;
  /** the item open on the right */
  let openId: string | null = null;
  const openItem = (id: string) => ctx.go({ params: { item: keyOf(items, id), add: null } }, true);
  let destroyed = false;
  ctx.guard(() => pending > 0 || !!typing);

  const say = (t: string, kind = '') => {
    status.textContent = t;
    status.dataset.kind = kind;
  };

  // ---------- saving ----------
  /** Writes the open list as `items` is now: one save, after the ones before it. */
  function save(): void {
    if (!menu) return;
    const path = menu.path;
    const value = fromItems(items);
    pending++;
    say('Saving…');
    saving = saving.then(async () => {
      const put = (v: string) => saveChanges(MENUS_COLLECTION, entryId, [{ op: 'set', path, value }], v);
      try {
        let r;
        try {
          r = await put(version);
        } catch (err) {
          // changed somewhere else, but not this list: the change goes on top of theirs
          if (!(err instanceof ApiError && err.status === 409)) throw err;
          const fresh = await getEntry(MENUS_COLLECTION, entryId);
          if (JSON.stringify(listAt((fresh.data ?? {}) as Raw, path)) !== JSON.stringify(listAt(data, path))) throw err;
          data = (fresh.data ?? {}) as Raw;
          r = await put(fresh.version);
        }
        version = r.version;
        setAt(path, value);
        if (!--pending) say('Saved', 'ok');
      } catch (err) {
        pending = 0;
        saving = Promise.resolve();
        if (err instanceof ApiError && err.status === 409) {
          ctx.toast('This menu was changed somewhere else, so it is shown again as it is now. Your last change to it was not saved.', 'error');
          await load(false);
        } else {
          say('Not saved', 'error');
          ctx.toast(`The menu could not be saved: ${(err as Error).message}`, 'error');
        }
      }
    });
  }

  function setAt(path: string, value: Raw[]): void {
    const keys = path.split('.');
    let v: unknown = data;
    for (const k of keys.slice(0, -1)) v = (v as Record<string, unknown>)[k];
    (v as Record<string, unknown>)[keys[keys.length - 1]!] = value;
  }

  /** One change: what it was goes on the undo stack, then the list is drawn and saved. */
  function change(next: MenuItem[]): void {
    undo.push(items);
    redo.length = 0;
    items = next;
    order?.refresh();
    save();
  }

  function step(back: boolean): void {
    const from = back ? undo : redo;
    const to = back ? redo : undo;
    const prev = from.pop();
    if (!prev) return void ctx.toast(back ? 'Nothing to undo.' : 'Nothing to redo.');
    to.push(items);
    items = prev;
    order?.refresh();
    drawSide(true);
    // the open item is gone (an add undone): so is its address
    if (!openId && ctx.params().get('item')) ctx.go({ params: { item: null } });
    save();
  }

  // ---------- loading ----------
  async function load(first: boolean): Promise<void> {
    try {
      if (first) [entries, targets] = await Promise.all([listEntries(MENUS_COLLECTION).then((l) => l.sort((a, b) => a.id.localeCompare(b.id))), loadTargets()]);
      if (!entries.length) return void card.replaceChildren(h('p', 'ms-menus__none', 'There are no menus yet: the site’s navigation collection is empty.'));
      const wanted = ctx.args[0];
      entryId = entries.find((e) => e.id === wanted)?.id ?? entries.find((e) => e.id === 'en')?.id ?? entries[0]!.id;
      if (wanted !== entryId) ctx.go({ args: [entryId] });
      const e = await getEntry(MENUS_COLLECTION, entryId);
      if (destroyed) return;
      data = (e.data ?? {}) as Raw;
      version = e.version;
      menus = findMenus(data);
      undo.length = redo.length = 0;
      say('');
      draw();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return void card.replaceChildren(h('p', 'ms-menus__none', 'These menus are not available to you.'));
      card.replaceChildren(ht('p', 'ms-menus__none', `The menus could not be loaded: ${(err as Error).message}`));
    }
  }

  // ---------- drawing ----------
  function draw(): void {
    const p = ctx.params();
    menu = menus.find((m) => m.path === p.get('m')) ?? menus[0] ?? null;
    drawBar();
    order?.destroy();
    order = null;
    card.replaceChildren();
    if (!menu) return void card.append(h('p', 'ms-menus__none', 'This entry has no lists of links.'));
    items = toItems(listAt(data, menu.path));
    const m = menu;
    const list = h('div');
    card.append(list);
    order = mountOrder({
      root: list,
      label: m.title,
      noun: 'link',
      tree: m.tree,
      maxDepth: m.maxDepth,
      items: () => items,
      row: (it) => row(it),
      move: (ids, to) => {
        const next = moveItems(items, ids, to);
        if (next !== items) change(next);
      },
      remove: (ids) => {
        const { tree, removed } = removeItems(items, ids);
        change(tree);
        if (openId && ids.includes(openId)) ctx.go({ params: { item: null } });
        // back where they were (one more change, so ⌘Z takes it back again)
        return () => change(restoreItems(items, removed));
      },
      duplicate: (ids) => {
        let next = items;
        for (const id of [...ids].reverse()) {
          const r = find(next, id);
          if (!r) continue;
          // the copy goes right after the item: added at the end, then moved there
          const copy = copyItem(r.item);
          next = moveItems([...next, copy], [copy.id], { parent: r.parent, index: r.index + 1 });
        }
        change(next);
      },
      scroller: el,
      // an open grip menu (grip=) or Move to… (move=) is in the address: a reload opens it again
      opened: (w) => ctx.go({ params: 'menu' in w ? { grip: w.menu && keyOf(items, w.menu) } : { move: w.moveTo && keyOf(items, w.moveTo) } }),
    });
    const grip = idOfKey(items, p.get('grip'));
    const moving = idOfKey(items, p.get('move'));
    if (moving) order.openMoveTo(moving);
    else if (grip) requestAnimationFrame(() => order?.openMenu(grip));
    card.append(textBtn('plus', 'Add a link', () => ctx.go({ params: { add: '1', item: null } }, true), 'ms-btn ms-btn--sm ms-menus__add'));
    drawSide();
  }

  function drawBar(): void {
    bar.replaceChildren();
    if (entries.length > 1) {
      const sel = h('select', 'ms-input ms-menus__lang');
      sel.setAttribute('aria-label', 'Language');
      for (const e of entries) sel.append(Object.assign(h('option'), { value: e.id, textContent: e.title || e.id, selected: e.id === entryId }));
      sel.addEventListener('change', () => ctx.go({ args: [sel.value], params: { m: null, item: null, add: null } }, true));
      bar.append(sel);
    }
    if (menus.length > 1) {
      const seg = h('div', 'ms-seg ms-menus__which');
      seg.setAttribute('role', 'tablist');
      seg.setAttribute('aria-label', 'Menu');
      for (const m of menus) {
        const b = h('button', 'ms-seg__btn');
        b.type = 'button';
        b.textContent = m.title;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(m === menu));
        b.classList.toggle('is-on', m === menu);
        b.addEventListener('click', () => ctx.go({ params: { m: m.path, item: null, add: null } }, true));
        seg.append(b);
      }
      bar.append(seg);
    }
  }

  function row(it: MenuItem): HTMLElement {
    const r = h('div', 'ms-menus__row');
    const name = h('span', 'ms-menus__label', '');
    name.textContent = it.label || 'Untitled';
    r.append(name);
    r.append(linkLine(linkOf(it.raw), !!it.children?.length));
    const edit = h('button', 'ms-btn ms-btn--sm ms-menus__edit', 'Edit');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Edit “${it.label}”`);
    edit.addEventListener('click', () => openItem(it.id));
    r.append(edit);
    r.addEventListener('dblclick', () => openItem(it.id));
    if (openId === it.id) r.classList.add('is-open');
    return r;
  }

  // ---------- the side: the open item, or "Add a link" ----------
  /** Draws the right side from the address; the open item's fields stay as they are unless `again` (after an undo). */
  function drawSide(again = false): void {
    const p = ctx.params();
    const id = idOfKey(items, p.get('item'));
    const open = id ? find(items, id) : null;
    for (const x of card.querySelectorAll('.ms-menus__row')) x.classList.toggle('is-open', !!open && x.closest<HTMLElement>('.ms-order__row')?.dataset.id === id);
    if (open && id === openId && !side.hidden && !again) return;
    openId = open ? id : null;
    side.hidden = !open && p.get('add') !== '1';
    side.replaceChildren();
    if (open) editor(open.item);
    else if (p.get('add') === '1') adder();
  }

  function sideHead(title: string): HTMLElement {
    const top = h('div', 'ms-menus__sidehead');
    const close = h('button', 'ms-iconbtn', ic('x', 14));
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => ctx.go({ params: { item: null, add: null } }, true));
    top.append(h('h2', '', title), close);
    return top;
  }

  function editor(it: MenuItem): void {
    // a burst of typing is one change: the list before it goes on the undo stack once, and it saves when it rests
    let before: MenuItem[] | null = null;
    const edit = (key: 'label' | 'href', v: string) => {
      if (!before) before = items;
      const next = withValue(items, it.id, key, v);
      items = next;
      order?.refresh();
      say('Saving…');
      clearTimeout(typing);
      flush = () => {
        clearTimeout(typing);
        typing = 0;
        flush = null;
        if (before) undo.push(before), (redo.length = 0);
        before = null;
        save();
        // the address follows the item's new link or label
        if (openId === it.id) ctx.go({ params: { item: keyOf(items, it.id) } });
      };
      typing = window.setTimeout(flush, 700);
    };
    const cur = () => find(items, it.id)?.item ?? it;
    const label = input('Label', () => cur().label, (v) => edit('label', v));
    // where it links: a page or post (it follows the page when it moves), or any address
    const box = h('div', 'ms-field ms-menus__link');
    const now = h('div', 'ms-menus__now');
    const drawNow = () => {
      const to = linkOf(cur().raw);
      now.replaceChildren(linkLine(to, !!cur().children?.length, true));
      // an address that is one of the site's pages: better linked to the page, which the menu then follows
      const page = to && 'href' in to ? targets.find((t) => t.url === to.href && t.link && 'entry' in t.link) : undefined;
      if (page) {
        const b = h('button', 'ms-linkbtn', `Link to the page “${page.label}” instead, so the menu follows it when it moves`);
        b.type = 'button';
        b.addEventListener('click', () => {
          flush?.();
          relink(it.id, page.link);
          drawNow();
          address.sync();
        });
        now.append(b);
      }
    };
    const q = h('input', 'ms-input');
    q.type = 'search';
    q.placeholder = 'Find a page or post';
    q.setAttribute('aria-label', 'Link to a page or post');
    const hits = h('div', 'ms-menus__hits');
    q.addEventListener('input', () => suggest(q.value, hits, (t) => {
      relink(it.id, t.link);
      q.value = '';
      hits.replaceChildren();
      drawNow();
      address.sync();
    }));
    const address = input('Or an address', () => String(cur().raw.href ?? ''), (v) => (edit('href', v), drawNow()), { open: openUrl(location.origin), placeholder: '/blog/ or https://…' });
    box.append(h('span', 'ms-field__label', 'Links to'), now, q, hits);
    drawNow();
    side.append(sideHead('Menu item'), label.el, box, address.el);
    if (it.children?.length) side.append(h('p', 'ms-menus__note', `Holds ${it.children.length} link${it.children.length === 1 ? '' : 's'}.`));
    if (it.lock) side.append(h('p', 'ms-menus__note', `${it.lock.by ? `Locked by ${it.lock.by}` : 'Locked'}.`));
    const del = textBtn('trash', 'Delete', () => {
      order?.focus(it.id);
      card.querySelector<HTMLElement>(`.ms-order__row[data-id="${it.id}"]`)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    }, 'ms-btn ms-btn--sm ms-btn--danger');
    side.append(h('div', 'ms-menus__sidefoot'));
    side.lastElementChild!.append(del);
    if (!label.el.querySelector('input')!.value) label.el.querySelector('input')!.focus();
  }

  function adder(): void {
    const q = h('input', 'ms-input');
    q.type = 'search';
    q.placeholder = 'Find a page or post';
    q.setAttribute('aria-label', 'Find a page or post');
    const hits = h('div', 'ms-menus__hits ms-menus__hits--add');
    const add = (label: string, to: Link) => {
      const it = newItem(label, to);
      change([...items, it]);
      order?.focus(it.id);
      openItem(it.id);
      ctx.toast(`Added “${label}” at the end of the menu.`, 'ok');
    };
    q.addEventListener('input', () => suggest(q.value, hits, (t) => add(t.label, t.link)));
    const custom = h('form', 'ms-menus__custom');
    let cl = '';
    let ch = '';
    const cLabel = input('Label', () => cl, (v) => (cl = v));
    const cHref = input('Link', () => ch, (v) => (ch = v), { open: openUrl(location.origin), placeholder: 'https://…' });
    const go = h('button', 'ms-btn ms-btn--sm', 'Add');
    go.type = 'submit';
    custom.append(h('h3', '', 'Any address'), cLabel.el, cHref.el, go);
    custom.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!cl.trim() || !ch.trim()) return void ctx.toast('A link needs a label and an address.', 'error');
      add(cl.trim(), { href: ch.trim() });
    });
    side.append(sideHead('Add a link'), q, hits, custom);
    suggest('', hits, (t) => add(t.label, t.link));
    q.focus();
  }

  function suggest(q: string, into: HTMLElement, pick: (t: Target) => void): void {
    into.replaceChildren(
      ...search(targets, q)
        .slice(0, 8)
        .map((t) => {
          const b = h('button', 'ms-menus__hit');
          b.type = 'button';
          b.append(h('span', 'ms-menus__hitlabel'), h('span', 'ms-menus__hithref'));
          b.firstElementChild!.textContent = t.label;
          b.lastElementChild!.textContent = `${t.kind} · ${t.url}`;
          b.addEventListener('click', () => pick(t));
          return b;
        }),
    );
  }

  /** Where an item links, as a row or the side shows it: the page (its title with the side) and its address. */
  function linkLine(to: Link, heading: boolean, long = false): HTMLElement {
    const line = h('span', 'ms-menus__href');
    if (to && 'entry' in to) {
      const t = targetOf(targets, to.entry);
      if (!t) {
        line.classList.add('is-missing');
        line.textContent = `Missing page: ${to.entry}. Pick another.`;
        return line;
      }
      if (long) line.append(h('strong', '', ''), ' ');
      if (long) line.firstElementChild!.textContent = t.label;
      line.append(copyable(t.url, { label: 'link', open: openUrl(location.origin)(t.url) }));
      line.title = `Links to “${t.label}”; follows it when it moves.`;
    } else if (to) line.append(copyable(to.href, { label: 'link', open: openUrl(location.origin)(to.href) }));
    else {
      line.classList.add('is-none');
      line.textContent = heading ? 'No link: opens its list' : 'No link yet';
    }
    return line;
  }

  /** One change: the item links somewhere else. */
  function relink(id: string, to: Link): void {
    change(mapItem(items, id, (it) => ({ ...it, raw: withLink(it.raw, to) })));
    if (openId === id) ctx.go({ params: { item: keyOf(items, id) } });
  }

  const onKey = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    if ((e.target as Element).closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    step(!e.shiftKey);
  };
  document.addEventListener('keydown', onKey);
  // a reload or a closed tab while typing or saving: the save goes now, and the browser asks first
  const onLeave = (e: BeforeUnloadEvent) => {
    flush?.();
    if (pending) e.preventDefault();
  };
  addEventListener('beforeunload', onLeave);

  void load(true);
  return {
    update: () => {
      const m = ctx.params().get('m');
      if (menu && (m ?? menus[0]?.path) !== menu.path) draw();
      else drawSide();
    },
    destroy: () => {
      flush?.();
      destroyed = true;
      document.removeEventListener('keydown', onKey);
      removeEventListener('beforeunload', onLeave);
      order?.destroy();
    },
  };
}

/** `items` with the label or link of `id` changed (new objects on the way to it, so undo keeps the old ones). */
function withValue(items: MenuItem[], id: string, key: 'label' | 'href', v: string): MenuItem[] {
  return mapItem(items, id, (it) => (key === 'label' ? { ...it, label: v, raw: { ...it.raw, label: v } } : { ...it, raw: withLink(it.raw, v ? { href: v } : null) }));
}

/** `items` with `id` changed by `fn` (new objects on the way to it, so undo keeps the old ones). */
function mapItem(items: MenuItem[], id: string, fn: (it: MenuItem) => MenuItem): MenuItem[] {
  return items.map((it) => (it.id === id ? fn(it) : it.children ? { ...it, children: mapItem(it.children, id, fn) } : it));
}
