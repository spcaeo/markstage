// What a page's own code needs from its Content-Security-Policy (docs/DEPLOY.md, Design & Code): the site's build
// runs this on the code injected into a page (the inject.head / inject.foot files, the entry's codeInjection) or on
// the whole page, and adds the answer to that page's policy, so a script an owner pasted runs and nothing else does.
//   cspHash(text)                 "'sha256-…'" for an inline script or style, as browsers hash it (UTF-8)
//   cspHashes(html)               {script, style, scriptOrigins, styleOrigins, problems}
//   withCspSources(policy, needs) the policy with those added to script-src / style-src
// Node only (node:crypto): it runs in the site's build, never in the editor.
import { createHash } from 'node:crypto';

/** The CSP source for an inline script or style: the SHA-256 of its exact text, base64. */
export const cspHash = (text) => `'sha256-${createHash('sha256').update(String(text), 'utf8').digest('base64')}'`;

// script types a browser runs (and so CSP checks): none, JavaScript, a module, an import map; data blocks such as
// JSON-LD (application/ld+json) are not run, so they need nothing
const RUNS = /^(|text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript|module|importmap|speculationrules)$/i;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const decode = (v) => v.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function attrsOf(s) {
  const out = {};
  for (const m of s.matchAll(ATTR)) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** The origin of an absolute http(s) URL (or a protocol-relative one), else null (same site: 'self'). */
function originOf(url) {
  const u = String(url).trim();
  if (!/^(https?:)?\/\//i.test(u)) return null;
  try {
    return new URL(u.startsWith('//') ? `https:${u}` : u).origin;
  } catch {
    return null;
  }
}

const uniq = (a) => [...new Set(a)];

/**
 * Everything the inline code of an HTML text needs: a hash per inline script that runs and per inline <style>, the
 * origin of each external script and stylesheet, and the problems a hash cannot allow (an `on…` event attribute, a
 * `style` attribute, a `javascript:` URL), which need the code changed instead.
 */
export function cspHashes(html) {
  const text = String(html ?? '');
  const script = [];
  const style = [];
  const scriptOrigins = [];
  const styleOrigins = [];
  const problems = [];
  // comments are skipped; the text inside <script> and <style> runs to its first end tag (as the HTML parser reads it)
  const TAG = /<!--[\s\S]*?(?:-->|$)|<(script|style)\b([^>]*)>([\s\S]*?)(?:<\/\1\s*>|$)|<([a-zA-Z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  for (const m of text.matchAll(TAG)) {
    if (m[0].startsWith('<!--')) continue;
    const name = (m[1] ?? m[4]).toLowerCase();
    const attrs = attrsOf(m[2] ?? m[5] ?? '');
    for (const [k, v] of Object.entries(attrs)) {
      if (/^on/.test(k)) problems.push({ kind: 'handler', tag: name, attr: k, message: `<${name} ${k}="…">: an inline event handler. Move it into a script (addEventListener); a hash cannot allow it.` });
      else if (k === 'style' && v.trim()) problems.push({ kind: 'style-attr', tag: name, attr: k, message: `<${name} style="…">: an inline style attribute. Move it into a class in a stylesheet; a hash cannot allow it.` });
      else if (['href', 'src', 'action', 'formaction'].includes(k) && /^\s*javascript:/i.test(v)) problems.push({ kind: 'javascript-url', tag: name, attr: k, message: `<${name} ${k}="javascript:…">: a javascript: address. Use a button with a script instead.` });
    }
    if (m[1] && name === 'script') {
      if (attrs.src !== undefined) {
        const o = originOf(attrs.src);
        if (o) scriptOrigins.push(o);
      } else if (RUNS.test((attrs.type ?? '').trim())) script.push(cspHash(m[3]));
    } else if (m[1] && name === 'style') style.push(cspHash(m[3]));
    else if (name === 'link' && /(^|\s)stylesheet(\s|$)/i.test(attrs.rel ?? '') && attrs.href) {
      const o = originOf(attrs.href);
      if (o) styleOrigins.push(o);
    } else if (name === 'link' && /(^|\s)(modulepreload|preload)(\s|$)/i.test(attrs.rel ?? '') && attrs.href && /^script$/i.test(attrs.as ?? (/modulepreload/i.test(attrs.rel) ? 'script' : ''))) {
      const o = originOf(attrs.href);
      if (o) scriptOrigins.push(o);
    }
  }
  return { script: uniq(script), style: uniq(style), scriptOrigins: uniq(scriptOrigins), styleOrigins: uniq(styleOrigins), problems };
}

/** The directives of a policy, in order: [[name, [source, …]], …]. */
function parse(policy) {
  return String(policy ?? '')
    .split(';')
    .map((d) => d.trim().split(/\s+/).filter(Boolean))
    .filter((d) => d.length)
    .map(([name, ...sources]) => [name.toLowerCase(), sources]);
}

/**
 * The policy with what cspHashes found added: hashes and origins to script-src and style-src (made from default-src
 * when the policy has none, as browsers fall back to it). A directive that allows 'unsafe-inline' with no hash or
 * nonce gets no hashes, because a hash there would switch 'unsafe-inline' off and stop the page's other inline
 * code; it already allows them. An empty policy stays empty: there is nothing to loosen.
 */
export function withCspSources(policy, needs) {
  const dirs = parse(policy);
  if (!dirs.length) return '';
  const get = (n) => dirs.find(([name]) => name === n);
  const add = (name, hashes, origins) => {
    if (!hashes.length && !origins.length) return;
    let d = get(name);
    if (!d) {
      const fallback = get('default-src');
      if (!fallback) return; // nothing restricts these: nothing to add
      d = [name, [...fallback[1]]];
      dirs.push(d);
    }
    const src = d[1];
    if (src.some((s) => s === "'none'")) d[1] = src.filter((s) => s !== "'none'");
    const inlineOnly = d[1].includes("'unsafe-inline'") && !d[1].some((s) => /^'(sha(256|384|512)|nonce)-/i.test(s));
    for (const s of [...(inlineOnly ? [] : hashes), ...origins]) if (!d[1].includes(s)) d[1].push(s);
  };
  add('script-src', needs?.script ?? [], needs?.scriptOrigins ?? []);
  add('style-src', needs?.style ?? [], needs?.styleOrigins ?? []);
  return dirs.map(([n, s]) => [n, ...s].join(' ')).join('; ');
}
