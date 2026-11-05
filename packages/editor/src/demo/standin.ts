// The live demo's stand-in for the Markstage server (docs/DEMO.md): it answers the editor's API calls in the
// browser. Reads are the answers a real server gave the real editor for the example blog (recorded by
// scripts/demo/record.mjs). A save is real: the Markdown is written by the same surgical converter the server uses
// (@markstage/core), kept in this tab (store.ts) and shown as the diff a commit would have. Every other change
// (publish, releases, users, settings, uploads, AI, environments, sign-in) answers one friendly refusal.
// No DOM here (test/demo-standin.test.ts).
import type { DemoStore, SaveRecord } from './store';

export const NOT_IN_DEMO = 'Not in the demo: install Markstage to try this.';

export type Recorded = Record<string, { status: number; body: unknown }>;

export interface DemoConverter {
  mdToDoc(text: string): { doc: unknown };
  docToMd(doc: unknown, original: string): string;
  changedBlocks(doc: unknown, original: string): number;
}

export interface StandInDeps {
  recorded: Recorded;
  collections: { id: string; format: 'md' | 'json'; dir: string; titleKey?: string }[];
  /** the sample blog's address in the demo, with a trailing slash (e.g. /markstage/demo/blog/) */
  site: string;
  md: () => DemoConverter;
  readFrontmatter: (text: string) => Record<string, unknown>;
  setFrontmatter: (text: string, changes: Record<string, unknown>) => string;
  store: DemoStore;
  now?: () => Date;
}

export interface Answer {
  status: number;
  body: unknown;
  /** a change the demo does not make (the page says so, with the install link) */
  refused?: boolean;
  /** a save it made */
  saved?: SaveRecord;
}

const ENTRY = /^collections\/([^/]+)\/entries\/([^/]+)(\/source|\/presence)?$/;
const PREVIEW = /^preview\/([^/]+)\/([^/]+)$/;
// keys only the publish routes change (as on the server)
const STATUS_KEYS = ['draft', 'status', 'publishAt'];

