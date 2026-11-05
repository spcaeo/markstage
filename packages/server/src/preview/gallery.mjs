// The section gallery (docs/API-EDIT.md): every section type a JSON collection's pages use or its schema
// declares, and each variation of it, drawn alone by the site's own components through the preview. Each sample is
// a throwaway page in the preview's private clone (never the content repo, never a build, never pushed: site.mjs):
// a copy of the page the sample comes from holding only that one section, at an address of its own. The editor
// frames those pages on the preview origin (#/gallery). Sample content is the first real use of a type and
// variation in the content; a type (or a variation the schema lists) no page uses yet gets placeholder words.
//
//   GET preview/gallery         { collections: [{ id, label }] }  the JSON collections with page sections
//   GET preview/gallery/:c      { collection, samples: [{ key, kind, variant, from, path, url }], problems }
import { HttpError, notFound, sha1 } from '../util.mjs';

const PREFIX = 'markstage-gallery-';
const get = (o, key) => key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
function set(o, key, value) {
  const parts = key.split('.');
  let at = o;
  for (const k of parts.slice(0, -1)) at = at[k] && typeof at[k] === 'object' ? at[k] : (at[k] = {});
  at[parts.at(-1)] = value;
}
const words = (key) => String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ').trim().toLowerCase();

/** Placeholder content for a field of the schema descriptor: words where text goes, three items in a list. */
export function placeholder(field, key = '') {
  const name = words(field?.label ?? key) || 'text';
  switch (field?.type) {
    case 'text':
      if (field.rich) return `<p>Sample ${name}: a sentence or two so the section shows how its text sits.</p>`;
      return field.multiline ? `Sample ${name}: a sentence or two so the section shows how its text sits.` : `Sample ${name}`;
    case 'url':
      return '#';
    case 'date':
    case 'datetime':
      return '2026-01-15';
    case 'number':
      return 3;
    case 'checkbox':
      return field.default ?? false;
    case 'select':
      return field.default ?? field.options?.[0]?.value ?? null;
    case 'slug':
      return 'sample';
    case 'array':
      return [1, 2, 3].map(() => placeholder(field.item, key));
    case 'object':
      return Object.fromEntries(Object.entries(field.fields ?? {}).map(([k, f]) => [k, placeholder(f, k)]));
    case 'conditional': {
      const keys = field.storage ?? { discriminant: 'discriminant', value: 'value' };
      const pick = field.discriminant?.default ?? Object.keys(field.values ?? {})[0];
      return { [keys.discriminant]: pick, [keys.value]: placeholder(field.values?.[pick], pick) };
    }
    case 'custom':
      return field.default === undefined ? null : structuredClone(field.default);
    default:
      return null;
  }
}

