// The site translation's drafts (docs/API-TRANSLATIONS.md "AI drafts of a whole site"): what the AI wrote for an
// entry's title and description in one locale, kept for a person to review, never in the entry itself. A locale's
// words live in the entry's file (<overridesKey>.<code>.<field>), so writing a draft there would put it live with the
// next publish; a draft is kept beside the site instead, in markstage/translations/<code>.json, committed in the
// name of the person who ran the job, so each batch is in the site's history. The site's build never reads it.
//
//   { "locale": "fr-CA", "drafts": { "posts/hello-world": { "fields": {"title": "…", "description": "…"},
//     "before": {"title": "", "description": ""}, "source": {"title": "…", "description": "…"},
//     "by": "Olive Owner", "at": "2026-11-05T09:00:00.000Z", "run": "tr_…", "model": "…" } } }
//
// A draft is linked to its entry by its key (collection/id) and to the words it would replace by `before`. A field
// stays open while the entry's words for it are still `before`: once anyone saves other words there (accepting the
// draft in Post settings, or writing their own), that field is reviewed and its draft goes. So a draft never
// overwrites anything: accepting it is the entry's own save, with its rights, versions and locks.
import { HttpError, nowIso } from '../util.mjs';

export const FIELDS = ['title', 'description'];
export const draftsFileOf = (code) => `markstage/translations/${code}.json`;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const get = (o, key) => key.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);

export function createDrafts(app, entries) {
  const { store, git, repoLock } = app;
  const key = () => app.config.locales?.overridesKey ?? 'locales';

  /** The locale's drafts file as kept: {locale, drafts}; a file that is not ours (or not JSON) reads as none. */
  function readFile(code) {
    const raw = store.readRel(draftsFileOf(code));
    if (raw === null) return { locale: code, drafts: {} };
    try {
      const doc = JSON.parse(raw);
      return { locale: code, drafts: doc && typeof doc.drafts === 'object' && !Array.isArray(doc.drafts) ? doc.drafts : {} };
    } catch {
      return { locale: code, drafts: {} };
    }
  }

  /** The entry's words in the locale now, field by field, or null when it is gone. */
  function wordsNow(ref, code) {
    const [cid, id] = ref.split('/');
    const c = store.collections.find((x) => x.id === cid);
    if (!c) return null;
    try {
      const fields = store.fieldsOf(c, store.read(c, id).text);
      return Object.fromEntries(FIELDS.map((f) => [f, str(get(fields, `${key()}.${code}.${f}`))]));
    } catch {
      return null;
    }
  }

  /** The draft with only its fields still open (the entry's words there are still what they were), or null. */
  function openPart(d, now) {
    if (!d || !now || typeof d.fields !== 'object') return null;
    const fields = {};
    for (const f of FIELDS) if (typeof d.fields[f] === 'string' && d.fields[f] && str(d.before?.[f]) === now[f]) fields[f] = d.fields[f];
    return Object.keys(fields).length ? { ...d, fields } : null;
  }

  /** The open draft for one entry in one locale, or null. */
  const openDraft = (code, ref) => openPart(readFile(code).drafts[ref], wordsNow(ref, code));

  /** Every open draft of a locale: ref -> draft. */
  function openDrafts(code) {
    const out = new Map();
    for (const [ref, d] of Object.entries(readFile(code).drafts)) {
      const open = openPart(d, wordsNow(ref, code));
      if (open) out.set(ref, open);
    }
    return out;
  }

  /**
   * Change the locale's file under the repo lock and commit it as `ctx`'s person: `change(drafts)` edits the map;
   * reviewed drafts and those of entries that are gone are dropped on the way. Returns the commit, or null.
   */
  function write(ctx, code, change, message) {
    return repoLock.run(async () => {
      const doc = readFile(code);
      const drafts = {};
      for (const [ref, d] of Object.entries(doc.drafts)) if (openPart(d, wordsNow(ref, code))) drafts[ref] = d;
      change(drafts);
      const rel = draftsFileOf(code);
      const was = store.readRel(rel);
      const text = `${JSON.stringify({ locale: code, note: 'AI drafts for people to review in Markstage (Post settings, Languages and regions). The site does not read this file.', drafts }, null, 2)}\n`;
      if (was === text) return null;
      store.writeRel(rel, text);
      return git.commit([rel], message, entries.authorOf(ctx.user));
    });
  }

  /** Add drafts ([{ref, fields, before, source, model}]) in one commit. */
  const add = (ctx, code, list, runId, message) =>
    write(
      ctx,
      code,
      (drafts) => {
        const at = nowIso(app.clock());
        for (const x of list) drafts[x.ref] = { fields: x.fields, before: x.before, source: x.source, by: ctx.user.name, at, run: runId, model: x.model ?? null };
      },
      message,
    );

  /** Remove one draft (Discard in Post settings); 404 when there is none open. */
  async function discard(ctx, code, ref) {
    if (!openDraft(code, ref)) throw new HttpError(404, 'not-found', 'There is no AI draft waiting for this entry in that region.');
    return write(ctx, code, (drafts) => delete drafts[ref], `Discard the AI draft of ${ref} in ${code}`);
  }

  return { readFile, wordsNow, openDraft, openDrafts, add, discard };
}
