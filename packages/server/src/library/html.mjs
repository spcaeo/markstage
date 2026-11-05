// HTML from elsewhere (a web page, a WordPress block) read for the Library's imports: a small tolerant reader into a
// tree, the page's parts, a clean copy to show, and Markdown for the site's converter. Nothing in it runs: scripts,
// styles, frames, forms, SVG and event attributes are dropped, and a link or image keeps only an http(s), mailto, tel
// or relative address (made absolute against the page).
const MAX_DEPTH = 100;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template']);
const DROP = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'template', 'svg', 'canvas', 'form', 'input', 'button', 'select', 'textarea', 'head', 'title', 'link', 'meta', 'nav', 'dialog', 'video', 'audio', 'picture source']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'table', 'figure', 'hr']);
const KEEP = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'a', 'strong', 'b', 'em', 'i', 'blockquote', 'img', 'br', 'hr', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'span', 'div', 'section', 'article', 'small', 'sup', 'sub']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·', laquo: '«', raquo: '»', times: '×', euro: '€', pound: '£' };

export const decode = (s) =>
  String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A tag's attributes ({name: value}, the first of each name), from the text after its name. */
export function attrsOf(src) {
  const out = {};
  for (const m of src.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** The HTML as a tree of {tag, attrs, children} and {text}. Unclosed paragraphs and list items are closed. */
export function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const close = (tag) => {
    const i = stack.map((n) => n.tag).lastIndexOf(tag);
    if (i > 0) stack.length = i;
  };
  // a tag runs to the next `>` and never past a `<`, so a tag that is never closed costs one scan (no backtracking)
  const re = /<!--[\s\S]*?(?:-->|$)|<![^<>]*>|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:[\s/][^<>]*)?)>|[^<]+|</g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [all, closing, opening, attrs] = m;
    if (all.startsWith('<!')) continue;
    if (closing) {
      close(closing.toLowerCase());
      continue;
    }
    if (opening) {
      const tag = opening.toLowerCase();
      if (RAW.has(tag)) {
        // their text is not HTML: skip to the closing tag
        const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
        re.lastIndex = end < 0 ? html.length : end;
        continue;
      }
      if (tag === 'p' || BLOCK.has(tag)) if (stack.some((n) => n.tag === 'p')) close('p');
      if (tag === 'li') {
        const li = stack.map((n) => n.tag).lastIndexOf('li');
        const list = Math.max(stack.map((n) => n.tag).lastIndexOf('ul'), stack.map((n) => n.tag).lastIndexOf('ol'));
        if (li > list && li > 0) stack.length = li;
      }
      const node = { tag, attrs: attrsOf((attrs ?? '').replace(/\/\s*$/, '')), children: [] };
      top().children.push(node);
      // nesting deeper than MAX_DEPTH is read flat (the walks below recurse, and no real page goes that deep)
      if (!VOID.has(tag) && !all.endsWith('/>') && stack.length < MAX_DEPTH) stack.push(node);
      continue;
    }
    // a run of text in pieces (a stray `<`) is one text node
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (last && last.text !== undefined) last.text += decode(all);
    else kids.push({ text: decode(all) });
  }
  return root;
}

const els = (n) => (n.children ?? []).filter((c) => c.tag);
/** The plain text of a node, spaces collapsed. */
export const textOf = (n) => (n.text !== undefined ? n.text : DROP.has(n.tag) ? '' : (n.children ?? []).map(textOf).join(n.tag && BLOCK.has(n.tag) ? ' ' : '')).replace(/\s+/g, ' ');
/** The text of a node as written (a <pre>'s lines kept). */
const rawText = (n) => (n.text !== undefined ? n.text : n.tag === 'br' ? '\n' : DROP.has(n.tag) ? '' : (n.children ?? []).map(rawText).join(''));
function find(n, tag) {
  if (n.tag === tag) return n;
  for (const c of els(n)) {
    const f = find(c, tag);
    if (f) return f;
  }
  return null;
}

