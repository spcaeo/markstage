// A converter for one site: its block packs plus the core Markdown reader, printer and surgical save.
//   const md = createConverter({ packs: [pack] });
//   md.mdToDoc(text)                       -> { frontmatter, doc }
//   md.docToMd(doc, originalText, opts)    -> the full file text (surgical by default; preserve:false = printer only)
//   md.changedBlocks(doc, originalText)    -> how many top-level blocks a save rewrites
//   md.printBlock(node) / md.printBlocks(nodes)
//   md.rawHtmlOf(doc)                      -> the HTML the converter could not map (rawHtml / rawInline sources)
import { registry } from '../blocks.mjs';
import { makeParser, splitFrontmatter } from './parse.mjs';
import { makePrinter } from './print.mjs';
import { makeSurgical } from './surgical.mjs';

export function createConverter({ packs = [] } = {}) {
  const reg = registry(packs);
  const { parseEntries, inlineNodes } = makeParser(reg);
  const printer = makePrinter(reg, inlineNodes);
  const { emitBlocks } = makeSurgical(reg, printer);

  function mdToDoc(text) {
    const { frontmatter, body } = splitFrontmatter(text);
    const content = parseEntries(body).map((e) => e.node);
    return { frontmatter, doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] } };
  }

  function docToMd(doc, originalText = '', { preserve = true } = {}) {
    const { frontmatter, body } = splitFrontmatter(originalText);
    const nodes = doc?.content ?? [];
    if (!preserve) return `${frontmatter}\n${printer.printBlocks(nodes)}\n`;
    const orig = parseEntries(body);
    const { text } = emitBlocks(nodes, orig, body);
    // no blocks left: just the frontmatter (a body that was already blank stays as it was)
    if (text === '') return frontmatter + (orig.length ? '' : body);
    const lead = orig.length ? body.slice(0, orig[0].start) : frontmatter ? '\n' : '';
    const trail = orig.length ? body.slice(orig[orig.length - 1].end) : '\n';
    return frontmatter + lead + text + trail;
  }

  function changedBlocks(doc, originalText) {
    const { body } = splitFrontmatter(originalText);
    return emitBlocks(doc?.content ?? [], parseEntries(body), body).changed;
  }

  return {
    mdToDoc,
    docToMd,
    changedBlocks,
    printBlock: (node, ctx) => printer.printBlock(node, ctx),
    printBlocks: (nodes) => printer.printBlocks(nodes),
    rawHtmlOf,
    splitFrontmatter,
  };
}

/** The HTML sources the converter kept as fallbacks (rawHtml blocks and rawInline atoms), in document order. */
export function rawHtmlOf(doc) {
  const out = [];
  const walk = (n) => {
    if ((n.type === 'rawHtml' || n.type === 'rawInline' || n.type === 'html') && typeof n.attrs?.html === 'string') out.push(n.attrs.html);
    for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc);
  return out;
}
