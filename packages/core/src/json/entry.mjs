// A JSON entry (a page, an author, a settings file) opened for editing. Every change is made on the file's text:
// the characters of the value that changed are replaced and nothing else moves, so a save rewrites only the changed
// paths, keeps the file's indent, newlines, key order and string escapes, and open + save with no edit returns the
// file byte for byte.
//
//   const e = JsonEntry.parse(text, { schema, policy });
//   e.set('sections.3.value.heading', 'New heading');
//   e.insert('sections', 4, section); e.move('sections', 4, 1); e.duplicate('sections', 1); e.remove('sections.2');
//   fs.writeFileSync(file, e.text);
//
// With a schema (the entry's root field, see schema.mjs) a new key goes where the tool would write it and new values
// are normalized (key order, omitted empties per `policy`); without one, new keys are appended.

import { parseTree, nodeValue } from './parse.mjs';
import { detectStyle, lineIndent, serialize, sameValue } from './format.mjs';
import { toPath, pathString } from './path.mjs';
import { fieldAt, keyOrder, normalize } from './schema.mjs';

/** @typedef {import('./parse.mjs').Node} Node */
/** @typedef {{ omit?: (value: unknown, field: any) => boolean }} Policy */
/** @typedef {{ op: 'set' | 'remove' | 'insert' | 'move' | 'duplicate', path: string, to?: number }} Change */

export class JsonEntry {
  /** @type {string} */ #text;
  /** @type {Node | undefined} */ #root;
  /** @type {unknown} */ #value;
  #style;
  #schema;
  /** @type {Policy | undefined} */ #policy;
  /** @type {Change[]} */ #changes = [];

  /**
   * @param {string} text
   * @param {{ schema?: any, policy?: Policy }} [options] schema = the entry's root field
   */
  constructor(text, options = {}) {
    this.#text = text;
    this.#schema = options.schema;
    this.#policy = options.policy;
    this.#tree();
    this.#style = detectStyle(text, /** @type {Node} */ (this.#root));
  }

  /** @param {string} text @param {{ schema?: any, policy?: Policy }} [options] */
  static parse(text, options) {
    return new JsonEntry(text, options);
  }

