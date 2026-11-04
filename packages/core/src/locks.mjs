// Locks (docs/OPERATIONS.md "Locks"): what a save may not do to a locked block, decided by comparing the stored
// entry with the saved one. The server refuses such a save (423) for every role; the editor asks the same question
// before it offers a move or a delete.
//   checkLocks(before, after, rules)  -> [{what: 'move'|'remove'|'edit'|'layout', path, type, label, by, message}]
//   lockChanges(before, after, rules) -> [{change: 'lock'|'unlock'|'change', path, type, label, from, to, rule?}]
//   lockReport(before, after, rules)  -> {violations, changes}
// `before` and `after` are a page {data} (JSON) or an article {doc, frontmatter}; `rules` is the site's
// `locks: {pages: {<section type>: {move, remove, edit}}, articles: {<box>: {...}}}` (site-config's locksOf).
// Where a lock is kept, so it lives in git:
//   pages: `_lock: {move, remove, edit, by, at}` on a section or a list item, or inside a section's `value` (where
//          the site's Keystatic schema and the editor's padlock keep it; both places are read, and a marker at the
//          top wins action by action); the entry's own `_lock: {layout, edit}`
//          (layout: nothing added, removed or reordered at the top level; edit: read-only);
//   articles: frontmatter `locks: [{heading, …}]` for the section under a heading and `locks: [{box, …}]` for every
//          run of that box (by block name); a box's `lock` attribute ({move, remove, edit}, or "move remove");
//   the site's rules by type: a page section's `discriminant`, an article box's block name ("Locked by the site").
// `true` locks that action; `false` lifts the site's rule for it on this entry only ("Unlock on this page"). `by` and
// `at` are who set the marker and when (the server writes them). A rule binds unless either side's marker lifts it; a
// marker's own `true` binds while both sides have it, so an editor may take it off in the same save.
// Moving other blocks past a locked one is allowed. A save is read as the fewest moves of unlocked blocks, so a
// move-locked block "moves" only when it changes places with another move-locked block: that is all a server can
// tell apart (the editor hides the grip on a locked block itself).

