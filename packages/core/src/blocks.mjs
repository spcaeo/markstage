// Block packs, Markdown side: how a site's own boxes look in its Markdown files. A pack is plain data plus pure
// functions, so the server, the dev integration and the browser all load the same file.
//
//   definePack({ name, blocks: [BlockCodec, ...] })
//
// Two kinds of block:
//   'line'  a whole one-line HTML block (e.g. <aside class="note">…</aside>) -> one node.
//           parse(html) -> node | null, print(node) -> html. A parse is only kept when print(parse(x)) === x, so a
//           pack can never change bytes it read.
//   'wrap'  an opening HTML line, Markdown blocks, a closing HTML line (e.g. <div class="steps"> … </div>).
//           open(html) -> { attrs?, title?, close } | null: `title` is a fixed first paragraph the printer writes
//           itself (an icon, a heading), `close` the exact closing line. printOpen(node) (with the title, if any)
//           and printClose(node) write them back. `parent`: the wrap only opens inside that block; `children`:
//           the exact sequence of child types it holds (anything else stays raw HTML).
// Everything the converter does not recognise stays a `rawHtml` / `rawInline` node with its exact source.

/** Checks a pack's shape and returns it (frozen). Throws with a plain message on a mistake. */
export function definePack(pack) {
  if (!pack || typeof pack.name !== 'string' || !Array.isArray(pack.blocks)) throw new Error('A block pack needs a name and a blocks array.');
  for (const b of pack.blocks) {
    if (!b || typeof b.name !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(b.name)) throw new Error(`Pack "${pack.name}": a block needs a camelCase name.`);
    if (b.kind === 'line') {
      if (typeof b.parse !== 'function' || typeof b.print !== 'function') throw new Error(`Block "${b.name}": a line block needs parse and print.`);
    } else if (b.kind === 'wrap') {
      if (typeof b.open !== 'function' || typeof b.printOpen !== 'function' || typeof b.printClose !== 'function') {
        throw new Error(`Block "${b.name}": a wrap block needs open, printOpen and printClose.`);
      }
    } else throw new Error(`Block "${b.name}": kind must be "line" or "wrap".`);
  }
  return Object.freeze(pack);
}

const CORE_TYPES = new Set([
  'doc', 'paragraph', 'heading', 'horizontalRule', 'codeBlock', 'blockquote', 'bulletList', 'orderedList', 'listItem',
  'table', 'tableRow', 'tableHeader', 'tableCell', 'image', 'text', 'hardBreak', 'rawHtml', 'rawInline',
  'mdxCode', 'mdxComponent', 'mdxContainer', 'mdxInline',
]);

/** The blocks of all packs, indexed for the converter. */
export function registry(packs = []) {
  const byName = new Map();
  const lines = [];
  const wraps = [];
  for (const pack of packs) {
    for (const b of pack.blocks) {
      if (CORE_TYPES.has(b.name)) throw new Error(`Pack "${pack.name}": "${b.name}" is a core node name.`);
      if (byName.has(b.name)) throw new Error(`Block "${b.name}" is defined twice.`);
      byName.set(b.name, b);
      (b.kind === 'line' ? lines : wraps).push(b);
    }
  }
  return {
    get: (name) => byName.get(name),
    isLine: (name) => byName.get(name)?.kind === 'line',
    isWrap: (name) => byName.get(name)?.kind === 'wrap',

    /** A whole one-line HTML block -> its node, or null. */
    parseLine(html) {
      for (const b of lines) {
        const node = b.parse(html);
        if (node && node.type === b.name && b.print(node) === html) return node;
      }
      return null;
    },

    /** The html node opening a wrap inside `parent` (a block name, or null at the top / in Markdown containers). */
    parseOpen(html, parent) {
      const holder = parent ? byName.get(parent) : null;
      for (const b of wraps) {
        if (b.parent ? b.parent !== parent : holder?.children) continue;
        if (holder?.children && !holder.children.includes(b.name)) continue;
        const open = b.open(html);
        if (!open) continue;
        const node = { type: b.name, ...(open.attrs ? { attrs: open.attrs } : {}) };
        // the printer must give back exactly what was read
        if (b.printOpen(node) !== html + (open.title ? `\n\n${open.title}` : '')) continue;
        return { type: b.name, attrs: open.attrs, title: open.title, close: open.close, children: b.children };
      }
      return null;
    },

    printLine: (node) => byName.get(node.type).print(node),
    printOpen: (node) => byName.get(node.type).printOpen(node),
    printClose: (node) => byName.get(node.type).printClose(node),
  };
}