/** An address kept as absolute http(s), mailto or tel, or null. */
export function safeUrl(value, base) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  try {
    const u = new URL(v, base);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * The page's parts, to choose from: its sections and articles (a header or footer without a menu too), or else its
 * content cut at each second-level heading. [{id: 'p1', label, node}].
 */
export function partsOf(root) {
  const main = find(root, 'main') ?? find(root, 'body') ?? root;
  const found = [];
  const walk = (n) => {
    for (const c of els(n)) {
      if (DROP.has(c.tag)) continue;
      if (c.tag === 'section' || c.tag === 'article' || ((c.tag === 'header' || c.tag === 'footer') && !find(c, 'nav'))) {
        if (textOf(c).trim()) found.push(c);
      } else walk(c);
    }
  };
  walk(main);
  let parts = found;
  if (found.length < 2) {
    let box = main;
    while (els(box).length === 1 && !els(box)[0].tag.match(/^h\d$/)) box = els(box)[0];
    parts = [];
    let cur = null;
    for (const c of box.children ?? []) {
      if (c.tag === 'h2' || !cur) {
        cur = { tag: 'section', attrs: {}, children: [] };
        parts.push(cur);
      }
      cur.children.push(c);
    }
    parts = parts.filter((p) => textOf(p).trim());
  }
  return parts.slice(0, 100).map((node, i) => {
    const h = ['h1', 'h2', 'h3'].map((t) => find(node, t)).find(Boolean);
    const label = (h ? textOf(h) : textOf(node)).trim().slice(0, 80) || `Part ${i + 1}`;
    return { id: `p${i + 1}`, label, node };
  });
}

/** Every image address in a node (absolute), in order. */
export function imagesOf(node, base) {
  const out = [];
  const walk = (n) => {
    if (n.tag === 'img') {
      const u = safeUrl(n.attrs.src, base);
      if (u && /^https?:/.test(u) && !out.includes(u)) out.push(u);
    }
    for (const c of els(n)) if (!DROP.has(c.tag)) walk(c);
  };
  walk(node);
  return out;
}

/** A clean copy of a node as HTML, to show before importing. */
export function cleanHtml(node, base) {
  if (node.text !== undefined) return esc(node.text);
  if (DROP.has(node.tag)) return '';
  const inner = (node.children ?? []).map((c) => cleanHtml(c, base)).join('');
  if (!KEEP.has(node.tag)) return inner;
  const a = [];
  if (node.tag === 'a') {
    const href = safeUrl(node.attrs.href, base);
    if (href) a.push(`href="${esc(href)}"`);
  }
  if (node.tag === 'img') {
    const src = safeUrl(node.attrs.src, base);
    if (!src) return '';
    a.push(`src="${esc(src)}"`, `alt="${esc(node.attrs.alt ?? '')}"`);
  }
  if ((node.tag === 'td' || node.tag === 'th') && /^\d+$/.test(node.attrs.colspan ?? '')) a.push(`colspan="${node.attrs.colspan}"`);
  const open = `<${node.tag}${a.length ? ` ${a.join(' ')}` : ''}>`;
  return VOID.has(node.tag) ? open : `${open}${inner}</${node.tag}>`;
}

const mdEsc = (s) => s.replace(/\\/g, '\\\\').replace(/([*_`[\]<>])/g, '\\$1').replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\\$2$3');

/**
 * A node as Markdown blocks (headings, paragraphs, lists, quotes, code, rules, tables, images). `src(url, node)` gives
 * the address an image is written with (its place in the site's media), or null to leave it out; `link(url)` the
 * address a link is written with (its new page), or null to keep the words alone.
 */
export function toMarkdown(node, { base, src = (u) => u, link = (u) => u } = {}) {
  // bold inside bold (<strong><strong>x</strong></strong>, which editors leave behind) is still one **x**
  const depth = { strong: 0, em: 0 };
  const marked = (kind, mark, kids) => {
    if (depth[kind]) return kids();
    depth[kind]++;
    try {
      const t = kids().trim();
      return t ? `${mark}${t}${mark}` : '';
    } finally {
      depth[kind]--;
    }
  };
  const inline = (n) => {
    if (n.text !== undefined) return mdEsc(n.text.replace(/\s+/g, ' '));
    if (DROP.has(n.tag)) return '';
    const kids = () => (n.children ?? []).map(inline).join('');
    switch (n.tag) {
      case 'strong':
      case 'b':
        return marked('strong', '**', kids);
      case 'em':
      case 'i':
        return marked('em', '*', kids);
      case 'code':
        return `\`${textOf(n).replace(/`/g, '')}\``;
      case 'br':
        return '  \n';
      case 'a': {
        const t = kids().trim();
        // a place on the same page (#section) stays one: resolved against the old address it would leave the page
        const own = String(n.attrs.href ?? '').trim();
        if (/^#[^\s<>"'`]+$/.test(own)) return t ? `[${t}](${own.replace(/\)/g, '%29')})` : '';
        const safe = safeUrl(n.attrs.href, base);
        const href = safe && link(safe);
        return href && t ? `[${t}](${href.replace(/\)/g, '%29')})` : t;
      }
      case 'img': {
        const u = safeUrl(n.attrs.src, base);
        const to = u && src(u, n);
        return to ? `![${mdEsc((n.attrs.alt ?? '').replace(/\s+/g, ' ').trim())}](${to})` : '';
      }
      default:
        return kids();
    }
  };
  const blocks = [];
  const para = (s) => {
    const t = s.replace(/[ \t]+\n/g, (m) => (m.startsWith('  ') ? m : '\n')).replace(/ {3,}/g, ' ').trim();
    if (t) blocks.push(t);
  };
  const list = (n, indent) => {
    let k = Number.parseInt(n.attrs.start ?? '1', 10) || 1;
    const lines = [];
    for (const li of els(n).filter((c) => c.tag === 'li')) {
      const own = (li.children ?? []).filter((c) => !(c.tag === 'ul' || c.tag === 'ol')).map(inline).join('').trim();
      const mark = n.tag === 'ol' ? `${k++}. ` : '- ';
      lines.push(`${indent}${mark}${own}`);
      // a list inside an item starts where the item's text does
      for (const sub of els(li).filter((c) => c.tag === 'ul' || c.tag === 'ol')) lines.push(...list(sub, indent + ' '.repeat(mark.length)));
    }
    return lines;
  };
  const block = (n) => {
    if (n.text !== undefined) return para(inline(n));
    if (DROP.has(n.tag)) return undefined;
    if (/^h[1-6]$/.test(n.tag)) return para(`${'#'.repeat(Number(n.tag[1]))} ${(n.children ?? []).map(inline).join('').trim()}`);
    if (n.tag === 'p' || n.tag === 'figcaption') return para((n.children ?? []).map(inline).join(''));
    if (n.tag === 'ul' || n.tag === 'ol') return void blocks.push(list(n, '').join('\n'));
    if (n.tag === 'hr') return void blocks.push('---');
    if (n.tag === 'pre') {
      const code = rawText(n).replace(/^\n/, '').replace(/\n$/, '');
      const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((m) => m[0].length + 1)));
      return void blocks.push(`${fence}\n${code}\n${fence}`);
    }
    if (n.tag === 'blockquote') {
      const inner = toMarkdown({ tag: 'div', attrs: {}, children: n.children ?? [] }, { base, src, link });
      return inner ? void blocks.push(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')) : undefined;
    }
    if (n.tag === 'img') return para(inline(n));
    if (n.tag === 'table') {
      const rows = [];
      const walk = (x) => (x.tag === 'tr' ? rows.push(els(x).filter((c) => c.tag === 'td' || c.tag === 'th').map((c) => (c.children ?? []).map(inline).join('').replace(/\|/g, '\\|').trim())) : els(x).forEach(walk));
      walk(n);
      if (!rows.length) return undefined;
      const w = Math.max(...rows.map((r) => r.length));
      const fill = (r) => `| ${[...r, ...Array(w - r.length).fill('')].join(' | ')} |`;
      return void blocks.push([fill(rows[0]), `|${' --- |'.repeat(w)}`, ...rows.slice(1).map(fill)].join('\n'));
    }
    // a container: its blocks, and its loose inline content as paragraphs
    let run = [];
    const flush = () => {
      para(run.map(inline).join(''));
      run = [];
    };
    for (const c of n.children ?? []) {
      if (c.text !== undefined || (c.tag && !BLOCK.has(c.tag) && c.tag !== 'img' && c.tag !== 'figcaption')) run.push(c);
      else {
        flush();
        block(c);
      }
    }
    flush();
    return undefined;
  };
  block(node);
  return blocks.join('\n\n');
}
