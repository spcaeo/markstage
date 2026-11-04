import type { Lock } from './index';
/** The site's lock rules (markstage.config `locks`), by page section type and article box name. */
export interface LockRules {
  pages?: Record<string, Lock>;
  articles?: Record<string, Lock>;
}
/** A page ({data}) or an article ({doc, frontmatter}) as stored and as saved. */
export type LockSide = { data: unknown } | { doc: unknown; frontmatter: Record<string, unknown> };
export interface LockViolation {
  what: 'move' | 'remove' | 'edit' | 'layout';
  /** where it is: "sections[2]", "sections[5].value.items[1]", "blocks[12]" */
  path: string;
  type: string | null;
  label: string;
  /** "the site" (a rule in markstage.config) or "an editor" (a lock kept in the entry) */
  by: string;
  message: string;
}
export interface LockChange {
  change: 'lock' | 'unlock' | 'change';
  path: string;
  type: string | null;
  label: string;
  from: unknown;
  to: unknown;
  /** 'site' when the change is about something the site's rule sets (an "Unlock on this page", or taking it back) */
  rule?: 'site';
  /** an article's frontmatter lock: the box name or the heading it is about */
  box?: string;
  heading?: string;
}
/** A marker as set: each action true (locked) or false (the site's rule lifted on this entry only). */
export type LockMark = Partial<Record<'move' | 'remove' | 'edit', boolean>>;
/** A lock from a stored marker ({move, remove, edit} or "move remove"); null when none. */
export function lockOf(v: unknown): Lock | null;
/** A stored marker with its falses kept (by and at left out); null when none. */
export function markOf(v: unknown): LockMark | null;
/** The file at the site's root that holds the site's rules when they are changed in the editor. */
export const LOCK_RULES_FILE: 'markstage.locks.json';
/** Rules in any accepted form ({type: ['move']} or {type: {move: true}}) as {pages, articles} of Lock; throws on a wrong shape. */
export function normalizeLockRules(v: unknown): { pages: Record<string, Lock>; articles: Record<string, Lock> };
/** The file's text for these rules (list form, keys sorted). */
export function lockRulesText(rules: unknown): string;
/** What a save may not do: each locked block it moves, deletes or changes. */
export function checkLocks(before: LockSide, after: LockSide, rules?: LockRules): LockViolation[];
/** The lock markers a save adds, takes off or changes (only an owner, administrator or editor may). */
export function lockChanges(before: LockSide, after: LockSide, rules?: LockRules): LockChange[];
export function lockReport(before: LockSide, after: LockSide, rules?: LockRules): { violations: LockViolation[]; changes: LockChange[] };
