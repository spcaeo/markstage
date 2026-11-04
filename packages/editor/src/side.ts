// The right column's own panels: the Outline (?side=outline) and the SEO check (?side=seo), each with its header
// button, and the "How do I…" guide (?side=help). One at a time, and never with Post settings (which take the same
// column): opening one closes the rest. The URL says which is open; the header shows the buttons only where the panels apply (an article on the
// canvas, not Source mode or a screen check).
import * as router from './router';
import type { Side } from './router';

export interface SidePanel {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  /** shows or hides it without telling the URL */
  show(on: boolean): void;
  close(): void;
}

export class SidePanels {
  private panels = new Map<Side, { panel: SidePanel; button?: HTMLElement }>();

  /** `before`: what else in the column closes when one opens (Post settings); `changed`: the header follows. */
  constructor(
    private before: () => void,
    private changed: () => void,
  ) {}

  /** `button`: the header's toggle (none for the guide, opened from More and ?). */
  add(name: Side, panel: SidePanel, button?: HTMLElement): void {
    this.panels.set(name, { panel, button });
  }

  /** A panel opened or closed itself (its button, its close button, Esc). */
  toggled(name: Side, open: boolean): void {
    if (open) {
      this.before();
      for (const [n, p] of this.panels) if (n !== name && p.panel.isOpen) p.panel.show(false);
      router.go({ side: name, nofollow: false, topic: null, hq: '' });
    } else if (router.route().side === name) router.go({ side: null, nofollow: false, topic: null, hq: '' });
    this.changed();
  }

  get isOpen(): boolean {
    return [...this.panels.values()].some((p) => p.panel.isOpen);
  }

  get els(): HTMLElement[] {
    return [...this.panels.values()].map((p) => p.panel.el);
  }

  /** Closes the open one (Post settings opened). */
  close(): void {
    for (const p of this.panels.values()) p.panel.close();
  }

  /** The header and the URL: which buttons show (`can(name)`) and which panel is open. */
  sync(can: (name: Side) => boolean): void {
    const want = router.route().side;
    for (const [n, p] of this.panels) {
      if (p.button) p.button.hidden = !can(n);
      const on = can(n) && want === n;
      if (on !== p.panel.isOpen) p.panel.show(on);
    }
  }
}
