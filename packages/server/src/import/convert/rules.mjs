// A site's converter rules (docs/IMPORT.md "Converter rules"): old HTML patterns, found by a class name on a wrapper,
// written as MDX components with props taken from inside them (headings, text, lists, links, pictures, question and
// answer pairs, repeated cards). Used by convert/html.mjs for an MDX collection; a pattern with no rule keeps the
// importer's usual behaviour (clean Markdown, or an import note). Pure.
//
// rules = {
//   components: {CtaBand: {import: '../../components/blocks/CtaBand.astro'}},   optional: an import line per component
//   report: ['soa-', 't3-'],                    optional: a wrapper with a class of this prefix and no rule is noted
//   rules: [{match: 'callout_box' | ['a', 'b'] | {class: 'a' | ['a', 'b'], tag?: 'div'}, component: 'CtaBand',
//            props: {heading: 'heading', text: {from: 'text', select: 'p'}, action: {from: 'link', required: true}},
//            children?: {from: 'markdown', exclude: 'h2'}, wordsFrom?: 'data/ratings.json'},
//           {match: 'soa-progress', drop: true}],
// }
// The first rule that matches a wrapper (all its classes; a * in a class stands for any letters: "t3-*-awards") and
// finds what it requires is used. `drop: true` leaves the wrapper out (noted when it had words); `keep: true` says
// plain Markdown is right for it (no component, no note). The children's
// Markdown may hold components of other rules; props never do. A component's props keep the old block's words; any
// words of the block no prop or child holds are noted, unless `wordsFrom` says the component takes them from a data
// file of the site.
// A prop's source, by `from` (a string alone is the `from`):
//   value     a fixed value (`value`)                 heading   the text of the first heading (or `select`)
//   text      the text of the first match (`select`, default p)
//   markdown  the Markdown of the first match (or of the wrapper), without `exclude`
//   list      the Markdown of every match (`select`, default li), as a list of texts
//   link / links    {href, text} of the first / every link      image / images   {src, alt} of the first / every picture
//             (with `select`: the links or pictures in what it matches, or the matches themselves)
//   attr      the attribute `name` of the first match (or of the wrapper)
//   hasClass  true when the first match (or the wrapper) has the class `name`, else false
//   qa        [{question, answer}]: from <details><summary> (the answer is what follows the question up to the next one),
//             or with `question: 'h3'` from each such heading and what follows it; `trimNumber` takes "1. " off
//   items     a list of objects, one per match of `select` (default li), each with its own `fields` (sources again)
// `required: true` on a source: when it finds nothing the rule is not used for that wrapper (noted), and the next
// matching rule (or the usual conversion) takes it.

