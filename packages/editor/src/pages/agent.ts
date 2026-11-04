// The page agent: runs inside the real page (the preview origin, or the dev server's page in a same-origin frame)
// and makes its bound fields editable where they are drawn. The site marks them (packages/astro bind.mjs):
// data-ms-field="sections.3.value.heading", data-ms-kind="text|rich|image|link|list", data-ms-format, and
// data-ms-section="3" on each section's outer element.
//
//   editor -> page  { markstage: 'page:hello' }                           the frame said ready or rendered
//   page -> editor  { markstage: 'page:ready', path, fields, sections }   the answer: what the page binds
//   editor -> page  { markstage: 'page:on', values, locked? }             start, with the stored value of each field
//                                                                         (`locked`: the paths the person may not
//                                                                         change: a click picks them, never edits)
//   editor -> page  { markstage: 'page:values', values }                  values changed in the panel
//   editor -> page  { markstage: 'page:reveal', path? | section? }        scroll to it and outline it
//   editor -> page  { markstage: 'page:track', on }                       a Library drag over the page began / ended
//   editor -> page  { markstage: 'page:scroll', by }                      scroll by this many pixels (near an edge)
//   page -> editor  { markstage: 'page:rects', rects, height }            where each section is drawn: after track on,
//                                                                         and after each scroll or resize while on
//   page -> editor  { markstage: 'page:edit', path, value }               typed in place (the stored form of the value)
//   page -> editor  { markstage: 'page:pick', path, kind }                clicked a field the panel edits
//   page -> editor  { markstage: 'page:section', index }                  clicked elsewhere in a section
//   page -> editor  { markstage: 'page:editing', on }                     typing in place started / ended
//   page -> editor  { markstage: 'page:key', key: 's' }                   ⌘S pressed on the page: the editor takes
//                                                                         the keyboard back (it never saves on it)
//   page -> editor  { markstage: 'page:stale' }                           the site changed (dev): draw the page again
//
// A click on text or rich text shows the stored value in place of the drawn one (the site may respell or reformat
// what it draws) and edits that. Links do not navigate while editing. Messages go through the preview agent's hub
// (device/agent.ts): only from the page's parent, only from one of the editor's origins, and only back to it.
import { onRequest, post } from '../device/agent';
import type { BoundField, SectionRect, ToPage } from './types';

const STYLE = `
[data-ms-field].ms-hover{outline:2px solid #6161ff!important;outline-offset:2px;cursor:pointer}
[data-ms-field][data-ms-kind=text].ms-hover,[data-ms-field][data-ms-kind=rich].ms-hover{cursor:text}
[data-ms-field].ms-locked.ms-hover{outline-style:dashed!important;cursor:default!important}
[data-ms-field].ms-editing{outline:2px solid #6161ff!important;outline-offset:2px;background:rgba(97,97,255,.06)}
[data-ms-section].ms-hover-section{outline:1px dashed rgba(97,97,255,.6)!important;outline-offset:-1px}
.ms-flash{animation:ms-flash 1.4s ease-out}
@keyframes ms-flash{0%{box-shadow:0 0 0 4px rgba(97,97,255,.55)}100%{box-shadow:0 0 0 4px rgba(97,97,255,0)}}`;

/** `receive`: hand a message to the agent directly (a same-origin frame, see install); `active`: the editor is on. */
export type Agent = { off: () => void; receive: (msg: ToPage) => void; active: () => boolean };

/**
 * The stored value after an edit: only the span the writer changed is replaced in `original`. `start` is how the
 * element read back when editing began and `now` how it reads now; the browser may write the rest of the markup
 * differently from how it is stored (entities, <br/>, attribute quotes), and none of that reaches the file. A
 * non-breaking space the browser turned into a plain one as typing followed it stays as it was. The changed span is
 * found in the stored text by the text around it (as much as matches exactly once); if it cannot be found, the
 * element's markup is taken as it is.
 */