const WHAT = ['move', 'remove', 'edit'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A lock from a stored marker: {move, remove, edit} (true only), or a "move remove" string; null when none. */
export function lockOf(v) {
  if (typeof v === 'string') v = v.split(/[\s,]+/);
  // the config's own form (['move', 'remove']), so rules not yet normalized by site-config never silently lock nothing
  if (Array.isArray(v)) v = Object.fromEntries(v.filter((w) => WHAT.includes(w)).map((w) => [w, true]));
  if (!isObj(v)) return null;
  const out = Object.fromEntries(WHAT.filter((w) => v[w] === true).map((w) => [w, true]));
  return Object.keys(out).length ? out : null;
}
/** A stored marker as set: each action `true` (locked) or `false` (the site's rule lifted here); null when none. */
export function markOf(v) {
  if (typeof v === 'string' || Array.isArray(v)) return lockOf(v);
  if (!isObj(v)) return null;
  const out = Object.fromEntries(WHAT.filter((w) => typeof v[w] === 'boolean').map((w) => [w, v[w]]));
  return Object.keys(out).length ? out : null;
}
/** Markers as one: an action is locked when any of them locks it, else lifted when one lifts it. */
function unite(...marks) {
  const ms = marks.filter(Boolean);
  const out = {};
  for (const w of WHAT) {
    if (ms.some((m) => m[w] === true)) out[w] = true;
    else if (ms.some((m) => m[w] === false)) out[w] = false;
  }
  return Object.keys(out).length ? out : null;
}
/** `top` over `base`, action by action (the frontmatter's word for a box kind over the boxes' own attributes). */
const over = (base, top) => (base || top ? markOf({ ...base, ...top }) : null);
const both = (a, b) => (a && b ? lockOf(Object.fromEntries(WHAT.filter((w) => a[w] && b[w]).map((w) => [w, true]))) : null);
/**
 * What binds an item: the site's rule unless a marker on either side lifts it (`false`), and a marker's own `true`
 * where both sides have it (`a` left out: one side). `site` says which parts come from the site's rule.
 */
const join = (b, rule, a = b) => {
  const site = Object.fromEntries(WHAT.filter((w) => rule?.[w] && b?.[w] !== false && a?.[w] !== false).map((w) => [w, true]));
  const l = { ...site, ...Object.fromEntries(WHAT.filter((w) => b?.[w] === true && a?.[w] === true).map((w) => [w, true])) };
  return Object.keys(l).length ? { ...l, site } : null;
};
/** What binds a pair: join, plus a lock a box keeps in itself on both sides (it holds where the frontmatter lifts the
 * site's rule for that kind). */
const bound = (x, y) => {
  const lock = join(x.own, x.rule, y.own);
  const extra = both(markIn(x), markIn(y));
  return extra ? { ...lock, ...extra, site: lock?.site ?? {} } : lock;
};
/** A marker added, taken off or changed: lock (only adds), unlock (only lifts), change; `rule: 'site'` when it is
 * about what the site's rule sets. */
function changeOf(from, to, rule, where) {
  let lifts = false;
  let adds = false;
  const touched = [];
  for (const w of WHAT) {
    const f = from?.[w];
    const t = to?.[w];
    if (f === t) continue;
    touched.push(w);
    if (t === false || f === true) lifts = true;
    if (t === true || f === false) adds = true;
  }
  if (!touched.length) return null;
  return { change: lifts && adds ? 'change' : lifts ? 'unlock' : 'lock', ...where, from: from ?? null, to: to ?? null, ...(touched.some((w) => rule?.[w]) ? { rule: 'site' } : {}) };
}

const SAYS = { move: 'moved', remove: 'deleted', edit: 'changed', layout: 'added, deleted or reordered' };
const violation = (what, it, lock) => {
  const by = lock?.site?.[what] ? 'the site' : 'an editor';
  return { what, path: it.path, type: it.type, label: it.label, by, message: `${it.label} is locked by ${by}: it can't be ${SAYS[what]}.` };
};

/** How alike two items are: the fields with the same value (objects), or the blocks in common (a unit's blocks). */
function alike(x, y) {
  if (Array.isArray(x) && Array.isArray(y)) {
    const ys = new Set(y.map((n) => JSON.stringify(n)));
    return x.filter((n) => ys.has(JSON.stringify(n))).length;
  }
  if (!isObj(x) || !isObj(y)) return 0;
  return Object.keys(x).filter((k) => k !== '_lock' && sameJson(x[k], y[k])).length;
}

/** The positions of b matched in a: the longest common run of equal keys, locked items counted first. */
function anchors(b, a) {
  const n = b.length;
  const m = a.length;
  const w = (it) => (it.lock?.move ? 1000 : 1);
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = b[i].key === a[j].key ? dp[i + 1][j + 1] + w(b[i]) : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (b[i].key === a[j].key && dp[i][j] === dp[i + 1][j + 1] + w(b[i])) pairs.push([i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** The longest increasing run of after-positions (the move-locked items that kept their order). */
function keptOrder(list) {
  const best = list.map(() => 1);
  const prev = list.map(() => -1);
  for (let i = 0; i < list.length; i++) for (let k = 0; k < i; k++) if (list[k].j < list[i].j && best[k] + 1 > best[i]) [best[i], prev[i]] = [best[k] + 1, k];
  let at = best.indexOf(Math.max(0, ...best));
  const keep = new Set();
  for (; at >= 0; at = prev[at]) keep.add(list[at]);
  return keep;
}

/** The marker an item keeps in itself (a box's lock attributes), apart from one in the frontmatter (reported there). */
const markIn = (it) => ('mark' in it ? it.mark : it.own);

/**
 * One list, before and after. Items are {key, type, own, rule, label, path, raw}; `inner(b, a)` checks inside a pair.
 * Pairs: equal items first, then an edited item with the one of its type in the same gap, then anywhere.
 */
function checkList(b, a, out, inner) {
  const pairs = anchors(b, a).map(([i, j]) => ({ i, j, same: true }));
  const usedB = new Set(pairs.map((p) => p.i));
  const usedA = new Set(pairs.map((p) => p.j));
  const bounds = [[-1, -1], ...pairs.map((p) => [p.i, p.j]), [b.length, a.length]];
  for (let g = 0; g + 1 < bounds.length; g++) {
    const bi = [];
    const aj = [];
    for (let i = bounds[g][0] + 1; i < bounds[g + 1][0]; i++) bi.push(i);
    for (let j = bounds[g][1] + 1; j < bounds[g + 1][1]; j++) aj.push(j);
    // the closest of its type first (most fields alike), so a deleted item never takes an edited one's place
    const cands = [];
    for (const i of bi) for (const j of aj) if (a[j].type === b[i].type) cands.push({ i, j, score: alike(b[i].raw, a[j].raw) });
    cands.sort((x, y) => y.score - x.score || x.i - y.i || x.j - y.j);
    for (const { i, j } of cands) {
      if (usedB.has(i) || usedA.has(j)) continue;
      pairs.push({ i, j, same: false });
      usedB.add(i);
      usedA.add(j);
    }
  }
  for (let i = 0; i < b.length; i++) {
    if (usedB.has(i) || !b[i].type || !bound(b[i], b[i])) continue;
    // a locked item that went far: the one of its type it is (same content), else the most alike, else the first
    let j = -1;
    let best = -1;
    for (let k = 0; k < a.length; k++) {
      if (usedA.has(k) || a[k].type !== b[i].type) continue;
      const score = a[k].key === b[i].key ? Infinity : alike(b[i].raw, a[k].raw);
      if (score > best) [j, best] = [k, score];
    }
    if (j < 0) continue;
    pairs.push({ i, j, same: a[j].key === b[i].key });
    usedB.add(i);
    usedA.add(j);
  }
  // in list order: the order checks read the after-positions as the before list runs
  pairs.sort((x, y) => x.i - y.i);
  const moving = [];
  for (const p of pairs) {
    const x = b[p.i];
    const y = a[p.j];
    // an editor may take a marker off in the same save: what stays locked is what both sides say
    const lock = bound(x, y);
    const ch = changeOf(markIn(x), markIn(y), x.rule, { path: y.path, type: y.type, label: y.label });
    if (ch) out.changes.push(ch);
    if (lock?.move) moving.push({ ...p, lock, it: x });
    if (!p.same && lock?.edit) {
      out.violations.push(violation('edit', x, lock));
      continue;
    }
    if (!p.same) inner?.(x, y);
  }
  for (const k of moving.filter((m) => !keptOrder(moving).has(m))) out.violations.push(violation('move', k.it, k.lock));
  for (let i = 0; i < b.length; i++) {
    if (usedB.has(i)) continue;
    // a box lock in the frontmatter outlives the box: what the saved side says of it counts too
    const lock = bound(b[i], b[i].fm ? { own: b[i].peer, mark: b[i].mark } : b[i]);
    if (lock?.remove) out.violations.push(violation('remove', b[i], lock));
  }
  for (let j = 0; j < a.length; j++) {
    const ch = usedA.has(j) ? null : changeOf(null, markIn(a[j]), a[j].rule, { path: a[j].path, type: a[j].type, label: a[j].label });
    if (ch) out.changes.push(ch);
  }
  return { pairs, added: a.length - usedA.size, removed: b.length - usedB.size };
}

// ---------- pages (JSON) ----------
const withoutLock = (v) => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== '_lock')) : v);
/** A list item without its marker in either place (its own, or its section value's). */
const itemWithoutLock = (v) => {
  const out = withoutLock(v);
  return isObj(out) && isObj(out.value) && '_lock' in out.value ? { ...out, value: withoutLock(out.value) } : out;
};
/** A list item's marker: its own `_lock`, else (action by action) its section value's. */
const itemMark = (v) => {
  if (!isObj(v)) return null;
  const inner = isObj(v.value) ? markOf(v.value._lock) : null;
  const own = markOf(v._lock);
  return inner || own ? { ...inner, ...own } : null;
};
const typeOfItem = (v) => (isObj(v) ? (typeof v.discriminant === 'string' ? v.discriminant : typeof v.type === 'string' ? v.type : null) : null);
const titleOf = (v) => {
  const inner = isObj(v?.value) ? v.value : v;
  const t = [inner?.title, inner?.heading, inner?.name, inner?.label].find((x) => typeof x === 'string' && x.trim());
  return t ? `“${t.trim().slice(0, 60)}”` : null;
};

function jsonItems(list, path, rules) {
  return list.map((v, i) => {
    const type = typeOfItem(v);
    return { key: JSON.stringify(itemWithoutLock(v)), type, own: itemMark(v), rule: type ? lockOf(rules[type]) : null, label: titleOf(v) ?? (type ? `The ${type} section` : `Item ${i + 1}`), path: `${path}[${i}]`, raw: v };
  });
}

function checkJson(b, a, path, rules, out) {
  if (Array.isArray(b) && Array.isArray(a) && (b.some(isObj) || a.some(isObj))) {
    checkList(jsonItems(b, path, rules), jsonItems(a, path, rules), out, (x, y) => checkJson(itemWithoutLock(x.raw), itemWithoutLock(y.raw), x.path, rules, out));
  } else if (isObj(b) && isObj(a)) {
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) if (k !== '_lock') checkJson(b[k], a[k], path ? `${path}.${k}` : k, rules, out);
  }
}

