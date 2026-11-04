// The lists screen's pure parts (entries.ts, docs/EDITOR-UX.md section 4 "List"): the filter choices, the date
// filter's cut-off, the page range words, the language chips and the row's tooltip. No DOM, so test/entries-model
// .test.ts checks them.
import { LOCALE } from '../dates';

/** The status chips, in order: the param value and the word. */
export const STATUS_CHIPS: [string, string][] = [
  ['', 'All'],
  ['draft', 'Drafts'],
  ['scheduled', 'Scheduled'],
  ['published', 'Live'],
];

/** The date filter (param `date`): the last 7 or 30 days, or this year. */
export const DATE_CHOICES: [string, string][] = [
  ['', 'Any time'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['year', 'This year'],
];

/** The "Needs attention" choices (param `attention`), the server's names and the words people see. */
export const ATTENTION_CHOICES: [string, string][] = [
  ['', 'Needs attention'],
  ['no-description', 'No description'],
  ['no-title', 'No title'],
  ['alt-text', 'Images without alt text'],
  ['links', 'Broken links'],
  ['not-translated', 'Not translated'],
];

/** The filter keys a view holds besides the collection, sort and page. */
export const FILTER_KEYS = ['status', 'author', 'tag', 'group', 'date', 'attention', 'q'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** The moment a date choice starts at, as an ISO string for the server's `since`; null for "any time" or an unknown key. */
export function sinceOf(key: string, now = Date.now()): string | null {
  if (key === '7d' || key === '30d') return new Date(now - (key === '7d' ? 7 : 30) * 86_400_000).toISOString();
  if (key === 'year') return new Date(new Date(now).getFullYear(), 0, 1).toISOString();
  return null;
}

const NUM = new Intl.NumberFormat();

/** "1–50 of 121"; "" when there is nothing. */
export function pageRange(total: number, page: number, perPage: number): string {
  if (!total) return '';
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  return `${NUM.format(from)}–${NUM.format(to)} of ${NUM.format(total)}`;
}

/** How many pages a total makes (never fewer than one). */
export const pageCount = (total: number, perPage: number) => Math.max(1, Math.ceil(total / perPage));

/** A language chip's words: the code's language part in capitals and a tick or a dash ("FR ✓", "EN –"). */
export function langChip(l: { code: string; done: boolean }): { text: string; title: string; done: boolean } {
  const lang = l.code.split('-')[0]!.toUpperCase();
  return { text: `${lang} ${l.done ? '✓' : '–'}`, title: l.done ? `${l.code}: has its own words` : `${l.code}: not translated yet`, done: l.done };
}

/** The words a kind of content goes by: "page" or "post", with the New button's and the empty state's words. */
export function kindWords(word: string): { one: string; many: string; newLabel: string; first: string } {
  const one = word === 'Blog posts' ? 'post' : word === 'Pages' ? 'page' : word.replace(/s$/i, '').toLowerCase() || 'entry';
  return { one, many: word === 'Blog posts' ? 'posts' : word.toLowerCase(), newLabel: `New ${one}`, first: `Write your first ${one}` };
}

/** True when any filter narrows the view. */
export const hasFilters = (q: Partial<Record<FilterKey, string>>) => FILTER_KEYS.some((k) => !!q[k]);

const DAY = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' });

/** The row's tooltip: the whole title, then the author, the address and the date, each only when there is one. */
export function rowTip(e: { title: string; url: string | null; date: string | null; author: string | null }, authorName: string | null): string {
  const parts = [e.title];
  if (authorName) parts.push(`By ${authorName}`);
  if (e.url) parts.push(e.url);
  if (e.date && Number.isFinite(Date.parse(e.date))) parts.push(DAY.format(Date.parse(e.date)));
  return parts.join('\n');
}

/** "3 selected" */
export const selectedWords = (n: number) => `${NUM.format(n)} selected`;
