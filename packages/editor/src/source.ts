// Source mode (?view=source): the entry's file as written (frontmatter and Markdown) in a code editor. It saves
// through the source route with the same version check as the canvas (409 when the file changed meanwhile). It is
// read-only when the person may not change the whole file (read-only, or a role that changes some fields only).
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '600', color: 'var(--ms-ink)' },
  { tag: [t.strong], fontWeight: '600' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--ms-accent-text)' },
  { tag: [t.monospace], color: 'var(--ms-warn-ink)' },
  { tag: [t.meta, t.processingInstruction, t.comment], color: 'var(--ms-muted)' },
  { tag: [t.angleBracket, t.tagName, t.attributeName], color: 'var(--ms-ok-ink)' },
  { tag: [t.attributeValue, t.string], color: 'var(--ms-accent-deep)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', background: 'var(--ms-paper)' },
  '.cm-scroller': { fontFamily: 'var(--ms-mono)', lineHeight: '1.65' },
  '.cm-content': { padding: '20px 0 120px' },
  '.cm-gutters': { background: 'var(--ms-paper)', border: '0', color: 'var(--ms-placeholder)' },
  '.cm-activeLine, .cm-activeLineGutter': { background: 'color-mix(in srgb, var(--ms-accent-tint) 55%, transparent)' },
  '&.cm-focused': { outline: '0' },
  '.cm-line': { paddingRight: '24px' },
});

export class SourceEditor {
  private view: EditorView | null = null;
  /** the text as last loaded or saved */
  private saved = '';

  constructor(
    readonly el: HTMLElement,
    private onChange: () => void,
    private onSave: () => void,
    /** true: the text can be read, searched and copied, not changed */
    private locked: () => boolean = () => false,
  ) {}

  /** Shows `text`; `saved` is the file as it is on disk (the text differs when the canvas had unsaved changes). */
  load(text: string, saved = text): void {
    this.saved = saved;
    this.view?.destroy();
    const locked = this.locked();
    this.view = new EditorView({
      parent: this.el,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          markdown(),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          theme,
          keymap.of([{ key: 'Mod-s', run: () => (this.onSave(), true), preventDefault: true }, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) this.onChange();
          }),
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown source', spellcheck: 'false', ...(locked ? { 'aria-readonly': 'true' } : {}) }),
          EditorState.readOnly.of(locked),
        ],
      }),
    });
  }

  get active(): boolean {
    return !!this.view;
  }

  text(): string {
    return this.view?.state.doc.toString() ?? '';
  }

  /** The selected text, or '' when nothing is selected. */
  selection(): string {
    if (!this.view) return '';
    const { from, to } = this.view.state.selection.main;
    return this.view.state.sliceDoc(from, to);
  }

  isDirty(): boolean {
    return !!this.view && this.text() !== this.saved;
  }

  markSaved(text = this.text()): void {
    this.saved = text;
  }

  focus(): void {
    this.view?.focus();
  }

  undo(): void {
    if (this.view) undo(this.view);
  }

  redo(): void {
    if (this.view) redo(this.view);
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
    this.el.replaceChildren();
  }
}
