// The padlock and its popover (docs/OPERATIONS.md "Locks"), the same for an article's boxes (padlocks.ts) and a
// page's sections (the pages editor): a pill (a closed padlock and "Locked" or "Locked by the site") on every
// locked block, always shown, its reason in its tooltip; a click opens what is locked, by whom, and for the roles that may: what can't be done (moved, deleted,
// changed) as switches, "Unlock" (or "Unlock on this page" for a site rule, kept with the entry) and, for an owner
// or administrator, "Change the rule for every page" (Settings → Locks). Authors and contributors read the reason.
import './styles/lock-ui.css';
import type { Lock } from '@markstage/core';
import { ic } from './icons';
import { lockReason, PARTS, type LockPart } from './locks';
import { viewerRole } from './runtime';

/** What the popover is about and how it changes it. */
export interface LockTarget {
  /** "FAQ questions", "Hero section" */
  label: string;
  /** the site's rule, and what holds now */
  site?: Lock;
  lock?: Lock;
  /** sets what holds (the owner keeps only what differs from the site's rule) */
  set(want: Record<LockPart, boolean>): void;
  /** Settings → Locks, at this kind's rule */
  ruleHref?: string;
}

const EDITORS = ['owner', 'administrator', 'editor'];
const MANAGERS = ['owner', 'administrator'];
const SWITCH: Record<LockPart, string> = { move: 'moved', remove: 'deleted', edit: 'changed' };

/** What the pill says: "Locked by the site", "Locked", or (open, on hover) "Lock". */
export const lockWord = (lock: Lock | undefined) => (!lock ? 'Lock' : lock.by?.startsWith('the site') ? 'Locked by the site' : 'Locked');

/** The padlock pill: closed and worded on a locked block (always shown), open on hover over one that can be locked. */
export function padlockButton(lock: Lock | undefined, open: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `ms-padlock${lock ? ' is-locked' : ''}`;
  b.innerHTML = `${ic(lock ? 'lock' : 'unlock', 14)}<span></span>`;
  b.querySelector('span')!.textContent = lockWord(lock);
  const say = lock ? `${lockReason(lock)} Click for the lock.` : 'Not locked. Click to lock it.';
  b.title = say;
  b.setAttribute('aria-label', say);
  b.setAttribute('aria-haspopup', 'dialog');
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    open();
  });
  return b;
}

let openPop: { el: HTMLElement; close(): void } | null = null;
export const lockPopoverOpen = () => !!openPop;
export const closeLockPopover = () => openPop?.close();

