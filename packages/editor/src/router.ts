// URL state (every state has a URL; back and forward work). All of it lives in the hash, so the page itself stays
// put:  #/e/<collection>/<id>?b=<block index>&view=source&s=1&side=outline&device=mobile&landscape=1&region=en-US&k=1&q=<search>
// (b: the selected top-level block, view=source: Source mode, s=1: Post settings are open, side: the right column's
// Outline (outline, heads=1: headings only, fold=2,5: the 2nd and 5th sections folded), SEO check (seo, nf=1:
// nofollow links marked on the canvas) or the "How do I…" guide (help,
// topic=<id>: the open topic, hq=<words>: its search) is open, one of them or Post
// settings (an old o=1 opens the Outline), find=<words>: the find bar is open (with=<words>, rep=1: its Replace
// row, fc=1: match case, fw=1: whole words), lock=<block index>: that block's lock popover is open, lib=<key>: the media library is open to choose the image of that setting, device: the page is
// shown on a screen (desktop, tablet, mobile or a width in px), landscape=1: turned sideways, region: the site's locale
// the screen shows (absent: the default one), theme=dark|light: the site's scheme on it when it is not the editor's
// own (absent: it follows the editor's colours), readers=1: "What readers see" shows the page's own text in place of
// the canvas (canvas-shell/page.ts), k=1: the search is open, q:
// what is typed in it), suggest: an AI suggestion is open (ai/editor.ts): suggest=alt&img=<n> for the nth image on
// the canvas (&at=panel: in the image block's settings panel), suggest=alt&field=<key> for an image setting (with
// s=1), suggest=seo with the SEO check, and suggest=translate&loc=<code> for a region's title and description (with
// s=1), and suggest=rewrite&sel=<from>-<to>[&how=<mode>] for the writing help on a selection of the canvas.
//       #/p/<collection>/<id>?…  a page (JSON entry with a page address) in the pages editor (pages/**): its own params
//                                 pass through untouched (`extra`); device, landscape, region, theme, view, k and q as above
//       #/<screen>/<args…>?…      a screen another part registers (host.ts registerScreen: users, media, …); its
//                                 params are its own (`screenParams`, q too while the search is closed); k=1 opens
//                                 the search, q then being what is typed in it
// Opening another entry adds a history entry; the selected block, the view and the search replace the current one.
// Old links #/a/<id> open the compat collection.
import { canRotate, validDevice } from './device/devices';
import type { FindState } from './find';

export interface Route {
  /** 'p': the open entry is a page in the pages editor, 'e': text on the canvas */
  mode: 'e' | 'p';
  collection: string | null;
  id: string | null;
  /** index of the selected top-level block */
  block: number | null;
  /** 'source' shows the raw file */
  view: 'source' | null;
  /** Post settings are open */
  settings: boolean;
  /** the right column's own panel (side.ts): the Outline or the SEO check */
  side: Side | null;
  /** the SEO check marks the nofollow links on the canvas */
  nofollow: boolean;
  /** the lock popover of the top-level block at this index is open */
  lock: number | null;
  /** the Outline shows the headings only, and these sections folded (1: the first section under an H2) */
  heads: boolean;
  fold: number[];
  /** the guide's open topic and its search (side=help) */
  topic: string | null;
  hq: string;
  /** the Library panel's search and kind (side=library: section|snippet) */
  lq: string;
  lk: string;
  /** the find bar (find.ts) is open with these words and options */
  find: FindState | null;
  /** the media library is open for the image setting with this frontmatter key (with Post settings) */
  lib: string | null;
  /** the page is shown on this screen (devices.ts) */
  device: string | null;
  landscape: boolean;
  /** the locale the screen shows (a code from the config), null for the default */
  region: string | null;
  /** the site's scheme on the screen (config `themes.dark`): null follows the editor's own colours */
  theme: 'dark' | 'light' | null;
  /** an AI suggestion is open: for the nth image on the canvas (img, from 1), an image setting (field), the SEO
   *  check's title and description, or a region's (loc) */
  suggest: Suggest | null;
  /** the search is open */
  k: boolean;
  q: string;
  /** "What readers see": the page's own text in place of the canvas (canvas-shell/page.ts) */
  readers: boolean;
  /** the pages editor's own params (#/p only), kept as they are */
  extra: Record<string, string>;
  /** a registered screen (#/<name>/<args>), null on the editor */
  screen: { name: string; args: string[] } | null;
  /** that screen's params */
  screenParams: Record<string, string>;
}

