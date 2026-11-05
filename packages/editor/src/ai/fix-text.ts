// The pure parts of the AI fixes (fixes.ts), apart so they are unit-tested without a browser: which suggestion kind
// a fix asks for, where a block or an image is, and the sentence a link-words fix rewrites.
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import type { LinkFound } from '../seo/text';
import type { AiKind } from './api';

/** The suggestion kind a fix asks for: the server offers it, or the button is not there. */
export const fixKind = (id: string): AiKind => (id === 'title' || id === 'description' ? 'seo' : id.startsWith('alt-') ? 'alt' : 'fix');

/** A heading's level as the writer types it: 3 or H3. */
export const LEVEL = /^h?([1-6])$/i;
const SENTENCE_MAX = 1000;

/** The top-level block at `index` and where it starts, or null. */
export function blockAt(doc: PMNode, index: number): { node: PMNode; pos: number } | null {
  if (index >= doc.childCount) return null;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return { node: doc.child(index), pos };
}

/** The nth image of the text (from 1, as imagesOf counts them), with its position. */
export function imageAt(doc: PMNode, n: number): { node: PMNode; pos: number } | null {
  let i = 0;
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'image' && ++i === n) found = { node, pos };
    return !found;
  });
  return found;
}

/**
 * The sentence a link stands in: from the end of the sentence before it (". ") to the end of its own, inside its
 * paragraph, never across an image or a line break (a fix replaces text only). {text, from, to, mark, others}:
 * `others` is true when another mark (bold, a second link) is in it, which a fix's plain text would not keep.
 */
export function sentenceOf(doc: PMNode, l: LinkFound): { text: string; from: number; to: number; mark: Mark; others: boolean } | null {
  const $at = doc.resolve(l.from);
  const block = $at.parent;
  if (!block.isTextblock) return null;
  const start = $at.start();
  // the text runs of the block, each with its place; a non-text node (an image, a line break) breaks them
  let text = '';
  const pos: number[] = [];
  let mark: Mark | null = null;
  const marks: string[] = [];
  block.forEach((child, at) => {
    if (child.isText) {
      for (let i = 0; i < child.text!.length; i++) {
        text += child.text![i];
        pos.push(start + at + i);
      }
    } else {
      text += '\u0000';
      pos.push(start + at);
    }
  });
  const a = pos.indexOf(l.from);
  const b = pos.indexOf(l.to - 1) + 1;
  if (a < 0 || b <= a || text.slice(a, b).includes('\u0000')) return null;
  let s = a;
  while (s > 0 && text[s - 1] !== '\u0000' && !(/\s/.test(text[s - 1]) && /[.!?]/.test(text[s - 2] ?? ''))) s--;
  let e = b;
  while (e < text.length && text[e] !== '\u0000' && !(/[.!?]/.test(text[e]) && (e + 1 === text.length || /\s/.test(text[e + 1])))) e++;
  if (e < text.length && text[e] !== '\u0000') e++;
  while (s < a && /\s/.test(text[s])) s++;
  while (e > b && /\s/.test(text[e - 1])) e--;
  if (e - s > SENTENCE_MAX) return null;
  const from = pos[s];
  const to = pos[e - 1] + 1;
  doc.nodesBetween(from, to, (n) => {
    if (!n.isText) return true;
    for (const m of n.marks) {
      if (m.type.name === 'link' && m.attrs.href === l.href && !mark) mark = m;
      marks.push(m.type.name === 'link' ? `link:${m.attrs.href}` : m.type.name);
    }
    if (!n.marks.length) marks.push('');
    return false;
  });
  if (!mark) return null;
  return { text: text.slice(s, e), from, to, mark, others: new Set(marks.filter((m) => m !== `link:${l.href}` && m !== '')).size > 0 };
}
