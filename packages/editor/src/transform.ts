// The document (what the converter reads and writes) <-> the editor's document. Core keeps them the same except
// for one-line boxes (`inlineBody`: one paragraph in the document, its text edited directly in the editor) and
// TipTap's empty attribute defaults; block packs add their own editor-only shapes (pack.ts toEditor / toContract).
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { blockUI, editorPacks } from './runtime';

const inlineBody = (type?: string) => !!type && !!blockUI(type)?.inlineBody;

function inward(n: JSONContent): JSONContent {
  if (inlineBody(n.type)) {
    const inline = (n.content ?? []).flatMap((p, i) => (i ? [{ type: 'hardBreak' }, ...(p.content ?? [])] : (p.content ?? [])));
    return { ...n, content: inline };
  }
  let out: JSONContent = n;
  if (n.content) out = { ...n, content: inwardList(n.content.map(inward), n.type ?? '') };
  for (const p of editorPacks()) out = p.toEditor?.(out) ?? out;
  return out;
}

function inwardList(content: JSONContent[], parent: string): JSONContent[] {
  let out = content;
  for (const p of editorPacks()) out = p.toEditorContent?.(out, parent) ?? out;
  return out;
}

/** Contract document -> editor document. */
export function toEditor(doc: JSONContent): JSONContent {
  const content = (doc.content ?? []).map(inward);
  return { type: 'doc', content: inwardList(content.length ? content : [{ type: 'paragraph' }], 'doc') };
}

/** Drops attributes the editor adds with no value (TipTap defaults), so the converter sees the contract. */
function clean(attrs?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!attrs) return attrs;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

function outward(n: JSONContent): JSONContent[] {
  for (const p of editorPacks()) {
    const r = p.toContract?.(n);
    // a node of the same type is the pack's final word on it (only its children are converted further)
    if (r) return (Array.isArray(r) ? r : [r]).flatMap((x) => (x.type === n.type ? plain(x) : outward(x)));
  }
  return plain(n);
}

function plain(n: JSONContent): JSONContent[] {
  const out: JSONContent = { type: n.type };
  const attrs = clean(n.attrs);
  if (attrs) out.attrs = attrs;
  if (n.text !== undefined) out.text = n.text;
  if (n.marks?.length) out.marks = n.marks.map((m) => (clean(m.attrs) ? { type: m.type, attrs: clean(m.attrs) } : { type: m.type }));
  if (inlineBody(n.type)) out.content = [{ type: 'paragraph', ...(n.content?.length ? { content: n.content.flatMap(outward) } : {}) }];
  else if (n.content) out.content = n.content.flatMap(outward);
  return [out];
}

const isEmptyParagraph = (n: JSONContent) => n.type === 'paragraph' && !n.content?.length;

/** Editor document -> contract document (empty top-level paragraphs dropped: Markdown has no such thing). */
export function toContract(doc: JSONContent): JSONContent {
  // an image block still waiting for its file is not written
  return { type: 'doc', content: (doc.content ?? []).flatMap(outward).filter((n) => !isEmptyParagraph(n) && !(n.type === 'image' && !n.attrs?.src)) };
}

/** Same entry as far as the file goes: empty top-level paragraphs are not saved (toContract drops them). */
export function sameContent(a: PMNode, b: PMNode): boolean {
  const kept = (d: PMNode) => {
    const out: PMNode[] = [];
    d.forEach((n) => {
      if (!(n.type.name === 'paragraph' && n.childCount === 0)) out.push(n);
    });
    return out;
  };
  const x = kept(a);
  const y = kept(b);
  return x.length === y.length && x.every((n, i) => n.eq(y[i]!));
}
