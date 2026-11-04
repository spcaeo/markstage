// An item's lock in a page list: its own `_lock` (kept in the entry by an editor) and the site's rule for its kind
// (config `locks.pages`), one lock between them. Each can only add: move ‖ move, remove ‖ remove, edit ‖ edit;
// except that the item's own `false` lifts the site's rule for that action on this page ("Unlock on this page").
// The badge names the site when the site's rule forbids something the item's own lock allows.
import type { Lock } from '@markstage/core';

export function mergeLocks(own: Lock | undefined, site: Lock | undefined): Lock | undefined {
  // the parts this item lifts are not the site's to lock here
  if (site && own) site = { ...site, move: site.move && own.move !== false, remove: site.remove && own.remove !== false, edit: site.edit && own.edit !== false };
  if (!site || !(site.move || site.remove || site.edit)) return own && (own.move || own.remove || own.edit) ? own : undefined;
  if (!own) return { ...site, by: site.by ?? 'the site' };
  const adds = (site.move && !own.move) || (site.remove && !own.remove) || (site.edit && !own.edit);
  const lock: Lock = { ...own, move: !!(own.move || site.move), remove: !!(own.remove || site.remove), edit: !!(own.edit || site.edit) };
  const by = adds ? (site.by ?? 'the site') : own.by;
  if (by) lock.by = by;
  else delete lock.by;
  return lock;
}
