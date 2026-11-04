// A JSON parser that keeps positions. Every value becomes a node with its [start, end) offsets in the source text,
// so an edit can replace exactly the characters of one value and leave every other byte of the file as it was.
//
//   node = { type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null', start, end, value? }
//   object nodes: members = [{ key, keyStart, keyEnd, value: node }]   (key = the decoded key string)
//   array nodes:  items   = [node]
//
// Strict JSON (RFC 8259): no comments, no trailing commas. A syntax error throws with the offset and line/column.

/** @typedef {{ type: 'object'|'array'|'string'|'number'|'boolean'|'null', start: number, end: number, value?: unknown, members?: Member[], items?: Node[] }} Node */
/** @typedef {{ key: string, keyStart: number, keyEnd: number, value: Node }} Member */

const WS = new Set([' ', '\t', '\n', '\r']);

export class JsonSyntaxError extends Error {
  /** @param {string} message @param {string} text @param {number} at */
  constructor(message, text, at) {
    const before = text.slice(0, at);
    const line = before.split('\n').length;
    const column = at - before.lastIndexOf('\n');
    super(`${message} at line ${line}, column ${column} (offset ${at})`);
    this.name = 'JsonSyntaxError';
    this.offset = at;
    this.line = line;
    this.column = column;
  }
}

/**
 * Parses `text` into a position-keeping tree.
 * @param {string} text
 * @returns {{ root: Node, text: string }}
 */
export function parseTree(text) {
  let i = 0;
  const fail = (msg, at = i) => {
    throw new JsonSyntaxError(msg, text, at);
  };
  const ws = () => {
    while (i < text.length && WS.has(text[i])) i++;
  };
  const expect = (ch) => {
    if (text[i] !== ch) fail(`expected "${ch}"`);
    i++;
  };

  function string() {
    const start = i;
    expect('"');
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        i++;
        return { type: 'string', start, end: i, value: JSON.parse(text.slice(start, i)) };
      }
      if (c === '\\') {
        const n = text[i + 1];
        if (n === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('bad \\u escape');
          i += 6;
        } else if ('"\\/bfnrt'.includes(n)) i += 2;
        else fail('bad escape');
        continue;
      }
      if (c < ' ') fail('control character in string');
      i++;
    }
    return fail('unterminated string', start);
  }

  function number() {
    const start = i;
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (!m) fail('bad number');
    i += m[0].length;
    return { type: 'number', start, end: i, value: Number(m[0]) };
  }

  function word(w, type, value) {
    const start = i;
    if (text.startsWith(w, i)) {
      i += w.length;
      return { type, start, end: i, value };
    }
    return fail('unexpected token');
  }

  function value() {
    ws();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === 't') return word('true', 'boolean', true);
    if (c === 'f') return word('false', 'boolean', false);
    if (c === 'n') return word('null', 'null', null);
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    return fail(i >= text.length ? 'unexpected end of input' : `unexpected "${c}"`);
  }

  function object() {
    const start = i;
    expect('{');
    /** @type {Member[]} */
    const members = [];
    ws();
    if (text[i] === '}') {
      i++;
      return { type: 'object', start, end: i, members };
    }
    for (;;) {
      ws();
      const k = string();
      ws();
      expect(':');
      const v = value();
      members.push({ key: /** @type {string} */ (k.value), keyStart: k.start, keyEnd: k.end, value: v });
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      expect('}');
      return { type: 'object', start, end: i, members };
    }
  }

  function array() {
    const start = i;
    expect('[');
    /** @type {Node[]} */
    const items = [];
    ws();
    if (text[i] === ']') {
      i++;
      return { type: 'array', start, end: i, items };
    }
    for (;;) {
      items.push(value());
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      expect(']');
      return { type: 'array', start, end: i, items };
    }
  }

  const root = value();
  ws();
  if (i < text.length) fail('unexpected text after the value');
  return { root, text };
}

/**
 * The plain value of a node (objects keep their key order; a repeated key keeps the last value, as JSON.parse does).
 * @param {Node} node
 * @returns {unknown}
 */
export function nodeValue(node) {
  if (node.type === 'object') return Object.fromEntries(node.members.map((m) => [m.key, nodeValue(m.value)]));
  if (node.type === 'array') return node.items.map(nodeValue);
  return node.value;
}
