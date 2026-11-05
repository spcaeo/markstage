// The editor's nodes and marks: TipTap's standard blocks, the converter's fallbacks (rawHtml, rawInline), images,
// GFM tables, plus every block pack's own nodes. Attributes the converter needs back as found are kept (heading
// ids, table alignment, list spacing, link printing hints).
import { Extension, Node, mergeAttributes, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { editorPacks } from './runtime';
import { RawHtmlView, RawInlineView } from './views/core';
import { ImageView } from './views/image';
import { ImageFiles } from './images';
import { TableView } from './views/table';
import { MDX_NODES } from './mdx/nodes';

/** An atom (edited in the panel, selected as one thing) drawn by `View`. */
export const atomNode = (name: string, attrs: Record<string, { default: unknown }>, View: any, inline = false) =>
  Node.create({
    name,
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    selectable: true,
    draggable: !inline,
    addAttributes: () => attrs,
    parseHTML: () => [{ tag: `[data-ms-atom="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) => [inline ? 'span' : 'div', mergeAttributes(HTMLAttributes, { 'data-ms-atom': name })],
    addNodeView: () => (p) => new View(p.node, p.view, p.getPos),
  });

const RawHtml = atomNode('rawHtml', { html: { default: '' } }, RawHtmlView);
const RawInline = atomNode('rawInline', { html: { default: '' } }, RawInlineView, true);
// figure: the classes of its <figure> ('' a plain one, null none); caption: plain text (core figure.mjs)
const Image = atomNode('image', { src: { default: '' }, alt: { default: '' }, title: { default: null }, figure: { default: null }, caption: { default: null } }, ImageView);

const KeptAttrs = Extension.create({
  name: 'keptAttrs',
  addGlobalAttributes: () => [
    { types: ['heading'], attributes: { id: { default: null, rendered: false } } },
    { types: ['table'], attributes: { align: { default: null, rendered: false } } },
    { types: ['bulletList', 'orderedList'], attributes: { tight: { default: true, rendered: false } } },
    { types: ['link'], attributes: { outer: { default: null, rendered: false }, order: { default: null, rendered: false } } },
  ],
});

// a Markdown table cell is one line: Enter there makes a line break (printed as <br>), not a second paragraph
const CellBreak = Extension.create({
  name: 'cellBreak',
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d).type.name;
          if (name === 'tableCell' || name === 'tableHeader') return editor.commands.setHardBreak();
        }
        return false;
      },
    };
  },
});

export function extensions(): AnyExtension[] {
  const packs = editorPacks();
  const tableView = packs.find((p) => p.tableView)?.tableView ?? TableView;
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      underline: false,
      dropcursor: { color: 'var(--ms-accent, #6161ff)', width: 2 },
      link: false,
    }),
    // below bold and italic, so **[text](url)** draws as <strong><a> the way Markdown renders it
    Link.extend({ priority: 50 }).configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: true,
      isAllowedUri: () => true,
      HTMLAttributes: { target: null, rel: null, class: null },
    }),
    KeptAttrs,
    Table.configure({ resizable: false, View: tableView as any }),
    TableRow,
    TableHeader.extend({ content: 'paragraph' }),
    TableCell.extend({ content: 'paragraph' }),
    CellBreak,
    RawHtml,
    RawInline,
    Image,
    ImageFiles,
    // the code parts of an MDX file (mdx/nodes.ts): only ever in an MDX entry's document
    ...MDX_NODES,
    ...packs.flatMap((p) => [...(p.nodes ?? []), ...(p.extensions ?? [])]),
    Placeholder.configure({
      showOnlyCurrent: true,
      includeChildren: true,
      placeholder: ({ node, editor }) => {
        for (const p of packs) {
          const text = p.placeholder?.(node);
          if (text != null) return text;
        }
        if (node.type.name === 'heading') return `Heading ${node.attrs.level}`;
        if (node.type.name !== 'paragraph') return '';
        const { $from } = editor.state.selection;
        return $from.depth <= 1 ? 'Write, or type / for a block' : 'Write…';
      },
    }),
  ];
}
