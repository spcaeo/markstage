// Images on the canvas: the classes on an image's <figure> (its width from editor.images, the decorative mark,
// classes the editor does not know, kept), uploads placed into the document, and dropping or pasting image files.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { toast } from './host';
import { finalSrc, imageFiles, isTemp, startUpload } from './media';
import { imagesConfig } from './runtime';

export interface FigureParts {
  /** a width id from editor.images.widths */
  width: string;
  decorative: boolean;
  /** classes the editor does not set, kept as they are */
  other: string[];
}

export function figureParts(figure: string | null | undefined): FigureParts {
  const cfg = imagesConfig();
  const tokens = (figure ?? '').split(/\s+/).filter(Boolean);
  const w = cfg.widths.find((x) => x.class && tokens.includes(x.class));
  return {
    width: (w ?? cfg.widths[0]).id,
    decorative: tokens.includes(cfg.decorativeClass),
    other: tokens.filter((t) => t !== cfg.decorativeClass && !cfg.widths.some((x) => x.class === t)),
  };
}

/** The figure attribute for these parts: null (a plain Markdown image) when nothing needs a figure. */
export function figureAttr(p: FigureParts, caption: string | null): string | null {
  const cfg = imagesConfig();
  const cls = cfg.widths.find((x) => x.id === p.width)?.class;
  const tokens = [...p.other, ...(cls ? [cls] : []), ...(p.decorative ? [cfg.decorativeClass] : [])];
  return tokens.length || caption ? tokens.join(' ') : null;
}

/** Sets `src` on every image showing `temp` (an upload that finished), outside the undo history. */
function settle(view: EditorView, temp: string, src: string | null): void {
  const tr = view.state.tr;
  view.state.doc.descendants((n: PMNode, pos: number) => {
    if (n.type.name !== 'image' || n.attrs.src !== temp) return;
    if (src === null) tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + n.nodeSize));
    else tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...n.attrs, src });
  });
  if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
}

/** Uploads `file` for the image(s) showing its temporary URL; a failure removes them and says why. */
export function upload(view: EditorView, file: File): string {
  const { temp, done } = startUpload(file);
  done.then(
    (src) => settle(view, temp, src),
    (err: Error) => {
      settle(view, temp, null);
      toast(`Could not upload: ${err.message}`, 'error');
    },
  );
  return temp;
}

/** Replaces the temporary URLs of finished uploads still in the document (undo or redo can bring them back). */
export function resolveTemps(view: EditorView): void {
  view.state.doc.descendants((n: PMNode) => {
    if (n.type.name === 'image' && isTemp(n.attrs.src) && finalSrc(n.attrs.src) !== n.attrs.src) settle(view, n.attrs.src, finalSrc(n.attrs.src));
  });
}

/** Inserts an image per file in place of from..to (a block position), each uploading. */
function insertFiles(view: EditorView, files: File[], from: number, to = from): void {
  const type = view.state.schema.nodes.image;
  const nodes = files.map((f) => type.create({ src: upload(view, f), alt: '' }));
  view.dispatch(view.state.tr.replaceWith(from, to, nodes).scrollIntoView());
  view.focus();
}

/** Where a dropped or pasted image goes: in place of an empty paragraph, else after the top-level block. */
function place(view: EditorView, files: File[], pos: number): void {
  const $p = view.state.doc.resolve(pos);
  if ($p.depth === 0) return insertFiles(view, files, pos);
  const block = $p.node(1);
  if (block.type.name === 'paragraph' && block.content.size === 0) return insertFiles(view, files, $p.before(1), $p.after(1));
  insertFiles(view, files, $p.after(1));
}

/** Dropping image files on the canvas, or pasting one (a screenshot), uploads it as an image block. */
export const ImageFiles = Extension.create({
  name: 'imageFiles',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: new PluginKey('imageFiles'),
      props: {
        handlePaste(view, event) {
          const files = imageFiles(event.clipboardData);
          if (!files.length) return false;
          // text copied from a page often carries a picture of itself as well: text wins
          if (event.clipboardData?.getData('text/plain')) return false;
          place(view, files, view.state.selection.from);
          return true;
        },
        handleDrop(view, event, _slice, moved) {
          if (moved) return false;
          const files = imageFiles(event.dataTransfer);
          if (!files.length) return false;
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          event.preventDefault();
          place(view, files, at?.pos ?? view.state.selection.from);
          return true;
        },
      },
    }),
  ],
});
