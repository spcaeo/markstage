// Locks on an article's blocks (docs/OPERATIONS.md "Locks"): what can't be done to a box or to the section under a
// heading with the editor's own tools (the grip, its drag and menu, Alt+↑/↓, the Outline). Three sources, one lock:
//   - the site's rules (`GET site/locks`, config `locks.articles` until read), by box name: "Locked by the site"; a
//     run of the same box drawn as one (a group of FAQs) is that box;
//   - an editor's lock on ONE box: its `lock` attribute, written as `data-lock="move remove"` on the box's opening
//     tag by the block pack (a run's lock is its first box's, as the server reads it);
//   - frontmatter `locks: [{box: 'faq', move: false}]`: the site's rule for that kind lifted on this entry only
//     ("Unlock on this page"); `{heading: 'Pricing', move?, remove?, edit?}` locks the section under a heading.
// Other blocks still move past a locked one. The server checks the same on save (core locks.mjs, a 423).
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Lock } from '@markstage/core';
import { normalizeLockRules } from '@markstage/core';
import { request } from './api';
import { lockRules } from './page-types';
import { config, isBox, viewerName } from './runtime';

export type LockPart = 'move' | 'remove' | 'edit';
export const PARTS: LockPart[] = ['move', 'remove', 'edit'];

/** An entry's own marker for one box or heading: true locks, false lifts the site's rule here. */
export interface OwnLock {
  box?: string;
  heading?: string;
  move?: boolean;
  remove?: boolean;
  edit?: boolean;
  by?: string;
  at?: string;
}

export interface LockInfo {
  /** what the marker names: a box by its block name, or the section under a heading by its words */
  on: { box: string } | { heading: string };
  /** the site's rule for it, the entry's frontmatter marker, and the box's own lock (data-lock) */
  site?: Lock;
  own?: OwnLock;
  attr?: Lock;
  /** the node that carries the box's own lock (a run's first box) */
  holder?: PMNode;
  /** what holds now (undefined: nothing) */
  lock?: Lock;
}

/** Where the entry's markers are read and written (the frontmatter edits; set by the editor when it starts). */
let store: { get(): unknown; set(v: OwnLock[]): void } | null = null;
export const useLockStore = (s: typeof store) => void (store = s);
const marks = (): OwnLock[] => {
  const v = store?.get();
  return Array.isArray(v) ? v.filter((x): x is OwnLock => !!x && typeof x === 'object') : [];
};

/** The name a box goes by in the rules: its block name, or the one of its items when it is a run drawn as one. */
function boxName(node: PMNode): string | null {
  const name = node.type.name;
  const rules = lockRules().articles;
  let kid = node.firstChild?.type.name ?? null;
  node.forEach((c) => void (c.type.name !== kid && (kid = null)));
  // a rule names it first (a group of FAQs is "faq"), then what it is
  if (rules[name]) return name;
  if (kid && rules[kid]) return kid;
  if (isBox(name)) return name;
  return kid && isBox(kid) ? kid : null;
}

const same = (a: OwnLock, on: LockInfo['on']) => ('box' in on ? a.box === on.box : a.heading === on.heading);

/** A stored lock ("move remove", or {move: true}) as a Lock; undefined when it locks nothing. */
export function readLock(v: unknown): Lock | undefined {
  const words = typeof v === 'string' ? v.split(/[\s,]+/) : v && typeof v === 'object' ? PARTS.filter((w) => (v as Record<string, unknown>)[w] === true) : [];
  const out: Lock = {};
  for (const w of PARTS) if (words.includes(w)) out[w] = true;
  return Object.keys(out).length ? out : undefined;
}
/** A lock as data-lock writes it: the parts in move, remove, edit order ('' none). */
const lockText = (want: Partial<Record<LockPart, boolean>>) => PARTS.filter((w) => want[w]).join(' ');

