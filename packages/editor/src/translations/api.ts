// The server's translation status (docs/API-TRANSLATIONS.md): per entry and tracked locale, whether its title and
// description are missing, outdated (the source changed after them) or done, read from git.
import { request } from '../api';

export type TStatus = 'missing' | 'outdated' | 'done';
export type StatusFilter = 'needs' | TStatus | 'all';
export type Sort = 'changed' | 'title';

export interface TField {
  status: TStatus;
  source: string;
  value: string;
  sourceChangedAt: string | null;
  translatedAt: string | null;
}

export interface TLocale {
  code: string;
  label: string;
  /** the same language as the default locale: an empty field means "the source text" */
  sameLanguage?: boolean;
}

export interface TItem {
  collection: string;
  id: string;
  title: string;
  url: string | null;
  entryStatus: string;
  locale: string;
  status: TStatus;
  fields: { title?: TField; description?: TField };
  sourceChangedAt: string | null;
  translatedAt: string | null;
  /** this person's save would be allowed (absent: the entry decides when it is opened) */
  can?: { edit: boolean };
}

export interface TList {
  locales: TLocale[];
  counts: Record<string, Record<TStatus, number>>;
  items: TItem[];
  total: number;
  page: number;
  perPage: number;
}

export interface TQuery {
  locale: string;
  status: StatusFilter;
  collection: string;
  q: string;
  sort: Sort;
  page: number;
}

export const PER_PAGE = 50;

export function translations(q: TQuery): Promise<TList> {
  const p = new URLSearchParams();
  if (q.locale) p.set('locale', q.locale);
  if (q.status !== 'needs') p.set('status', q.status);
  if (q.collection) p.set('collection', q.collection);
  if (q.q) p.set('q', q.q);
  if (q.sort !== 'changed') p.set('sort', q.sort);
  if (q.page > 1) p.set('page', String(q.page));
  p.set('perPage', String(PER_PAGE));
  return request<TList>(`translations?${p}`);
}