export function createGallery(app) {
  const { config, store, db } = app;
  const pv = config.preview;
  // collection id -> { rel: text } of its throwaway pages; all of them go into every state the clone shows. In the
  // database (kv preview.gallery:<collection>): the gallery is asked for on any server process, and the preview
  // listener runs in the one holding the primary role (docs/SCALING.md)
  const KEY = 'preview.gallery:';
  const built = {
    set: (cid, files) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`${KEY}${cid}`, JSON.stringify(files)),
    values: () => db.prepare('SELECT value FROM kv WHERE key LIKE ?').all(`${KEY}%`).map((r) => JSON.parse(r.value)),
  };
  // they lived until a restart, as they did in memory
  app.cluster?.onReap(({ startup, alone }) => startup && alone && db.prepare('DELETE FROM kv WHERE key LIKE ?').run(`${KEY}%`));
  const coll = (id) => config.collections.find((c) => c.id === id);
  const addressKey = (c) => c.fields.url || (typeof c.url === 'string' && /^\{([A-Za-z_][\w.]*)\}$/.exec(c.url)?.[1]) || null;

  /** The schema of one section (the list's item), when the site has a schema: a conditional, one option per type. */
  function sectionField(c) {
    const f = c.schema?.type === 'object' ? get(c.schema.fields ?? {}, c.gallery.field.split('.').join('.fields.')) : null;
    return f?.type === 'array' && f.item?.type === 'conditional' ? f.item : null;
  }

  /** Every entry of the collection: { id, data, summary } (an entry that does not read is left out). */
  function entriesOf(c) {
    const out = [];
    for (const id of store.ids(c)) {
      if (id.startsWith(PREFIX)) continue;
      try {
        const { text } = store.read(c, id);
        out.push({ id, data: JSON.parse(text), summary: store.summarize(c, id, text) });
      } catch {
        // not JSON, or unreadable: not a source of samples
      }
    }
    return out;
  }

  /** A section's type and value, stored as {discriminant, value} (or the schema's own keys), or flat {kind, …}. */
  function partsOf(item, keys) {
    if (!item || typeof item !== 'object') return null;
    if (keys.discriminant in item) return { kind: String(item[keys.discriminant]), value: item[keys.value] ?? {} };
    if (typeof item.kind === 'string') return { kind: item.kind, value: item };
    return null;
  }

  function hasSections(c) {
    if (!c.gallery) return false;
    if (sectionField(c)) return true;
    return entriesOf(c).some((e) => Array.isArray(get(e.data, c.gallery.field)) && get(e.data, c.gallery.field).some((s) => partsOf(s, { discriminant: 'discriminant', value: 'value' })));
  }

  /** The samples: { kind, variant, item (as stored), from: {id, title, url, index} | null }, in schema order. */
  function samplesOf(c, entries) {
    const schema = sectionField(c);
    const keys = schema?.storage ?? { discriminant: 'discriminant', value: 'value' };
    const vKey = c.gallery.variant;
    const found = new Map();
    for (const e of entries) {
      const list = get(e.data, c.gallery.field);
      if (!Array.isArray(list)) continue;
      list.forEach((item, index) => {
        const p = partsOf(item, keys);
        if (!p) return;
        const v = vKey ? get(p.value, vKey) : undefined;
        const variant = v === undefined || v === null || v === '' ? null : String(v);
        const key = `${p.kind}\0${variant ?? ''}`;
        if (!found.has(key)) found.set(key, { kind: p.kind, variant, item, from: { id: e.id, title: e.summary.title, url: e.summary.url, index } });
      });
    }
    // what the schema declares and no page uses yet: placeholder words (a variation it lists as a select too)
    if (schema) {
      for (const [kind, f] of Object.entries(schema.values ?? {})) {
        const variants = [null];
        const vf = vKey && f?.type === 'object' ? get(f.fields ?? {}, vKey.split('.').join('.fields.')) : null;
        if (vf?.type === 'select') variants.push(...(vf.options ?? []).map((o) => String(o.value)).filter(Boolean));
        for (const variant of variants) {
          const key = `${kind}\0${variant ?? ''}`;
          if (found.has(key) || (variant === null && [...found.values()].some((s) => s.kind === kind))) continue;
          const value = placeholder(f, kind);
          if (variant !== null && value && typeof value === 'object') set(value, vKey, variant);
          found.set(key, { kind, variant, item: { [keys.discriminant]: kind, [keys.value]: value }, from: null });
        }
      }
    }
    // the schema's order of types, else the order the pages first use them; within a type, the plain one first
    const order = [...new Set([...(schema ? Object.keys(schema.values ?? {}) : []), ...[...found.values()].map((s) => s.kind)])];
    const rank = (k) => (order.includes(k) ? order.indexOf(k) : order.length);
    return [...found.values()].sort((a, b) => rank(a.kind) - rank(b.kind) || Number(b.variant === null) - Number(a.variant === null));
  }

  /** The throwaway pages for a collection's samples, written into the clone from the next preview request on. */
  function build(c) {
    const entries = entriesOf(c);
    const hostOf = (s) => (s.from ? entries.find((e) => e.id === s.from.id) : entries.find((e) => e.summary.url && e.summary.status !== 'draft') ?? entries.find((e) => e.summary.url));
    const taken = store.addresses();
    const aKey = addressKey(c);
    const files = {};
    const samples = [];
    const problems = [];
    samplesOf(c, entries).forEach((s, n) => {
      const host = hostOf(s);
      const id = `${PREFIX}${n + 1}`;
      const data = structuredClone(host?.data ?? {});
      set(data, c.gallery.field, [s.item]);
      if (aKey) set(data, aKey, `/${id}/`);
      const text = `${JSON.stringify(data, null, 2)}\n`;
      const url = host ? store.summarize(c, id, text).url : null;
      if (!url || taken.has(url) || store.exists(c, id)) {
        problems.push({ kind: s.kind, variant: s.variant, message: !host ? 'No page to copy it into.' : !url ? 'This collection gives a new page no address, so the sample cannot be shown.' : `The address ${url} is taken.` });
        return;
      }
      files[store.rel(store.fileOf(c, id, { mustExist: false }))] = text;
      samples.push({ key: sha1(`${s.kind}\0${s.variant ?? ''}`).slice(0, 10), kind: s.kind, variant: s.variant, from: s.from, path: url, url: `${pv.origin}${url}` });
    });
    built.set(c.id, files);
    return { collection: c.id, samples, problems };
  }

  function routes(router) {
    router.add('GET', '/preview/gallery', () => {
      if (!pv.origin) throw new HttpError(409, 'no-preview', 'The gallery needs the preview (preview.origin in the server config).');
      return { collections: config.collections.filter(hasSections).map((c) => ({ id: c.id, label: c.label })) };
    });
    router.add('GET', '/preview/gallery/:c', (ctx) => {
      if (!pv.origin) throw new HttpError(409, 'no-preview', 'The gallery needs the preview (preview.origin in the server config).');
      const c = coll(ctx.params.c);
      if (!c || !hasSections(c)) throw notFound('This collection has no page sections.');
      return build(c);
    });
  }

  return {
    routes,
    /** { rel: text } of every throwaway page built so far: part of every state the clone shows */
    files: () => Object.assign({}, ...built.values()),
  };
}
