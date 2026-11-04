// The page-level values (title, SEO, canonical, robots…) for the shell's Page settings drawer, which posts and pages
// share: the same get / set / onChange as its FrontmatterEdits, backed by the page model, so a setting is one more
// pending change saved with the rest (⌘S) and undone with the rest.
import { drawField, shapeKey, type FieldsCtx } from './fields';
import type { PageModel } from './model';
import type { PageSettingsEdits } from './types';

export function pageSettings(model: PageModel, saved: () => Record<string, unknown>): PageSettingsEdits {
  const listeners: ((path: string | null) => void)[] = [];
  let last: string | null = null;
  model.onChange((why) => {
    for (const fn of listeners) fn(why === 'edit' ? last : null);
    last = null;
  });
  const has = (path: string) => {
    let at: unknown = saved();
    for (const k of path.split('.')) at = at && typeof at === 'object' ? (at as Record<string, unknown>)[k] : undefined;
    return at !== undefined;
  };
  return {
    get: (path) => model.get(path),
    set(path, value) {
      last = path;
      const empty = value === null || value === undefined || value === '';
      // an empty value for a key the file never had is no change; for one it has, the key goes
      if (empty && !has(path) && model.get(path) === undefined) return;
      if (empty && value !== '') model.change({ op: 'remove', path });
      else model.change({ op: 'set', path, value });
    },
    onChange: (fn) => void listeners.push(fn),
    get isDirty() {
      return model.dirty;
    },
  };
}

/** The page-level fields the drawer does not draw itself, from the schema (see PageEditorHandle.drawSettings). */
export function drawPageFields(el: HTMLElement, fctx: FieldsCtx, model: PageModel, skip: string[] = [], bodyKey = 'sections') {
  let syncs: (() => void)[] = [];
  let shape = '';
  const draw = () => {
    syncs = [];
    el.replaceChildren();
    shape = shapeKey(model.data);
    const ctx: FieldsCtx = { ...fctx, restructure: draw };
    if (ctx.root.type !== 'object') return;
    for (const [k, f] of Object.entries(ctx.root.fields)) {
      if (k === bodyKey || skip.includes(k)) continue;
      const inner = new Set(skip.filter((p) => p.startsWith(`${k}.`)).map((p) => p.slice(k.length + 1)));
      if (f.type === 'object' && inner.size) {
        const rest = Object.fromEntries(Object.entries(f.fields).filter(([sub]) => !inner.has(sub)));
        if (Object.keys(rest).length) drawField(el, k, { ...f, fields: rest }, k, ctx, syncs);
      } else drawField(el, k, f, k, ctx, syncs);
    }
  };
  draw();
  // an image's AI alt text follows the URL here too (ai.ts)
  const offAi = fctx.ai?.listen(() => syncs.forEach((s) => s()));
  const off = model.onChange((why) => {
    if (why === 'list') shape = shapeKey(model.data);
    if (why !== 'edit' && why !== 'list') draw();
    else if (why === 'edit' && shapeKey(model.data) !== shape) draw();
    else for (const s of syncs) s();
  });
  return {
    focus(path?: string) {
      const at = (path && el.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)) || el.querySelector<HTMLElement>('[data-path]');
      if (!at) return;
      for (let d = at.closest('details'); d; d = d.parentElement?.closest('details') ?? null) (d as HTMLDetailsElement).open = true;
      at.scrollIntoView({ block: 'nearest' });
      at.querySelector<HTMLElement>('input, textarea, select')?.focus({ preventScroll: true });
    },
    destroy: () => {
      off();
      offAi?.();
      el.replaceChildren();
    },
  };
}
