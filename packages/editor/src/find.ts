// Find and replace in the open article (⌘F; ⌥⌘F opens it with Replace): a bar under the header, every match marked
// on the canvas and the current one stronger, Enter / Shift+Enter (or the arrows) step through them, "3 of 12".
// Match case and Whole word narrow it. Replace changes the current match, Replace all every one, each as one
// transaction (one ⌘Z takes it back); a replaced word keeps the formatting it had. The URL holds it all
// (find=<words>&with=<words>&rep=1&fc=1&fw=1). Source mode has the code editor's own search.
import './styles/find.css';
import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { toast } from './host';
import { ic } from './icons';

export interface FindState {
  q: string;
  with: string;
  /** the Replace row is open */
  replace: boolean;
  matchCase: boolean;
  word: boolean;
}

interface Match {
  from: number;
  to: number;
}

interface PluginState {
  query: FindState | null;
  matches: Match[];
  current: number;
  decos: DecorationSet;
}

const key = new PluginKey<PluginState>('msFind');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every match of the query in the document's text (inside one paragraph, heading, cell or box line each). */
export function findAll(doc: PMNode, q: FindState): Match[] {
  if (!q.q) return [];
  const body = esc(q.q);
  const re = new RegExp(q.word ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, `gu${q.matchCase ? '' : 'i'}`);
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // one character per inline leaf (a line break, an inline box), so an offset is a position
    const text = node.textBetween(0, node.content.size, undefined, '￼');
    for (const m of text.matchAll(re)) if (m[0]) out.push({ from: pos + 1 + m.index!, to: pos + 1 + m.index! + m[0].length });
    return false;
  });
  return out;
}

function decorate(doc: PMNode, matches: Match[], current: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'ms-found is-current' : 'ms-found' })),
  );
}

/** The match at or after the selection. */
const nearest = (matches: Match[], at: number) => Math.max(0, matches.findIndex((m) => m.to > at));

export class FindBar {
  readonly el: HTMLElement;
  private q: HTMLInputElement;
  private with: HTMLInputElement;
  private count: HTMLElement;
  private caseBox: HTMLInputElement;
  private wordBox: HTMLInputElement;
  private repRow: HTMLElement;

