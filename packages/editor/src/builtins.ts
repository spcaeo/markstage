// Built into the editor for every site: the labels and settings of the core blocks that are edited as one thing
// (table, image, HTML the converter kept as written, quote, code) and the "Text" section of the block menu. A
// block pack adds its own boxes the same way (pack.ts).
import type { JSONContent } from '@tiptap/core';
import type { BlockUI, InserterEntry } from './pack';
import { TABLE_ACTIONS } from './toolbar';
import { assetUrl, contentSrc } from './assets';
import { imagePicker } from './image-picker';
import { figureAttr, figureParts, type FigureParts } from './images';
import { entryIsMdx, imagesConfig } from './runtime';
import { MDX_BLOCKS } from './mdx/blocks';

/** Small drawings for the block menu (72x48), shared with packs through `svgPreview`. */
export const PREVIEW_COLORS = { accent: '#6161ff', tint: '#e3e3fd', grey: '#c9cbd1', line: '#e7e8eb' };
const A = PREVIEW_COLORS.accent;
const G = PREVIEW_COLORS.grey;
const L = PREVIEW_COLORS.line;
export const svgPreview = (inner: string) =>
  `<svg viewBox="0 0 72 48" width="72" height="48" aria-hidden="true" focusable="false"><rect x=".5" y=".5" width="71" height="47" rx="6" fill="#fff" stroke="${L}"/>${inner}</svg>`;
export const svgBar = (x: number, y: number, w: number, c = G, h = 3) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${c}"/>`;

/** Builders for document nodes (JSON), for inserter entries. */
export const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
export const bold = (t: string) => text(t, [{ type: 'bold' }]);
export const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', ...(content.length ? { content } : {}) });
export const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content: [p(...content)] });
export const ul = (...items: JSONContent[]): JSONContent => ({ type: 'bulletList', content: items });
export const ol = (...items: JSONContent[]): JSONContent => ({ type: 'orderedList', attrs: { start: 1 }, content: items });
const cell = (type: string, t = ''): JSONContent => ({ type, content: [t ? p(text(t)) : p()] });

export const BUILTIN_INSERTER: InserterEntry[] = [
  {
    id: 'paragraph',
    title: 'Text',
    hint: 'A plain paragraph',
    group: 'Basic blocks',
    keywords: 'paragraph text plain',
    preview: svgPreview(svgBar(10, 14, 52) + svgBar(10, 22, 48) + svgBar(10, 30, 36)),
    make: () => p(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    hint: 'A section',
    group: 'Basic blocks',
    keywords: 'heading h2 section title',
    preview: svgPreview(svgBar(10, 15, 40, '#0b1015', 6) + svgBar(10, 28, 52) + svgBar(10, 35, 44)),
    make: () => ({ type: 'heading', attrs: { level: 2 } }),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    hint: 'A sub-section',
    group: 'Basic blocks',
    keywords: 'heading h3 subsection',
    preview: svgPreview(svgBar(10, 16, 32, '#2b3036', 4) + svgBar(10, 27, 52) + svgBar(10, 34, 44)),
    make: () => ({ type: 'heading', attrs: { level: 3 } }),
  },
  {
    id: 'bulletList',
    title: 'Bulleted list',
    hint: 'Points in any order',
    group: 'Basic blocks',
    keywords: 'list bullet unordered ul',
    preview: svgPreview([14, 23, 32].map((y) => `<circle cx="13" cy="${y + 1.5}" r="1.8" fill="${A}"/>` + svgBar(19, y, 38)).join('')),
    make: () => ul(li()),
  },
  {
    id: 'orderedList',
    title: 'Numbered list',
    hint: 'Points in order',
    group: 'Basic blocks',
    keywords: 'list numbered ordered ol',
    preview: svgPreview([14, 23, 32].map((y, i) => `<text x="10" y="${y + 4}" font-size="6" font-family="monospace" fill="${A}">${i + 1}</text>` + svgBar(19, y, 38)).join('')),
    make: () => ol(li()),
  },
  {
    id: 'table',
    title: 'Table',
    hint: 'Rows and columns',
    group: 'Basic blocks',
    keywords: 'table grid comparison columns',
    preview: svgPreview(`<rect x="9" y="10" width="54" height="28" rx="2" fill="none" stroke="${G}"/><rect x="9" y="10" width="54" height="8" fill="#f1f1f3"/><path d="M27 10v28M45 10v28M9 18h54M9 28h54" stroke="${G}"/>`),
    make: () => ({
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', 'Column'), cell('tableHeader', 'Column'), cell('tableHeader', 'Column')] },
        { type: 'tableRow', content: [cell('tableCell'), cell('tableCell'), cell('tableCell')] },
        { type: 'tableRow', content: [cell('tableCell'), cell('tableCell'), cell('tableCell')] },
      ],
    }),
  },
  {
    id: 'blockquote',
    title: 'Quote',
    hint: 'A quotation',
    group: 'Basic blocks',
    keywords: 'quote blockquote citation',
    preview: svgPreview(`<rect x="10" y="12" width="2.5" height="24" rx="1" fill="${A}"/>` + svgBar(17, 15, 42) + svgBar(17, 23, 38) + svgBar(17, 31, 26)),
    make: () => ({ type: 'blockquote', content: [p()] }),
  },
  {
    id: 'image',
    title: 'Image',
    hint: 'Upload, drop, paste or link one',
    group: 'Basic blocks',
    keywords: 'image picture photo screenshot figure upload',
    preview: svgPreview(`<rect x="16" y="9" width="40" height="24" rx="2" fill="${PREVIEW_COLORS.tint}"/><path d="m22 29 9-9 6 6 4-4 9 7" fill="none" stroke="${A}" stroke-width="1.5"/><circle cx="44" cy="15" r="2.5" fill="${A}"/>` + svgBar(22, 38, 28)),
    make: () => ({ type: 'image', attrs: { src: '', alt: '' } }),
  },
  {
    id: 'horizontalRule',
    title: 'Divider',
    hint: 'A line between parts',
    group: 'Basic blocks',
    keywords: 'divider rule line hr separator',
    preview: svgPreview(svgBar(10, 13, 52) + `<path d="M10 24h52" stroke="${G}"/>` + svgBar(10, 32, 40)),
    make: () => ({ type: 'horizontalRule' }),
  },
];