function pageReport(before, after, rules) {
  const out = { violations: [], changes: [] };
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  // the page's own lock: {layout} (nothing added, deleted or reordered at the top level) and {edit} (read-only); it
  // binds while both sides have it, so an editor may take it off in the same save
  if (!sameJson(b._lock, a._lock)) out.changes.push({ change: !b._lock ? 'lock' : !a._lock ? 'unlock' : 'change', path: '_lock', type: null, label: 'The whole page', from: b._lock ?? null, to: a._lock ?? null });
  const holds = (k) => b._lock?.[k] === true && a._lock?.[k] === true;
  const entry = { path: '', type: null, label: 'This page' };
  if (holds('edit') && !sameJson(withoutLock(b), withoutLock(a))) out.violations.push(violation('edit', entry, null));
  const layout = holds('layout');
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (k === '_lock') continue;
    const bv = b[k];
    const av = a[k];
    if (layout && Array.isArray(bv) && Array.isArray(av) && bv.some(isObj)) {
      const r = checkList(jsonItems(bv, k, rules), jsonItems(av, k, rules), out, (x, y) => checkJson(itemWithoutLock(x.raw), itemWithoutLock(y.raw), x.path, rules, out));
      const order = r.pairs.map((p) => p.j);
      if (r.added || r.removed || order.some((j, n) => n && j < order[n - 1])) out.violations.push(violation('layout', { path: k, type: null, label: 'The layout of this page' }, null));
    } else checkJson(bv, av, k, rules, out);
  }
  return out;
}

