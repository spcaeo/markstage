// The Library in the pages editor (docs/API-LIBRARY.md "Synced items"): the page sections a site keeps in its Library,
// to add from the outline's picker or drag into the list, and a synced copy's place on the page. A copy is the item's
// section as it is, plus `_synced: {id, version}` when the item is synced; the server writes the item's locks on it
// (`_lock`) when it saves. The site builds it like any section. A synced copy changed here is applied to every page that uses it (Apply), put back
// (Undo my changes), or detached (it becomes this page's own); a save with it changed in place is refused by the server.
import { ApiError, getEntry, type Entry } from '../api';
import { toast } from '../host';
import { h } from '../panel-form';
import * as lib from '../reusable/api';
import { viewerName, viewerRole } from '../runtime';
import { ask } from '../shell';
import type { PageModel } from './model';

/** What a dragged Library item carries (its id), so the outline knows the drop is one. */
export const LIB_DRAG = 'application/x-markstage-library';
const EDITORS = ['owner', 'administrator', 'editor'];
type Section = { discriminant?: unknown; value?: Record<string, unknown>; _synced?: { id: string; version?: string }; _lock?: unknown };

/** The Library's page sections for this collection (the picker keeps those of this page's kinds), or none without the server. */
export async function sectionItems(collection: string): Promise<lib.LibItem[]> {
  if (!viewerName()) return [];
  try {
    const all = (await lib.all()).items;
    return all.filter((it) => it.kind === 'section' && !!it.sectionType && (!it.collection || it.collection === collection) && isObj(it.body?.value));
  } catch {
    return [];
  }
}

/** One item by id, from the list the editor already has. */
export const itemById = async (id: string): Promise<lib.LibItem | null> => (await lib.all().catch(() => ({ items: [] as lib.LibItem[] }))).items.find((it) => it.id === id) ?? null;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** The section to put on the page for `it`: its own value, marked when it is synced (the server adds its locks). */
export function copyOf(it: lib.LibItem): Section {
  const s = structuredClone(it.body.value) as Section;
  if (it.synced) s._synced = { id: it.id, ...(it.syncVersion ? { version: it.syncVersion } : {}) };
  return s;
}

/** The marker of a synced copy, or null. */
export const markerOf = (s: unknown): { id: string } | null => (isObj(s) && isObj(s._synced) && typeof s._synced.id === 'string' ? (s._synced as { id: string }) : null);

/** A section without what is the page's own (the marker, a lock on it or in its value): what is compared with the item and sent to it. */
function content(s: Section): Section {
  const { _synced, _lock, ...rest } = structuredClone(s);
  void _synced, void _lock;
  if (rest.value && '_lock' in rest.value) delete rest.value._lock;
  return rest;
}
/** Is the copy as its item has it? */
const stable = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
export const sameAsItem = (s: Section, it: lib.LibItem) => stable(content(s)) === stable(content(it.body.value as Section));

export const mayDetach = (it: lib.LibItem) => EDITORS.includes(viewerRole()) || !(it.locks?.move || it.locks?.remove || it.locks?.edit);
export const mayEditEverywhere = (it: lib.LibItem) => EDITORS.includes(viewerRole()) || (it.kind === 'snippet' && it.createdByName === viewerName());

/** The copy becomes this page's own section (the save is the detach); one undo step. `quiet`: a save follows, which says so. */
export function detach(model: PageModel, index: number, quiet = false): void {
  model.change({ op: 'remove', path: `sections.${index}._synced` });
  if (!quiet) toast('Detached: it is this page’s own section now. Save to keep it that way.', 'ok');
}

export interface SyncedNoteOpts {
  model: PageModel;
  index: number;
  entry: () => Entry;
  save: () => Promise<boolean>;
  reload: (fresh: Entry) => void;
}

/**
 * The note over a synced section's fields: where it comes from and how many pages use it; when it was changed here,
 * Apply to every page, Undo my changes, or Detach here. `sync` draws it again after an edit.
 */
