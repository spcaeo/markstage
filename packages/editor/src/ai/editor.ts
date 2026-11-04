// AI suggestions in the text editor (#/e), each where its value is and each with its URL (router.ts `suggest`):
//   - alt text for the nth image on the canvas (suggest=alt&img=<n>): its card under the image's alt line, or under
//     the alt text in the image block's settings panel (&at=panel);
//   - alt text for an image setting in Post settings (s=1&suggest=alt&field=<key>): under the field's alt text;
//   - the search title and description in the SEO check (side=seo&suggest=seo): under the search result;
//   - a region's title and description (s=1&suggest=translate&loc=<code>): under that region's fields.
// A card is made once while the URL asks for it, so a redraw of what it sits in does not ask again. Accepting is a
// change like typing: the canvas's undo (⌘Z) takes back an image's alt text; a setting goes into the unsaved changes
// with a toast to undo it; ⌘S saves it all through the one save path (locks, validation).
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Entry } from '../api';
import { toast } from '../host';
import * as router from '../router';
import type { FrontmatterEdits } from '../settings/state';
import { mayChange } from '../field-access';
import { figureParts } from '../images';
import { suggestCard, type Card, type CardSpec, type SuggestField } from './card';
import type { SuggestBody } from './api';

export interface AiEditorDeps {
  getEditor(): Editor | null;
  entry(): Entry | null;
  /** the title as the writer sees it (unsaved too) */
  title(): string;
  edits: FrontmatterEdits;
  /** what holds the image views (they raise `ms-ai-alt` from their "Suggest" button) */
  canvas: HTMLElement;
  /** draws Post settings and the SEO check again: their slots follow the URL */
  redraw(): void;
}

/** What a place hands over to have its card: the rest (title, close) is the same everywhere. */
export type SlotSpec = Omit<CardSpec, 'close'>;

/** A suggestion's card, for the entry the URL names (another entry's card is another card) */
const keyOf = (s: router.Suggest) => {
  const r = router.route();
  return `${r.collection}/${r.id}|${'img' in s ? `alt:img:${s.img}${s.at ? `:${s.at}` : ''}` : 'field' in s ? `alt:field:${s.field}` : 'loc' in s ? `translate:${s.loc}` : s.kind}`;
};
const same = (a: router.Suggest | null, b: router.Suggest) => !!a && keyOf(a) === keyOf(b);

/** The nth image on the canvas (from 1), with its position. */
export function nthImage(doc: PMNode, n: number): { node: PMNode; pos: number } | null {
  let i = 0;
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'image' && ++i === n) found = { node, pos };
    return !found;
  });
  return found;
}

/** Which image (from 1) is at `pos`. */
export function imageNumber(doc: PMNode, at: number): number | null {
  let i = 0;
  let n: number | null = null;
  doc.descendants((node, pos) => {
    if (n !== null) return false;
    if (node.type.name === 'image') {
      i++;
      if (pos === at) n = i;
    }
    return n === null;
  });
  return n;
}

