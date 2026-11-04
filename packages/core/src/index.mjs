// @markstage/core: the document model and the Markdown converter with block packs. Pure ESM; runs in Node and in
// the browser (the editor uses it for Source mode and Copy as Markdown).
export { createConverter, rawHtmlOf } from './markdown/converter.mjs';
export { splitFrontmatter } from './markdown/parse.mjs';
export { markdownUrls } from './markdown/urls.mjs';
export { definePack, registry } from './blocks.mjs';
export { readFrontmatter, bodyOf, hasFrontmatter } from './frontmatter.mjs';
export { decodeHtml, escHtml, escAttr, parseTag, attrOf, hasTags } from './html.mjs';
export {
  sameMark,
  normalizeInline,
  linkFromTag,
  linkOpenTag,
  htmlToInline,
  inlineToHtml,
  markOrder,
  markExtent,
  paragraph,
} from './inline.mjs';
export { setFrontmatter } from './frontmatter-write.mjs';
export { changedLeaves, mergeBlocks, mergeData, resolve, splitBlocks } from './merge.mjs';
export { ancestors, canMove, canRemove, find, flatten, moveItems, placeOf, removeItems, restoreItems } from './order.mjs';
export { alternates, emitsHreflang, localeOfPath, localePath } from './locales.mjs';
export { checkLocks, LOCK_RULES_FILE, lockChanges, lockOf, lockReport, lockRulesText, markOf, normalizeLockRules } from './locks.mjs';
