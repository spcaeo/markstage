// The shell's shared light index (api.ts siteIndex): one request for every entry's title, address and status,
// taken by whoever needs it first (the palette when it opens, Home's Recent, the link tools when an entry opens),
// never at boot; and the drawer's counts, which come from `collections` (cheap) after a change.
import { forgetIndex, request, siteIndex, type EntrySummary } from './api';
import type { EntryPalette } from './palette';
import type { ClientConfig } from './runtime';
import type { SitePages } from './site-pages';
import type { LinkTarget } from './toolbar';

export function shellIndex(cfg: ClientConfig, d: { palette: EntryPalette; pages: SitePages; setLinkTargets: (t: LinkTarget[]) => void; setCount: (key: string, n: number) => void }) {
  /** The light index into the palette and the link targets: one request, shared by all who need it. */
  async function takeIndex(): Promise<EntrySummary[]> {
    const all = await siteIndex();
    d.palette.setEntries(all);
    d.pages.take(cfg, all);
    d.setLinkTargets(d.pages.targets);
    return all;
  }

  /** After a change (a save, a trash, an import): the drawer's counts, and the index again where it was in use. */
  async function refreshList(): Promise<void> {
    forgetIndex();
    const cols = await request<{ id: string; counts: { all: number } }[]>('collections');
    for (const c of cols) d.setCount(`entries:${c.id}`, c.counts.all);
    if (d.palette.entries.length || d.pages.known) await takeIndex();
  }

  return { takeIndex, refreshList };
}
