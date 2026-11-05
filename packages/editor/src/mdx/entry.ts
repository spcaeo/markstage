// An MDX entry as it opens (docs/MDX.md). One the MDX reader cannot read comes without a document (`unreadable`):
// it opens read-only in Source mode, with the reader's words, so nothing can be saved over it.
import type { Entry } from '../api';

/**
 * For an entry the reader could not read: gives it an empty document to hold (it is never saved: the entry is
 * read-only) and returns the message to show; null for any other entry.
 */
export function mdxUnreadable(e: Entry): string | null {
  if (!e.unreadable) return null;
  e.doc = { type: 'doc', content: [{ type: 'paragraph' }] };
  const where = e.unreadable.line ? ` (line ${e.unreadable.line})` : '';
  return `This MDX file cannot be shown on the canvas${where}, so it is open read-only in Source mode. ${e.unreadable.message.replace(/^Line \d+: /, '')} A developer can fix it in the file.`;
}
