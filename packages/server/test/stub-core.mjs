// A stand-in for @markstage/core until it lands: enough Markdown <-> doc to drive the server. Blocks are split on
// blank lines; a block starting with "<" is raw HTML (`rawHtml` node), "# " a heading, the rest paragraphs.
// The frontmatter reader handles the flat YAML the fixtures use (scalars, quoted strings, `- item` lists).
const FM = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/;

// frontmatter writes and the CommonMark URL reader are core's own, so the server's status and settings edits and its
// link-scheme rule are tested with them
export { markdownUrls, setFrontmatter } from '@markstage/core';

const scalar = (v) => {
  const s = v.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~' || s === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^".*"$/.test(s)) return JSON.parse(s);
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^\[.*\]$/.test(s)) return JSON.parse(s);
  return s;
};

export function parseFrontmatter(text) {
  const m = FM.exec(text);
  if (!m) return {};
  const out = {};
  let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      out[listKey].push(scalar(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[2].trim() === '') {
      out[kv[1]] = [];
      listKey = kv[1];
    } else {
      out[kv[1]] = scalar(kv[2]);
      listKey = null;
    }
  }
  return out;
}

const split = (text) => {
  const m = FM.exec(text);
  const fm = m ? m[0] : '';
  const rest = text.slice(fm.length);
  const lead = /^\n*/.exec(rest)[0];
  const trail = /\n*$/.exec(rest)[0];
  const body = rest.slice(lead.length, rest.length - trail.length);
  return { fm, lead, body, trail };
};

export function mdToDoc(text) {
  if (text.includes('\u0000')) throw new Error('binary content');
  const { body } = split(text);
  const content = body
    ? body.split('\n\n').map((b) => {
        if (b.startsWith('<')) return { type: 'rawHtml', attrs: { html: b } };
        if (b.startsWith('# ')) return { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: b.slice(2) }] };
        return { type: 'paragraph', content: [{ type: 'text', text: b }] };
      })
    : [];
  return { frontmatter: parseFrontmatter(text), doc: { type: 'doc', content } };
}

const textOf = (n) => (n.content ?? []).map((c) => c.text ?? '').join('');

export function docToMd(doc, original) {
  const { fm, lead, trail } = split(original);
  const body = (doc.content ?? [])
    .map((n) => (n.type === 'rawHtml' ? n.attrs.html : n.type === 'heading' ? `# ${textOf(n)}` : textOf(n)))
    .join('\n\n');
  return fm + (lead || '\n') + body + (trail || '\n');
}
