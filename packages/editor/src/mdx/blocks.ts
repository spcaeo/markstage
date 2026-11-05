// The side panel of an MDX component (and of its code): the component's literal settings (text, number, on/off) can
// be changed there; a setting that is code ({x}, {...props}) is shown read-only, with its copy button. Which is which
// is the model's (model.ts propFields); the save rewrites only the changed value, in its own quote style (core
// mdx.mjs applyProps).
import type { BlockUI } from '../pack';
import type { PanelCtx } from '../panel-form';
import { h } from '../panel-form';
import { copyable } from '../copy';
import { codeWords, componentName, propFields, withProp, type Prop } from './model';

const propsOf = (ctx: PanelCtx): Prop[] => (ctx.node()?.attrs.props ?? []) as Prop[];

/** Writes setting `i` as typed (nothing when it is not a value it can take). */
function setProp(ctx: PanelCtx, i: number, typed: string | boolean): void {
  const props = withProp(propsOf(ctx), i, typed);
  if (props) ctx.set({ props });
}

/** A setting shown as written: code, or a component whose settings are kept as written. */
function readOnly(label: string, text: string, hint: string): { el: HTMLElement } {
  const wrap = h('div', 'ms-mdx-prop');
  wrap.dataset.prop = label;
  const name = h('span', 'ms-mdx-prop__label');
  name.textContent = label;
  const note = h('span', 'ms-mdx-prop__hint');
  note.textContent = hint;
  wrap.append(name, copyable(text, { label: label.toLowerCase(), className: 'ms-mdx-prop__code' }), note);
  return { el: wrap };
}

function componentPanel(ctx: PanelCtx): void {
  const node = ctx.node();
  if (!node) return;
  const title = h('p', 'ms-mdx-prop__name');
  title.textContent = `The ${componentName(node.attrs)} component`;
  ctx.add({ el: title });
  const fields = propFields(propsOf(ctx), !!node.attrs.fixed);
  if (!fields.length) ctx.note('This component has no settings.');
  for (const f of fields) {
    const now = () => propFields(propsOf(ctx))[f.index]?.value;
    if (f.control === 'code') ctx.add(readOnly(f.label, f.value, f.hint));
    else if (f.control === 'switch') ctx.add(ctx.segmented(f.label, [['true', 'On'], ['false', 'Off']], () => String(now() === true), (v) => setProp(ctx, f.index, v === 'true')));
    else {
      const field = ctx.input(f.label, () => String(now() ?? ''), (v) => setProp(ctx, f.index, v), f.control === 'number' ? { hint: 'A number.' } : {});
      if (f.control === 'number') field.el.querySelector('input')?.setAttribute('inputmode', 'decimal');
      field.el.dataset.prop = f.label;
      ctx.add(field);
    }
  }
  if (node.attrs.fixed && fields.length) ctx.note('This component sits in a list or a quotation, so its settings are kept as written.');
}

function codePanel(ctx: PanelCtx): void {
  const node = ctx.node();
  if (!node) return;
  ctx.note(codeWords(String(node.attrs.kind), String(node.attrs.source ?? '')));
  ctx.add(readOnly('Code', String(node.attrs.source ?? ''), 'Kept as written. A developer changes it, or you in Source mode.'));
}

const DESCRIPTION = 'Part of the site’s code. Its words and simple settings are yours to change; the code stays as written.';

export const MDX_BLOCKS: BlockUI[] = [
  // the panel is drawn once per component (its fields follow the values as they change)
  { name: 'mdxComponent', label: 'Component', description: DESCRIPTION, panel: componentPanel, panelKey: (n) => String(n.attrs.source) },
  { name: 'mdxContainer', label: 'Component', description: DESCRIPTION, panel: componentPanel, panelKey: (n) => String(n.attrs.open) },
  { name: 'mdxCode', label: 'Code', panel: codePanel, panelKey: (n) => String(n.attrs.source) },
];
