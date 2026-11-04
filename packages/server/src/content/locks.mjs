// Locks (docs/OPERATIONS.md "Locks"): core's lockReport compares the stored entry with the saved one (the site's rules
// in markstage.config `locks`, an editor's `_lock` in a page, a box's lock and frontmatter `locks` in an article).
// entries.guard refuses a save that moves, deletes or changes a locked block (423), for every role, and a lock added,
// taken off or changed by anyone below editor (403). Without core, a save of an entry that has locks is refused
// rather than let through.
import { HttpError } from '../util.mjs';

export const core = await import('@markstage/core/locks').catch((e) => {
  if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return null;
  throw e;
});

const MARKERS = /"_lock"\s*:|^locks:|data-lock=/m;
const empty = { violations: [], changes: [] };

/**
 * The lock report of a save. `before`/`after` are the parsed entry ({data} or {doc}) with its fields; `rules` the
 * site's locks ({pages, articles}).
 */
export function lockReportOf(c, before, after, rules, texts) {
  const theirs = c.format === 'json' ? { pages: rules?.pages ?? {} } : { articles: rules?.articles ?? {} };
  if (!core) {
    const ruled = Object.keys(c.format === 'json' ? theirs.pages : theirs.articles).length > 0;
    if (ruled || texts.some((t) => t && MARKERS.test(t))) throw new HttpError(503, 'locks-unavailable', 'This entry has locks, and checking them needs @markstage/core, which is not installed.');
    return empty;
  }
  const side = (p, fields) => (c.format === 'json' ? { data: p.data } : { doc: p.doc, frontmatter: fields ?? {} });
  return core.lockReport(side(before.parsed, before.fields), side(after.parsed, after.fields), theirs);
}

/**
 * The JSON path of a marker from a change's path: "sections[3]" -> "sections.3._lock", "_lock" -> "_lock"; a
 * section that keeps it in its value (and not on itself) -> "sections.3.value._lock", so `by` and `at` go beside it.
 */
function markerPath(p, data) {
  if (p === '_lock') return '_lock';
  const at = p.replace(/\[(\d+)\]/g, '.$1');
  const item = at.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), data);
  const inValue = item && typeof item === 'object' && item._lock === undefined && item.value && typeof item.value === 'object' && item.value._lock !== undefined;
  return inValue ? `${at}.value._lock` : `${at}._lock`;
}

/**
 * Who set each lock that a save adds or changes, and when: `by` (the person's name) and `at` (to the second) are
 * written by the server on every marker the save changed, whatever the editor sent. A marker taken off has none.
 */
export function stampLocks(c, converter, text, changes, { by, at }) {
  const set = changes.filter((ch) => ch.to);
  if (!set.length) return text;
  if (c.format === 'json') {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON: the paths as they are
    }
    const ops = set.flatMap((ch) => [{ path: `${markerPath(ch.path, data)}.by`, value: by }, { path: `${markerPath(ch.path, data)}.at`, value: at }]);
    return converter.applyJsonChanges(text, ops, c);
  }
  const fm = converter.parseFrontmatter(text) ?? {};
  if (!Array.isArray(fm.locks)) return text;
  const boxes = new Set(set.filter((ch) => ch.box).map((ch) => ch.box));
  const headings = new Set(set.filter((ch) => ch.heading).map((ch) => ch.heading));
  const locks = fm.locks.map((l) => (l && typeof l === 'object' && (boxes.has(String(l.box ?? '').trim()) || headings.has(String(l.heading ?? '').trim())) ? { ...l, by, at } : l));
  return converter.setFrontmatter(text, { locks });
}
