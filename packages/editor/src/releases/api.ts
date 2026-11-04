// The Releases and share links routes (docs/API-RELEASES.md): a named set of changes that go live together, its
// preview built as if it were published, and links that show that preview (or one draft) to people without an
// account. Typed calls through the shell's request() (CSRF token, ApiError, the 401 hand-off).
import { apiPath, request } from '../api';
import type { BuildBlocked } from '../admin/api';

export type ReleaseStatus = 'open' | 'scheduled' | 'publishing' | 'published' | 'rolled-back' | 'cancelled';
export const STATUSES: ReleaseStatus[] = ['open', 'scheduled', 'publishing', 'published', 'rolled-back', 'cancelled'];

export interface Person {
  id: string;
  name: string | null;
}

export interface Decision {
  effect: 'allow' | 'needs' | 'deny';
  rule: { id: string; name: string } | null;
  words: string;
  missing: { kind: string; words: string }[];
}

export interface ReleasePreview {
  status: 'none' | 'building' | 'ready' | 'failed';
  fresh: boolean;
  builtAt?: string | null;
  buildTime?: string | null;
  job?: string | null;
  error?: string | null;
  stale: 'site' | 'release' | 'both' | null;
  words: string | null;
}

export interface ReleaseItem {
  id: string;
  kind: 'entry' | 'library' | 'media';
  title: string;
  collection: string | null;
  entryId: string | null;
  libraryId: string | null;
  libraryKind?: string;
  path: string;
  url: string | null;
  bytes: number;
  type?: string;
  width?: number | null;
  height?: number | null;
  alt?: string;
  isNew: boolean;
  changedSince: boolean;
  alsoIn: { id: string; name: string }[];
  addedBy: Person;
  addedAt: string;
}

export interface Release {
  id: string;
  name: string;
  description: string;
  status: ReleaseStatus;
  version: string;
  publishAt: string | null;
  key: string;
  counts: { items: number; entries: number; library: number; media: number };
  items?: ReleaseItem[];
  approvals: { userId: string; name: string | null; role: string; sha: string; at: string }[];
  /** whether a rule would count this person's approval (only then may they approve) */
  canApprove?: boolean;
  checks: { done: boolean; passed?: string[]; failed?: string[]; results?: { entry: string; id: string; label: string; blocking: boolean; ok: boolean }[] } | null;
  createdBy: Person;
  createdAt: string;
  updatedAt: string;
  scheduledBy: Person | null;
  publishedAt: string | null;
  publishedBy: Person | null;
  buildTime: string | null;
  commit: string | null;
  revert: string | null;
  job: string | null;
  error: string | null;
  blocked: { words: string; rule: { id: string; name: string } | null; code: string; at: string } | null;
  preview?: ReleasePreview;
  decision?: Decision | null;
  links?: number;
}

export interface ShareLink {
  id: string;
  release: string | null;
  collection: string | null;
  entryId: string | null;
  label: string;
  state: 'active' | 'expired' | 'revoked';
  createdBy: Person;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: Person | null;
  views: number;
  lastViewAt: string | null;
}

/** What a share link shows: a release, or one draft. */
export type ShareTarget = { release: string } | { collection: string; id: string };

/** An entry for a release: its saved text, or the changes sent with it (the editor's unsaved ones). */
export type EntryContent = { source?: string; data?: Record<string, unknown> };

const json = (method: string, body: unknown = {}): RequestInit => ({ method, body: JSON.stringify(body) });
const enc = encodeURIComponent;
const r = (rid: string) => `releases/${enc(rid)}`;

export const list = (status = '') => request<{ releases: Release[]; buildBlocked?: BuildBlocked | null }>(`releases${status ? `?status=${enc(status)}` : ''}`);
export const get = (rid: string) => request<Release>(r(rid));
export const make = (body: { name: string; description?: string }) => request<Release>('releases', json('POST', body));
export const rename = (rid: string, body: { version: string; name?: string; description?: string }) => request<Release>(r(rid), json('PATCH', body));
export const cancel = (rid: string, version: string) => request<Release>(`${r(rid)}/cancel`, json('POST', { version }));
export const addEntry = (rid: string, body: { collection: string; id: string; version: string } & EntryContent) =>
  request<{ item: ReleaseItem; release: Release }>(`${r(rid)}/items`, json('POST', { kind: 'entry', ...body }));
export const addLibrary = (rid: string, body: { libraryId: string; version: string; item: Record<string, unknown> }) =>
  request<{ item: ReleaseItem; release: Release }>(`${r(rid)}/items`, json('POST', { kind: 'library', ...body }));
export const addPicture = (rid: string, file: File, alt: string) =>
  request<{ item: ReleaseItem; release: Release }>(`${r(rid)}/media?filename=${enc(file.name)}&alt=${enc(alt)}`, { method: 'POST', body: file });
export const itemText = (rid: string, iid: string) => request<{ path: string; text: string | null; current: string | null; version: string | null }>(`${r(rid)}/items/${enc(iid)}`);
/** A picture's address (a plain <img>: the browser sends the session cookie). */
export const itemFile = (rid: string, iid: string) => apiPath(`${r(rid)}/items/${enc(iid)}/file`);
export const removeItem = (rid: string, iid: string) => request<{ release: Release }>(`${r(rid)}/items/${enc(iid)}`, json('DELETE'));
export const buildPreview = (rid: string) => request<{ job: string | null; preview: ReleasePreview }>(`${r(rid)}/preview`, json('POST'));
export const approve = (rid: string, version: string) => request<Release>(`${r(rid)}/approve`, json('POST', { version }));
export const schedule = (rid: string, version: string, publishAt: string) => request<Release>(`${r(rid)}/schedule`, json('POST', { version, publishAt }));
export const unschedule = (rid: string, version: string) => request<Release>(`${r(rid)}/unschedule`, json('POST', { version }));
export const publish = (rid: string, version: string, reason?: string) => request<{ job: string; release: Release }>(`${r(rid)}/publish`, json('POST', { version, reason }));
export const rollback = (rid: string, reason?: string) => request<{ job: string; release: Release }>(`${r(rid)}/rollback`, json('POST', reason ? { reason } : {}));

export const links = (t: ShareTarget) =>
  request<{ links: ShareLink[]; on: boolean }>(`share-links?${'release' in t ? `release=${enc(t.release)}` : `collection=${enc(t.collection)}&id=${enc(t.id)}`}`);
export const makeLink = (t: ShareTarget, body: { days?: number; label?: string }) => request<{ link: ShareLink; url: string }>('share-links', json('POST', { ...t, ...body }));
export const revokeLink = (lid: string) => request<{ link: ShareLink }>(`share-links/${enc(lid)}`, json('DELETE'));