  /** The file text as it would be saved. */
  get text() {
    return this.#text;
  }
  toString() {
    return this.#text;
  }
  /** The entry's data. */
  get value() {
    if (this.#value === undefined) this.#value = nodeValue(this.#tree());
    return this.#value;
  }
  /** The edits made since opening, in order. */
  get changes() {
    return this.#changes.slice();
  }
  get changed() {
    return this.#changes.length > 0;
  }
  get style() {
    return { ...this.#style };
  }

  has(path) {
    return this.#find(toPath(path)).node !== undefined;
  }

  /** The value at `path` (undefined when absent). */
  get(path) {
    const { node } = this.#find(toPath(path));
    return node ? nodeValue(node) : undefined;
  }

  /** The schema field at `path` (needs a schema). */
  field(path) {
    return this.#schema ? fieldAt(this.#schema, path, this.value) : undefined;
  }

  /**
   * Sets the value at `path`, creating missing object keys on the way. A value the policy omits (or undefined)
   * removes the key. Setting the value it already has changes nothing.
   */
  set(path, value) {
    const p = toPath(path);
    if (!p.length) throw new Error('set needs a path inside the entry');
    const field = this.field(p);
    const v = this.#schema ? normalize(value, field, this.#policy) : value;
    if (v === undefined || (this.#policy?.omit?.(v, field) && typeof p[p.length - 1] === 'string')) {
      if (this.has(p)) this.remove(p);
      return this;
    }
    const { node, parents } = this.#find(p);
    if (node) {
      if (sameValue(nodeValue(node), v)) return this;
      this.#splice(node.start, node.end, serialize(v, this.#style, lineIndent(this.#text, node.start)));
      return this.#log('set', p);
    }
    // the deepest container that exists, and what is missing under it
    const depth = parents.length - 1; // how many segments of the path exist
    const holder = parents[depth].node;
    const rest = p.slice(depth);
    let fill = v;
    for (let i = rest.length - 1; i >= 1; i--) {
      const seg = rest[i];
      if (typeof seg === 'number') throw new Error(`no item ${seg} at ${pathString(p.slice(0, depth + i))}`);
      fill = { [seg]: fill };
    }
    if (this.#schema && rest.length > 1) fill = normalize(fill, this.field(p.slice(0, depth + 1)), this.#policy);
    const seg = rest[0];
    if (holder.type === 'object') {
      if (typeof seg !== 'string') throw new Error(`${pathString(p.slice(0, depth))} is an object; "${seg}" is not a key`);
      this.#insertMember(holder, p.slice(0, depth), seg, fill);
    } else if (holder.type === 'array') {
      if (seg !== holder.items.length) throw new Error(`no item ${seg} at ${pathString(p.slice(0, depth))}`);
      this.#insertItem(holder, seg, serialize(fill, this.#style, this.#itemIndent(holder)));
    } else throw new Error(`${pathString(p.slice(0, depth))} holds a ${holder.type}, not a container`);
    return this.#log('set', p);
  }

  /** Removes an object key or an array item. */
  remove(path) {
    const p = toPath(path);
    const { node, parents } = this.#find(p);
    if (!node) throw new Error(`nothing at ${pathString(p)}`);
    const box = parents[parents.length - 1].node;
    const seg = p[p.length - 1];
    const k = box.type === 'object' ? box.members.findIndex((m) => m.key === String(seg)) : /** @type {number} */ (seg);
    this.#cut(box, k);
    return this.#log('remove', p);
  }

  /** Inserts `value` into the array at `path` before index `index` (index = length appends). */
  insert(path, index, value) {
    const p = toPath(path);
    const box = this.#array(p);
    if (!Number.isInteger(index) || index < 0 || index > box.items.length) throw new Error(`index ${index} out of range at ${pathString(p)}`);
    const v = this.#schema ? normalize(value, this.field([...p, index]) ?? this.field(p)?.item, this.#policy) : value;
    this.#insertItem(box, index, serialize(v, this.#style, this.#itemIndent(box)));
    return this.#log('insert', [...p, index]);
  }

  /** Appends `value` to the array at `path`. */
  push(path, value) {
    return this.insert(path, this.#array(toPath(path)).items.length, value);
  }

  /** Moves item `from` of the array at `path` so it ends up at index `to`; its text moves unchanged. */
  move(path, from, to) {
    const p = toPath(path);
    const box = this.#array(p);
    const n = box.items.length;
    if (![from, to].every((x) => Number.isInteger(x) && x >= 0 && x < n)) throw new Error(`move ${from} -> ${to} out of range at ${pathString(p)}`);
    if (from === to) return this;
    const raw = this.#raw(box.items[from]);
    this.#cut(box, from);
    this.#insertItem(this.#array(p), to, raw);
    this.#changes.push({ op: 'move', path: pathString([...p, from]), to });
    return this;
  }

  /** Copies item `index` of the array at `path` (its exact text) to `index + 1`; returns the new index. */
  duplicate(path, index) {
    const p = toPath(path);
    const box = this.#array(p);
    if (!Number.isInteger(index) || index < 0 || index >= box.items.length) throw new Error(`no item ${index} at ${pathString(p)}`);
    this.#insertItem(box, index + 1, this.#raw(box.items[index]));
    this.#log('duplicate', [...p, index]);
    return index + 1;
  }

  // ---------- internals ----------

  #tree() {
    if (!this.#root) this.#root = parseTree(this.#text).root;
    return this.#root;
  }

  #log(op, p) {
    this.#changes.push({ op, path: pathString(p) });
    return this;
  }

  /** The node at `p` and the containers above it (parents[i].node holds segment p[i]); when the node is missing,
   * parents ends with the deepest container that exists. */
  #find(p) {
    /** @type {{ node: Node }[]} */
    const parents = [];
    /** @type {Node | undefined} */
    let node = this.#tree();
    for (const seg of p) {
      if (!node) break;
      parents.push({ node });
      if (node.type === 'object') node = node.members.findLast((m) => m.key === String(seg))?.value;
      else if (node.type === 'array') node = typeof seg === 'number' ? node.items[seg] : undefined;
      else node = undefined;
    }
    return { node, parents };
  }

  #array(p) {
    const { node } = this.#find(p);
    if (!node || node.type !== 'array') throw new Error(`${pathString(p) || '(root)'} is not an array`);
    return node;
  }

  #raw(node) {
    return this.#text.slice(node.start, node.end);
  }

  #splice(start, end, insert) {
    this.#text = this.#text.slice(0, start) + insert + this.#text.slice(end);
    this.#root = undefined;
    this.#value = undefined;
  }

