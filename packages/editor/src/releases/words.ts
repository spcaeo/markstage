// The Releases screens' words, with no DOM: a release's status, its preview, an item's kind, when it goes live, and
// whether it can be published now. Kept apart so test/releases.test.ts checks them.
import type { Release, ReleaseItem, ReleasePreview, ReleaseStatus, ShareLink } from './api';
import { fmtDateTime } from '../dates';

export const STATUS_WORDS: Record<ReleaseStatus, string> = {
  open: 'Open',
  scheduled: 'Scheduled',
  publishing: 'Going live',
  published: 'Live',
  'rolled-back': 'Rolled back',
  cancelled: 'Cancelled',
};

/** The statuses a release can still change in (items added, scheduled, published). */
export const OPEN: ReleaseStatus[] = ['open', 'scheduled'];
export const isOpen = (r: Pick<Release, 'status'>) => OPEN.includes(r.status);

export const KIND_WORDS: Record<ReleaseItem['kind'], string> = { entry: 'Page', library: 'Library item', media: 'Picture' };
export const LINK_WORDS: Record<ShareLink['state'], string> = { active: 'Working', expired: 'Expired', revoked: 'Turned off' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "a, b and c". */
const and = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** "3 pages, 1 Library item and 2 pictures", or "Nothing yet". */
export function countWords(c: Release['counts']): string {
  const parts = [c.entries && plural(c.entries, 'page'), c.library && plural(c.library, 'Library item'), c.media && plural(c.media, 'picture')].filter((x): x is string => !!x);
  return parts.length ? and(parts) : 'Nothing yet';
}

/** A date and time people read: "2 Nov 2026, 09:00". */
export function at(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? fmtDateTime(t) : '';
}

/** Where a release stands in one line, for the list and the page's head. */
export function whenWords(r: Pick<Release, 'status' | 'publishAt' | 'publishedAt' | 'blocked'>): string {
  if (r.status === 'scheduled') return r.blocked ? `Was due ${at(r.publishAt)}: blocked` : `Goes live ${at(r.publishAt)}`;
  if (r.status === 'published') return `Live since ${at(r.publishedAt)}`;
  if (r.status === 'publishing') return 'Going live now';
  return '';
}

/** The preview in words, and what can be done about it. */
export function previewWords(p: ReleasePreview | undefined, scheduled: boolean): { tone: 'ok' | 'bad' | 'warn' | ''; text: string; build: string | null } {
  if (!p || p.status === 'none') return { tone: '', text: 'No preview yet. It is the site built as if this release were live: build it to look, or to share it.', build: 'Build the preview' };
  if (p.status === 'building') return { tone: '', text: `Building the preview${scheduled ? ', as of the time it goes live' : ''}…`, build: null };
  if (p.status === 'failed') return { tone: 'bad', text: `The preview did not build${p.error ? `: ${p.error}` : '.'}`, build: 'Build it again' };
  if (!p.fresh) return { tone: 'warn', text: p.words ?? 'This preview is out of date: build it again.', build: 'Build it again' };
  return { tone: 'ok', text: `Up to date: what would go live now${p.buildTime ? `, built as of ${at(p.buildTime)}` : ''}.`, build: null };
}

/** Approvals that count: the ones given for exactly what the release holds now. */
export const currentApprovals = (r: Pick<Release, 'approvals' | 'key'>) => r.approvals.filter((a) => a.sha === r.key);

/** Items that stop a publish: a file changed on the site since it was added. */
export const changedItems = (r: Pick<Release, 'items'>) => (r.items ?? []).filter((i) => i.changedSince);

/**
 * Can the person publish it now, with the reason they typed? The server asks the rules again either way. Returns
 * why not in words, or what Publish does.
 */
export function publishable(r: Pick<Release, 'status' | 'decision' | 'counts' | 'items'>, reason: string): { ok: boolean; why: string } {
  if (!isOpen(r)) return { ok: false, why: `The release is ${STATUS_WORDS[r.status].toLowerCase()}.` };
  if (!r.counts.items) return { ok: false, why: 'Put something in it first: open a page, then More → Add to a release.' };
  const changed = changedItems(r);
  if (changed.length) return { ok: false, why: `${and(changed.map((i) => `“${i.title}”`))} changed on the site since ${changed.length === 1 ? 'it was' : 'they were'} added. Add ${changed.length === 1 ? 'it' : 'them'} again to take the latest.` };
  const d = r.decision;
  if (!d) return { ok: false, why: 'The rules have not answered yet.' };
  if (d.effect === 'allow') return { ok: true, why: 'Everything in it goes live in one commit, then the site is built and checked. If a step fails, the live site stays as it is.' };
  if (d.effect === 'needs') {
    const left = d.missing.filter((m) => !(m.kind === 'reason' && reason.trim()));
    if (!left.length) return { ok: true, why: 'Everything in it goes live in one commit, then the site is built and checked. If a step fails, the live site stays as it is.' };
    return { ok: false, why: `Still needs ${and(left.map((m) => m.words))}.` };
  }
  return { ok: false, why: d.words };
}

/** A datetime-local value ("2026-11-02T09:00") as an ISO time, or '' when it is not one. */
export function fromLocal(v: string): string {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/** An ISO time as a datetime-local value in this browser's time zone. */
export function toLocal(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
