// Change many entries at once (docs/OPERATIONS.md "Writing and finding"): set a field (a topic, a category, the
// author), add a value to a list or take it out (tags), unpublish, or move to the trash, with a summary of every
// entry before anything is written. All the changes go in one commit; live entries are rebuilt and deployed in one
// job, and put back if it fails. Each change is checked like a save of that entry; one that fails is left out and
// says why. Editors and above. `rename` changes values in a field wherever they are (a category or tag renamed, two
// merged into one, one deleted or given to another), for the taxonomy screen (taxonomy.mjs), and can be undone.
//   GET  /site/bulk/fields?collection=   the fields these entries use (kind: list, text, number, boolean), with the
//                                        values seen most (to pick from)
//   POST /site/bulk/plan {action, field?, value?, entries: [{collection, id}]}
//                                        per entry: {from, to, change, problem}
//   POST /site/bulk {action, field?, value?, from?, entries: [{collection, id, version}]}
//                                        {commit, changed, skipped, job}
// rename: {field, from: [value, …], value: the new value, or null to take them out}
import { INJECTION_KEY } from '../design/inject.mjs';
import { atLeast } from '../roles.mjs';
import { badRequest, forbidden, newId, nowIso, sha1 } from '../util.mjs';

const ACTIONS = ['set', 'add', 'remove', 'rename', 'unpublish', 'trash'];
/** The actions on a field: the ones Undo may put back (never a status change or the trash). */
export const FIELD_ACTIONS = ['set', 'add', 'remove', 'rename'];
const YIELD_EVERY = 20;
const MAX_ENTRIES = 200;
// a rename goes wherever the value is, so it may be on many more entries
const MAX_RENAME = 1000;
const MAX_FROM = 20;
const FIELD = /^[A-Za-z_][\w-]{0,63}$/;
const MAX_VALUES = 100;
const STATUS_KEYS = ['draft', 'publishAt', 'protected'];

/** Fields a bulk change may not touch: status (publish routes), page code (owners), and what makes the address. */
export const fixedFields = (c) => [...STATUS_KEYS, INJECTION_KEY, '_lock', 'locks', c.fields.title, c.fields.slug, c.fields.url].filter(Boolean);

export const isScalar = (v) => ['string', 'number', 'boolean'].includes(typeof v);
export const FIELD_NAME = FIELD;
/** A top-level field set (null takes it out), surgically, in frontmatter or JSON. */
export const fieldSetter = (converter) => (c, text, field, value) => (c.format === 'md' ? converter.setFrontmatter(text, { [field]: value }) : converter.applyJsonChanges(text, [value === null ? { path: field, delete: true } : { path: field, value }], c));
const shown = (v) => (v === undefined || v === null ? null : v);

