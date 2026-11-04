// "Link these words" for the open page's own link suggestions (topics.ts): the first place on the canvas where the
// words stand unlinked, in the suggestion's block first, gets the link; the change is pending like any edit (⌘S).
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Suggestion } from './topics';

/** The document position of a text offset inside a text block that starts at `start`. */
function posAt(block: PMNode, start: number, offset: number): number | null {
  let seen = 0;
  let out: number | null = null;
  block.forEach((child, at) => {
    if (out !== null) return;
    const len = child.isText ? child.text!.length : 0;
    if (child.isText && offset <= seen + len) out = start + 1 + at + (offset - seen);
    seen += len;
  });
  return out ?? (offset === seen ? start + block.nodeSize - 1 : null);
}

/** Where the words are unlinked in this part of the document: {from, to} or null. */
function findIn(doc: PMNode, from: number, to: number, words: string, isLinked: (a: number, b: number) => boolean): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null;
  doc.nodesBetween(from, to, (node, pos) => {
    if (hit) return false;
    if (!node.isTextblock) return true;
    const text = node.textContent;
    for (let i = text.indexOf(words); i >= 0 && !hit; i = text.indexOf(words, i + 1)) {
      const a = posAt(node, pos, i);
      const b = posAt(node, pos, i + words.length);
      if (a !== null && b !== null && !isLinked(a, b)) hit = { from: a, to: b };
    }
    return false;
  });
  return hit;
}

export function linkWordsOnCanvas(getEditor: () => Editor | null): (s: Suggestion) => boolean {
  return (s) => {
    const ed = getEditor();
    if (!ed || !s.toUrl) return false;
    const doc = ed.state.doc;
    const linked = (a: number, b: number) => doc.rangeHasMark(a, b, ed.schema.marks.link);
    // the suggestion's top-level block first, then anywhere
    let hit: { from: number; to: number } | null = null;
    const top = s.path?.[0];
    if (top !== undefined && top < doc.childCount) {
      let start = 0;
      for (let i = 0; i < top; i++) start += doc.child(i).nodeSize;
      hit = findIn(doc, start, start + doc.child(top).nodeSize, s.anchor, linked);
    }
    hit ??= findIn(doc, 0, doc.content.size, s.anchor, linked);
    if (!hit) return false;
    ed.chain().focus().setTextSelection(hit).setLink({ href: s.toUrl }).run();
    return true;
  };
}