// ---------- articles (document + frontmatter) ----------
const textOf = (n) => (typeof n?.text === 'string' ? n.text : (n?.content ?? []).map(textOf).join(''));

/**
 * The article's top-level blocks as units: a locked heading's section, a run of one box (one the site's rules or a
 * `box` lock name), or one block. A box's marker comes from this side's frontmatter (`boxes`) or its lock attribute.
 */
function articleUnits(doc, headings, rules, boxes, named, peers) {
  const nodes = Array.isArray(doc?.content) ? doc.content : [];
  const units = [];
  for (let i = 0; i < nodes.length; ) {
    const n = nodes[i];
    const h = n.type === 'heading' ? headings.find((x) => x.heading === textOf(n).trim()) : null;
    let end = i + 1;
    if (h) {
      const level = n.attrs?.level ?? 1;
      while (end < nodes.length && !(nodes[end].type === 'heading' && (nodes[end].attrs?.level ?? 1) <= level)) end++;
    } else if (rules[n.type] || named.has(n.type)) while (end < nodes.length && nodes[end].type === n.type) end++;
    const part = nodes.slice(i, end);
    const fromFm = !h && named.has(n.type);
    // every box of a run counts, not only its first, and a box's own lock still holds where the frontmatter lifts a rule
    const mark = h ? null : unite(...part.map((x) => markOf(x.attrs?.lock ?? x.attrs?.['data-lock'])));
    const own = h ? lockOf(h) : fromFm ? over(mark, markOf(boxes.get(n.type))) : mark;
    const type = h ? `heading:${h.heading}` : n.type;
    const label = h ? `The section “${h.heading}”` : rules[n.type] || named.has(n.type) ? `The ${n.type} box` : `Block ${units.length + 1}`;
    units.push({ key: JSON.stringify(part.map((x) => (isObj(x.attrs) && ('lock' in x.attrs || 'data-lock' in x.attrs) ? { ...x, attrs: { ...x.attrs, lock: undefined, 'data-lock': undefined } } : x))), type, own, mark, fm: h ? false : fromFm, peer: fromFm ? over(mark, markOf(peers.get(n.type))) : null, rule: h ? null : lockOf(rules[n.type]), label, path: `blocks[${i}]`, raw: part });
    i = end;
  }
  return units;
}

const headingLocks = (fm) => (Array.isArray(fm?.locks) ? fm.locks.filter((x) => isObj(x) && typeof x.heading === 'string' && x.heading.trim()).map((x) => ({ ...x, heading: x.heading.trim() })) : []);
/** Frontmatter `locks: [{box, …}]`: block name -> its marker (the last one of a name wins). */
const boxLocks = (fm) => new Map((Array.isArray(fm?.locks) ? fm.locks : []).filter((x) => isObj(x) && typeof x.box === 'string' && x.box.trim()).map((x) => [x.box.trim(), x]));

