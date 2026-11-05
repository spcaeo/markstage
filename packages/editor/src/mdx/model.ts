// The words and the settings model of MDX components (no DOM, so tests run it in Node): what a card says, which
// settings a writer may change and how, and the guard that keeps the imports and exports as they are.
import { importedNames } from '@markstage/core';
import type { Node as PMNode } from '@tiptap/pm/model';

export type Prop = { name: string | null; kind: 'string' | 'number' | 'boolean' | 'expression' | 'spread'; value: unknown };

/** One prop as the card shows it: type="tip", height={240}, animate, data={…}. */
export function propText(p: Prop): string {
  if (p.kind === 'spread') return `{${String(p.value)}}`;
  if (p.kind === 'string') return `${p.name}="${String(p.value)}"`;
  if (p.kind === 'boolean') return p.value === true ? String(p.name) : `${p.name}={false}`;
  if (p.kind === 'number') return `${p.name}={${String(p.value)}}`;
  return `${p.name}={…}`;
}

/** What a component is called on its card: its name, or "Fragment" for <>…</>. */
export const componentName = (attrs: { name?: unknown }) => (attrs.name ? String(attrs.name) : 'Fragment');

const COMMENT = /^\{\s*\/\*[\s\S]*\*\/\s*\}$/;

/** What a piece of code says about itself, in a line of plain words. */
export function codeWords(kind: string, source: string): string {
  if (kind === 'esm') {
    const names = importedNames(source);
    if (names.length) return `Uses ${names.length} component${names.length === 1 ? '' : 's'}: ${names.join(', ')}. Code at the top of the file, kept as written.`;
    return 'Code at the top of the file, kept as written.';
  }
  if (kind === 'block') return 'This part holds code over several lines, so it is kept as written. Change it in Source mode.';
  if (COMMENT.test(source.trim())) return 'A note in the code, not shown on the page.';
  return 'Code the site works out when it builds the page.';
}

/** One setting in the side panel: a text box, a number, an on/off switch, or code shown as written. */
export type PropField =
  | { index: number; label: string; control: 'text' | 'number'; value: string }
  | { index: number; label: string; control: 'switch'; value: boolean }
  | { index: number; label: string; control: 'code'; value: string; hint: string };

/** The settings of a component, in the order written. `fixed`: the props could not be placed again, all read-only. */
export function propFields(props: Prop[], fixed = false): PropField[] {
  return props.map((p, index) => {
    const label = p.name ?? 'Spread';
    if (fixed || p.kind === 'expression' || p.kind === 'spread') {
      const value = p.kind === 'expression' || p.kind === 'spread' ? `{${String(p.value)}}` : propText(p);
      return { index, label, control: 'code', value, hint: fixed ? 'Kept as written here. Change it in Source mode.' : 'Code: kept as written. Change it in Source mode.' };
    }
    if (p.kind === 'boolean') return { index, label, control: 'switch', value: p.value === true };
    return { index, label, control: p.kind === 'number' ? 'number' : 'text', value: String(p.value ?? '') };
  });
}

/**
 * The props with setting `i` changed to what the writer typed, or null when it is not a value it can take (a
 * number that is not one, or a setting that is code): nothing is written then.
 */
export function withProp(props: Prop[], i: number, typed: string | boolean): Prop[] | null {
  const p = props[i];
  if (!p) return null;
  let value: unknown;
  if (p.kind === 'boolean') value = typed === true || typed === 'true';
  else if (p.kind === 'number') {
    const t = String(typed).trim();
    if (t === '' || !Number.isFinite(Number(t))) return null;
    value = Number(t);
  } else if (p.kind === 'string') value = String(typed).replace(/[\r\n]+/g, ' ');
  else return null;
  return props.map((q, k) => (k === i ? { ...q, value } : q));
}

/** The imports and exports of a document, in order, and how many of them open it. */
export function esmOf(doc: PMNode): { sources: string[]; lead: number } {
  const sources: string[] = [];
  let lead = 0;
  let leading = true;
  doc.forEach((n) => {
    const esm = n.type.name === 'mdxCode' && n.attrs.kind === 'esm';
    if (esm) sources.push(String(n.attrs.source));
    if (leading && esm) lead++;
    else leading = false;
  });
  return { sources, lead };
}

/** True when going from `before` to `after` keeps every import and export, in order, and those at the top there. */
export function esmKept(before: PMNode, after: PMNode): boolean {
  const was = esmOf(before);
  if (!was.sources.length) return true;
  const now = esmOf(after);
  return now.sources.join('\u0000') === was.sources.join('\u0000') && now.lead >= was.lead;
}
