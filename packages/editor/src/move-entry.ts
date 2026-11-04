// Moving an entry to a new address (the slug field in Post settings, with the Markstage server): POST
// collections/:c/entries/:id/move. The file is renamed, the site's links to it follow and the old address redirects
// (docs/API.md "Move"); a live entry is published at once (a job, shown on #/jobs/<id>).
import { ApiError, request, type Entry } from './api';

export interface Moved {
  id: string;
  version: string;
  url: string | null;
  oldUrl: string | null;
  linksUpdated: { collection: string; id: string }[];
  redirects: { from: string; to: string }[];
  commit: string | null;
  job: string | null;
}

/**
 * Moves `e` so its address ends in `slug`. When the slug was the file name the file takes the new name (and the
 * slug follows); when they differed only the slug changes (newSlug).
 */
export function moveEntry(e: Entry, slugKey: string, slug: string): Promise<Moved> {
  const old = e.frontmatter?.[slugKey];
  const body = old === undefined || old === e.id ? { version: e.version, newId: slug } : { version: e.version, newId: e.id, newSlug: slug };
  return request<Moved>(`collections/${encodeURIComponent(e.collection)}/entries/${encodeURIComponent(e.id)}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** What happened, in a line for the toast. */
export function movedNote(m: Moved): string {
  const n = m.linksUpdated.length;
  const links = n ? ` ${n} ${n === 1 ? 'page that links' : 'pages that link'} to it now ${n === 1 ? 'uses' : 'use'} the new address.` : '';
  const redirect = m.redirects.length ? ' The old address redirects.' : '';
  return `Moved to ${m.url ?? m.id}.${links}${redirect}${m.job ? ' Publishing now.' : ''}`;
}

/** A failed move, in plain words (nothing moved). */
export function moveError(err: unknown): string {
  if (!(err instanceof ApiError)) return (err as Error).message;
  if (err.code === 'id-taken') return 'Another entry already has this address. Pick another one.';
  if (err.status === 409) return 'The file changed since it was opened. Reload it, then try again.';
  if (err.status === 403) return 'This page is live, and moving it publishes it: ask someone who can publish.';
  if (err.code === 'redirects-failed') return `The site could not record the redirect, so nothing moved. ${err.message}`;
  if (err.status === 422 && err.fields) return Object.values(err.fields).join(' ');
  return err.message;
}