function articleReport(before, after, rules) {
  const out = { violations: [], changes: [] };
  const hb = headingLocks(before.frontmatter);
  const ha = headingLocks(after.frontmatter);
  for (const h of hb) {
    const now = ha.find((x) => x.heading === h.heading);
    if (!sameJson(lockOf(h), now && lockOf(now))) out.changes.push({ change: now ? 'change' : 'unlock', path: 'locks', type: 'heading', heading: h.heading, label: `The section “${h.heading}”`, from: lockOf(h), to: now ? lockOf(now) : null });
  }
  for (const h of ha) if (!hb.some((x) => x.heading === h.heading)) out.changes.push({ change: 'lock', path: 'locks', type: 'heading', heading: h.heading, label: `The section “${h.heading}”`, from: null, to: lockOf(h) });
  // a heading lock binds while both sides have it (an editor takes it off first, or in the same save)
  const held = hb.map((h) => ({ heading: h.heading, ...(both(lockOf(h), lockOf(ha.find((x) => x.heading === h.heading))) ?? {}) })).filter((h) => lockOf(h));
  // box locks: one change per name; the runs of that box read their marker from their own side
  const bb = boxLocks(before.frontmatter);
  const ba = boxLocks(after.frontmatter);
  const named = new Set([...bb.keys(), ...ba.keys()]);
  for (const box of named) {
    const ch = changeOf(markOf(bb.get(box)), markOf(ba.get(box)), lockOf(rules[box]), { path: 'locks', type: 'box', label: `The ${box} box` });
    if (ch) out.changes.push({ ...ch, box });
  }
  checkList(articleUnits(before.doc, held, rules, bb, named, ba), articleUnits(after.doc, held, rules, ba, named, bb), out);
  return out;
}

/** Everything a save does against locks: what it may not do, and the lock markers it adds, takes off or changes. */
export function lockReport(before, after, rules = {}) {
  if (before && 'doc' in before) return articleReport(before, after ?? {}, rules.articles ?? {});
  return pageReport(before?.data, after?.data, rules.pages ?? {});
}
/** What a save may not do: each locked block it moves, deletes or changes (empty when none). */
export const checkLocks = (before, after, rules) => lockReport(before, after, rules).violations;
/** The lock markers a save adds, takes off or changes (only an owner, administrator or editor may). */
export const lockChanges = (before, after, rules) => lockReport(before, after, rules).changes;

// ---------- the site's rules, kept as data (Settings → Locks) ----------
/**
 * The site's rules can be changed in the editor (owner and administrator): they are kept in this file at the site's
 * root, beside markstage.config, and win over the config's `locks` when it is there. The config stays code nobody
 * edits from a screen; the file is data, committed like an entry.
 */
export const LOCK_RULES_FILE = 'markstage.locks.json';
const KIND = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** Rules as {pages, articles} of {<type>: {move?, remove?, edit?}} (true only), from any accepted form; throws a
 * plain-words Error on a wrong shape. */
export function normalizeLockRules(v) {
  const bad = (why) => {
    throw new Error(`Lock rules: ${why}. Use {"pages": {"hero": ["move", "remove"]}, "articles": {"faq": ["remove"]}}.`);
  };
  if (v === undefined || v === null) return { pages: {}, articles: {} };
  if (!isObj(v)) bad('not an object');
  const out = { pages: {}, articles: {} };
  for (const [where, rules] of Object.entries(v)) {
    if (!(where in out)) bad(`"${where}" is not pages or articles`);
    if (!isObj(rules)) bad(`${where} is not an object`);
    for (const [type, what] of Object.entries(rules)) {
      if (!KIND.test(type)) bad(`"${type}" is not a section type or box name`);
      const list = Array.isArray(what) ? what : isObj(what) ? WHAT.filter((w) => what[w] === true) : bad(`${where}.${type} is not a list`);
      if (list.some((w) => !WHAT.includes(w))) bad(`${where}.${type} names something other than move, remove or edit`);
      const l = lockOf(list);
      if (l) out[where][type] = l;
    }
  }
  return out;
}

/** The file's text for these rules: the config's own list form, keys sorted, so a change reads as a small diff. */
export function lockRulesText(rules) {
  const n = normalizeLockRules(rules);
  const side = (r) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, WHAT.filter((w) => r[k][w])]));
  return `${JSON.stringify({ pages: side(n.pages), articles: side(n.articles) }, null, 2)}\n`;
}