export const RULE_LIMITS = Object.freeze({ rules: 200, props: 40, depth: 3, bytes: 256 * 1024 });
const FROM = new Set(['value', 'heading', 'text', 'markdown', 'list', 'link', 'links', 'image', 'images', 'attr', 'hasClass', 'qa', 'items']);
const COMPONENT = /^[A-Z][A-Za-z0-9]{0,62}(?:\.[A-Z][A-Za-z0-9]{0,62})?$/;
const PROP = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const CLASS = /^-?[A-Za-z_*][\w*-]{0,99}$/;
const TAG = /^[a-z][a-z0-9]{0,15}$/;
const IMPORT = /^[^\s'"`;\\]{1,300}$/;
const HEADINGS = 'h1, h2, h3, h4, h5, h6';
const SKIPPED = new Set(['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'object', 'canvas', 'form', 'button', 'input', 'select', 'textarea']);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

class RuleError extends Error {}
const fail = (where, words) => {
  throw new RuleError(`${where}: ${words}`);
};

/** A selector: "tag", ".class", "tag.class.other", several with commas, as [{tag, classes}]. */
function selectorOf(s, where) {
  if (typeof s !== 'string' || !s.trim() || s.length > 300) fail(where, 'a selector such as "p", ".call_heading" or "h2, h3".');
  return s.split(',').map((one) => {
    const t = one.trim();
    const m = /^([a-z][a-z0-9]*)?((?:\.[A-Za-z_-][\w-]*)*)$/.exec(t);
    if (!m || (!m[1] && !m[2])) fail(where, `“${t}” is not a selector this file takes (a tag, .class, or tag.class).`);
    return { tag: m[1] ?? null, classes: m[2] ? m[2].slice(1).split('.') : [] };
  });
}

function sourceOf(raw, where, depth) {
  const s = typeof raw === 'string' ? { from: raw } : raw;
  if (!isObj(s)) fail(where, 'a source: a word such as "heading", or {from, select, …}.');
  const from = s.from ?? (Object.hasOwn(s, 'value') ? 'value' : null);
  if (!FROM.has(from)) fail(where, `“from” is one of ${[...FROM].join(', ')}.`);
  const out = { from, required: s.required === true };
  if (from === 'value') {
    if (!['string', 'number', 'boolean'].includes(typeof s.value)) fail(where, 'value is text, a number or true/false.');
    out.value = s.value;
  }
  if (s.select !== undefined) out.select = selectorOf(s.select, `${where}.select`);
  if (s.exclude !== undefined) out.exclude = selectorOf(s.exclude, `${where}.exclude`);
  if (from === 'attr') {
    if (typeof s.name !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(s.name)) fail(where, 'attr takes the attribute’s name ("data-n").');
    out.name = s.name;
  }
  if (from === 'hasClass') {
    if (typeof s.name !== 'string' || !/^-?[A-Za-z_][\w-]{0,99}$/.test(s.name)) fail(where, 'hasClass takes the class name ("recommended").');
    out.name = s.name;
  }
  if (from === 'qa') {
    if (s.question !== undefined) out.question = selectorOf(s.question, `${where}.question`);
    out.trimNumber = s.trimNumber === true;
  }
  if (from === 'items') {
    if (depth >= RULE_LIMITS.depth) fail(where, `items go at most ${RULE_LIMITS.depth} deep.`);
    if (!isObj(s.fields) || !Object.keys(s.fields).length) fail(where, 'items need fields: {title: "heading", text: "text"}.');
    out.fields = fieldsOf(s.fields, `${where}.fields`, depth + 1);
  }
  return out;
}

function fieldsOf(obj, where, depth) {
  const entries = Object.entries(obj);
  if (entries.length > RULE_LIMITS.props) fail(where, `at most ${RULE_LIMITS.props} props.`);
  return entries.map(([k, v]) => {
    if (!PROP.test(k)) fail(`${where}.${k}`, 'a prop name is letters, digits and _.');
    return [k, sourceOf(v, `${where}.${k}`, depth)];
  });
}

function matchOf(m, where) {
  const o = typeof m === 'string' || Array.isArray(m) ? { class: m } : m;
  if (!isObj(o)) fail(where, 'match is a class name, a list of them (all needed), or {class, tag}.');
  const classes = Array.isArray(o.class) ? o.class : [o.class];
  if (!classes.length || classes.some((c) => typeof c !== 'string' || !CLASS.test(c))) fail(where, 'match.class is a class name (or a list of them, all needed).');
  if (o.tag !== undefined && (typeof o.tag !== 'string' || !TAG.test(o.tag))) fail(where, 'match.tag is a tag name such as "div".');
  // a class with * matches any class of that shape ("t3-*-awards"); the rest are compared as they are
  const tests = classes.map((c) => (c.includes('*') ? new RegExp(`^${c.split('*').map((x) => x.replace(/-/g, '\\-')).join('[\\w-]*')}$`) : c));
  return { classes, tests, tag: o.tag ?? null };
}

/**
 * A rules file's JSON checked and made ready: {rules, components, report}. Throws an Error naming the place
 * ("rules[2].props.text: …") when something is not as the file takes it.
 */
export function checkRules(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let v = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    if (String(raw).length > RULE_LIMITS.bytes) fail('rules', 'the file is over 256 KB.');
    try {
      v = JSON.parse(String(raw));
    } catch {
      fail('rules', 'the file is not JSON.');
    }
  }
  if (!isObj(v)) fail('rules', 'an object: {rules: [...], components?, report?}.');
  const list = v.rules;
  if (!Array.isArray(list) || list.length > RULE_LIMITS.rules) fail('rules.rules', `a list of at most ${RULE_LIMITS.rules} rules.`);
  const components = {};
  if (v.components !== undefined) {
    if (!isObj(v.components)) fail('rules.components', '{Name: {import: "path"}}.');
    for (const [name, c] of Object.entries(v.components)) {
      if (!COMPONENT.test(name)) fail(`rules.components.${name}`, 'a component name starts with a capital letter.');
      if (!isObj(c) || (c.import !== undefined && (typeof c.import !== 'string' || !IMPORT.test(c.import)))) fail(`rules.components.${name}`, '{import: "path"}, a path with no spaces or quotes.');
      components[name] = { import: c.import ?? null };
    }
  }
  const report = v.report === undefined ? [] : v.report;
  if (!Array.isArray(report) || report.length > 50 || report.some((p) => typeof p !== 'string' || !/^[A-Za-z_][\w-]{0,40}$/.test(p))) fail('rules.report', 'a list of class prefixes such as "soa-".');
  const rules = list.map((r, i) => {
    const where = `rules.rules[${i}]`;
    if (!isObj(r)) fail(where, '{match, component, props}.');
    if (r.drop === true) return { match: matchOf(r.match, `${where}.match`), drop: true };
    if (r.keep === true) return { match: matchOf(r.match, `${where}.match`), keep: true };
    if (typeof r.component !== 'string' || !COMPONENT.test(r.component)) fail(`${where}.component`, 'a component name such as "CtaBand" (or drop: true).');
    if (r.props !== undefined && !isObj(r.props)) fail(`${where}.props`, '{name: source}.');
    if (r.wordsFrom !== undefined && (typeof r.wordsFrom !== 'string' || r.wordsFrom.length > 200)) fail(`${where}.wordsFrom`, 'the data file the component takes its words from.');
    return {
      match: matchOf(r.match, `${where}.match`),
      component: r.component,
      props: fieldsOf(r.props ?? {}, `${where}.props`, 0),
      children: r.children === undefined ? null : sourceOf(r.children, `${where}.children`, 0),
      wordsFrom: r.wordsFrom ?? null,
    };
  });
  return { rules, components, report };
}

export const isRuleError = (e) => e instanceof RuleError;

// ---- reading a wrapper

const classesOf = (n) => String(n.attrs?.class ?? '').split(/\s+/).filter(Boolean);
const kids = (n) => (n.children ?? []).filter((c) => c.tag);
const matches = (n, sel) => sel.some((s) => (!s.tag || s.tag === n.tag) && s.classes.every((c) => classesOf(n).includes(c)));

/** The first element under `n` (not `n`) that matches, depth first. */
function find(n, sel) {
  for (const c of kids(n)) {
    if (SKIPPED.has(c.tag)) continue;
    if (matches(c, sel)) return c;
    const f = find(c, sel);
    if (f) return f;
  }
  return null;
}

/** Every element under `n` that matches, the outermost only. */
function findAll(n, sel, out = []) {
  for (const c of kids(n)) {
    if (SKIPPED.has(c.tag)) continue;
    if (matches(c, sel)) out.push(c);
    else findAll(c, sel, out);
  }
  return out;
}

const plain = (n) => (n.text !== undefined ? n.text : SKIPPED.has(n.tag) ? '' : (n.children ?? []).map(plain).join(n.tag && /^(p|div|li|h\d|section|br|td|th|tr)$/.test(n.tag) ? ' ' : '')).replace(/\s+/g, ' ');
const textIn = (n) => (n ? plain(n).trim() : '');
const words = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const empty = (v) => v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);
const NUMBERED = /^\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[.):-]\s*/i;

