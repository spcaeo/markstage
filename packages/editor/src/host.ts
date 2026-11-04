// The shell's API for the parts of the editor other people own:
//   - screens (#/<name>/<args…>?<params>): the admin screens (src/admin/**, the server's) call registerScreen() from
//     their index.ts, which the shell imports when it exists; the shell mounts one in place of the canvas;
//   - the pages editor (#/p/<collection>/<id>, src/pages/**): pages/index.ts exports mountPageEditor(host, ctx) and
//     the shell drives it like the canvas (Save, ⌘S, undo, the leave guard, the conflict banner);
//   - toast(): a short note at the bottom of the window, for everyone.
// The rest is shared as it is: request() and ApiError (api.ts), copyable() / copyText() (copy.ts), ask(), Banner,
// Menu (shell.ts), ic() (icons.ts), h() / input() / actionBtn() (panel-form.ts), the --ms-* tokens (chrome.css).
import type { Entry } from './api';
import type { Banner } from './shell';
import { ask } from './shell';
import type { MenuGroup } from './shell-words';

// ---------- screens ----------
export interface ScreenCtx {
  /** the path parts after the name (opaque ids) */
  args: string[];
  /** the screen's params as they are now */
  params(): URLSearchParams;
  /** moves within the screen: new args and/or params (null removes one); `push` adds a history entry */
  go(change: { args?: string[]; params?: Record<string, string | null> }, push?: boolean): void;
  /** anywhere in the editor, e.g. '#/e/posts/hello' or '#/users' */
  open(hash: string, push?: boolean): void;
  toast(text: string, kind?: ToastKind, opts?: ToastOpts): void;
  ask: typeof ask;
  /** the tab's title ("<text> · Markstage") */
  setTitle(text: string): void;
  /** while it returns true, leaving the screen asks first (null: no guard) */
  guard(dirty: (() => boolean) | null): void;
}

export interface MountedScreen {
  /** only the params changed (same name and args) */
  update?(ctx: ScreenCtx): void;
  destroy(): void;
}

export interface ScreenDef {
  /** the first part of the hash: #/users; not e, a or p */
  name: string;
  label: string;
  /** an icons.ts name */
  icon: string;
  /** where the navigation lists it: with the content, under admin, or not at all */
  nav?: 'main' | 'admin' | null;
  /** the drawer's group it sits in (shell-words.ts); 'tools' puts it under More tools; none with nav: More tools */
  group?: MenuGroup;
  /** what the drawer calls it (the word list, docs/EDITOR-UX.md section 3); the label otherwise */
  menuLabel?: string;
  /** roles that see it in the navigation (all when absent); the server still decides what they may do */
  roles?: string[];
  /** shown without a signed-in user (sign-in, 2FA, accept invite) */
  public?: boolean;
  mount(el: HTMLElement, ctx: ScreenCtx): MountedScreen | void;
}

const registry = new Map<string, ScreenDef>();

export function registerScreen(def: ScreenDef): void {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(def.name) || ['e', 'a', 'p'].includes(def.name)) throw new Error(`registerScreen: "${def.name}" is not a free screen name.`);
  registry.set(def.name, def);
}

export const screen = (name: string) => registry.get(name) ?? null;
export const screens = () => [...registry.values()];

// ---------- the pages editor ----------
export type PageStatus = 'idle' | 'loading' | 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

export interface PageCtx {
  entry: Entry;
  /** the right column: the pages editor owns its contents while mounted */
  panel: HTMLElement;
  setStatus(s: PageStatus, text?: string): void;
  banner: Banner;
  /** the pages editor's own params (#/p/<c>/<id>?sec=…&f=…) */
  params(): Record<string, string>;
  /** sets them (null removes one); `push` adds a history entry */
  go(params: Record<string, string | null>, push?: boolean): void;
  /** the address the framed page is loaded from (a preview origin in production); live: it follows unsaved edits */
  previewUrl(): Promise<{ url: string; live: boolean }>;
  /** the site's pages and special links matching `q`, for link fields */
  searchLinks(q: string): Promise<{ href: string; label: string }[]>;
  /** the media library chooser (upload, drop or paste in it): the chosen image's value and its alt text, or null */
  pickImage?(current: { src: string; alt: string } | null): Promise<{ src: string; alt: string } | null>;
  /** call after every edit: the shell updates the status and the leave guard from dirty() */
  changed(): void;
  /** a save answered 409: the shell shows the conflict banner; its Reload calls reload() with the fresh entry */
  onConflict(version?: string): void;
}

export interface PageEditor {
  /** true when saved (or nothing to save); on 409 call ctx.onConflict and return false */
  save(): Promise<boolean>;
  dirty(): boolean;
  reload(entry: Entry): void;
  destroy(): void;
  undo?(): void;
  redo?(): void;
  /** back or forward changed only its params (sec, f, …): show that state */
  paramsChanged?(params: Record<string, string>): void;
  /** the page as it is now, unsaved changes and all (Add to a release takes them) */
  snapshot?(): { version: string; base: Record<string, unknown>; data: Record<string, unknown> };
}

export type MountPageEditor = (host: HTMLElement, ctx: PageCtx) => PageEditor;

// ---------- toasts ----------
export type ToastKind = 'ok' | 'info' | 'error';
let toasts: HTMLElement | null = null;

export interface ToastOpts {
  /** one action on the toast (Undo); the toast then stays longer */
  action?: { label: string; run: () => void };
}

/**
 * A short note at the bottom of the window, read out by screen readers: gone after 4 s (8 s with an action); an
 * error stays until closed. At most two at a time.
 */
export function toast(text: string, kind: ToastKind = 'info', opts: ToastOpts = {}): void {
  if (!toasts) {
    toasts = document.createElement('div');
    toasts.className = 'ms-toasts';
    toasts.setAttribute('role', 'status');
    toasts.setAttribute('aria-live', 'polite');
    document.body.append(toasts);
  }
  const t = document.createElement('div');
  t.className = `ms-toast ms-toast--${kind}`;
  const words = document.createElement('span');
  words.textContent = text;
  t.append(words);
  const close = () => t.remove();
  if (opts.action) {
    const { label, run } = opts.action;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ms-toast__action';
    b.textContent = label;
    b.addEventListener('click', () => {
      close();
      run();
    });
    t.append(b);
  }
  if (kind === 'error') {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ms-toast__close';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    x.addEventListener('click', close);
    t.append(x);
  } else setTimeout(close, opts.action ? 8000 : 4000);
  toasts.append(t);
  while (toasts.childElementCount > 2) toasts.firstElementChild!.remove();
}

/** Removes every toast (another screen opened). */
export function clearToasts(): void {
  toasts?.replaceChildren();
}
