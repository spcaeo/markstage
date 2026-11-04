// setFrontmatter(text, changes): change some frontmatter keys and leave every other byte of the file alone.
//   setFrontmatter(text, { title: 'New', seo: { description: 'Short' }, legacy: null })
// - a key whose value is unchanged is not touched (same value -> same file);
// - a mapping given for a mapping is merged key by key, so only the keys that change are rewritten;
// - null removes a key; a new key goes after the last key of its mapping;
// - a changed value keeps the old one's style: quotes ('' or ""), plain, folded (>-) or literal (|), flow [a, b],
//   and a list indented or not under its key; comments and the order of keys stay as they are;
// - a file without frontmatter gets one.
import YAML from 'yaml';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const lineStart = (src, i) => src.lastIndexOf('\n', i - 1) + 1;
/** The end of the line `i` is on, after its newline (a range that already ends with one stays). */
function lineEnd(src, i) {
  if (i > 0 && src[i - 1] === '\n') return i;
  const n = src.indexOf('\n', i);
  return n < 0 ? src.length : n + 1;
}

/** One pair's text: `key: value`, at `column`, `depth` levels deep, in the style of `old` (the value node it replaces). */
function render(src, key, value, old, column, depth) {
  // A nested pair is rendered under `depth` stand-in keys, so its text wraps at the same width as in the whole file.
  const step = depth > 0 && column % depth === 0 && column / depth >= 2 ? column / depth : 2;
  let wrapped = { [key]: value };
  for (let d = 0; d < depth; d++) wrapped = { x: wrapped };
  const doc = new YAML.Document(wrapped);
  const node = doc.getIn([...Array(depth).fill('x'), key], true);
  if (YAML.isScalar(node) && YAML.isScalar(old) && typeof value === 'string' && old.type) node.type = old.type;
  if (YAML.isCollection(node) && YAML.isCollection(old) && old.flow) node.flow = true;
  // list items take the style of the old item at their place (or the last one)
  if (YAML.isSeq(node) && YAML.isSeq(old) && old.items.length)
    node.items.forEach((item, i) => {
      const was = old.items[Math.min(i, old.items.length - 1)];
      if (YAML.isScalar(item) && YAML.isScalar(was) && typeof item.value === 'string' && was.type) item.type = was.type;
    });
  // a value written on one line stays on one line, however long (the file's writer did not fold it)
  const oneLine = YAML.isScalar(old) && old.range && !src.slice(old.range[0], old.range[1]).includes('\n') && !/^[|>]/.test(src.slice(old.range[0], old.range[1]));
  // a list written at its key's column (key:\n- a) stays that way
  const indentSeq = !(YAML.isSeq(old) && !old.flow && old.items[0]?.range && old.range[0] - lineStart(src, old.range[0]) === column);
  let lines = doc.toString({ indent: step, indentSeq, lineWidth: oneLine ? 0 : 80 }).replace(/\n$/, '').split('\n').slice(depth);
  const have = lines[0].length - lines[0].trimStart().length;
  if (have !== column) lines = lines.map((l) => (l ? ' '.repeat(column) + l.slice(have) : l));
  return `${lines.join('\n')}\n`;
}

/** `current` with `change` applied as setFrontmatter applies it (null removes; a mapping that loses every key goes). */
function merged(current, change) {
  if (!isObject(change)) return change;
  const out = isObject(current) ? { ...current } : {};
  for (const [k, v] of Object.entries(change)) {
    const next = v === null || v === undefined ? undefined : merged(out[k], v);
    if (next === undefined || (isObject(next) && !Object.keys(next).length && isObject(v))) delete out[k];
    else out[k] = next;
  }
  return out;
}
const emptied = (v) => isObject(v) && !Object.keys(v).length;

function applyMap(src, map, changes, depth, edits) {
  const pairs = map.items;
  const column = pairs[0] ? pairs[0].key.range[0] - lineStart(src, pairs[0].key.range[0]) : 0;
  let append = '';
  for (const [key, value] of Object.entries(changes)) {
    const pair = pairs.find((p) => (YAML.isScalar(p.key) ? p.key.value : p.key) === key);
    if (!pair) {
      const add = merged(undefined, value);
      if (add !== null && add !== undefined && !(isObject(value) && emptied(add))) append += render(src, key, add, null, column, depth);
      continue;
    }
    const old = pair.value;
    const current = old == null ? null : old.toJSON();
    const start = lineStart(src, pair.key.range[0]);
    const end = lineEnd(src, old?.range ? old.range[1] : pair.key.range[1]);
    // a mapping whose last keys are removed goes with its key (no `cover:` left behind as null)
    const gone = isObject(value) && emptied(merged(current, value));
    if (gone && !isObject(current)) continue;
    if (value === null || value === undefined || gone) {
      edits.push([start, end, '']);
      continue;
    }
    if (same(current, value)) continue;
    if (isObject(value) && YAML.isMap(old) && !old.flow && old.items.length) {
      applyMap(src, old, value, depth + 1, edits);
      continue;
    }
    const text = render(src, key, isObject(value) ? merged(current, value) : value, old, column, depth);
    // a one-line value replaced by a one-line value: only the value changes (the key, spacing and comment stay)
    const fresh = text.indexOf('\n') === text.length - 1 ? YAML.parseDocument(text).contents?.items?.[0]?.value : null;
    const oneLine = (node, t) => YAML.isScalar(node) && node.range && !/^[|>]/.test(t) && !t.includes('\n');
    const value1 = fresh?.range ? text.slice(fresh.range[0], fresh.range[1]) : '';
    if (oneLine(fresh, value1) && YAML.isScalar(old) && old.range && oneLine(old, src.slice(old.range[0], old.range[1]))) {
      edits.push([old.range[0], old.range[1], value1]);
    } else edits.push([start, end, text]);
  }
  if (append) {
    const last = pairs[pairs.length - 1];
    const at = last ? lineEnd(src, last.value?.range ? last.value.range[1] : last.key.range[1]) : src.length;
    edits.push([at, at, append]);
  }
}

/** The file text with the frontmatter `changes` applied (see the top of this file). */
export function setFrontmatter(text, changes) {
  if (!isObject(changes)) throw new TypeError('setFrontmatter: changes must be an object');
  const m = /^---\r?\n([\s\S]*?)(\r?\n)?---\r?\n/.exec(text);
  if (!m) {
    const add = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== null && v !== undefined));
    if (!Object.keys(add).length) return text;
    return `---\n${YAML.stringify(add, { lineWidth: 80 })}---\n${text ? `\n${text.replace(/^\n/, '')}` : ''}`;
  }
  const open = text.indexOf('\n') + 1;
  const close = m[0].slice(m[0].lastIndexOf('---'));
  const inner = m[1] ? `${m[1]}\n` : '';
  const doc = YAML.parseDocument(inner);
  if (doc.errors.length) throw doc.errors[0];
  if (doc.contents && !YAML.isMap(doc.contents)) throw new TypeError('setFrontmatter: the frontmatter is not a mapping');
  const edits = [];
  applyMap(inner, doc.contents ?? new YAML.YAMLMap(), changes, 0, edits);
  if (!edits.length) return text;
  let out = inner;
  for (const [s, e, t] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1])) out = out.slice(0, s) + t + out.slice(e);
  return text.slice(0, open) + out + close + text.slice(m[0].length);
}