/** A copy of `n` without the elements `sel` matches. */
function without(n, sel) {
  if (!sel) return n;
  const copy = (x) => (x.text !== undefined ? x : { ...x, children: (x.children ?? []).filter((c) => !(c.tag && matches(c, sel))).map(copy) });
  return copy(n);
}

/**
 * What a rule's sources read from a wrapper. `md(node)`: the node as Markdown (links and pictures put to their new
 * places); `image(url, node)` and `link(url)` as for the Markdown; `src(node)`: an image's real address.
 */
function reader({ md, mdNested, image, link, href, src }) {
  const linkOf = (a) => {
    if (!a) return null;
    const to = href(a.attrs.href);
    const text = textIn(a);
    return to || text ? { href: to ?? '', text } : null;
  };
  const imageOf = (img) => {
    if (!img) return null;
    const u = src(img);
    if (!u) return null;
    const to = image(u, img);
    return to ? { src: to, alt: String(img.attrs.alt ?? '').trim() } : null;
  };
  const only = (tag) => [{ tag, classes: [] }];
  // the first <a> or <img>: the wrapper itself, else in it; with a selector, the match itself or the first in it
  const firstOf = (el, sel, tag) => {
    const at = sel ? find(el, sel) : el;
    if (!at) return null;
    return at.tag === tag ? at : find(at, only(tag));
  };
  const allOf = (el, sel, tag) => (sel ? findAll(el, sel) : [el]).flatMap((at) => (at.tag === tag ? [at] : findAll(at, only(tag))));

  /** Q/A pairs: by <details> (or the given question headings), each answer what follows up to the next question. */
  function qa(el, s) {
    const isQ = (n) => (s.question ? matches(n, s.question) : n.tag === 'details');
    const qs = s.question ? findAll(el, s.question) : findAll(el, [{ tag: 'details', classes: [] }]);
    const out = [];
    for (const q of qs) {
      const parent = parentOf(el, q);
      let question;
      let answer = '';
      if (q.tag === 'details') {
        const summary = kids(q).find((c) => c.tag === 'summary');
        question = textIn(summary);
        answer = md({ tag: 'div', attrs: {}, children: (q.children ?? []).filter((c) => c !== summary) });
      } else question = textIn(q);
      if (!answer.trim() && parent) {
        // the answer follows the question (a heading, or a toggle with an empty inside), up to the next question
        const sib = parent.children ?? [];
        const after = [];
        for (let i = sib.indexOf(q) + 1; i < sib.length; i++) {
          const x = sib[i];
          if (x.tag && (isQ(x) || (s.question && /^h[1-6]$/.test(x.tag) && Number(x.tag[1]) <= Number(q.tag[1] ?? 9)))) break;
          after.push(x);
        }
        answer = md({ tag: 'div', attrs: {}, children: after });
      }
      if (s.trimNumber) question = question.replace(NUMBERED, '');
      if (question) out.push({ question, answer: answer.trim() });
    }
    return out;
  }

  function read(s, el, nested = false) {
    switch (s.from) {
      case 'value':
        return s.value;
      case 'heading':
        return textIn(find(el, s.select ?? selectorOf(HEADINGS, 'heading')));
      case 'text':
        return textIn(s.select ? find(el, s.select) : find(el, [{ tag: 'p', classes: [] }]));
      case 'markdown': {
        // the wrapper's own inside (never the wrapper again: its rule would match it once more)
        const n = s.select ? find(el, s.select) : { tag: 'div', attrs: {}, children: el.children ?? [] };
        return n ? (nested ? mdNested : md)(without(n, s.exclude)).trim() : '';
      }
      case 'list':
        return findAll(el, s.select ?? [{ tag: 'li', classes: [] }]).map((n) => md(without(n, s.exclude)).trim()).filter(Boolean);
      case 'link':
        return linkOf(firstOf(el, s.select, 'a'));
      case 'links':
        return allOf(el, s.select, 'a').map(linkOf).filter(Boolean);
      case 'image':
        return imageOf(firstOf(el, s.select, 'img'));
      case 'images':
        return allOf(el, s.select, 'img').map(imageOf).filter(Boolean);
      case 'attr': {
        const n = s.select ? find(el, s.select) : el;
        const v = n?.attrs?.[s.name];
        return v === undefined ? null : String(v).trim();
      }
      case 'hasClass': {
        const n = s.select ? find(el, s.select) : el;
        return Boolean(n && classesOf(n).includes(s.name));
      }
      case 'qa':
        return qa(el, s);
      case 'items':
        return findAll(el, s.select ?? [{ tag: 'li', classes: [] }])
          .map((item) => objectOf(s.fields, item).value)
          .filter((o) => o && !empty(o));
      default:
        return null;
    }
  }

  /** {value, missing}: the props of `fields` read from `el`; `missing` the first required one that found nothing. */
  function objectOf(fields, el) {
    const value = {};
    let missing = null;
    for (const [k, s] of fields) {
      const v = read(s, el);
      if (empty(v)) {
        if (s.required && !missing) missing = k;
        continue;
      }
      value[k] = v;
    }
    return { value, missing };
  }

  return { read, objectOf };
}

