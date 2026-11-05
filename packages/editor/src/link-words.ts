// "Link these words" for the open page's own link suggestions (topics.ts), and "Add link" for the AI's (ai/links.ts):
// the first place on the canvas where the words stand unlinked, in the suggestion's block first, gets the link; the
// change is pending like any edit (⌘S).
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

/**
 * Links the first place where `words` stand unlinked (in the top-level block `top` first, then anywhere) to `href`:
 * one change on the canvas (⌘Z takes it back). 'missing': the words are not there unlinked; 'locked': the block is
 * locked (lock-ui.ts turns the change away).
 */
export function linkWords(ed: Editor, words: string, href: string, top?: number | null): 'linked' | 'missing' | 'locked' {
  const doc = ed.state.doc;
  const linked = (a: number, b: number) => doc.rangeHasMark(a, b, ed.schema.marks.link);
  let hit: { from: number; to: number } | null = null;
  if (top !== undefined && top !== null && top < doc.childCount) {
    let start = 0;
    for (let i = 0; i < top; i++) start += doc.child(i).nodeSize;
    hit = findIn(doc, start, start + doc.child(top).nodeSize, words, linked);
  }
  hit ??= findIn(doc, 0, doc.content.size, words, linked);
  if (!hit) return 'missing';
  ed.chain().focus().setTextSelection(hit).setLink({ href }).run();
  // the canvas has the keys now (the chain's focus waits a frame): ⌘Z takes the link back at once
  ed.view.focus();
  return ed.state.doc.eq(doc) ? 'locked' : 'linked';
}

export function linkWordsOnCanvas(getEditor: () => Editor | null): (s: Suggestion) => boolean {
  return (s) => {
    const ed = getEditor();
    if (!ed || !s.toUrl) return false;
    return linkWords(ed, s.anchor, s.toUrl, s.path?.[0]) !== 'missing';
  };
}