export function splice(original: string, start: string, now: string): string {
  if (now === start) return original;
  let p = 0;
  while (p < start.length && p < now.length && start[p] === now[p]) p++;
  let q = 0;
  while (q < start.length - p && q < now.length - p && start[start.length - 1 - q] === now[now.length - 1 - q]) q++;
  const head = start.slice(0, p);
  const tail = start.slice(start.length - q);
  const removed = start.slice(p, start.length - q);
  const added = now.slice(p, now.length - q);
  const keepNbsp = NBSP_ONLY.test(removed) && added.startsWith(' ');
  const put = (was: string) => (keepNbsp ? was + added.slice(1) : added);
  if (original === start) return head + put(removed) + tail;
  for (const k of [64, 32, 16, 8, 4]) {
    const left = head.slice(-k);
    const right = tail.slice(0, k);
    if (!removed && !left && !right) break;
    const re = new RegExp(`(${loose(left)})(${loose(removed)})(${loose(right)})`, 'g');
    const found = [...original.matchAll(re)];
    if (found.length > 1) break; // more context only matched less: ambiguous
    if (found.length === 1) {
      const m = found[0];
      const at = m.index + m[1].length;
      return original.slice(0, at) + put(m[2]) + original.slice(at + m[2].length);
    }
  }
  return now;
}

const NBSP_ONLY = /^(&nbsp;|\u00a0)$/;
/** `text` as a pattern in which a non-breaking space matches either way it is written. */
const loose = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&nbsp;|\u00a0/g, '(?:&nbsp;|\u00a0)');

