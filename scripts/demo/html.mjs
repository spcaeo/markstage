// The small pieces of HTML and script the demo build writes (build-demo.mjs; tests: html.test.mjs).

/**
 * The page's own site paths (href="/posts/x/", src="/uploads/a.png") moved under `base` (e.g. /markstage/demo/blog/),
 * since the blog is served from there and not from a site root. Paths already under it, and //host addresses, stay.
 */
export function prefixPaths(html, base) {
  const fix = (url) => (url.startsWith('/') && !url.startsWith('//') && !url.startsWith(base) ? `${base}${url.slice(1)}` : url);
  return html
    .replace(/\b(href|src|action|poster)="([^"]*)"/g, (_, attr, url) => `${attr}="${fix(url)}"`)
    .replace(/\bsrcset="([^"]*)"/g, (_, set) => `srcset="${set.split(',').map((part) => part.trim().replace(/^\S+/, (u) => fix(u))).join(', ')}"`);
}

/**
 * The script each blog page loads: it adds the editor's preview agent (preview-agent.js, next to it) with this
 * page's own origin as the editor's, as the Markstage server's preview does (data-cms). Only inside the editor's frame.
 */
export function agentLoader() {
  return `// Markstage live demo: the editor's preview agent on the sample blog's pages, inside the editor's frame only.
(function () {
  var me = document.currentScript;
  if (window.parent === window || !me || !document.head) return;
  var s = document.createElement('script');
  s.src = new URL('preview-agent.js', me.src).href;
  s.setAttribute('data-cms', location.origin);
  document.head.appendChild(s);
})();
`;
}

/** A page that sends the reader to `target` (a demo built on its own, without the site's landing page). */
export function redirectPage(target) {
  const t = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <meta http-equiv="refresh" content="0; url=${t}" />
    <title>Markstage live demo</title>
  </head>
  <body>
    <p><a href="${t}">Open the Markstage live demo</a></p>
  </body>
</html>
`;
}

/** The site's brand tokens (site/styles.css) that the demo's strip takes, by the strip's token names. */
export const BRAND_TOKENS = {
  brand: 'brand',
  'brand-hover': 'brand-hover',
  'brand-ink': 'brand-ink',
  'on-brand': 'on-brand',
  'brand-soft': 'brand-soft',
  accent: 'accent',
  line: 'line',
};

const block = (css, at) => {
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
};
const tokensIn = (body) => Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;}]+);/g)].map((m) => [m[1], m[2].trim()]));

/**
 * The demo strip's tokens from the public site's stylesheet: its first `:root` block (light) and the `:root` inside
 * its `prefers-color-scheme: dark` block, written for the editor's own light and dark themes. Empty when the
 * stylesheet has none of them. Only colour values pass (#hex, rgb(), hsl(), oklch()), so nothing else gets in.
 */
export function brandCss(siteCss) {
  const light = tokensIn(block(siteCss, siteCss.search(/(^|\n):root\s*\{/)));
  const darkAt = siteCss.search(/@media\s*\(prefers-color-scheme:\s*dark\)/);
  const darkBody = darkAt < 0 ? '' : block(siteCss, darkAt);
  const rootAt = darkBody.search(/:root\s*\{/);
  const dark = rootAt < 0 ? {} : tokensIn(block(darkBody, rootAt));
  const colour = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab)\([\d\s.,%/+-]+\))$/i;
  const decl = (t) =>
    Object.entries(BRAND_TOKENS)
      .filter(([, from]) => colour.test(t[from] ?? ''))
      .map(([to, from]) => `  --ms-demo-${to}: ${t[from]};`)
      .join('\n');
  const parts = [];
  const l = decl(light);
  const d = decl(dark);
  if (l) parts.push(`:root .ms-demo-bar,\n:root .ms-demo-dialog {\n${l}\n}`);
  if (d) {
    parts.push(`:root .ms[data-ms-theme='dark'] :is(.ms-demo-bar, .ms-demo-dialog) {\n${d}\n}`);
    parts.push(`@media (prefers-color-scheme: dark) {\n  :root .ms:not([data-ms-theme='light']) :is(.ms-demo-bar, .ms-demo-dialog) {\n${d.replace(/^/gm, '  ')}\n  }\n}`);
  }
  return parts.length ? `/* the public site's brand for the live demo's strip (scripts/demo/html.mjs brandCss) */\n${parts.join('\n')}\n` : '';
}