function parentOf(root, target) {
  for (const c of kids(root)) {
    if (c === target) return root;
    const p = parentOf(c, target);
    if (p) return p;
  }
  return null;
}

// ---- writing MDX

const attrString = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A component as MDX: literal props as they can be edited (text, numbers, on/off), the rest as JSON expressions. */
export function componentMdx(name, props, children) {
  const attrs = Object.entries(props).map(([k, v]) => {
    if (v === true) return k;
    if (v === false || typeof v === 'number') return `${k}={${JSON.stringify(v)}}`;
    if (typeof v === 'string' && !/[\n\r\u2028\u2029]/.test(v)) return `${k}="${attrString(v)}"`;
    return `${k}={${JSON.stringify(v)}}`;
  });
  const open = `<${name}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
  if (!children || !children.trim()) return `${open} />`;
  return `${open}>\n\n${children.trim()}\n\n</${name}>`;
}

/**
 * The transform convert/html.mjs runs over the tree: each wrapper a rule matches becomes a marker paragraph whose MDX
 * is in `pieces`. `opts`: {md, image, link, href, src, note, used (Map name -> count), marker(n)}.
 */
export function rulesTransform(compiled, opts) {
  const { note, pieces, used, marker } = opts;
  const r = reader(opts);
  // a wrapper with a reported prefix and no rule is noted once, not each wrapper inside it
  const quiet = new WeakSet();
  const hush = (n) => {
    quiet.add(n);
    for (const c of kids(n)) hush(c);
  };
  const fits = (rule, n, cls = classesOf(n)) => (!rule.match.tag || rule.match.tag === n.tag) && rule.match.tests.every((t) => (typeof t === 'string' ? cls.includes(t) : cls.some((c) => t.test(c))));
  const ruleInside = (n) => kids(n).some((c) => compiled.rules.some((rule) => !rule.keep && fits(rule, c)) || ruleInside(c));
  // inside a component's children the component accounts for what is there: nothing more is reported
  let inChildren = 0;
  return (node) => {
    if (!node.tag) return undefined;
    const cls = classesOf(node);
    if (!cls.length) return undefined;
    for (const rule of compiled.rules) {
      if (!fits(rule, node, cls)) continue;
      const name = rule.match.classes.join('.');
      if (rule.keep) {
        hush(node);
        return undefined;
      }
      if (rule.drop) {
        const said = plain(node).trim();
        if (words(said)) note('rule', `The old block “${name}” was left out by the converter rules (it said: “${said.length > 120 ? `${said.slice(0, 117)}…` : said}”).`);
        return null;
      }
      const { value: props, missing } = r.objectOf(rule.props, node);
      let children = '';
      if (rule.children) {
        inChildren++;
        try {
          children = String(r.read(rule.children, node, true) ?? '');
        } finally {
          inChildren--;
        }
      }
      if (missing || (rule.children?.required && !children.trim())) {
        note('rule', `The rule for “${name}” (${rule.component}) was not used: it found no ${missing ?? 'children'}. That part came in as Markdown.`);
        continue;
      }
      // words of the old block that no prop holds are listed, so nothing is lost without a note
      const values = (v) => (isObj(v) ? Object.values(v).map(values).join(' ') : Array.isArray(v) ? v.map(values).join(' ') : String(v));
      const kept = words(`${values(props)} ${children}`);
      const lost = [];
      // a part another rule handles (a component of its own, a part left out) is that rule's to account for
      const walk = (n, top = false) => {
        if (n.text !== undefined) {
          const w = words(n.text.replace(NUMBERED, ''));
          if (w.length > 2 && !kept.includes(w)) lost.push(n.text.trim());
          return;
        }
        if (SKIPPED.has(n.tag) || (!top && compiled.rules.some((x) => x !== rule && !x.keep && fits(x, n)))) return;
        for (const c of n.children ?? []) walk(c);
      };
      if (!rule.wordsFrom) walk(node, true);
      if (lost.length) {
        const said = lost.join(' ').replace(/\s+/g, ' ');
        note('rule', `${rule.component} (from “${name}”) did not keep some of the old words: “${said.length > 160 ? `${said.slice(0, 157)}…` : said}”. Check it.`);
      }
      used.set(rule.component, (used.get(rule.component) ?? 0) + 1);
      pieces.push(componentMdx(rule.component, props, children));
      return { tag: 'p', attrs: {}, children: [{ text: marker(pieces.length - 1) }] };
    }
    const prefixed = compiled.report.length && !quiet.has(node) && !inChildren ? cls.find((c) => compiled.report.some((p) => c.startsWith(p))) : null;
    if (prefixed && !ruleInside(node)) {
      const h = textIn(find(node, selectorOf(HEADINGS, 'heading'))) || textIn(node);
      const what = h ? ` (“${h.length > 60 ? `${h.slice(0, 57)}…` : h}”)` : '';
      note('rule', `The old block “${prefixed}”${what} has no converter rule, so it came in as plain Markdown.`);
      hush(node);
    }
    return undefined;
  };
}

/** The import lines for the components a text uses (those the rules file gives a path for). */
export function importsOf(compiled, used) {
  return [...used.keys()]
    .filter((n) => compiled.components[n]?.import)
    .sort()
    .map((n) => `import ${n.split('.')[0]} from '${compiled.components[n].import}';`)
    .filter((l, i, a) => a.indexOf(l) === i);
}
