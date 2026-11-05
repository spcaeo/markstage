// A converter for one site: its block packs plus the core Markdown reader, printer and surgical save.
//   const md = createConverter({ packs: [pack] });
//   md.mdToDoc(text)                       -> { frontmatter, doc }
//   md.docToMd(doc, originalText, opts)    -> the full file text (surgical by default; preserve:false = printer only)
//   md.changedBlocks(doc, originalText)    -> how many top-level blocks a save rewrites
//   md.printBlock(node) / md.printBlocks(nodes)
//   md.rawHtmlOf(doc)                      -> the HTML the converter could not map (rawHtml / rawInline sources)
//                                             and, for MDX, the code (mdx.mjs mdxCodeOf)
//
// createConverter({ mdx: true }) reads and writes MDX (docs/MDX.md): the code is kept as written, the prose edits
// as in Markdown. mdToDoc throws an MdxError (with the line) for a file the MDX reader cannot read, or one it could
// not write back byte for byte: such a file is not opened for editing, so it can never be saved wrong.
import { registry } from '../blocks.mjs';
import { MdxError, mdxCodeOf, mdxErrorOf, mdxParser } from './mdx.mjs';
import { makeParser, splitFrontmatter } from './parse.mjs';
import { makePrinter } from './print.mjs';
import { makeSurgical } from './surgical.mjs';

export function createConverter({ packs = [], mdx = false } = {}) {
  const reg = registry(packs);
  const flavour = mdx ? { mdx: { parser: mdxParser } } : {};
  const { parseEntries: readEntries, inlineNodes } = makeParser(reg, flavour);
  const printer = makePrinter(reg, inlineNodes, flavour);
  const { emitBlocks } = makeSurgical(reg, printer);
  const lines = (s) => s.split('\n').length - 1;
  // the MDX reader's errors carry the line in the body: the frontmatter's lines are added
  const parseEntries = !mdx
    ? readEntries
    : (body, frontmatter = '') => {
        try {
          return readEntries(body);
        } catch (e) {
          throw mdxErrorOf(e, lines(frontmatter));
        }
      };

  function mdToDoc(text) {
    const { frontmatter, body } = splitFrontmatter(text);
    const content = parseEntries(body, frontmatter).map((e) => e.node);
    const doc = { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
    if (mdx && docToMd(doc, text) !== text) throw new MdxError('Markstage cannot write this MDX file back exactly as it is, so it is not opened for editing.');
    return { frontmatter, doc };
  }

  function docToMd(doc, originalText = '', { preserve = true } = {}) {
    const { frontmatter, body } = splitFrontmatter(originalText);
    const nodes = doc?.content ?? [];
    if (!preserve) return `${frontmatter}\n${printer.printBlocks(nodes)}\n`;
    const orig = parseEntries(body, frontmatter);
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
    mdx: !!mdx,
    mdToDoc,
    docToMd,
    changedBlocks,
    printBlock: (node, ctx) => printer.printBlock(node, ctx),
    printBlocks: (nodes) => printer.printBlocks(nodes),
    rawHtmlOf,
    splitFrontmatter,
  };
}

/**
 * The HTML sources the converter kept as fallbacks (rawHtml blocks and rawInline atoms), in document order, and the
 * MDX code (imports, expressions, components without their literal values: `mdx: false` leaves it out).
 */
export function rawHtmlOf(doc, { mdx = true } = {}) {
  const out = [];
  const walk = (n) => {
    if ((n.type === 'rawHtml' || n.type === 'rawInline' || n.type === 'html') && typeof n.attrs?.html === 'string') out.push(n.attrs.html);
    const code = mdx ? mdxCodeOf(n) : null;
    if (code !== null) out.push(code);
    for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc);
  return out;
}