export type Side = 'outline' | 'seo' | 'help' | 'library';
export type Suggest = { kind: 'alt'; img: number; at?: 'panel' } | { kind: 'alt'; field: string } | { kind: 'seo' } | { kind: 'translate'; loc: string } | { kind: 'rewrite'; sel: [number, number]; how?: RewriteMode };
/** The writing help's choices (ai/rewrite.ts): the server's `mode` of a rewrite suggestion. */
export const REWRITE_MODES = ['rewrite', 'shorten', 'fix', 'tone:friendly', 'tone:formal', 'tone:confident'] as const;
export type RewriteMode = (typeof REWRITE_MODES)[number];
const SIDES: Side[] = ['outline', 'seo', 'help', 'library'];

/** Params the shell reads itself; anything else on #/p belongs to the pages editor. */
const RESERVED = new Set(['b', 'view', 's', 'o', 'side', 'nf', 'heads', 'fold', 'lock', 'find', 'with', 'rep', 'fc', 'fw', 'topic', 'hq', 'lq', 'lk', 'lib', 'device', 'landscape', 'region', 'theme', 'readers', 'k', 'q']);
const SCREEN = /^\/([a-z][a-z0-9-]{0,39})((?:\/[A-Za-z0-9_.-]{1,100})*)\/?$/;

const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const KEY = /^[A-Za-z_][\w.-]{0,99}$/;
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** The suggestion the params ask for, when what it sits in is open (Post settings, the SEO check). */
function readSuggest(params: URLSearchParams, r: Pick<Route, 'mode' | 'view' | 'settings' | 'side'>): Suggest | null {
  const kind = params.get('suggest');
  if (r.mode !== 'e' || r.view || !kind) return null;
  const img = params.get('img') ?? '';
  const field = params.get('field') ?? '';
  const loc = params.get('loc') ?? '';
  if (kind === 'alt' && /^[1-9]\d{0,4}$/.test(img)) return params.get('at') === 'panel' ? { kind, img: Number(img), at: 'panel' } : { kind, img: Number(img) };
  if (kind === 'alt' && r.settings && KEY.test(field)) return { kind, field };
  if (kind === 'seo' && r.side === 'seo') return { kind };
  if (kind === 'translate' && r.settings && LOCALE.test(loc)) return { kind, loc };
  // the writing help on a selection of the canvas: sel=<from>-<to> (the selection's positions), how=<mode> once chosen
  const sel = /^(\d{1,7})-(\d{1,7})$/.exec(params.get('sel') ?? '');
  if (kind === 'rewrite' && sel && Number(sel[1]) < Number(sel[2])) {
    const how = params.get('how') as RewriteMode | null;
    return how && REWRITE_MODES.includes(how) ? { kind, sel: [Number(sel[1]), Number(sel[2])], how } : { kind, sel: [Number(sel[1]), Number(sel[2])] };
  }
  return null;
}

/** The suggestion still has a place (the drawer or the side it sits in is open). */
const suggestFits = (r: Route): Route['suggest'] => {
  const s = r.suggest;
  if (!s || r.mode !== 'e' || r.view || r.screen) return null;
  if (s.kind === 'seo') return r.side === 'seo' && !r.settings ? s : null;
  return 'img' in s || s.kind === 'rewrite' || r.settings ? s : null;
};
let compat: string | null = null;

