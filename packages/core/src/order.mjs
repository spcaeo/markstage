// Ordering a list or a tree of items, the same everywhere (docs/OPERATIONS.md "Order, move, delete and hierarchy"):
// the editor's order component draws and drags, these functions decide. Items are { id, children?, lock? }; a tree
// is an array of them. Nothing is changed in place: every function returns a new array (items keep their identity).
//
//   flatten(tree)                      -> [{ item, depth, parent, index, path }] in reading order
//   find(tree, id)                     -> that row, or null
//   moveItems(tree, ids, { parent, index })   -> the tree with `ids` (in reading order) at `index` among `parent`'s
//                                          children (index counted without the moved items); null parent: top level
//   removeItems(tree, ids)             -> { tree, removed: [{ item, parent, index }] } (restore with restoreItems)
//   restoreItems(tree, removed)        -> the removed items back where they were
//   placeOf(tree, id)                  -> { parent, index } of an item (for "move back")
//   canMove / canRemove (lock rules)   -> { ok, reason }

const kids = (item) => item.children ?? [];

export function flatten(tree, depth = 0, parent = null, out = [], path = []) {
  tree.forEach((item, index) => {
    const p = [...path, index];
    out.push({ item, depth, parent, index, path: p });
    if (item.children?.length) flatten(item.children, depth + 1, item.id, out, p);
  });
  return out;
}

export const find = (tree, id) => flatten(tree).find((r) => r.item.id === id) ?? null;

export const placeOf = (tree, id) => {
  const r = find(tree, id);
  return r ? { parent: r.parent, index: r.index } : null;
};

/** The ids with every descendant of an id in the list left out (moving a parent moves its children). */
function tops(tree, ids) {
  const want = new Set(ids);
  return flatten(tree)
    .filter((r) => want.has(r.item.id))
    .filter((r) => !ancestors(tree, r.item.id).some((a) => want.has(a)))
    .map((r) => r.item.id);
}

/** The ids above an item, nearest first. */
export function ancestors(tree, id) {
  const rows = flatten(tree);
  const out = [];
  let r = rows.find((x) => x.item.id === id);
  while (r?.parent) {
    out.push(r.parent);
    r = rows.find((x) => x.item.id === r.parent);
  }
  return out;
}

/** `tree` without the items `ids` (anywhere); `taken` gets them in reading order. */
function without(tree, ids, taken) {
  const out = [];
  for (const item of tree) {
    if (ids.has(item.id)) {
      taken.push(item);
      continue;
    }
    out.push(item.children ? { ...item, children: without(item.children, ids, taken) } : item);
  }
  return out;
}

/** `tree` with `items` inserted at `index` among the children of `parent` (null: the top level). */
function insert(tree, parent, index, items) {
  if (parent === null) {
    const i = Math.max(0, Math.min(index, tree.length));
    return [...tree.slice(0, i), ...items, ...tree.slice(i)];
  }
  return tree.map((item) => {
    if (item.id === parent) {
      const c = kids(item);
      const i = Math.max(0, Math.min(index, c.length));
      return { ...item, children: [...c.slice(0, i), ...items, ...c.slice(i)] };
    }
    return item.children ? { ...item, children: insert(item.children, parent, index, items) } : item;
  });
}

export function moveItems(tree, ids, to) {
  const moving = tops(tree, ids);
  if (!moving.length) return tree;
  // an item cannot go inside itself
  if (to.parent !== null && (moving.includes(to.parent) || ancestors(tree, to.parent).some((a) => moving.includes(a)))) return tree;
  if (to.parent !== null && !find(tree, to.parent)) return tree;
  const taken = [];
  const rest = without(tree, new Set(moving), taken);
  return insert(rest, to.parent, to.index, taken);
}

export function removeItems(tree, ids) {
  const gone = tops(tree, ids);
  const removed = gone.map((id) => ({ ...placeOf(tree, id), item: find(tree, id).item }));
  const taken = [];
  return { tree: without(tree, new Set(gone), taken), removed };
}

export function restoreItems(tree, removed) {
  // back in reading order, each at its old index (the earlier ones are back first, so the indexes hold)
  return removed.reduce((t, r) => insert(t, r.parent, r.index, [r.item]), tree);
}

const who = (lock) => (lock?.by ? `Locked by ${lock.by}` : 'Locked');

/** Whether the items may move: none of them (or an item above them) is move-locked. */
export function canMove(tree, ids) {
  for (const id of ids) {
    const r = find(tree, id);
    if (r?.item.lock?.move) return { ok: false, reason: `${who(r.item.lock)}: can't be moved.` };
  }
  return { ok: true, reason: '' };
}

/** Whether the items may be removed: none of them, and nothing inside them, is remove-locked. */
export function canRemove(tree, ids) {
  for (const id of ids) {
    const r = find(tree, id);
    if (!r) continue;
    for (const x of [r, ...flatten(kids(r.item))]) if (x.item.lock?.remove) return { ok: false, reason: `${who(x.item.lock)}: can't be deleted.` };
  }
  return { ok: true, reason: '' };
}
