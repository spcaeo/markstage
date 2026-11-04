// Page frames and types in the editor (docs/API-PAGE-TYPES.md): the site's choices for a collection, an entry's type
// and frame (its own, its type's, its collection's), the lock rules that hold on the open page (the site's, with
// those of its type, saved and pending: as the server holds a save to both), and the type's checks of a saved entry.
import { request } from './api';
import { config, type FrameInfo, type PageTypeInfo, type SiteLock } from './runtime';

type Rules = { pages: Record<string, SiteLock>; articles: Record<string, SiteLock> };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** "a money page", "an article". */
export const aLabel = (label: string) => `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label.toLowerCase()}`;

/** The value at a dotted key. */
export const valueAt = (data: unknown, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), data);

export const framesConfig = () => config().frames ?? null;
export const typeKey = () => config().pageTypes?.key ?? 'pageType';
export const frameKey = () => config().frames?.key ?? 'frame';

/** The page types an entry of this collection may have. */
export const typesFor = (collection: string): PageTypeInfo[] => (config().pageTypes?.types ?? []).filter((t) => t.collections.includes(collection));

/** True when the collection's entries have a frame or a page type to choose (the Page box shows). */
export const hasPageBox = (collection: string) => !!framesConfig() || typesFor(collection).length > 0;

/** The type an entry has (its key's value, when a type of its collection). */
export const typeOf = (collection: string, id: unknown): PageTypeInfo | null => typesFor(collection).find((t) => t.id === id) ?? null;

/** The frame an entry has without a choice of its own: its type's, else its collection's. */
export function inheritedFrame(collection: string, type: PageTypeInfo | null): { frame: FrameInfo; from: 'type' | 'collection' } | null {
  const fr = framesConfig();
  if (!fr?.list.length) return null;
  const find = (id: string | null | undefined) => fr.list.find((f) => f.id === id);
  const own = type?.frame ? find(type.frame) : undefined;
  if (own) return { frame: own, from: 'type' };
  return { frame: find(fr.defaults[collection]) ?? fr.list[0], from: 'collection' };
}

/** The open entry, by who keeps it ('post': Post settings, 'page': the pages editor): its collection and its type ids now (saved and pending). */
type Open = { collection: string; types: () => unknown[] };
const open = new Map<'post' | 'page', Open>();
export const setOpenPage = (by: 'post' | 'page', o: Open | null) => void (o ? open.set(by, o) : open.delete(by));

/** The lock rules on the open entry: the site's, with those of its type(s) added. */
export function lockRules(): Rules {
  const base: Rules = config().locks ?? { pages: {}, articles: {} };
  const types = [...open.values()].flatMap((o) => {
    const ids = o.types();
    return typesFor(o.collection).filter((t) => ids.includes(t.id));
  });
  if (!types.length) return base;
  const out: Rules = { pages: { ...base.pages }, articles: { ...base.articles } };
  for (const t of types) {
    for (const part of ['pages', 'articles'] as const) {
      for (const [kind, l] of Object.entries(t.locks?.[part] ?? {})) {
        const was = out[part][kind] ?? {};
        out[part][kind] = { ...(was.move || l.move ? { move: true } : {}), ...(was.remove || l.remove ? { remove: true } : {}), ...(was.edit || l.edit ? { edit: true } : {}) };
      }
    }
  }
  return out;
}

export interface PageCheck {
  id: string;
  label: string;
  level: 'warn' | 'block';
  ok: boolean;
  /** what to do, when not ok */
  message?: string;
}
export interface PageChecks {
  type: { id: string; label: string } | null;
  frame: (FrameInfo & { from: 'page' | 'type' | 'collection' }) | null;
  checks: PageCheck[];
}

/** The saved entry's type, frame and its type's checks (the server, or astro dev). */
export const pageChecks = (collection: string, id: string) => request<PageChecks>(`collections/${encodeURIComponent(collection)}/entries/${encodeURIComponent(id)}/page-checks`);