export function aiEditor(d: AiEditorDeps) {
  const cards = new Map<string, Card>();
  /** the suggestion the URL asked for when last followed */
  let shown = '';
  const close = () => router.go({ suggest: null }, true);
  /** why a suggestion for `keys` (frontmatter keys, or "body" for the text) can't be used, or null */
  const readOnly = (keys: string[]) => {
    const e = d.entry();
    if (e?.can && !e.can.edit) return 'You can read this entry but not change it, so the suggestion can’t be used here.';
    const locked = keys.filter((k) => (k === 'body' ? !mayChange(e?.can, k) : !d.edits.may(k))).map((k) => (k === 'body' ? 'the text' : k));
    return locked.length ? `Your role can’t change ${locked.join(' or ')}, so the suggestion can’t be used here.` : null;
  };
  /** the entry the URL names is the one drawn (not still loading) */
  const loaded = () => {
    const e = d.entry();
    const r = router.route();
    return !!e && e.collection === r.collection && e.id === r.id;
  };
  const where = () => {
    const e = d.entry();
    return e ? { collection: e.collection, id: e.id } : null;
  };

  /** The card for `s` while the URL asks for it (made once), else null; any other card goes. */
  function slot(s: router.Suggest, spec: () => SlotSpec): HTMLElement | null {
    const key = keyOf(s);
    if (!same(router.route().suggest, s) || !loaded()) {
      cards.get(key)?.destroy();
      cards.delete(key);
      return null;
    }
    let c = cards.get(key);
    if (!c) cards.set(key, (c = suggestCard({ ...spec(), close })));
    else c.sync();
    return c.el;
  }

  /** Settings accepted: one unsaved change per key, with a toast to take them back. */
  function acceptEdits(pairs: [string, string][], words: string): string | null {
    const no = readOnly(pairs.map(([k]) => k));
    if (no) return no;
    const old = pairs.map(([k]): [string, unknown] => [k, d.edits.get(k) ?? null]);
    // one step of the settings' history: ⌘Z there takes it back
    d.edits.group(() => pairs.forEach(([k, v]) => d.edits.set(k, v.trim() || null)));
    toast(`${words} ⌘S saves it.`, 'ok', { action: { label: 'Undo', run: () => d.edits.group(() => old.forEach(([k, v]) => d.edits.set(k, v))) } });
    return null;
  }

  // ---------- an image on the canvas ----------
  d.canvas.addEventListener('ms-ai-alt', (e) => {
    const pos = (e as CustomEvent<{ pos: number | undefined }>).detail.pos;
    const ed = d.getEditor();
    const n = ed && pos !== undefined ? imageNumber(ed.state.doc, pos) : null;
    if (n) router.go({ suggest: { kind: 'alt', img: n } }, true);
  });

  function canvasCard(): void {
    const s = router.route().suggest;
    const ed = d.getEditor();
    for (const [key, c] of cards) if (key.includes('|alt:img:') && !(s && key === keyOf(s))) (c.destroy(), cards.delete(key));
    // the entry the URL names is not drawn yet (it is loading): its load follows again
    if (!s || !('img' in s) || s.at || !ed || !loaded()) return;
    const at = nthImage(ed.state.doc, s.img);
    if (!at) {
      router.go({ suggest: null });
      return void toast(`There is no image ${s.img} on the canvas any more.`, 'error');
    }
    const n = s.img;
    const el = slot(s, () => ({
      title: 'Suggested alt text',
      fields: [{ name: 'alt', label: 'Alt text', now: () => String(nthImage(d.getEditor()!.state.doc, n)?.node.attrs.alt ?? ''), multiline: true }],
      body: (): SuggestBody => ({ kind: 'alt', image: String(nthImage(d.getEditor()!.state.doc, n)?.node.attrs.src ?? ''), ...where() }),
      accept: (v) => {
        const no = readOnly(['body']);
        if (no) return no;
        const editor = d.getEditor();
        const img = editor && nthImage(editor.state.doc, n);
        if (!editor || !img) return 'The image is not on the canvas any more.';
        if (figureParts(img.node.attrs.figure).decorative) return 'This image is marked decorative, so it needs no alt text. Untick “Decorative” first to give it some.';
        const old = String(img.node.attrs.alt ?? '');
        // the alt line keeps what is typed in it while it has the focus: it shows the new text once it lets go
        const line = editor.view.nodeDOM(img.pos) as HTMLElement | null;
        if (line?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
        const set = (alt: string) => {
          const now = nthImage(editor.state.doc, n);
          if (now) editor.view.dispatch(editor.state.tr.setNodeMarkup(now.pos, undefined, { ...now.node.attrs, alt }));
        };
        set(v.alt.trim());
        toast('Alt text set from the suggestion. ⌘S saves it.', 'ok', { action: { label: 'Undo', run: () => set(old) } });
        return null;
      },
      // back in the text, where ⌘Z takes it back
      refocus: () => d.getEditor()?.view.focus(),
    }));
    const dom = el && (ed.view.nodeDOM(at.pos) as HTMLElement | null);
    if (el && dom && el.parentElement !== dom) dom.append(el);
  }

  return {
    /** the URL changed (or the canvas was drawn again): each card follows */
    follow(): void {
      const s = router.route().suggest;
      const now = s ? keyOf(s) : '';
      canvasCard();
      if (now === shown) return;
      shown = now;
      for (const [key, c] of cards) if (key !== now) (c.destroy(), cards.delete(key));
      d.redraw();
    },
    /** the canvas changed: the image's card stays under it, and says the alt text as it is now */
    update(): void {
      const s = router.route().suggest;
      if (s && 'img' in s) canvasCard();
    },

    /** for an image setting's picker (settings/fields.ts) */
    alt(key: string, image: () => string, label: string) {
      const s: router.Suggest = { kind: 'alt', field: key };
      return {
        ask: () => router.go({ suggest: s }, true),
        card: (alt: { get(): string; set(v: string): void }) =>
          slot(s, () => ({
            title: 'Suggested alt text',
            fields: [{ name: 'alt', label: 'Alt text', now: () => alt.get(), multiline: true }],
            body: (): SuggestBody => ({ kind: 'alt', image: image(), ...where() }),
            accept: (v) => {
              const no = readOnly([key]);
              if (no) return no;
              const old = alt.get();
              alt.set(v.alt.trim());
              toast(`Alt text of ${label.toLowerCase()} set from the suggestion. ⌘S saves it.`, 'ok', { action: { label: 'Undo', run: () => alt.set(old) } });
              return null;
            },
          })),
      };
    },

    /** for the image block's settings panel (builtins.ts, through PanelCtx): the image at `pos` */
    panelAlt(pos: number) {
      const at = (): router.Suggest | null => {
        const ed = d.getEditor();
        const n = ed && imageNumber(ed.state.doc, pos);
        return n ? { kind: 'alt', img: n, at: 'panel' } : null;
      };
      return {
        ask: () => {
          const s = at();
          if (s) router.go({ suggest: s }, true);
        },
        card: (alt: { get(): string; set(v: string): void }) => {
          const s = at();
          return s
            ? slot(s, () => ({
                title: 'Suggested alt text',
                fields: [{ name: 'alt', label: 'Alt text', now: () => alt.get(), multiline: true }],
                body: (): SuggestBody => ({ kind: 'alt', image: String(d.getEditor()?.state.doc.nodeAt(pos)?.attrs.src ?? ''), ...where() }),
                accept: (v) => {
                  const no = readOnly(['body']);
                  if (no) return no;
                  const old = alt.get();
                  alt.set(v.alt.trim());
                  toast('Alt text set from the suggestion. ⌘S saves it.', 'ok', { action: { label: 'Undo', run: () => alt.set(old) } });
                  return null;
                },
                // a change on the canvas: back in the text, ⌘Z takes it back (the image stays selected, its panel open)
                refocus: () => d.getEditor()?.view.focus(),
              }))
            : null;
        },
      };
    },

    /** the SEO check's search title and description (the keys the suggestion is written to) */
    seo(keys: { title?: string; description?: string }): HTMLElement[] {
      const s: router.Suggest = { kind: 'seo' };
      const fields: SuggestField[] = [];
      if (keys.title) fields.push({ name: 'title', label: 'Search title', now: () => String(d.edits.get(keys.title!) ?? ''), empty: 'Empty: the title is used' });
      if (keys.description) fields.push({ name: 'description', label: 'Search description', now: () => String(d.edits.get(keys.description!) ?? ''), multiline: true });
      if (!fields.length) return [];
      const card = slot(s, () => ({
        title: 'Suggested title and description',
        fields,
        // the title and the text as they are now: unsaved changes count
        body: (): SuggestBody => ({ kind: 'seo', ...where()!, title: d.title().slice(0, 1000), text: (d.getEditor()?.getText({ blockSeparator: '\n\n' }) ?? '').slice(0, 20_000) }),
        accept: (v) =>
          acceptEdits(
            fields.filter((f) => typeof v[f.name] === 'string').map((f) => [f.name === 'title' ? keys.title! : keys.description!, v[f.name]]),
            'Search title and description set from the suggestion.',
          ),
      }));
      return card ? [card] : [];
    },
    seoAsk: () => router.go({ suggest: { kind: 'seo' } }, true),

    /** a region's own title and description (settings/locales.ts): `fields` maps title/description to their keys */
    translate(locale: { code: string; label: string }, fields: { name: string; key: string; label: string; from(): string }[]) {
      const s: router.Suggest = { kind: 'translate', loc: locale.code };
      return {
        ask: () => router.go({ suggest: s }, true),
        card: () =>
          slot(s, () => ({
            title: `Draft translation for ${locale.label}`,
            fields: fields.map((f) => ({ name: f.name, label: f.label, now: () => String(d.edits.get(f.key) ?? ''), multiline: f.name === 'description', empty: 'Empty: the same as everywhere' })),
            body: (): SuggestBody => ({ kind: 'translate', ...where()!, locale: locale.code, fields: Object.fromEntries(fields.map((f) => [f.name, f.from()])) }),
            accept: (v) =>
              acceptEdits(
                fields.filter((f) => typeof v[f.name] === 'string').map((f) => [f.key, v[f.name]]),
                `The ${locale.label} ${fields.length > 1 ? 'title and description are' : `${fields[0].label.toLowerCase()} is`} set from the draft.`,
              ),
          })),
      };
    },
  };
}

export type AiEditor = ReturnType<typeof aiEditor>;
