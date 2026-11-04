// A robots directive list (e.g. seo.robots: ["index", "follow", "max-snippet:-1"]) as one switch, "Show in search
// engines", for the Page settings drawer; the other directives stay as the file has them.
/** True when a robots list lets search engines index the page (no "noindex", no "none"). */
export const indexable = (list: unknown): boolean => !(Array.isArray(list) ? list : []).some((d) => /^(noindex|none)$/i.test(String(d).trim()));

/** The robots list with indexing on or off: "index" and "noindex" swap in place and every other directive stays as
 *  it is ("none" becomes "nofollow" plus the new one); null when the list is already that way. */
export function withIndex(list: unknown, on: boolean): string[] | null {
  const was = (Array.isArray(list) ? list : []).map(String);
  if (indexable(was) === on) return null;
  const out: string[] = [];
  let placed = false;
  for (const d of was) {
    const k = d.trim().toLowerCase();
    if (k === 'index' || k === 'noindex') {
      if (!placed) out.push(on ? 'index' : 'noindex');
      placed = true;
    } else if (k === 'none') {
      out.push('nofollow');
      if (!placed) out.push(on ? 'index' : 'noindex');
      placed = true;
    } else out.push(d);
  }
  if (!placed) out.unshift(on ? 'index' : 'noindex');
  return out;
}
