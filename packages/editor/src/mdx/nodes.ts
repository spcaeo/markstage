// The editor's nodes for the code parts of an MDX file (core markdown/mdx.mjs, docs/MDX.md): imports, exports and
// {expressions} (mdxCode), JSX blocks (mdxComponent, and mdxContainer whose Markdown children are edited as prose),
// and JSX inside a line (mdxInline). All of them are locked: drawn as cards, never typed into; a component's
// literal props change in the side panel (blocks.ts). The guard below keeps the imports and exports as they are, so
// the writer cannot break the code.
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { esmKept } from './model';
import { CodeView, ComponentView, ContainerView, InlineView } from './views';

/** An attribute kept as JSON in the HTML (copy and paste inside the editor keeps a component whole). */
const kept = (name: string, def: unknown) => ({
  default: def,
  parseHTML: (el: HTMLElement) => {
    try {
      const v = el.getAttribute(`data-ms-${name}`);
      return v === null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  renderHTML: (attrs: Record<string, unknown>) => ({ [`data-ms-${name}`]: JSON.stringify(attrs[name] ?? def) }),
});

const atom = (name: string, attrs: Record<string, unknown>, View: any, inline = false, draggable = true) =>
  Node.create({
    name,
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    selectable: true,
    draggable: !inline && draggable,
    addAttributes: () => Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, kept(k, v)])),
    parseHTML: () => [{ tag: `${inline ? 'span' : 'div'}[data-ms-atom="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) => [inline ? 'span' : 'div', mergeAttributes(HTMLAttributes, { 'data-ms-atom': name })],
    addNodeView: () => (p) => new View(p.node, p.view, p.getPos),
  });

const MdxCode = atom('mdxCode', { kind: 'expression', source: '' }, CodeView, false, false);
const MdxComponent = atom('mdxComponent', { name: null, props: [], source: '', fixed: false }, ComponentView);
const MdxInline = atom('mdxInline', { name: null, source: '' }, InlineView, true);

const MdxContainer = Node.create({
  name: 'mdxContainer',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  selectable: true,
  draggable: true,
  addAttributes: () => ({ name: kept('name', null), props: kept('props', []), open: kept('open', ''), close: kept('close', ''), fixed: kept('fixed', false) }),
  parseHTML: () => [{ tag: 'div[data-ms-atom="mdxContainer"]', contentElement: '.ms-mdx-card__body' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-ms-atom': 'mdxContainer' }), ['div', { class: 'ms-mdx-card__body' }, 0]],
  addNodeView: () => (p) => new ContainerView(p.node, p.view, p.getPos),
});

/** A transaction that sets the whole document again (a kept copy brought back) says so with this meta. */
export const WHOLE_DOC = 'msWholeDoc';

/**
 * The imports and exports stay: no edit removes, changes or reorders them, and ones that open the file still open
 * it. (Select all and delete, a drag, a paste over them: refused.) Components may be removed, like any block.
 */
export const MdxGuard = Extension.create({
  name: 'mdxGuard',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: new PluginKey('mdxGuard'),
      filterTransaction(tr, state) {
        return !tr.docChanged || !!tr.getMeta(WHOLE_DOC) || esmKept(state.doc, tr.doc);
      },
    }),
  ],
});

export const MDX_NODES = [MdxCode, MdxComponent, MdxContainer, MdxInline, MdxGuard];