export const BUILTIN_BLOCKS: BlockUI[] = [
  {
    name: 'table',
    label: 'Table',
    description: 'Edit cells on the canvas; Enter in a cell starts a new line in it.',
    panel(ctx) {
      ctx.actions(...TABLE_ACTIONS.map(([label, icon, run]) => ctx.button(icon, label, () => void run(ctx.editor), label.startsWith('Delete') ? 'danger' : undefined)));
    },
  },
  {
    name: 'rawHtml',
    label: 'HTML block',
    panel(ctx) {
      const field = ctx.input('HTML source', () => ctx.node()?.attrs.html ?? '', () => {}, {
        code: true,
        hint: 'HTML the editor has no box for. It is saved exactly as written here.',
      });
      const area = field.el.querySelector('textarea')!;
      ctx.add(field);
      ctx.actions(ctx.button('check', 'Apply', () => ctx.set({ html: area.value }), 'primary'));
    },
  },
  {
    name: 'image',
    label: 'Image',
    description: 'Type the caption under the image; “Alt” there swaps it for the alt text. Edit or crop saves a new file.',
    panel(ctx) {
      const cfg = imagesConfig();
      const parts = () => figureParts(ctx.node()?.attrs.figure);
      const setParts = (patch: Partial<FigureParts>, more: Record<string, unknown> = {}) =>
        ctx.set({ figure: figureAttr({ ...parts(), ...patch }, ctx.node()?.attrs.caption ?? null), ...more });
      // the same picker as covers: picture, Replace, Choose from library, Crop, Remove (the block), alt; the path under Details
      ctx.add(
        imagePicker({
          label: 'Image',
          get: () => ctx.node()?.attrs.src ?? '',
          set: (v) => (v ? ctx.set({ src: v }) : ctx.remove(ctx.pos)),
          url: (v) => assetUrl(v),
          value: (m) => contentSrc(m.path),
          alt: { get: () => ctx.node()?.attrs.alt ?? '', set: (v) => ctx.set({ alt: v }), decorative: () => parts().decorative },
          ai: ctx.altAi,
        }),
        ctx.segmented('Decorative', [['no', 'No'], ['yes', 'Yes']], () => (parts().decorative ? 'yes' : 'no'), (v) => setParts({ decorative: v === 'yes' }, v === 'yes' ? { alt: '' } : {})),
      );
      // in MDX a caption or a width would be written as a <figure> component, so they are left out there
      if (cfg.captions && !entryIsMdx())
        ctx.add(
          ctx.input('Caption', () => ctx.node()?.attrs.caption ?? '', (v) => {
            const caption = v.trim() ? v : null;
            ctx.set({ caption, figure: figureAttr(parts(), caption) });
          }),
        );
      if (cfg.widths.length > 1 && !entryIsMdx()) ctx.add(ctx.segmented('Width', cfg.widths.map((w) => [w.id, w.label]), () => parts().width, (v) => setParts({ width: v })));
    },
    panelKey: () => 'image',
  },
  { name: 'blockquote', label: 'Quote' },
  { name: 'codeBlock', label: 'Code' },
  ...MDX_BLOCKS,
];

export type { JSONContent };
