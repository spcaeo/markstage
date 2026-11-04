// The address name a title gives, as the server makes it (content/entries.mjs slugify): lowercase a-z and digits
// with hyphens; accents are folded (é → e). A title with none of those (Arabic, emoji…) gives '' and the entry is
// named by the day instead ("post-2026-11-02"), never a silent "untitled" (QA pass 2, N4): the New sheet says so.
export const slugOf = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The name the server gives an entry whose title has no letters a-z or digits: "post-<today>" (a page: "page-"). */
export const datedSlug = (kind: 'post' | 'page', now = new Date()): string => `${kind}-${now.toISOString().slice(0, 10)}`;
