// The site import's routes (docs/API-IMPORT.md "A whole site"), typed, through the shell's request().
import { request } from '../../api';

export type Product = 'wordpress' | 'ghost' | 'prismic';
export type Action = 'create' | 'update' | 'unchanged' | 'skip' | 'fetch' | 'reuse' | 'existing';
export type Collision = 'both' | 'skip' | 'replace';

export interface RunInfo {
  id: string;
  kind: 'site' | 'json';
  product?: Product;
  source: string;
  status: 'planned' | 'running' | 'done' | 'failed' | 'expired' | 'replaced';
  createdAt: string;
  expiresAt: string;
  by: { id: string; name: string } | null;
  job: string | null;
  finishedAt: string | null;
}

export interface PlanItem {
  sourceId: string;
  type: string;
  title: string;
  sourceStatus: string;
  collection: string;
  id: string | null;
  url: string | null;
  action: Action;
  problem?: string;
  collision?: Collision;
  notes: number;
}

export interface PlanMedia {
  sourceId: string;
  url: string;
  action: Action;
  path?: string;
  problem?: string;
  alt: boolean;
}

export interface ReviewItem {
  kind: string;
  text: string;
  /** in a plan the item's source id; after a run where it went */
  entry?: string | { sourceId: string; collection: string; id: string | null; title: string };
  media?: string | { sourceId: string; id: string | null };
}

export interface FieldKeys {
  [role: string]: string | null;
}

export interface Mapping {
  types: Record<string, string | null>;
  fields: Record<string, FieldKeys>;
  onCollision: Collision;
  drafts: 'skip' | 'include';
  media: 'used' | 'all';
}

export interface Counts {
  types: Record<string, number>;
  entries: Partial<Record<Action, number>>;
  media: Partial<Record<Action, number>>;
  authors: Partial<Record<Action, number>>;
  redirects: number;
  ids: number;
  collisions: number;
  needsAlt: number;
  notConverted: number;
  embeds: number;
  published: number;
  left: Record<string, number>;
  unusedMedia: number;
  other: Record<string, number>;
}

export interface SitePlan {
  kind: 'site';
  product: Product;
  from: 'file' | 'api';
  name: string;
  site: { url: string | null; title: string | null };
  source: string;
  mapping: Mapping;
  collections: { id: string; label: string; format: 'md' | 'json'; hasStatus: boolean; defaults: FieldKeys }[];
  counts: Counts;
  items: PlanItem[];
  media: PlanMedia[];
  authors: { sourceId: string; slug: string | null; name: string; action: Action }[];
  redirects: { from: string; to: string }[];
  review: ReviewItem[];
  hook: boolean;
  idsFile: string;
  placeholder: string;
}

export interface SiteResult {
  commits: string[];
  entries: (PlanItem & { kept?: number })[];
  media: { sourceId: string; url: string; action: Action; id?: string; path?: string; alt?: boolean; problem?: string }[];
  authors: SitePlan['authors'];
  redirects: { paths: number; ids: number; hook: boolean; file: string | null; commit: string | null } | null;
  review: ReviewItem[];
  counts: { entries: Partial<Record<Action, number>>; media: Partial<Record<Action, number>>; authors: Partial<Record<Action, number>>; review: Record<string, number>; redirects: number; ids: number; commits: number };
}

export interface RunState {
  run: RunInfo;
  plan: SitePlan;
  result: SiteResult | null;
}

/** An export file: {run, plan}. */
export function planFile(product: Product, file: File, extra: { siteUrl?: string; mapping?: Partial<Mapping> } = {}): Promise<{ run: RunInfo; plan: SitePlan }> {
  const body = new FormData();
  body.append('source', product);
  if (extra.siteUrl) body.append('siteUrl', extra.siteUrl);
  if (extra.mapping) body.append('mapping', JSON.stringify(extra.mapping));
  body.append('file', file, file.name);
  return request('import/site', { method: 'POST', body });
}

/** An API's details (the password, key or token is used for this one read, and kept nowhere). */
export const planApi = (body: Record<string, unknown>) => request<{ run: RunInfo; plan: SitePlan }>('import/site', { method: 'POST', body: JSON.stringify(body) });
export const replan = (rid: string, mapping: Partial<Mapping>) => request<{ run: RunInfo; plan: SitePlan }>(`import/${encodeURIComponent(rid)}/replan`, { method: 'POST', body: JSON.stringify({ mapping }) });
export const runImport = (rid: string) => request<{ run: RunInfo; job: { id: string } }>(`import/${encodeURIComponent(rid)}/run`, { method: 'POST', body: '{}' });
export const getRun = (rid: string) => request<RunState>(`import/${encodeURIComponent(rid)}`);
export const listRuns = () => request<{ items: RunInfo[] }>('import');
