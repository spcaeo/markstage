// Field bindings: the attributes that tell the Markstage editor which entry field an element shows, so the writer
// edits it on the real rendered page. Only in editor mode (MARKSTAGE_EDITOR=1 in the build or dev server's
// environment); in any other build every helper returns nothing, so the site's output is byte for byte what it
// was without Markstage.
//
// data-ms-field is the field's path in the entry (dotted, array items by index: "sections.3.value.heading");
// data-ms-kind says how it is edited: text and rich (HTML) inline on the page, image / link / list in the panel.
// An element that shows the value reformatted (a date written out) adds data-ms-format="date", and the editor
// edits that value in the panel instead. data-ms-section marks a page section's outer element (the outline).
//
// Two Astro behaviours decide how a site uses these and keep its normal build unchanged (checked on a real site
// with Astro 7 by comparing every built file):
// 1. Make the binders where the sections are planned (one module that already imports this) and hand them to the
//    section components as a prop. A new `import` in a component that has a <style> block shifts the order of the
//    page's <link rel="stylesheet"> tags.
// 2. Spread a binding ({...b('heading')}) only onto an element that has a class attribute. Astro gives any other
//    element with a spread its scoping class; there write the attributes one by one:
//    <time data-ms-field={b.field('date')} data-ms-kind={b.kind()} data-ms-format={b.format('date')}>
//
//   planning module:   const binders = sections.map((_, i) => sectionBinder(i));
//   section component: const { section, b } = Astro.props;
//                      <h2 class="title" {...b('heading')} set:html={section.heading} />
//                      <ul class="items" {...b('items', 'list')}>…<li class="item" {...b(`items.${i}.title`)}>…</ul>

/** @typedef {'text' | 'rich' | 'image' | 'link' | 'list'} BindKind */
/** @typedef {{ 'data-ms-field'?: string, 'data-ms-kind'?: BindKind }} Binding */

export const KINDS = Object.freeze(['text', 'rich', 'image', 'link', 'list']);

/** True when the page is built for the editor. */
export function editing() {
  return globalThis.process?.env?.MARKSTAGE_EDITOR === '1';
}

/**
 * The binding attributes for one field (none outside editor mode, or without a path).
 * @param {string | false | null | undefined} path
 * @param {BindKind} [kind]
 * @returns {Binding}
 */
export function bind(path, kind = 'text') {
  // a new object each time: Astro may add to the attributes it is given
  if (!path || !editing()) return {};
  if (!KINDS.includes(kind)) throw new Error(`markstage bind: unknown kind "${kind}" for ${path}`);
  return { 'data-ms-field': path, 'data-ms-kind': kind };
}

/** Joins path parts, skipping empty ones: fieldPath('sections.2.value', 'items', 0, 'title'). */
export function fieldPath(...parts) {
  return parts.filter((p) => p !== undefined && p !== null && p !== '').join('.');
}

/**
 * Bindings under one base path (a section's value): b('heading'), b('lead', 'rich'), b.path('items', 2).
 * @param {string} base
 */
export function binder(base) {
  /** @param {string | number} sub @param {BindKind} [kind] */
  const b = (sub, kind = 'text') => bind(fieldPath(base, sub), kind);
  /** editor mode (when the binder was made) */
  b.on = editing();
  /** @param {...(string | number | undefined)} parts */
  b.path = (...parts) => fieldPath(base, ...parts);
  // the attributes one by one, for an element without a class attribute (see 2. above)
  /** @param {string | number} sub */
  b.field = (sub) => (editing() ? fieldPath(base, sub) : undefined);
  /** @param {BindKind} [kind] */
  b.kind = (kind = 'text') => (editing() ? kind : undefined);
  /** @param {string} format data-ms-format for an element that shows the value reformatted */
  b.format = (format) => (editing() ? format : undefined);
  return b;
}

/** Marks a page section's outer element with its index (the editor's section outline). */
export function bindSection(index) {
  return editing() && Number.isInteger(index) ? { 'data-ms-section': String(index) } : {};
}

/** The binder for page section `index` (its fields live under sections.<index>.value). */
export const sectionBinder = (index) => binder(`sections.${index}.value`);
