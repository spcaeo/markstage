// AI alt text in the pages editor (#/p): "Suggest alt text" on an image field puts suggest=alt&field=<its path> in the
// page's own params (a link opens it again; Back and Forward open and close it), and the suggestion shows under the
// field's alt text while they say so, next to the alt text there now (ai/card.ts). Accepting is a change like typing
// (the page's undo, ⌘Z, takes it back; ⌘S saves it); Dismiss or Escape closes it.
import { suggestButton, suggestCard, type Card } from '../ai/card';
import type { SuggestBody } from '../ai/api';
import { toast } from '../host';

export interface PagesAiDeps {
  params(): Record<string, string>;
  go(params: Record<string, string | null>, push?: boolean): void;
  /** the section panel's fields show what the params ask for now (a change made here is not reported back) */
  redraw(): void;
  entry: { collection: string; id: string };
  /** words when the page may not be changed by this person */
  /** why the field at `path` can't take the suggestion (read-only, the person's role), or null */
  readOnly(path: string): string | null;
}

/** a field's path in the page (sections.0.value.picture) */
const PATH = /^[A-Za-z0-9_][\w.-]{0,199}$/;

export function pagesAi(d: PagesAiDeps) {
  let open: { path: string; card: Card } | null = null;
  /** places with image fields besides the section panel (the Page settings drawer): they place their cards again */
  const others = new Set<() => void>();
  /** the field whose suggestion the URL asks for */
  const wanted = () => {
    const p = d.params();
    return p.suggest === 'alt' && PATH.test(p.field ?? '') ? p.field : null;
  };
  const follow = () => {
    if (open && wanted() !== open.path) drop();
    for (const fn of others) fn();
  };
  const go = (p: Record<string, string | null>) => {
    d.go(p, true);
    follow();
    d.redraw();
  };
  const close = () => go({ suggest: null, field: null });
  const drop = () => {
    open?.card.destroy();
    open = null;
  };

  return {
    /** "Suggest alt text" for the image field at `path` */
    button: (path: string) => suggestButton('Suggest alt text', () => go({ suggest: 'alt', field: path }), 'ms-btn--sm'),

    /** The card for the image field at `path` while the URL asks for it (made once), else null. */
    card(path: string, src: () => string, alt: { get(): string; set(v: string): void }): HTMLElement | null {
      if (wanted() !== path) {
        if (open?.path === path) drop();
        return null;
      }
      if (open?.path !== path) {
        drop();
        const card = suggestCard({
          title: 'Suggested alt text',
          fields: [{ name: 'alt', label: 'Alt text', now: () => alt.get(), multiline: true }],
          body: (): SuggestBody => ({ kind: 'alt', image: src(), collection: d.entry.collection, id: d.entry.id }),
          accept: (v) => {
            const no = d.readOnly(path);
            if (no) return no;
            const old = alt.get();
            alt.set(v.alt.trim());
            toast('Alt text set from the suggestion. ⌘S saves it.', 'ok', { action: { label: 'Undo', run: () => alt.set(old) } });
            return null;
          },
          close,
        });
        open = { path, card };
      } else open.card.sync();
      return open.card.el;
    },

    /** the params changed: a card the URL no longer asks for goes, and each place shows the one it asks for */
    follow,
    /** `fn` places the cards of fields drawn elsewhere (it runs on each follow); returns the way to stop */
    listen(fn: () => void): () => void {
      others.add(fn);
      return () => others.delete(fn);
    },
    destroy: drop,
  };
}

export type PagesAi = ReturnType<typeof pagesAi>;