  constructor(
    host: HTMLElement,
    private getEditor: () => Editor | null,
    /** the bar changed: the URL follows (null: closed) */
    private onState: (s: FindState | null) => void,
  ) {
    this.el = host;
    host.className = 'ms-find';
    host.hidden = true;
    host.setAttribute('role', 'search');
    host.innerHTML = `<div class="ms-find__row"><button type="button" class="ms-iconbtn ms-find__toggle" data-rep aria-label="Replace (⌥⌘F)" title="Replace (⌥⌘F)" aria-expanded="false">${ic('down', 14)}</button><input type="text" class="ms-find__q" placeholder="Find in this article" aria-label="Find" spellcheck="false" autocomplete="off" /><span class="ms-find__count" aria-live="polite"></span><button type="button" class="ms-iconbtn" data-prev aria-label="Previous match (Shift+Enter)" title="Previous match (Shift+Enter)">${ic('up', 15)}</button><button type="button" class="ms-iconbtn" data-next aria-label="Next match (Enter)" title="Next match (Enter)">${ic('down', 15)}</button><label class="ms-find__opt" title="Match case"><input type="checkbox" data-case />Aa</label><label class="ms-find__opt" title="Whole word"><input type="checkbox" data-word />Whole word</label><button type="button" class="ms-iconbtn" data-close aria-label="Close (Esc)" title="Close (Esc)">${ic('x', 15)}</button></div><div class="ms-find__row ms-find__rep" hidden><input type="text" class="ms-find__with" placeholder="Replace with" aria-label="Replace with" spellcheck="false" autocomplete="off" /><button type="button" class="ms-btn ms-btn--sm" data-one>Replace</button><button type="button" class="ms-btn ms-btn--sm" data-all>Replace all</button></div>`;
    this.q = host.querySelector('.ms-find__q')!;
    this.with = host.querySelector('.ms-find__with')!;
    this.count = host.querySelector('.ms-find__count')!;
    this.caseBox = host.querySelector('[data-case]')!;
    this.wordBox = host.querySelector('[data-word]')!;
    this.repRow = host.querySelector('.ms-find__rep')!;
    const changed = () => {
      this.apply();
      this.onState(this.state());
    };
    this.q.addEventListener('input', changed);
    this.with.addEventListener('input', () => this.onState(this.state()));
    this.caseBox.addEventListener('change', changed);
    this.wordBox.addEventListener('change', changed);
    host.querySelector('[data-rep]')!.addEventListener('click', () => this.showReplace(!!this.repRow.hidden));
    host.querySelector('[data-prev]')!.addEventListener('click', () => this.step(-1));
    host.querySelector('[data-next]')!.addEventListener('click', () => this.step(1));
    host.querySelector('[data-close]')!.addEventListener('click', () => this.close());
    host.querySelector('[data-one]')!.addEventListener('click', () => this.replaceOne());
    host.querySelector('[data-all]')!.addEventListener('click', () => this.replaceAll());
    host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'Enter' && e.target === this.q) {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Enter' && e.target === this.with) {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) this.replaceAll();
        else this.replaceOne();
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** ⌘F (`replace`: ⌥⌘F): open with the selected words, or the last ones. */
  open(replace = false): void {
    const editor = this.getEditor();
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    const picked = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
    if (picked && !picked.includes('\n') && picked.length < 200) this.q.value = picked;
    this.el.hidden = false;
    if (replace) this.showReplace(true, false);
    this.apply();
    this.onState(this.state());
    this.q.focus();
    this.q.select();
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.dispatch(null);
    this.onState(null);
    this.getEditor()?.view.focus();
  }

  /** The URL's find state (another entry opened, back / forward): the bar follows without telling the URL. */
  sync(s: FindState | null): void {
    if (!s) {
      if (this.isOpen) {
        this.el.hidden = true;
        this.dispatch(null);
      }
      return;
    }
    // the bar already shows it (the URL follows the bar as it is used)
    if (this.isOpen && JSON.stringify(this.state()) === JSON.stringify(s) && this.plugin()?.query) return;
    this.el.hidden = false;
    if (this.q.value !== s.q) this.q.value = s.q;
    if (this.with.value !== s.with) this.with.value = s.with;
    this.caseBox.checked = s.matchCase;
    this.wordBox.checked = s.word;
    this.showReplace(s.replace, false);
    this.apply();
  }

  extension() {
    return Extension.create({
      name: 'findReplace',
      addProseMirrorPlugins: () => [
        new Plugin<PluginState>({
          key,
          state: {
            init: () => ({ query: null, matches: [], current: -1, decos: DecorationSet.empty }),
            apply: (tr, prev, _old, state) => {
              const meta = tr.getMeta(key) as { query: FindState | null; current?: number } | undefined;
              const query = meta ? meta.query : prev.query;
              if (!meta && !tr.docChanged) return prev;
              const matches = query ? findAll(state.doc, query) : [];
              const current = !matches.length ? -1 : meta?.current !== undefined ? Math.min(meta.current, matches.length - 1) : Math.min(Math.max(prev.current, 0), matches.length - 1);
              return { query, matches, current, decos: decorate(state.doc, matches, current) };
            },
          },
          props: { decorations: (state) => key.getState(state)?.decos },
          view: () => ({ update: () => this.showCount() }),
        }),
      ],
    });
  }

  private state(): FindState {
    return { q: this.q.value, with: this.with.value, replace: !this.repRow.hidden, matchCase: this.caseBox.checked, word: this.wordBox.checked };
  }

  private showReplace(on: boolean, tell = true): void {
    this.repRow.hidden = !on;
    const t = this.el.querySelector('[data-rep]')!;
    t.setAttribute('aria-expanded', String(on));
    t.classList.toggle('is-open', on);
    if (tell) {
      this.onState(this.state());
      if (on) this.with.focus();
    }
  }

  private plugin(state?: EditorState): PluginState | undefined {
    const s = state ?? this.getEditor()?.state;
    return s ? key.getState(s) : undefined;
  }

  private dispatch(query: FindState | null, current?: number): void {
    const editor = this.getEditor();
    if (editor) editor.view.dispatch(editor.state.tr.setMeta(key, { query, current }).setMeta('addToHistory', false));
  }

  /** The query as typed: the matches from where the caret is. */
  private apply(): void {
    const editor = this.getEditor();
    if (!editor) return;
    const s = this.state();
    this.dispatch(s, nearest(findAll(editor.state.doc, s), editor.state.selection.from));
  }

  private showCount(): void {
    const p = this.plugin();
    const n = p?.matches.length ?? 0;
    this.count.textContent = !this.q.value ? '' : n ? `${p!.current + 1} of ${n}` : 'No results';
    this.count.classList.toggle('is-none', !!this.q.value && !n);
  }

  /** The next (or previous) match: selected on the canvas and scrolled to, the focus staying in the bar. */
  private step(dir: 1 | -1): void {
    const editor = this.getEditor();
    const p = this.plugin();
    if (!editor || !p?.matches.length) return;
    const i = (p.current + dir + p.matches.length) % p.matches.length;
    this.show(i);
  }

  private show(i: number): void {
    const editor = this.getEditor()!;
    const m = this.plugin()!.matches[i]!;
    const tr = editor.state.tr.setMeta(key, { query: this.state(), current: i }).setSelection(TextSelection.create(editor.state.doc, m.from, m.to));
    editor.view.dispatch(tr);
    // the match in the middle of the canvas
    const scroller = editor.view.dom.closest<HTMLElement>('.ms-scroll');
    if (scroller) {
      const at = editor.view.coordsAtPos(m.from);
      const box = scroller.getBoundingClientRect();
      scroller.scrollBy({ top: at.top - (box.top + box.height / 2) });
    }
  }

  /** Replaces the current match (the formatting of its first letter is kept), then shows the next. */
  private replaceOne(): void {
    const editor = this.getEditor();
    const p = this.plugin();
    if (!editor || !p?.matches.length || p.current < 0) return;
    const m = p.matches[p.current]!;
    const tr = editor.state.tr;
    if (this.with.value) tr.insertText(this.with.value, m.from, m.to);
    else tr.delete(m.from, m.to);
    tr.setMeta(key, { query: this.state(), current: p.current });
    editor.view.dispatch(tr);
    const after = this.plugin();
    if (after?.matches.length) this.show(Math.min(p.current, after.matches.length - 1));
  }

  /** Every match at once, one transaction. */
  private replaceAll(): void {
    const editor = this.getEditor();
    const p = this.plugin();
    if (!editor || !p?.matches.length) return;
    const tr = editor.state.tr;
    for (const m of [...p.matches].reverse()) {
      if (this.with.value) tr.insertText(this.with.value, m.from, m.to);
      else tr.delete(m.from, m.to);
    }
    tr.setMeta(key, { query: this.state(), current: 0 });
    editor.view.dispatch(tr.scrollIntoView());
    toast(`Replaced ${p.matches.length} time${p.matches.length === 1 ? '' : 's'}. ⌘Z takes it back.`, 'ok');
  }
}