/** Starts the page agent in `win`; it answers through `send` (the hub's post, pinned to the editor's origin). */
export function install(win: Window, send: (msg: object) => void): Agent {
  const doc = win.document;
  let values: Record<string, unknown> = {};
  let on = false;
  let locked = new Set<string>();
  // shown: what the page drew; start: the stored value as the element reads it back; original: the stored value
  let editing: { el: HTMLElement; path: string; shown: string; start: string; original: unknown; html: boolean } | null = null;
  let hover: HTMLElement | null = null;
  let hoverSection: HTMLElement | null = null;
  // the frame's own Element class, not the editor's: duck-typed, since a same-origin frame is another realm
  const asEl = (t: EventTarget | null) => (t && typeof (t as Element).closest === 'function' ? (t as Element) : null);
  const fieldOf = (t: EventTarget | null) => asEl(t)?.closest<HTMLElement>('[data-ms-field]') ?? null;
  const sectionOf = (t: EventTarget | null) => asEl(t)?.closest<HTMLElement>('[data-ms-section]') ?? null;
  const kindOf = (el: HTMLElement) => (el.dataset.msKind ?? 'text') as BoundField['kind'];
  const inline = (el: HTMLElement) => (kindOf(el) === 'text' || kindOf(el) === 'rich') && !el.dataset.msFormat && !locked.has(el.dataset.msField ?? '');

  const style = doc.createElement('style');
  style.textContent = STYLE;

  function bound(): { fields: BoundField[]; sections: number[] } {
    const fields: BoundField[] = [];
    const seen = new Set<string>();
    for (const el of doc.querySelectorAll<HTMLElement>('[data-ms-field]')) {
      const path = el.dataset.msField!;
      if (seen.has(path)) continue;
      seen.add(path);
      fields.push({ path, kind: kindOf(el), ...(el.dataset.msFormat ? { format: el.dataset.msFormat } : {}) });
    }
    const sections = [...doc.querySelectorAll<HTMLElement>('[data-ms-section]')].map((e) => Number(e.dataset.msSection)).filter(Number.isInteger);
    return { fields, sections };
  }

  /** The stored value as markup: text with markup in it is edited as markup, so nothing in it is lost. */
  const asHtml = (el: HTMLElement, v: unknown) => kindOf(el) === 'rich' || /<\/?[a-z][^>]*>|&[a-z#0-9]+;/i.test(String(v ?? ''));

  function startEdit(el: HTMLElement): void {
    if (editing?.el === el) return;
    finishEdit();
    const path = el.dataset.msField!;
    const stored = values[path];
    const shown = el.innerHTML;
    const html = asHtml(el, stored);
    if (typeof stored === 'string') {
      if (html) el.innerHTML = stored;
      else el.textContent = stored;
    }
    // plaintext-only keeps pasted markup out of a text field (where a browser lacks it, plain 'true')
    el.contentEditable = html ? 'true' : 'plaintext-only';
    if (!html && el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.classList.add('ms-editing');
    el.spellcheck = true;
    editing = { el, path, shown, start: read(el, html), original: stored, html };
    send({ markstage: 'page:editing', on: true });
    el.focus();
    const sel = win.getSelection();
    if (sel && !el.contains(sel.anchorNode)) {
      const r = doc.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  // textContent, not innerText: innerText is the text as drawn (CSS uppercase and all)
  const read = (el: HTMLElement, html: boolean) => (html ? el.innerHTML : (el.textContent ?? '').replace(/\n+$/, ''));

  function emitEdit(): void {
    if (!editing) return;
    const now = splice(typeof editing.original === 'string' ? editing.original : editing.start, editing.start, read(editing.el, editing.html));
    if (now === values[editing.path]) return;
    values[editing.path] = now;
    send({ markstage: 'page:edit', path: editing.path, value: now });
  }

  function finishEdit(cancel = false): void {
    if (!editing) return;
    const { el, path, shown, original } = editing;
    if (cancel) {
      if (values[path] !== original) send({ markstage: 'page:edit', path, value: original });
      values[path] = original;
      el.innerHTML = shown;
    }
    el.removeAttribute('contenteditable');
    el.classList.remove('ms-editing');
    editing = null;
    send({ markstage: 'page:editing', on: false });
  }

  const onOver = (e: Event) => {
    if (!on) return;
    const f = fieldOf(e.target);
    if (f !== hover) {
      hover?.classList.remove('ms-hover');
      hover = f;
      hover?.classList.add('ms-hover');
    }
    const s = sectionOf(e.target);
    if (s !== hoverSection) {
      hoverSection?.classList.remove('ms-hover-section');
      hoverSection = s;
      hoverSection?.classList.add('ms-hover-section');
    }
  };
  const onClick = (e: MouseEvent) => {
    if (!on) return;
    const f = fieldOf(e.target);
    const inLink = (e.target as Element | null)?.closest?.('a, button, form, summary, label');
    if (f || inLink) e.preventDefault();
    if (f && editing?.el === f) return;
    if (f && inline(f)) {
      e.stopPropagation();
      startEdit(f);
      return;
    }
    finishEdit();
    if (f) {
      e.stopPropagation();
      send({ markstage: 'page:pick', path: f.dataset.msField, kind: kindOf(f) });
      return;
    }
    const s = sectionOf(e.target);
    if (s) send({ markstage: 'page:section', index: Number(s.dataset.msSection) });
  };
  const onInput = (e: Event) => {
    if (editing && editing.el.contains(e.target as Node)) emitEdit();
  };
  const onKey = (e: KeyboardEvent) => {
    // ⌘S on the page saves in the editor (not the browser's Save page dialog); what was typed went out before it
    if (on && (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      send({ markstage: 'page:key', key: 's' });
      return;
    }
    if (!editing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(true);
    } else if (e.key === 'Enter' && !editing.html && !e.shiftKey) {
      e.preventDefault();
      finishEdit();
    }
  };
  const onFocusOut = (e: FocusEvent) => {
    if (editing && !editing.el.contains(e.relatedTarget as Node | null)) finishEdit();
  };
  const onSubmit = (e: Event) => on && e.preventDefault();

  function reveal(msg: Extract<ToPage, { markstage: 'page:reveal' }>): void {
    const el =
      msg.path !== undefined
        ? doc.querySelector<HTMLElement>(`[data-ms-field="${CSS.escape(msg.path)}"]`)
        : msg.section !== undefined
          ? doc.querySelector<HTMLElement>(`[data-ms-section="${msg.section}"]`)
          : null;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('ms-flash');
    void el.offsetWidth;
    el.classList.add('ms-flash');
  }

  /** Shows panel edits on the page: text fields take the new stored value (until the page is drawn again). */
  function showValues(next: Record<string, unknown>): void {
    for (const [path, v] of Object.entries(next)) {
      if (values[path] === v) continue;
      values[path] = v;
      if (editing?.path === path || typeof v !== 'string') continue;
      for (const el of doc.querySelectorAll<HTMLElement>(`[data-ms-field="${CSS.escape(path)}"]`)) {
        if (!inline(el)) continue;
        if (asHtml(el, v)) el.innerHTML = v;
        else el.textContent = v;
      }
    }
  }

  // while the editor drags a Library section over the page: where the sections are, again after a scroll
  let tracking = false;
  let rectsQueued = false;
  const sendRects = () => {
    rectsQueued = false;
    if (!tracking) return;
    const rects: SectionRect[] = [];
    const seen = new Set<number>();
    for (const el of doc.querySelectorAll<HTMLElement>('[data-ms-section]')) {
      const index = Number(el.dataset.msSection);
      if (!Number.isInteger(index) || seen.has(index)) continue;
      seen.add(index);
      const r = el.getBoundingClientRect();
      rects.push({ index, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) });
    }
    send({ markstage: 'page:rects', rects, height: win.innerHeight });
  };
  const queueRects = () => {
    if (!tracking || rectsQueued) return;
    rectsQueued = true;
    win.requestAnimationFrame(sendRects);
  };
  function track(want: boolean): void {
    tracking = want;
    if (want) {
      win.addEventListener('scroll', queueRects, true);
      win.addEventListener('resize', queueRects);
      sendRects();
    } else {
      win.removeEventListener('scroll', queueRects, true);
      win.removeEventListener('resize', queueRects);
    }
  }

  const receive = (msg: ToPage | null) => {
    if (!msg || typeof msg !== 'object' || typeof msg.markstage !== 'string' || !msg.markstage.startsWith('page:')) return;
    if (msg.markstage === 'page:hello') send({ markstage: 'page:ready', path: win.location.pathname, ...bound() });
    else if (msg.markstage === 'page:on') {
      values = { ...msg.values };
      locked = new Set(Array.isArray(msg.locked) ? msg.locked.filter((p): p is string => typeof p === 'string') : []);
      for (const el of doc.querySelectorAll<HTMLElement>('[data-ms-field]')) el.classList.toggle('ms-locked', locked.has(el.dataset.msField!));
      on = true;
      if (!style.isConnected) doc.head.append(style);
    } else if (msg.markstage === 'page:values') showValues(msg.values);
    else if (msg.markstage === 'page:reveal') reveal(msg);
    else if (msg.markstage === 'page:track') track(msg.on === true);
    else if (msg.markstage === 'page:scroll' && Number.isFinite(msg.by)) win.scrollBy(0, Math.max(-200, Math.min(200, msg.by)));
    else if (msg.markstage === 'page:off') off();
  };

  function off(): void {
    track(false);
    finishEdit();
    on = false;
    hover?.classList.remove('ms-hover');
    hoverSection?.classList.remove('ms-hover-section');
    style.remove();
  }

  doc.addEventListener('mouseover', onOver, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusout', onFocusOut, true);
  doc.addEventListener('submit', onSubmit, true);
  const agent: Agent = {
    receive,
    active: () => on,
    off: () => {
      off();
      doc.removeEventListener('mouseover', onOver, true);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('input', onInput, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('focusout', onFocusOut, true);
      doc.removeEventListener('submit', onSubmit, true);
    },
  };
  return agent;
}

// Registered with the preview agent's hub (device/agent.ts, which pins the editor's origin for the preview server's
// script and the dev integration alike). Starts on the first page: message; the editor sends page:hello when the
// frame says it is ready or rendered, and the answer is page:ready.
let agent: Agent | null = null;
// In `astro dev` a save (or any edit to the site) makes the dev server reload every open page, which would reload
// this page under the writer's hands and lose what they type. While the editor is on, the page skips that reload
// (Vite reloads for an .html path only when it is this page's, so the path is pointed elsewhere, as the shell does
// for itself) and tells the editor, which draws the page again when the writer is idle.
const hot = (import.meta as { hot?: { on: (ev: string, cb: (p: { path?: string }) => void) => void } }).hot;
hot?.on('vite:beforeFullReload', (payload) => {
  // a reload for an .html path is not this page's (a site's pages here have no .html address): Vite ignores it too
  if (!agent?.active() || payload.path?.endsWith('.html')) return;
  payload.path = '/markstage-reload-skipped.html';
  post({ markstage: 'page:stale' });
});
if (typeof window !== 'undefined')
  onRequest('page', (msg) => {
    if (!msg.markstage.startsWith('page:')) return false;
    agent ??= install(window, (m) => post(m));
    agent.receive(msg as unknown as ToPage);
    return true;
  });