export function bulkRoutes(router, app, many) {
  const { store, repoLock, audit, converter, db } = app;

  const needEditor = (ctx) => {
    if (!atLeast(ctx.user, 'editor')) throw forbidden('Only editors and above can change many entries at once.');
  };

  function requestOf(body) {
    const { action, field, value, from } = body ?? {};
    if (!ACTIONS.includes(action)) throw badRequest(`Say what to do: ${ACTIONS.join(', ')}.`);
    if (action === 'rename') {
      if (typeof field !== 'string' || !FIELD.test(field)) throw badRequest('Say which field to change.');
      if (!Array.isArray(from) || !from.length || from.length > MAX_FROM || !from.every((v) => isScalar(v) && v !== '')) throw badRequest(`Say which values to change (1 to ${MAX_FROM}).`);
      if (!(value === null || (isScalar(value) && value !== ''))) throw badRequest('The new value must be text, a number, yes/no, or null to take the values out.');
    }
    if (['set', 'add', 'remove'].includes(action)) {
      if (typeof field !== 'string' || !FIELD.test(field)) throw badRequest('Say which field to change.');
      if (action === 'set' && !(value === null || isScalar(value) || (Array.isArray(value) && value.every(isScalar)))) throw badRequest('The value must be text, a number, yes/no, a list of those, or null to clear it.');
      if (action !== 'set' && (!isScalar(value) || value === '')) throw badRequest('Say which value to add or take out.');
    }
    const entries = body.entries;
    if (!Array.isArray(entries) || !entries.length) throw badRequest('Choose the entries to change.');
    const max = action === 'rename' ? MAX_RENAME : MAX_ENTRIES;
    if (entries.length > max) throw badRequest(`At most ${max} entries at a time.`);
    return { action, field, value, from: action === 'rename' ? [...new Set(from)] : undefined, entries };
  }

  const setField = fieldSetter(converter);

  /** The change to one entry: {from, to, after, problem?}; `after` equal to the text means no change. */
  function changeOf(c, id, text, r) {
    const s = store.summarize(c, id, text);
    if (r.action === 'unpublish') {
      if (!c.hasStatus) return { from: s.status, to: s.status, after: text, note: 'This collection has no draft status.' };
      if (s.status === 'draft') return { from: 'draft', to: 'draft', after: text, note: 'Already a draft.' };
      const after = c.format === 'md' ? converter.setFrontmatter(text, { draft: true, publishAt: null }) : converter.applyJsonChanges(text, [{ path: 'draft', value: true }, { path: 'publishAt', delete: true }], c);
      return { from: s.status, to: 'draft', after };
    }
    if (r.action === 'trash') return { from: s.status, to: 'trash', after: null };
    if (fixedFields(c).includes(r.field)) return { from: null, to: null, after: text, note: `“${r.field}” cannot be changed here.` };
    const was = store.fieldsOf(c, text)[r.field];
    let now;
    if (r.action === 'rename') {
      const hit = (v) => r.from.includes(v);
      if (Array.isArray(was) ? !was.some(hit) : !hit(was)) return { from: shown(was), to: shown(was), after: text, note: 'No change.' };
      now = Array.isArray(was) ? [...new Set(was.map((v) => (hit(v) ? r.value : v)).filter((v) => v !== null))] : r.value;
      return { from: shown(was), to: shown(now), after: setField(c, text, r.field, now) };
    }
    if (r.action === 'set') now = r.value;
    else if (was !== undefined && was !== null && !Array.isArray(was)) return { from: shown(was), to: shown(was), after: text, note: `“${r.field}” is not a list here.` };
    else if (r.action === 'add') now = (was ?? []).includes(r.value) ? was : [...(was ?? []), r.value];
    else now = (was ?? []).filter((v) => v !== r.value);
    if (JSON.stringify(shown(was)) === JSON.stringify(shown(now)) || (r.action === 'remove' && !was?.length)) return { from: shown(was), to: shown(was), after: text, note: 'No change.' };
    return { from: shown(was), to: shown(now), after: setField(c, text, r.field, now) };
  }

  /** Each asked entry with its change; `versions` makes a stale entry a skip. */
  async function planOf(ctx, r, { versions }) {
    const rows = [];
    for (const a of r.entries) {
      // every entry is parsed and checked (tens of milliseconds): other requests get a turn in between
      if (rows.length % YIELD_EVERY === YIELD_EVERY - 1) await new Promise((res) => setImmediate(res));
      const row = { collection: a?.collection, id: a?.id, title: a?.id };
      rows.push(row);
      let c;
      let cur;
      try {
        c = store.collection(String(a?.collection));
        cur = store.read(c, String(a?.id));
      } catch {
        row.problem = 'It is no longer there.';
        continue;
      }
      const s = store.summarize(c, a.id, cur.text);
      Object.assign(row, { title: s.title || a.id, status: s.status ?? 'published', version: cur.version });
      if (versions && a.version !== cur.version) {
        row.problem = 'It changed since the summary. Look again to see it as it is now.';
        continue;
      }
      const ch = changeOf(c, a.id, cur.text, r);
      Object.assign(row, { from: ch.from, to: ch.to });
      if (ch.note) {
        row.problem = ch.note;
        continue;
      }
      row.h = { c, id: a.id, before: cur.text, after: many.stamped(c, cur.text, ch.after), title: row.title, status: row.status };
      row.problem = (await many.problemOf(ctx, row.h, { allowStatus: r.action === 'unpublish' })) ?? undefined;
    }
    return rows;
  }

  const publicRow = ({ h, ...row }) => row;

  router.add('GET', '/site/bulk/fields', (ctx) => {
    needEditor(ctx);
    const only = ctx.query.get('collection');
    const seen = new Map();
    for (const c of store.collections) {
      if (only && c.id !== only) continue;
      const fixed = fixedFields(c);
      for (const id of store.ids(c)) {
        let f;
        try {
          f = store.fieldsOf(c, store.read(c, id).text);
        } catch {
          continue;
        }
        for (const [k, v] of Object.entries(f)) {
          if (fixed.includes(k) || !FIELD.test(k)) continue;
          const list = Array.isArray(v);
          if (!(list ? v.every(isScalar) : isScalar(v))) continue;
          const e = seen.get(k) ?? { name: k, list: false, entries: 0, values: new Map(), types: new Set() };
          e.list ||= list;
          for (const x of list ? v : [v]) e.types.add(typeof x);
          e.entries++;
          for (const x of list ? v : [v]) if (typeof x === 'string' && x.length <= 120) e.values.set(x, (e.values.get(x) ?? 0) + 1);
          seen.set(k, e);
        }
      }
    }
    const fields = [...seen.values()]
      .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name))
      .map((e) => ({ name: e.name, list: e.list, kind: e.list ? 'list' : e.types.size === 1 && e.types.has('boolean') ? 'boolean' : e.types.size === 1 && e.types.has('number') ? 'number' : 'text', entries: e.entries, values: [...e.values].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_VALUES).map(([v, n]) => ({ value: v, entries: n })) }));
    return { fields };
  });

  router.add('POST', '/site/bulk/plan', async (ctx) => {
    needEditor(ctx);
    return { entries: (await planOf(ctx, requestOf(ctx.body), { versions: false })).map(publicRow) };
  });

  router.add('POST', '/site/bulk', async (ctx) => {
    needEditor(ctx);
    const r = requestOf(ctx.body);
    const out = await repoLock.run(async () => {
      const rows = await planOf(ctx, r, { versions: true });
      const list = rows.filter((x) => !x.problem).map((x) => x.h);
      const n = list.length;
      const what = { set: `Set ${r.field}`, add: `Add ${r.value} to ${r.field}`, remove: `Take ${r.value} out of ${r.field}`, rename: r.value === null ? `Take ${r.from?.join(', ')} out of ${r.field}` : `${r.field}: ${r.from?.join(', ')} becomes ${r.value}`, unpublish: 'Unpublish', trash: 'Trash' }[r.action];
      const commit = await many.commitAll(ctx, list, `${what} in ${n} entr${n === 1 ? 'y' : 'ies'}`.slice(0, 200));
      // the trash keeps each text, so it can be restored (and a failed deploy takes it back out)
      if (r.action === 'trash' && commit) {
        const add = db.prepare('INSERT INTO trash (id, collection, entry_id, title, author, text, deleted_at, deleted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const h of list) {
          h.trashId = newId('tr');
          const s = store.summarize(h.c, h.id, h.before);
          add.run(h.trashId, h.c.id, h.id, s.title, s.author, h.before, nowIso(app.clock()), ctx.user.id);
        }
      }
      if (commit) audit.log(ctx, 'entries.bulk', { target: 'site', detail: { action: r.action, field: r.field, value: r.value, from: r.from, commit, entries: list.map((h) => `${h.c.id}/${h.id}`) } });
      return { rows, list, commit };
    });
    const job = many.deploy(ctx, { kind: 'bulk', target: 'site', list: out.list, commit: out.commit });
    return {
      commit: out.commit,
      // a trashed entry's place in the trash, so a list's Undo can bring it back
      changed: out.rows.filter((x) => !x.problem).map(({ h, version, ...row }) => ({ ...row, version: h.after === null ? null : sha1(h.after), ...(h.trashId ? { trashId: h.trashId } : {}) })),
      skipped: out.rows.filter((x) => x.problem).map(publicRow),
      job,
    };
  });

  /** The summary of a change, nothing written (the taxonomy screen asks for a rename on the entries it found). */
  return { plan: async (ctx, body) => (await planOf(ctx, requestOf(body), { versions: false })).map(publicRow) };
}