/** A file version for a text the demo wrote: opaque, like the server's (two FNV-1a hashes). */
export function versionOf(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `demo${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

const refuse = (): Answer => ({ status: 501, body: { error: 'not-in-demo', message: NOT_IN_DEMO }, refused: true });
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export function createStandIn(d: StandInDeps): (method: string, path: string, body?: string | null) => Answer {
  const now = d.now ?? (() => new Date());
  const col = (id: string) => d.collections.find((c) => c.id === id) ?? null;
  const key = (c: string, id: string) => `${c}/${id}`;

  /** The recorded answer for a path: its exact query first, else the same path with any query. */
  function recorded(path: string): { status: number; body: unknown } | null {
    if (d.recorded[path]) return d.recorded[path];
    const bare = path.split('?')[0];
    if (d.recorded[bare]) return d.recorded[bare];
    const other = Object.keys(d.recorded).find((k) => k.split('?')[0] === bare);
    return other ? d.recorded[other] : null;
  }

  /** The entry's file as it is now in this tab: the recorded source, or the visitor's last save. */
  function current(c: string, id: string): { source: string; version: string } | null {
    const mine = d.store.file(key(c, id));
    if (mine) return mine;
    const src = d.recorded[`collections/${c}/entries/${id}/source`]?.body as { source?: string; version?: string } | undefined;
    return typeof src?.source === 'string' ? { source: src.source, version: String(src.version ?? versionOf(src.source)) } : null;
  }

  const titleOf = (c: string, fm: Record<string, unknown>, fallback: string) => {
    const t = fm[col(c)?.titleKey ?? 'title'];
    return typeof t === 'string' && t ? t : fallback;
  };

  function getEntry(c: string, id: string): Answer {
    const rec = d.recorded[`collections/${c}/entries/${id}`];
    if (!rec) return { status: 404, body: { error: 'not-found', message: 'This entry is not in the demo’s sample blog.' } };
    const mine = d.store.file(key(c, id));
    if (!mine || col(c)?.format !== 'md') return { status: rec.status, body: clone(rec.body) };
    const body = clone(rec.body) as Record<string, unknown>;
    const fm = d.readFrontmatter(mine.source);
    body.version = mine.version;
    body.frontmatter = fm;
    body.doc = d.md().mdToDoc(mine.source).doc;
    body.title = titleOf(c, fm, String(body.title ?? id));
    return { status: 200, body };
  }

  function save(c: string, id: string, input: Record<string, unknown>, sourceOnly: boolean): Answer {
    const info = col(c);
    const now0 = current(c, id);
    if (!info || info.format !== 'md' || !now0) return refuse();
    if (typeof input.version === 'string' && input.version !== now0.version) {
      return { status: 409, body: { error: 'conflict', message: 'This post changed since you opened it. Reload it to see the saved text.', version: now0.version } };
    }
    let text = now0.source;
    let changedBlocks = 1;
    if (sourceOnly) {
      if (typeof input.source !== 'string') return { status: 400, body: { error: 'bad-request', message: 'Send the source.' } };
      text = input.source;
    } else {
      if (input.doc !== undefined && input.doc !== null) {
        text = d.md().docToMd(input.doc, now0.source);
        changedBlocks = d.md().changedBlocks(input.doc, now0.source);
      }
      const fm = input.frontmatter as Record<string, unknown> | undefined;
      if (fm && typeof fm === 'object' && Object.keys(fm).length) {
        if (STATUS_KEYS.some((k) => k in fm)) return { status: 422, body: { error: 'invalid', message: 'Status changes only through Publish, which is not in the demo.' } };
        text = d.setFrontmatter(text, fm);
      }
    }
    if (text === now0.source) return { status: 200, body: { ok: true, version: now0.version, changedBlocks: 0 } };
    const version = versionOf(text);
    const title = titleOf(c, d.readFrontmatter(text), id);
    const record: SaveRecord = { at: now().toISOString(), file: `${info.dir.replace(/\/+$/, '')}/${id}.md`, key: key(c, id), title, before: now0.source, after: text };
    d.store.save(record, version);
    return { status: 200, body: { ok: true, version, changedBlocks }, saved: record };
  }

  return (method, path, raw) => {
    const m = method.toUpperCase();
    const bare = path.split('?')[0];
    let input: Record<string, unknown> = {};
    try {
      input = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      input = {};
    }
    const entry = ENTRY.exec(bare);
    const c = entry ? decodeURIComponent(entry[1]) : '';
    const id = entry ? decodeURIComponent(entry[2]) : '';
    if (entry?.[3] === '/presence') {
      // who else has it open: nobody, in a demo
      if (m === 'DELETE') return { status: 200, body: { ok: true } };
      return { status: 200, body: { mode: input.mode === 'viewing' ? 'viewing' : 'editing', canEdit: true, lock: null, takenOver: null, version: current(c, id)?.version, saved: null, role: 'owner' } };
    }
    if (m === 'GET' || m === 'HEAD') {
      if (entry && !entry[3]) return getEntry(c, id);
      if (entry?.[3] === '/source') {
        const now0 = current(c, id);
        return now0 ? { status: 200, body: { source: now0.source, version: now0.version, format: col(c)?.format ?? 'md' } } : { status: 404, body: { error: 'not-found', message: 'This entry is not in the demo’s sample blog.' } };
      }
      const pv = PREVIEW.exec(bare);
      if (pv) {
        const url = (d.recorded[`collections/${decodeURIComponent(pv[1])}/entries/${decodeURIComponent(pv[2])}`]?.body as { url?: string } | undefined)?.url;
        if (!url) return { status: 404, body: { error: 'not-found', message: 'This entry has no page.' } };
        return { status: 200, body: { url: `${d.site}${url.replace(/^\/+/, '')}`, devServer: true } };
      }
      if (bare === 'index') {
        const rec = recorded(path);
        const body = clone(rec?.body) as { items?: { collection: string; id: string; title: string }[] } | undefined;
        for (const it of body?.items ?? []) {
          const mine = d.store.file(key(it.collection, it.id));
          if (mine) it.title = titleOf(it.collection, d.readFrontmatter(mine.source), it.title);
        }
        return { status: rec?.status ?? 200, body: body ?? { items: [] } };
      }
      const rec = recorded(path);
      return rec ? { status: rec.status, body: clone(rec.body) } : { status: 501, body: { error: 'not-in-demo', message: NOT_IN_DEMO } };
    }
    if (m === 'PUT' && entry && !entry[3]) return save(c, id, input, false);
    if (m === 'PUT' && entry?.[3] === '/source') return save(c, id, input, true);
    return refuse();
  };
}