/** What a top-level block's lock is made of; undefined for a block that can't be locked (a paragraph, a list). */
export function lockInfo(node: PMNode | null | undefined): LockInfo | undefined {
  if (!node) return undefined;
  const heading = node.type.name === 'heading' ? node.textContent.trim() : null;
  const box = heading === null ? boxName(node) : null;
  if (!heading && !box) return undefined;
  const on: LockInfo['on'] = heading ? { heading } : { box: box! };
  const rule = box ? lockRules().articles[box] : undefined;
  const site = rule && (rule.move || rule.remove || rule.edit) ? { move: !!rule.move, remove: !!rule.remove, edit: !!rule.edit, by: 'the site' } : undefined;
  const own = marks().find((m) => same(m, on));
  // a box's own lock: on the box, or on any box of a run drawn as one (any of them binds the run, as on the server);
  // a new lock goes on the run's first
  const run = !box ? [] : node.type.name !== box ? (node.content.content as PMNode[]).filter((c) => c.type.name === box) : [node];
  const holder = run[0];
  const parts = run.map((n) => readLock(n.attrs.lock)).filter((l): l is Lock => !!l);
  const attr = parts.length ? (Object.fromEntries(PARTS.map((w) => [w, parts.some((l) => l[w])])) as Lock) : undefined;
  // each part: the box's own lock, else the site's rule unless this entry lifts it (a heading: its marker)
  const bySite = (w: LockPart) => !!site?.[w] && own?.[w] !== false;
  const holds = (w: LockPart) => !!attr?.[w] || bySite(w) || own?.[w] === true;
  const fromSite = PARTS.some((w) => holds(w) && bySite(w) && !attr?.[w] && own?.[w] !== true);
  const lock: Lock = { move: holds('move'), remove: holds('remove'), edit: holds('edit'), by: fromSite ? 'the site' : own?.by || 'an editor' };
  return { on, site, own, attr, holder, lock: lock.move || lock.remove || lock.edit ? lock : undefined };
}

/** The lock on a top-level block of the article, or undefined. */
export const blockLock = (node: PMNode | null | undefined): Lock | undefined => lockInfo(node)?.lock;

/**
 * Sets what holds for the block. A box: what the site's rule doesn't already lock goes on the box itself (its
 * data-lock, one change on the canvas); a site rule it lifts goes in the frontmatter, for that kind on this entry.
 * A heading: its frontmatter marker. `at` is where the block starts in the document.
 */
export function setLock(info: LockInfo, want: Record<LockPart, boolean>, editor?: Editor | null, at?: number): void {
  if (!store) return;
  const box = 'box' in info.on;
  const own: OwnLock = { ...info.on };
  // a box's marker only lifts the site's rule; a heading's says everything
  for (const w of PARTS) {
    if (box ? info.site?.[w] && !want[w] : want[w] !== !!info.site?.[w]) own[w] = want[w];
  }
  const keep = PARTS.some((w) => typeof own[w] === 'boolean');
  if (keep && viewerName()) own.by = viewerName();
  if (keep) own.at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const list = marks();
  const i = list.findIndex((m) => same(m, info.on));
  const was = i >= 0 ? JSON.stringify({ ...list[i], by: 0, at: 0 }) : null;
  if (!(keep && was === JSON.stringify({ ...own, by: 0, at: 0 }))) {
    if (i >= 0) keep ? list.splice(i, 1, own) : list.splice(i, 1);
    else if (keep) list.push(own);
    if (keep || i >= 0) store.set(list);
  }
  if (!box || !editor || at === undefined || !info.holder) return;
  // the box's own lock: the parts wanted that the site's rule doesn't lock
  const text = lockText(Object.fromEntries(PARTS.map((w) => [w, want[w] && !info.site?.[w]])));
  if (text === lockText(info.attr ?? {})) return;
  const pos = info.holder === editor.state.doc.nodeAt(at) ? at : at + 1;
  if (editor.state.doc.nodeAt(pos) !== info.holder) return;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...info.holder.attrs, lock: text || null });
  // the rest of a run keeps no lock of its own, so the run holds exactly what was asked (one change, one ⌘Z)
  if (pos === at + 1) {
    const wrap = tr.doc.nodeAt(at);
    wrap?.forEach((c, off) => {
      if (off > 0 && c.type === info.holder!.type && c.attrs.lock) tr.setNodeMarkup(at + 1 + off, undefined, { ...c.attrs, lock: null });
    });
  }
  editor.view.dispatch(tr);
}

const NAMES: Record<LockPart, string> = { move: 'moved', remove: 'deleted', edit: 'changed' };
/** "Locked by the site: can't be moved or deleted." */
export const lockReason = (l: Lock) => `Locked by ${l.by ?? 'the site'}: can't be ${PARTS.filter((w) => l[w]).map((w) => NAMES[w]).join(' or ').replace(/ or (?=.* or )/, ', ')}.`;

let rulesRead = 0;
/**
 * The site's rules as the server has them now (the config's are baked in when the editor was built, and Settings →
 * Locks may have changed them since): read at most once a minute, signed in only; then `ms-lock-rules` is sent and
 * the padlocks draw again.
 */
export function freshLockRules(): void {
  if (!viewerName() || Date.now() - rulesRead < 60_000) return;
  rulesRead = Date.now();
  void request<{ rules: unknown }>('site/locks').then(
    (d) => {
      const rules = normalizeLockRules(d.rules);
      if (JSON.stringify(rules) === JSON.stringify(config().locks ?? null)) return;
      config().locks = rules;
      dispatchEvent(new Event('ms-lock-rules'));
    },
    () => undefined,
  );
}
