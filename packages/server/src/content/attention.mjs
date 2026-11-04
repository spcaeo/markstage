// The lists screen's "Needs attention" filters and language chips (docs/API.md "Collections and entries"), on top of
// store.list: only what the server already has cheaply, so a list never scans the site.
//   attention=no-description   the search description (seo key, else the excerpt) is empty
//   attention=no-title         the search title (seo key, else the title field) is empty
//   attention=alt-text         an image without a description (the publish rules' check, preflight.mjs)
//   attention=links            a link to a draft or to no page (the same check)
//   attention=not-translated   a tracked locale (translations.mjs) still has no words of its own
// Each item gets `locales: [{code, done}]` when the site tracks locales with their own title or description:
// `done` means that locale has its words (or shares the language, where empty means "the same").
import { searchText } from '../publish-rules.mjs';
import { badRequest } from '../util.mjs';
import { trackedLocales } from './translations.mjs';

export const ATTENTION = ['no-description', 'no-title', 'alt-text', 'links', 'not-translated'];

const get = (o, key) => key.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Each tracked locale's state for one entry, from its fields alone: done when every tracked field has words in
 * that locale, or the source has none, or the locale shares the source's language.
 */
export function localesOf(tracked, overridesKey, c, fields) {
  const source = searchText(c, fields ?? {});
  return tracked.map((l) => ({
    code: l.code,
    done: l.sameLanguage || l.fields.every((f) => !source[f] || !!str(get(fields, `${overridesKey}.${l.code}.${f}`))),
  }));
}

/** The `keep` predicate and `decorate` function for store.list, from the query; 400 for an unknown filter. */
export function listExtras(app, c, q) {
  const tracked = app.config.locales ? trackedLocales(app.config.locales) : [];
  const overridesKey = app.config.locales?.overridesKey ?? 'locales';
  const decorate = tracked.length ? (e, fields) => void (e.locales = localesOf(tracked, overridesKey, c, fields)) : undefined;
  const want = q.attention ? String(q.attention) : '';
  if (!want) return { decorate };
  if (!ATTENTION.includes(want)) throw badRequest(`Unknown attention filter (${ATTENTION.join(', ')}).`);
  let keep;
  if (want === 'no-description') keep = (e, fields) => !searchText(c, fields ?? {}).description;
  else if (want === 'no-title') keep = (e, fields) => !searchText(c, fields ?? {}).title;
  else if (want === 'not-translated') keep = (e) => !!e.locales?.some((l) => !l.done);
  else {
    // the publish rules' own findings (kept per file version, so only changed entries are read and parsed; the
    // route warms them up first, yielding between entries, so the first ask does not block the server)
    const known = app.preflight.knownPages();
    keep = (e) => {
      let f;
      try {
        f = app.preflight.findings(c, e.id, app.store.read(c, e.id).text, { known, duplicates: false });
      } catch {
        return false;
      }
      return want === 'alt-text' ? f.altText.length > 0 : f.links.length > 0;
    };
  }
  return { decorate, keep, warm: !!keep && (want === 'alt-text' || want === 'links') };
}
