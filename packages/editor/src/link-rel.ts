// A link's options in the link field (toolbar.ts): open in a new tab (target="_blank") and what it tells search
// engines (rel nofollow / sponsored / ugc). A new link with none of them stays a plain Markdown link; a link that
// had a target or rel keeps every word the field does not show (noopener, noreferrer, …) and their order, so a link
// whose options did not change is written as it was.

export interface LinkAttrs {
  target?: string | null;
  rel?: string | null;
}

export type Option = 'tab' | 'nofollow' | 'sponsored' | 'ugc';

export const OPTIONS: { id: Option; label: string; why: string }[] = [
  { id: 'tab', label: 'New tab', why: 'Opens in a new tab (target="_blank")' },
  { id: 'nofollow', label: 'Nofollow', why: 'Tells search engines not to follow this link or pass it credit (rel="nofollow")' },
  { id: 'sponsored', label: 'Sponsored', why: 'A paid or affiliate link (rel="sponsored")' },
  { id: 'ugc', label: 'User content', why: 'A link someone else wrote, as in a comment (rel="ugc")' },
];

const words = (rel: string | null | undefined) => (rel ?? '').split(/\s+/).filter(Boolean);

/**
 * The server's rule for a link (content/urls.mjs), checked in the link box at once (QA F11): http, https, mailto or
 * tel, or a relative address. Returns the words to show, or null when the link is fine.
 */
export function unsafeLink(href: string): string | null {
  const t = href.trim();
  if (!t) return null;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(t.replace(/^[\s\u0000-\u001f]+/, ''));
  if (!m || ['http', 'https', 'mailto', 'tel'].includes(m[1].toLowerCase())) return null;
  return `Links must start with http, https, mailto or tel, or be relative: ${t}`;
}

/** The options a link has now. */
export function optionsOf(a: LinkAttrs): Set<Option> {
  const on = new Set<Option>();
  if (a.target === '_blank') on.add('tab');
  for (const w of words(a.rel).map((x) => x.toLowerCase())) if (w === 'nofollow' || w === 'sponsored' || w === 'ugc') on.add(w);
  return on;
}

/** The target and rel for `picked`, from the link's attrs before (`a`): unchanged options keep the text as it was. */
export function withOptions(a: LinkAttrs, picked: Set<Option>): { target: string | null; rel: string | null } {
  const had = optionsOf(a);
  const target = picked.has('tab') ? (had.has('tab') ? a.target! : '_blank') : had.has('tab') ? null : (a.target ?? null);
  let rel = words(a.rel).filter((w) => {
    const k = w.toLowerCase() as Option;
    return !['nofollow', 'sponsored', 'ugc'].includes(k) || picked.has(k);
  });
  for (const o of ['nofollow', 'sponsored', 'ugc'] as const) if (picked.has(o) && !had.has(o)) rel = [...rel, o];
  // a new tab always with noopener (the owner's rule; QA F12): the new page cannot reach back to this one
  if (picked.has('tab') && !had.has('tab') && !rel.some((w) => w.toLowerCase() === 'noopener')) rel = [...rel, 'noopener'];
  const same = rel.join(' ') === words(a.rel).join(' ');
  return { target, rel: same ? (a.rel ?? null) : rel.length ? rel.join(' ') : null };
}

/** What the link card says about a link's options: "New tab", "nofollow", … */
export const optionChips = (a: LinkAttrs): string[] => OPTIONS.filter((o) => optionsOf(a).has(o.id)).map((o) => (o.id === 'tab' ? o.label : o.id));
