// Mounts the registered screens (host.ts) for #/<name>/<args>?<params>: one at a time, in place of the canvas (the
// open entry stays loaded underneath, so coming back finds it as it was). Params-only changes call update(); a new
// name or new args destroy and mount again. A screen's guard asks before it is left.
import { ic } from './icons';
import type { MountedScreen, ScreenCtx } from './host';
import { clearToasts, screen as screenDef, toast } from './host';
import * as router from './router';
import { ask } from './shell';

export class ScreenHost {
  private mounted: { key: string; def: string; m: MountedScreen | null } | null = null;
  private dirty: (() => boolean) | null = null;

  constructor(
    private app: HTMLElement,
    private el: HTMLElement,
    private siteName: string,
  ) {}

  get active(): boolean {
    return this.mounted !== null;
  }

  /** The open screen has a guard that says it holds unsaved changes. */
  isDirty(): boolean {
    return !!this.mounted && !!this.dirty?.();
  }

  /** True when the open screen may be left (no guard, or the writer chose to leave). */
  async canLeave(): Promise<boolean> {
    if (!this.isDirty()) return true;
    const choice = await ask('Unsaved changes', 'This screen has changes that are not saved. Leave it anyway?', [
      ['cancel', 'Stay'],
      ['leave', 'Leave without saving', 'ms-btn ms-btn--danger'],
    ]);
    return choice === 'leave';
  }

  /** Shows the route's screen (or none). */
  show(r: router.Route): void {
    const s = r.screen;
    const key = s ? [s.name, ...s.args].join('/') : '';
    if (this.mounted && this.mounted.key === key) {
      this.mounted.m?.update?.(this.ctx(r));
      return;
    }
    this.close();
    // another place: the notes about the last one go
    clearToasts();
    if (!s) return;
    this.app.classList.add('is-screen');
    this.el.hidden = false;
    const def = screenDef(s.name);
    const host = document.createElement('div');
    host.className = 'ms-screen__body';
    this.el.replaceChildren(host);
    if (!def) {
      host.innerHTML = `<div class="ms-blank__box">${ic('alert', 28)}<h2>Not available</h2><p>This screen does not exist, or is not available to you.</p></div>`;
      this.mounted = { key, def: '', m: null };
      this.setTitle('Not available');
      return;
    }
    // a public screen (sign-in, setup) shows alone: no rail, no head
    this.app.classList.toggle('is-public', !!def.public);
    this.setTitle(def.label);
    this.mounted = { key, def: def.name, m: null };
    this.mounted.m = def.mount(host, this.ctx(r)) ?? null;
  }

  close(): void {
    if (!this.mounted) return;
    this.mounted.m?.destroy();
    this.mounted = null;
    this.dirty = null;
    this.el.replaceChildren();
    this.el.hidden = true;
    this.app.classList.remove('is-screen', 'is-public');
  }

  private setTitle(text: string): void {
    const title = this.app.querySelector<HTMLElement>('.ms-head__title')!;
    title.textContent = text;
    // the open entry's tooltip (its whole title) is not this screen's
    title.removeAttribute('title');
    document.title = `${text} · ${this.siteName} · Markstage`;
  }

  private ctx(r: router.Route): ScreenCtx {
    const s = r.screen!;
    return {
      args: [...s.args],
      params: () => new URLSearchParams(router.route().screenParams),
      go: (change, push = false) => {
        const params = { ...router.route().screenParams };
        for (const [k, v] of Object.entries(change.params ?? {})) {
          if (v === null) delete params[k];
          else params[k] = v;
        }
        router.go({ screen: { name: s.name, args: change.args ?? router.route().screen?.args ?? [] }, screenParams: params }, push);
        this.show(router.route());
      },
      open: (hash, push = true) => {
        if (push) location.hash = hash;
        else {
          history.replaceState(null, '', hash);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }
      },
      toast,
      ask,
      setTitle: (text) => this.setTitle(text),
      guard: (fn) => (this.dirty = fn),
    };
  }
}
