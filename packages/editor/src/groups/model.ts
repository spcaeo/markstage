// The Groups screen's arithmetic (screen.ts), kept apart so it can be tested: a group's entries in the order its page
// shows them (core's hubOrder on the site: the ids its `order` lists first, in that order, then the rest newest
// first), and the order a move leaves behind.

export interface Member {
  id: string;
  title: string;
  url: string | null;
  status?: string;
  date?: string | null;
  version: string;
}

/** The members as the group's page shows them, and how many of them keep a place of their own (the rest follow by date). */
export function arrange<T extends Member>(members: T[], order: readonly string[]): { list: T[]; pinned: number } {
  const byId = new Map(members.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const first: T[] = [];
  for (const id of order) {
    const m = byId.get(id);
    if (m && !seen.has(id)) first.push(m), seen.add(id);
  }
  const rest = members.filter((m) => !seen.has(m.id)).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.title.localeCompare(b.title));
  return { list: [...first, ...rest], pinned: first.length };
}

/**
 * The order after a move: everything down to the lowest item that had a place of its own or was just moved keeps
 * the place it has now (what the writer sees above it stays put); below that, newest first as before.
 */
export function orderAfterMove(after: readonly string[], pinnedBefore: readonly string[], moved: readonly string[]): string[] {
  const keep = new Set([...pinnedBefore, ...moved]);
  let last = -1;
  after.forEach((id, i) => keep.has(id) && (last = i));
  return after.slice(0, last + 1);
}

/** The order without one entry: it goes back among the rest, newest first. */
export const withoutOne = (order: readonly string[], id: string) => order.filter((x) => x !== id);

/** Whether two orders are the same list. */
export const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The line above the list: how many keep a place of their own, and what the rest do. */
export function placeWords(count: number, pinned: number, things: string, group: string): string {
  if (!count) return `No ${things} in this ${group} yet.`;
  if (!pinned) return 'None has a place of its own yet: they follow, newest first.';
  if (pinned >= count) return pinned === 1 ? 'It keeps its place on the page.' : `All ${count} keep these places on the page.`;
  return `${pinned === 1 ? 'The first keeps its place' : `The first ${pinned} keep these places`} on the page; the rest follow, newest first.`;
}