/** Opens the popover under `anchor`; `t()` is read again after each change (the block's lock as it is now). */
export function openLockPopover(anchor: HTMLElement, t: () => LockTarget | null, onClose?: () => void): void {
  openPop?.close();
  const el = document.createElement('div');
  el.className = 'ms-lockpop';
  el.setAttribute('role', 'dialog');
  const can = EDITORS.includes(viewerRole());
  const draw = () => {
    const x = t();
    if (!x) return close();
    const lock = x.lock;
    // a site rule this entry lifts: "Unlocked on this page"
    const lifted = !!x.site && PARTS.some((w) => x.site![w] && !lock?.[w]);
    el.setAttribute('aria-label', `${x.label}: ${lock ? 'locked' : 'not locked'}`);
    el.replaceChildren();
    const head = document.createElement('div');
    head.className = 'ms-lockpop__head';
    head.innerHTML = `${ic(lock ? 'lock' : 'unlock', 16)}<strong></strong>`;
    head.querySelector('strong')!.textContent = `${lock ? 'Locked' : lifted ? 'Unlocked on this page' : 'Not locked'}: ${x.label}`;
    el.append(head);
    const p = (text: string, cls = '') => el.append(Object.assign(document.createElement('p'), { className: `ms-lockpop__text ${cls}`.trim(), textContent: text }));
    if (lock) p(lockReason(lock));
    if (lifted) p(`The site locks it on every other page (${lockReason(x.site!).replace(/^Locked by the site: /, '').replace(/\.$/, '')}); here it is lifted.`, 'is-note');
    if (!can) {
      if (lock) p('Ask an editor to unlock it.', 'is-note');
      return;
    }
    // what can't be done, one switch each; a change applies at once and is saved with the page
    const box = document.createElement('fieldset');
    box.className = 'ms-lockpop__parts';
    box.append(Object.assign(document.createElement('legend'), { textContent: "Can't be" }));
    const want = { move: !!lock?.move, remove: !!lock?.remove, edit: !!lock?.edit };
    for (const w of PARTS) {
      const l = document.createElement('label');
      const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: want[w] });
      c.addEventListener('change', () => (x.set({ ...want, [w]: c.checked }), draw(), el.querySelector<HTMLInputElement>(`[data-part="${w}"]`)?.focus()));
      c.dataset.part = w;
      l.append(c, document.createTextNode(SWITCH[w]));
      if (x.site?.[w]) l.title = `The site's rule locks this (${SWITCH[w]}) on every page.`;
      box.append(l);
    }
    el.append(box);
    const tools = document.createElement('div');
    tools.className = 'ms-lockpop__tools';
    const btn = (text: string, run: () => void, primary = false) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: `ms-btn ms-btn--sm${primary ? ' ms-btn--primary' : ''}`, textContent: text });
      b.addEventListener('click', () => (run(), draw(), el.querySelector<HTMLElement>('button, input')?.focus()));
      tools.append(b);
    };
    const none = { move: false, remove: false, edit: false };
    if (lock) btn(x.site && PARTS.some((w) => x.site![w] && lock[w]) ? 'Unlock on this page' : 'Unlock', () => x.set(none), true);
    else if (lifted) btn('Lock again (the site’s rule)', () => x.set({ move: !!x.site!.move, remove: !!x.site!.remove, edit: !!x.site!.edit }), true);
    else btn('Lock', () => x.set({ move: true, remove: true, edit: false }), true);
    if (x.site && x.ruleHref && MANAGERS.includes(viewerRole())) {
      const a = Object.assign(document.createElement('a'), { className: 'ms-btn ms-btn--sm ms-btn--quiet', href: x.ruleHref, textContent: 'Change the rule for every page' });
      a.addEventListener('click', () => close());
      tools.append(a);
    }
    el.append(tools);
    p('Saved with the page (⌘S).', 'is-note');
  };
  // the pill drawn again (the lock changed, the list redrew): this block's new one
  const pill = () => (anchor.isConnected ? anchor : document.querySelector<HTMLElement>(`.ms-padlock[data-index="${anchor.dataset.index}"]`));
  let seen = '';
  const place = () => {
    const r = pill()?.getBoundingClientRect();
    if (!r) return;
    el.style.top = `${Math.min(r.bottom + 6, innerHeight - el.offsetHeight - 8)}px`;
    el.style.left = `${Math.max(8, Math.min(r.right - el.offsetWidth, innerWidth - el.offsetWidth - 8))}px`;
  };
  // it stays by its pill while the page scrolls or settles (a list still loading moves the pill after it opened)
  const follow = () => {
    if (openPop?.el !== el) return;
    const r = pill()?.getBoundingClientRect();
    const now = r ? `${r.left},${r.bottom},${innerWidth},${innerHeight},${el.offsetHeight}` : '';
    if (now !== seen) (seen = now), place();
    requestAnimationFrame(follow);
  };
  const outside = (e: MouseEvent) => !el.contains(e.target as Node) && !pill()?.contains(e.target as Node) && close();
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  };
  function close(refocus = false): void {
    if (openPop?.el !== el) return;
    openPop = null;
    el.remove();
    removeEventListener('mousedown', outside, true);
    removeEventListener('keydown', key, true);
    // the pills were drawn again meanwhile (the lock changed): the keyboard goes back to this block's new one
    if (refocus) pill()?.focus();
    onClose?.();
  }
  draw();
  document.body.append(el);
  place();
  openPop = { el, close };
  requestAnimationFrame(follow);
  addEventListener('mousedown', outside, true);
  // Esc closes it wherever the focus is (a reader's popover has nothing to focus but itself)
  addEventListener('keydown', key, true);
  el.tabIndex = -1;
  (el.querySelector<HTMLElement>('input, button, a') ?? el).focus();
}