export function syncedNote(o: SyncedNoteOpts): { el: HTMLElement; sync: () => void } {
  const box = h('div', 'msp-synced');
  box.setAttribute('role', 'status');
  const s = () => (o.model.get('sections') as Section[] | undefined)?.[o.index];
  const id = markerOf(s())!.id;
  box.append(h('p', 'msp-synced__text', 'Synced from the Library…'));
  let it: lib.LibItem | null | undefined;
  let pages = 'every page that uses it';
  let shown = '';
  let countedFor: boolean | null = null;
  /** the pages that use it, this one too (Apply saves this page first, so a copy not saved yet counts) */
  const count = async (changed: boolean) => {
    countedFor = changed;
    const e = o.entry();
    const n = await lib.impact(id).then(
      (r) => r.pages.length + (r.pages.some((p) => p.collection === e.collection && p.id === e.id) ? 0 : 1),
      () => null,
    );
    if (n !== null) pages = `${n} page${n === 1 ? '' : 's'}`;
    shown = '';
    draw();
  };
  const draw = () => {
    const cur = s();
    if (it === undefined || !markerOf(cur)) return;
    if (!it) {
      if (shown === 'gone') return;
      shown = 'gone';
      return void box.replaceChildren(h('p', 'msp-synced__text', 'Synced from a Library item that is not there any more. Detach it to keep it as this page’s own.'), tools([['Detach here', () => detach(o.model, o.index)]]));
    }
    const changed = !sameAsItem(cur!, it);
    if (countedFor !== changed) void count(changed);
    if (shown === String(changed)) return;
    shown = String(changed);
    const name = h('strong');
    name.textContent = `“${it.name}”`;
    const text = h('p', 'msp-synced__text');
    const locked = !mayDetach(it) ? ' An editor locked it, so only an editor can detach it.' : '';
    text.append('Synced from the Library: ', name, changed ? `. You changed it here: apply it to ${pages} (this one too), or undo your changes.${locked}` : `, on ${pages}. A change here can be applied to all of them; detach it to make it this page’s own.${locked}`);
    const acts: [string, () => void, string?][] = [];
    if (changed && mayEditEverywhere(it)) acts.push([`Apply to ${pages}`, () => void apply(it!), 'ms-btn ms-btn--sm ms-btn--primary']);
    if (changed) acts.push(['Undo my changes', () => o.model.change({ op: 'set', path: `sections.${o.index}`, value: reset(it!) })]);
    if (mayDetach(it)) acts.push(['Detach here', () => detach(o.model, o.index)]);
    acts.push(['Open in the Library', () => (location.hash = `#/library?open=${encodeURIComponent(id)}`), 'ms-btn ms-btn--sm ms-btn--quiet']);
    box.classList.toggle('is-changed', changed);
    box.replaceChildren(text, tools(acts));
  };
  void itemById(id).then((found) => {
    it = found;
    draw();
  });
  return { el: box, sync: draw };

  /** The item's content in this copy's place, with the copy's own marker and locks (the server stamps those). */
  function reset(item: lib.LibItem): Section {
    const cur = s()!;
    const v = content(item.body.value as Section);
    if (cur.value?._lock !== undefined) v.value = { ...(v.value ?? {}), _lock: cur.value._lock };
    return { ...v, _synced: cur._synced, ...(cur._lock !== undefined ? { _lock: cur._lock } : {}) };
  }

  /** The copy as changed here goes to the item and every page; this page's other changes are saved first. */
  async function apply(item: lib.LibItem): Promise<void> {
    const mine = content(s()!);
    const choice = await ask('Apply to every page', `“${item.name}” changes on every page that uses it, this one too, in one commit. A page where it was changed by hand is left alone.`, [
      ['cancel', 'Cancel'],
      ['apply', 'Apply', 'ms-btn ms-btn--primary'],
    ]);
    if (choice !== 'apply') return;
    // the copy goes back to the item's for the save, so only the page's other changes are saved here
    o.model.change({ op: 'set', path: `sections.${o.index}`, value: reset(item) });
    if (!(await o.save())) return void toast('The page did not save, so nothing was applied. Your change is one ⌘Z back.', 'error');
    try {
      const r = await lib.editEverywhere(item.id, { ...item.body, value: mine }, item.version);
      const e = o.entry();
      o.reload(await getEntry(e.collection, e.id));
      const skipped = r.skipped?.length ? ` Left alone (changed there by hand): ${r.skipped.map((x) => x.title).join(', ')}.` : '';
      toast(`Changed “${item.name}” on ${r.changed} page${r.changed === 1 ? '' : 's'}.${skipped}`, 'ok');
    } catch (err) {
      toast(err instanceof ApiError && err.status === 409 ? `“${item.name}” changed in the Library meanwhile: open it there and try again.` : `Not applied: ${(err as Error).message}`, 'error');
    }
  }
}

function tools(acts: [string, () => void, string?][]): HTMLElement {
  const row = h('div', 'msp-synced__tools');
  for (const [label, run, cls] of acts) {
    const b = h('button', cls ?? 'ms-btn ms-btn--sm');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', run);
    row.append(b);
  }
  return row;
}

/** The synced copies of item `id` on the page now (a save the server refused as `synced` names the item). */
export function copiesOf(model: PageModel, id: string): number[] {
  const list = (model.get('sections') as Section[] | undefined) ?? [];
  return list.flatMap((sec, i) => (markerOf(sec)?.id === id ? [i] : []));
}
