// The page shell's markup helpers (page.ts): what of the site's page may be drawn in the editor, and how the
// editor's own head elements get the page's component scope.

/** `'post post--rich'` -> `.post.post--rich` */
export const classSelector = (classes: string) =>
  classes
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => `.${CSS.escape(c)}`)
    .join('');

// SVG's set and animate* elements can write an attribute after the page is drawn (`<set attributeName=href
// to="javascript:…">`): dropped with the scripts. SVG names are matched as written (case-sensitive).
const DROP = 'script, noscript, iframe, object, embed, frame, frameset, base, meta, link, style, template, astro-dev-toolbar, set, animate, animateMotion, animateTransform';
// a drawn block never needs a control: a form in it could only imitate the editor's own (a fake "sign in again" box)
const DROP_CONTROLS = 'form, input, button, textarea, select, option, label, dialog';
const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'background', 'cite', 'ping'];
// an image's own data: address (an inline placeholder) is an image, never a page
const MEDIA_ATTRS = ['src', 'poster'];

/**
 * A URL attribute the editor may keep: a relative address, a #fragment, or http(s), mailto or tel; for an image's
 * source also a data:image address. Read as a browser reads it: ASCII whitespace and control characters taken out
 * first (`java&#9;script:`, `&#1;javascript:`, a newline in a formaction all mean javascript: to a browser).
 */
export function safeUrl(name: string, value: string): boolean {
  const v = value.replace(/[\u0000-\u0020\u007f]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v)?.[1].toLowerCase();
  if (!scheme) return true;
  if (scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel') return true;
  return scheme === 'data' && MEDIA_ATTRS.includes(name) && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(v);
}

/**
 * The page as the editor may draw it: no scripts or frames, no event handlers, no address but the web's (safeUrl:
 * never javascript:, however it is spelled), no SVG animation that could write one later, nothing
 * that takes the focus on its own. The editor never runs the page's code (it is the site's, in the CMS's origin).
 * `controls: false` (a raw HTML block of an entry) also drops forms and form controls, and every `id` and `name`,
 * so the block cannot shadow a global the editor reads (DOM clobbering), and keeps it in its box (`contain`).
 */
export function sanitize(root: Element | DocumentFragment, { controls = true, inline = false }: { controls?: boolean; inline?: boolean } = {}): void {
  for (const el of root.querySelectorAll(controls ? DROP : `${DROP}, ${DROP_CONTROLS}`)) el.remove();
  for (const el of root.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'autofocus' || (!controls && (n === 'id' || n === 'name')) || (URL_ATTRS.includes(n) && !safeUrl(n, a.value))) el.removeAttribute(a.name);
      else if (!controls && n === 'style') contain(el as HTMLElement, inline);
    }
  }
}

/**
 * A raw HTML element's own style kept to its box (security review 3 Nov 2026, S6): no fixed or sticky position (a
 * block could cover the editor with a fake screen), no z-index past ±10, and inside a line no absolute position
 * either (a line has no box to keep it in; a block's box clips it: .ms-raw `contain: paint`).
 */
function contain(el: HTMLElement, inline: boolean): void {
  const s = el.style;
  if (!s) return;
  if (/^(fixed|sticky)$/i.test(s.position) || (inline && /^absolute$/i.test(s.position))) s.removeProperty('position');
  const z = Number.parseInt(s.zIndex, 10);
  if (Number.isFinite(z) && Math.abs(z) > 10) s.removeProperty('z-index');
  if (!s.cssText.trim()) el.removeAttribute('style');
}

/** Links in drawn raw HTML never take the editor anywhere: a click, a middle click or Enter on one does nothing. */
export function holdLinks(root: HTMLElement): void {
  const stop = (e: Event) => {
    if ((e.target as Element | null)?.closest?.('a, area')) e.preventDefault();
  };
  root.addEventListener('click', stop);
  root.addEventListener('auxclick', stop);
}

/**
 * Raw HTML (an entry's block kept as written) as the editor may draw it: parsed in a detached template (nothing
 * runs or loads while it is parsed), cleaned with `sanitize` (controls dropped too), then handed over as a fragment.
 */
export function cleanHtml(html: string, doc: Document = document, { inline = false }: { inline?: boolean } = {}): DocumentFragment {
  const t = doc.createElement('template');
  t.innerHTML = html;
  sanitize(t.content, { controls: false, inline });
  return t.content;
}

/** A framework's scope class (Svelte's svelte-1abc, old Astro's astro-ABCD). */
const SCOPE_CLASS = /^(svelte|astro)-[A-Za-z0-9]+$/;

/**
 * The editor's own elements in `slot` that stand for `page` (or a part of it) get its scope: the attributes the
 * framework adds with no value (data-astro-cid-x, data-v-x) and its scope classes. An element of the slot stands for
 * the page element that has one of its classes (or is `standsFor`, for `page` itself).
 */
export function adoptScope(page: Element, slot: Element, standsFor: Element | null = null): void {
  const byClass = new Map<string, Element>();
  for (const el of [page, ...page.querySelectorAll('[class]')]) for (const c of el.classList) if (!byClass.has(c)) byClass.set(c, el);
  const copy = (src: Element, el: Element) => {
    for (const a of src.attributes) if (a.value === '' && a.name.startsWith('data-') && !el.hasAttribute(a.name)) el.setAttribute(a.name, '');
    for (const c of src.classList) if (SCOPE_CLASS.test(c)) el.classList.add(c);
  };
  // `standsFor`: the slot's element that stands for `page` itself (the title for the page's own heading)
  if (standsFor) copy(page, standsFor);
  for (const el of slot.querySelectorAll('[class]')) {
    const src = [...el.classList].map((c) => byClass.get(c)).find(Boolean);
    if (src) copy(src, el);
  }
}