  /** The indent of an array's items (from an existing one, else one step in from the array's line). */
  #itemIndent(box) {
    if (box.items.length && this.#style.pretty) return lineIndent(this.#text, box.items[0].start);
    return lineIndent(this.#text, box.start) + (this.#style.pretty ? this.#style.indent : '');
  }

  /** Whitespace between two entries of `box` (copied from the file when it has two, else built from the style). */
  #gap(box, entryStart) {
    const starts = box.type === 'object' ? box.members.map((m) => m.keyStart) : box.items.map((n) => n.start);
    const ends = box.type === 'object' ? box.members.map((m) => m.value.end) : box.items.map((n) => n.end);
    if (starts.length >= 2) return this.#text.slice(ends[0], starts[1]).replace(/^\s*,/, '');
    if (!this.#style.pretty) return '';
    return this.#style.newline + lineIndent(this.#text, entryStart);
  }

  /** Puts already-serialized `raw` into array `box` before index `k`. */
  #insertItem(box, k, raw) {
    const n = box.items.length;
    if (!n) {
      const base = lineIndent(this.#text, box.start);
      const inner = this.#style.pretty ? this.#style.newline + base + this.#style.indent : '';
      const close = this.#style.pretty ? this.#style.newline + base : '';
      this.#splice(box.start, box.end, `[${inner}${raw}${close}]`);
      return;
    }
    const gap = this.#gap(box, box.items[0].start);
    if (k < n) this.#splice(box.items[k].start, box.items[k].start, `${raw},${gap}`);
    else this.#splice(box.items[n - 1].end, box.items[n - 1].end, `,${gap}${raw}`);
  }

  /** Adds key `key` to object `box` (at `at`), in schema order when there is a schema, else last. */
  #insertMember(box, at, key, value) {
    const n = box.members.length;
    const base = lineIndent(this.#text, box.start);
    const memberIndent = n && this.#style.pretty ? lineIndent(this.#text, box.members[0].keyStart) : base + this.#style.indent;
    const colon = this.#style.pretty ? this.#style.colon : this.#style.colon.trim() || ':';
    const raw = `${JSON.stringify(key)}${colon}${serialize(value, this.#style, memberIndent)}`;
    if (!n) {
      const inner = this.#style.pretty ? this.#style.newline + memberIndent : '';
      const close = this.#style.pretty ? this.#style.newline + base : '';
      this.#splice(box.start, box.end, `{${inner}${raw}${close}}`);
      return;
    }
    // after the last member whose key comes before `key` in the schema order
    const order = this.#schema ? keyOrder(this.field(at)) : undefined;
    let k = n;
    if (order?.includes(key)) {
      const rank = order.indexOf(key);
      k = 0;
      box.members.forEach((m, i) => {
        const r = order.indexOf(m.key);
        if (r === -1 || r < rank) k = i + 1;
      });
    }
    const gap = this.#gap(box, box.members[0].keyStart);
    if (k < n) this.#splice(box.members[k].keyStart, box.members[k].keyStart, `${raw},${gap}`);
    else this.#splice(box.members[n - 1].value.end, box.members[n - 1].value.end, `,${gap}${raw}`);
  }

  /** Removes entry `k` of `box` with the comma and whitespace that belonged to it. */
  #cut(box, k) {
    const starts = box.type === 'object' ? box.members.map((m) => m.keyStart) : box.items.map((n) => n.start);
    const ends = box.type === 'object' ? box.members.map((m) => m.value.end) : box.items.map((n) => n.end);
    const n = starts.length;
    if (k < 0 || k >= n) throw new Error(`no entry ${k}`);
    if (n === 1) this.#splice(box.start, box.end, box.type === 'object' ? '{}' : '[]');
    else if (k > 0) this.#splice(ends[k - 1], ends[k], '');
    else this.#splice(starts[0], starts[1], '');
  }
}
