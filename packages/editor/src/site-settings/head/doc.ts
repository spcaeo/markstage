// The head kit's settings as the editor holds them (docs/HEAD-KIT.md "The settings screens and API"): the server's
// GET / PUT head, the settings one part draws, and the save that every part shares (Undo, a stale version, the
// server's plain-word refusals). Search & AI and Tracking each change their own keys and keep every other key of the
// file as it was, so one part never undoes the other.
import { request } from '../../api';
import type { ScreenCtx } from '../../host';
import { type Tracker, isStale } from './check';

export interface FeedRow {
  id: string;
  title: string;
  description: string;
  path: string;
  collections: string[];
  limit: number;
}
export type Raw = Record<string, unknown>;
export interface HeadDoc {
  enabled: boolean;
  canEdit: boolean;
  file?: string;
  version?: string | null;
  /** the file's own JSON, or null while there is none */
  settings?: Raw | null;
  /** the settings with every default filled in */
  head?: {
    markdown: { pages: boolean; okf: boolean; llms: boolean; skip: string[] };
    feeds: FeedRow[];
    tracking: Record<string, string>;
  };
  issues?: { path: string; message: string }[];
  collections?: { id: string; label: string }[];
  trackers?: Tracker[];
  gtmLoads?: string[];
}

export const loadHead = () => request<HeadDoc>('head');

interface Saved {
  ok: boolean;
  version: string | null;
  commit: string | null;
  job: string | null;
}

/**
 * Save `settings` over `doc` (its version is the one this page was loaded with). The toast has Undo, which puts the
 * file back as it was. Returns the new version, or throws the server's refusal.
 */
export async function saveHead(doc: HeadDoc, settings: Raw, ctx: ScreenCtx, said: string, onUndone: () => void): Promise<string | null> {
  const before = doc.settings ?? {};
  const r = await request<Saved>('head', { method: 'PUT', body: JSON.stringify({ version: doc.version ?? null, settings }) });
  const done = r.version ?? doc.version ?? null;
  ctx.toast(said, 'ok', {
    action: {
      label: 'Undo',
      run: () =>
        void request<Saved>('head', { method: 'PUT', body: JSON.stringify({ version: done, settings: before }) }).then(
          () => (ctx.toast('Undone: the settings are as they were.', 'ok'), onUndone()),
          (err) => ctx.toast(isStale(err) ? 'Someone else changed these settings; reload to see theirs.' : `Not undone: ${(err as Error).message}`, 'error'),
        ),
    },
  });
  return done;
}