export function parse(hash = location.hash): Route {
  const [p, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const e = /^\/([ep])\/([a-z][a-z0-9-]{0,39})\/([^/]+)\/?$/.exec(p);
  const a = /^\/a\/([^/]+)\/?$/.exec(p);
  const [collection, id] = e ? [e[2], e[3]] : a && compat ? [compat, a[1]] : [null, null];
  const b = params.get('b');
  const sc = !e && !a ? SCREEN.exec(p) : null;
  const screen = sc && !['e', 'a', 'p'].includes(sc[1]) ? { name: sc[1], args: sc[2].split('/').filter(Boolean) } : null;
  const sideParam = params.get('side') ?? (params.get('o') === '1' ? 'outline' : null);
  const side = e?.[1] !== 'p' && params.get('s') !== '1' && params.get('view') !== 'source' ? (SIDES.find((x) => x === sideParam) ?? null) : null;
  const own = (keep: (k: string) => boolean) => Object.fromEntries([...params].filter(([k]) => keep(k)));
  const mode = e?.[1] === 'p' ? 'p' : 'e';
  const view = params.get('view') === 'source' ? 'source' : null;
  const settings = params.get('s') === '1' && params.get('view') !== 'source';
  return {
    mode,
    // a page's own params (its section, field, open lock popover: lock=<section>)
    extra: e?.[1] === 'p' ? own((k) => !RESERVED.has(k) || k === 'lock') : {},
    screen,
    // a screen's own search is q too: its own while the editor's search (k=1) is closed
    screenParams: screen ? own((k) => k !== 'k' && !(k === 'q' && params.get('k') === '1')) : {},
    collection: id && ID.test(id) ? collection : null,
    id: id && ID.test(id) ? id : null,
    block: b !== null && /^\d+$/.test(b) ? Number(b) : null,
    view,
    settings,
    side,
    nofollow: side === 'seo' && params.get('nf') === '1',
    lock: e?.[1] !== 'p' && params.get('view') !== 'source' && /^\d{1,5}$/.test(params.get('lock') ?? '') ? Number(params.get('lock')) : null,
    heads: side === 'outline' && params.get('heads') === '1',
    fold: side === 'outline' ? [...new Set((params.get('fold') ?? '').split(',').filter((n) => /^[1-9]\d{0,3}$/.test(n)).map(Number))].sort((a, b) => a - b) : [],
    topic: side === 'help' && /^[a-z][a-z0-9-]{0,39}$/.test(params.get('topic') ?? '') ? params.get('topic') : null,
    hq: side === 'help' ? (params.get('hq') ?? '') : '',
    lq: side === 'library' ? (params.get('lq') ?? '') : '',
    lk: side === 'library' && ['section', 'snippet'].includes(params.get('lk') ?? '') ? params.get('lk')! : '',
    find:
      e?.[1] !== 'p' && params.get('view') !== 'source' && params.has('find')
        ? { q: params.get('find') ?? '', with: params.get('with') ?? '', replace: params.get('rep') === '1', matchCase: params.get('fc') === '1', word: params.get('fw') === '1' }
        : null,
    lib: params.get('s') === '1' && params.get('view') !== 'source' && /^[A-Za-z_][\w.-]{0,99}$/.test(params.get('lib') ?? '') ? params.get('lib') : null,
    device: validDevice(params.get('device')) && params.get('view') !== 'source' ? params.get('device') : null,
    landscape: params.get('landscape') === '1',
    region: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(params.get('region') ?? '') ? params.get('region') : null,
    theme: params.get('theme') === 'dark' ? 'dark' : params.get('theme') === 'light' ? 'light' : null,
    suggest: screen ? null : readSuggest(params, { mode, view, settings, side }),
    readers: mode === 'e' && !view && params.get('readers') === '1',
    k: params.get('k') === '1',
    q: params.get('q') ?? '',
  };
}

export function format(r: Route): string {
  const params = new URLSearchParams();
  if (r.screen) {
    for (const [k, v] of Object.entries(r.screenParams)) params.set(k, v);
    if (r.k) params.set('k', '1');
    if (r.k && r.q) params.set('q', r.q);
    const query = params.toString();
    return `#/${[r.screen.name, ...r.screen.args].join('/')}${query ? `?${query}` : ''}`;
  }
  const open = !!(r.collection && r.id);
  if (open && r.mode === 'p') for (const [k, v] of Object.entries(r.extra)) if (!RESERVED.has(k) || k === 'lock') params.set(k, v);
  if (open && r.view) params.set('view', r.view);
  if (open && r.block !== null && !r.view) params.set('b', String(r.block));
  if (open && r.settings && !r.view) params.set('s', '1');
  if (open && r.side && !r.settings && !r.view && r.mode === 'e') params.set('side', r.side);
  if (open && r.side === 'seo' && r.nofollow && !r.settings && !r.view && r.mode === 'e') params.set('nf', '1');
  if (open && r.side === 'outline' && !r.settings && !r.view && r.mode === 'e') {
    if (r.heads) params.set('heads', '1');
    if (r.fold.length) params.set('fold', r.fold.join(','));
  }
  if (open && r.side === 'help' && !r.settings && !r.view && r.mode === 'e') {
    if (r.topic) params.set('topic', r.topic);
    if (r.hq) params.set('hq', r.hq);
  }
  if (open && r.side === 'library' && !r.settings && !r.view && r.mode === 'e') {
    if (r.lq) params.set('lq', r.lq);
    if (r.lk) params.set('lk', r.lk);
  }
  if (open && r.lock !== null && !r.view && r.mode === 'e') params.set('lock', String(r.lock));
  if (open && r.find && !r.view && r.mode === 'e') {
    params.set('find', r.find.q);
    if (r.find.replace) params.set('rep', '1');
    if (r.find.with) params.set('with', r.find.with);
    if (r.find.matchCase) params.set('fc', '1');
    if (r.find.word) params.set('fw', '1');
  }
  if (open && r.settings && !r.view && r.lib) params.set('lib', r.lib);
  if (open && r.device && !r.view) params.set('device', r.device);
  if (open && r.device && !r.view && r.landscape && canRotate(r.device)) params.set('landscape', '1');
  if (open && r.device && !r.view && r.region) params.set('region', r.region);
  if (open && r.device && !r.view && r.theme) params.set('theme', r.theme);
  if (open && r.readers && !r.view && r.mode === 'e') params.set('readers', '1');
  const sg = open ? suggestFits(r) : null;
  if (sg) {
    params.set('suggest', sg.kind);
    if ('img' in sg) params.set('img', String(sg.img));
    if ('at' in sg && sg.at) params.set('at', sg.at);
    if ('field' in sg) params.set('field', sg.field);
    if ('loc' in sg) params.set('loc', sg.loc);
    if ('sel' in sg) params.set('sel', `${sg.sel[0]}-${sg.sel[1]}`);
    if ('how' in sg && sg.how) params.set('how', sg.how);
  }
  if (r.k) params.set('k', '1');
  if (r.k && r.q) params.set('q', r.q);
  // fold=2,5 reads as it is (a comma is fine in a query)
  const query = params.toString().replace(/(^|&)fold=[\d%C]+/, (m) => m.replaceAll('%2C', ','));
  return `#${open ? `/${r.mode}/${r.collection}/${r.id}` : '/'}${query ? `?${query}` : ''}`;
}

let current: Route;
// set while we write the hash ourselves, so our own change is not read back as navigation
let writing = false;
// each history entry knows its place (history.state.ms): a move the writer cancels steps back by the same amount,
// so the history stays as it was; `pending` is that move, for resume()
let index = 0;
let pending: { to: number | null; hash: string } | null = null;
// while history steps back to where a cancelled move started (history.go is async), the events it raises are ours
let restoring: string | null = null;
const state = () => ({ ...(history.state ?? {}), ms: index });

/** Reads the URL the page opened with (`compatCollection`: where #/a/<id> links go) and rewrites old forms. */
export function init(compatCollection: string | null): Route {
  compat = compatCollection;
  current = parse();
  const hash = format(current);
  index = typeof history.state?.ms === 'number' ? history.state.ms : 0;
  history.replaceState(state(), '', hash !== location.hash && location.hash ? hash : location.href);
  return current;
}

export const route = () => current;

/** Changes the URL. `push` adds a history entry (opening an entry); otherwise the entry is replaced. */
export function go(change: Partial<Route>, push = false): void {
  const next = { ...current, ...change };
  const moved = (change.id !== undefined && change.id !== current.id) || (change.collection !== undefined && change.collection !== current.collection);
  if (moved && change.block === undefined) next.block = null;
  if (moved && change.view === undefined) next.view = null;
  if (moved && change.settings === undefined) next.settings = false;
  if (!next.settings || (moved && change.lib === undefined)) next.lib = null;
  if (moved && change.device === undefined) next.device = null;
  if (moved && change.fold === undefined) next.fold = [];
  if (moved && change.lock === undefined) next.lock = null;
  if (moved && change.extra === undefined) next.extra = {};
  if (moved && change.screen === undefined) next.screen = null;
  const otherScreen = change.screen !== undefined && [change.screen?.name, ...(change.screen?.args ?? [])].join('/') !== [current.screen?.name, ...(current.screen?.args ?? [])].join('/');
  if (otherScreen && change.screenParams === undefined) next.screenParams = {};
  if (moved && change.suggest === undefined) next.suggest = null;
  // a card in the settings panel goes with the block whose panel it is in
  if (change.block !== undefined && change.block !== current.block && change.suggest === undefined && next.suggest && 'at' in next.suggest) next.suggest = null;
  next.suggest = suggestFits(next);
  const hash = format(next);
  current = next;
  if (hash === location.hash) return;
  writing = true;
  if (push) {
    index++;
    history.pushState(state(), '', hash);
  } else history.replaceState(state(), '', hash);
  writing = false;
  changed();
}

const watchers: ((r: Route) => void)[] = [];
let lastPlace = '';
const changed = () => {
  // another screen or entry: whatever was open over the old one (a confirm box, a menu) goes with it
  const place = placeOf(current);
  if (place !== lastPlace) {
    lastPlace = place;
    if (typeof document !== 'undefined') closeOverlays(document);
  }
  watchers.forEach((w) => w(current));
};

/** Where the route is (the screen and its arguments, or the open entry): what a dialog or menu belongs to. */
export const placeOf = (r: Route): string => [r.mode, r.collection ?? '', r.id ?? '', r.screen?.name ?? '', ...(r.screen?.args ?? [])].join('/');

/**
 * Closes every open dialog and pop-up menu that belongs to the place being left (a confirm box left open on
 * Moved addresses must not sit over Categories). The editor's own search (ms-pal) and the "sign in again" box
 * (ms-signin) are not of one place and stay. Returns how many were closed.
 */
export function closeOverlays(root: { querySelectorAll(sel: string): ArrayLike<Element> }, open: Set<{ close(): void }> = openMenus): number {
  let n = 0;
  for (const d of Array.from(root.querySelectorAll('dialog[open]:not(.ms-pal):not(.ms-signin)'))) {
    (d as HTMLDialogElement).close();
    n++;
  }
  for (const m of [...open]) {
    m.close();
    n++;
  }
  open.clear();
  return n;
}

/** The pop-up menus open now (shell.ts Menu adds itself while open), so a route change can close them. */
export const openMenus = new Set<{ close(): void }>();
/** Calls `fn` after every change of the URL: the editor's own (go) and the user's (Back, a typed address). */
export function onChange(fn: (r: Route) => void): void {
  watchers.push(fn);
}

/** Makes the move the writer was asked about (a navigation handler returned false), once they chose to leave. */
export function resume(): void {
  const p = pending;
  pending = null;
  if (!p) return;
  if (p.to !== null) history.go(p.to - index);
  else location.hash = p.hash;
}

/** Calls `fn` when the user moves through history or edits the URL; `fn` may return false to stay put. */
export function onNavigate(fn: (next: Route, prev: Route) => boolean | void): void {
  const handle = () => {
    if (writing) return;
    if (restoring !== null) {
      if (location.hash === restoring || format(parse()) === restoring) restoring = null;
      return;
    }
    const prev = current;
    const next = parse();
    const to = typeof history.state?.ms === 'number' ? (history.state.ms as number) : null;
    // popstate and hashchange both fire for one step back
    if (format(next) === format(current)) return;
    const from = index;
    current = next;
    if (to !== null) index = to;
    else {
      // a hash typed or linked: a new entry
      index = from + 1;
      history.replaceState(state(), '', location.href);
    }
    if (fn(next, prev) === false) {
      current = prev;
      pending = { to: to ?? index, hash: location.hash };
      if (to !== null && to !== from) {
        // back or forward: go back where we were (the handler sees the same route again and ignores it)
        index = from;
        restoring = format(prev);
        history.go(from - to);
      } else {
        index = from;
        history.replaceState(state(), '', format(prev));
        pending = { to: null, hash: format(next) };
      }
    }
    changed();
  };
  window.addEventListener('popstate', handle);
  window.addEventListener('hashchange', handle);
}
