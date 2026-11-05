// The e2e suite's setup that is not a test: its ports (MARKSTAGE_E2E_PORT_BASE and fixed offsets, all checked free:
// a busy one fails the run, naming it), Playwright, and the stand-ins for the site's health hook and `astro dev`.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

export const PORT_BASE = Number(process.env.MARKSTAGE_E2E_PORT_BASE ?? 18231);
if (!Number.isInteger(PORT_BASE) || PORT_BASE < 1024 || PORT_BASE + 99 > 65535) throw new Error(`MARKSTAGE_E2E_PORT_BASE must be a port from 1024 to 65436, not ${process.env.MARKSTAGE_E2E_PORT_BASE}.`);
export const PORT = PORT_BASE;
export const BASE = `http://127.0.0.1:${PORT}`;
// the preview origin (its dev servers take a port from DEV_PORTS) and the stand-in stock photo provider
export const PREVIEW_PORT = PORT_BASE + 4;
export const STOCK_PORT = PORT_BASE + 6;
// Redirects run on a second server with a two-locale site and a redirects hook, its "live site" served from its build
export const REDIR_PORT = PORT_BASE + 8;
export const LIVE_PORT = PORT_BASE + 10;
export const DEV_PORTS = [PORT_BASE + 16, PORT_BASE + 68];
// the Library's own server (library.e2e.mjs, and canvas-drop.e2e.mjs after it: the files run one at a time): +12, its
// preview +14, the preview's dev servers +70 to +80
export const LIBRARY_PORTS = [PORT_BASE + 12, PORT_BASE + 14, ...Array.from({ length: 11 }, (_, i) => PORT_BASE + 70 + i)];
// the lists screen's own server (entries.e2e.mjs)
export const ENTRIES_PORT = PORT_BASE + 85;
// the Groups screen's own server (groups.e2e.mjs)
export const GROUPS_PORT = PORT_BASE + 82;
// the share origin of the share links' server (share.e2e.mjs; the server itself takes a free port)
export const SHARE_PORT = PORT_BASE + 87;
// "Edit this page" (edit-button.e2e.mjs): its CMS +84 and its site +86; the section gallery (gallery.e2e.mjs): its
// server +88 and its preview +90 (its dev servers take +60 to +68, inside DEV_PORTS: the files run one at a time)
export const EDIT_BUTTON_PORTS = [PORT_BASE + 84, PORT_BASE + 86];
export const GALLERY_PORTS = [PORT_BASE + 88, PORT_BASE + 90];
// the Inbox's Odoo marks (inbox-odoo.e2e.mjs): its server +81 and the stand-in Odoo +83
export const INBOX_ODOO_PORTS = [PORT_BASE + 81, PORT_BASE + 83];
// the Releases screens (releases-ui.e2e.mjs): the share origin of their server (the server itself takes a free port)
export const RELEASES_UI_PORT = PORT_BASE + 2;
// the token screen's two kinds (tokens.e2e.mjs)
export const TOKENS_PORT = PORT_BASE + 89;
// AI suggestions (ai-suggest.e2e.mjs): its server with the stub +92, one with no key +94, a staging environment +96
export const AI_SUGGEST_PORTS = [PORT_BASE + 92, PORT_BASE + 94, PORT_BASE + 96];
// the translation status screen (translations.e2e.mjs)
export const TRANSLATIONS_PORT = PORT_BASE + 98;
// single sign-on in the editor (sso.e2e.mjs; its stand-in provider takes a free port) and Settings → Roles (roles.e2e.mjs)
export const SSO_UI_PORT = PORT_BASE + 91;
export const ROLES_UI_PORT = PORT_BASE + 93;
// a field-limited role in the editor (field-limits.e2e.mjs): what it may not change is greyed out
export const FIELDS_UI_PORT = PORT_BASE + 97;
// the Authors screen and the author field of Post settings (authors.e2e.mjs)
export const AUTHORS_PORT = PORT_BASE + 95;
// page frames and types (page-types.e2e.mjs): its server +1 and its preview +3 (its dev servers take DEV_PORTS: the
// files run one at a time)
export const PAGE_TYPES_PORTS = [PORT_BASE + 1, PORT_BASE + 3];
// topics and links (links.e2e.mjs)
export const LINKS_PORT = PORT_BASE + 5;
// the canvas drawn in its page (canvas-shell.e2e.mjs): the example blog's `astro dev`
export const CANVAS_SHELL_PORT = PORT_BASE + 99;
// the deep-QA fixes (qa-round1.e2e.mjs): its server +7 and its preview +9 (its dev servers take DEV_PORTS)
export const QA_PORTS = [PORT_BASE + 7, PORT_BASE + 9];
// the second deep-QA pass (qa-round2.e2e.mjs): its server +11 and its preview +13 (its dev servers take DEV_PORTS)
export const QA2_PORTS = [PORT_BASE + 11, PORT_BASE + 13];
// the live demo's static server (demo.e2e.mjs)
export const DEMO_PORT = PORT_BASE + 15;
// an MDX guide in the editor (mdx.e2e.mjs): its server +17
export const MDX_PORT = PORT_BASE + 17;
// an AI agent publishing a release on the example blog (mcp-publish.e2e.mjs): its server +19
export const MCP_PUBLISH_PORT = PORT_BASE + 19;
// importing a site (import.e2e.mjs): its server +18 and the old site +20, inside DEV_PORTS (the files run one at a time)
export const IMPORT_PORTS = [PORT_BASE + 18, PORT_BASE + 20];
// AI link suggestions and fixes (ai-seo.e2e.mjs): its server with the stub +69, and one with AI off +21, inside
// DEV_PORTS (the files run one at a time)
export const AI_SEO_PORTS = [PORT_BASE + 69, PORT_BASE + 21];
export const SHOTS = process.env.MARKSTAGE_E2E_SHOTS ?? null;

async function loadPlaywright() {
  try {
    if (process.env.MARKSTAGE_PLAYWRIGHT) return createRequire(path.join(process.env.MARKSTAGE_PLAYWRIGHT, 'package.json'))(process.env.MARKSTAGE_PLAYWRIGHT);
    return await import('playwright');
  } catch {
    return null;
  }
}

/** The TCP ports something listens on now (one lsof for all of them). */
const listening = () => {
  let out = '';
  try {
    out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  } catch (e) {
    out = e.stdout ?? ''; // lsof exits 1 when nothing listens
  }
  return new Set([...out.matchAll(/:(\d+) \(LISTEN\)/g)].map((m) => Number(m[1])));
};

export const pw = await loadPlaywright();
export const skip = !pw ? 'Playwright not found (npm install at the repo root, or set MARKSTAGE_PLAYWRIGHT)' : false;
if (pw) {
  const taken = listening();
  const ours = [PORT, PREVIEW_PORT, STOCK_PORT, REDIR_PORT, LIVE_PORT, ...Array.from({ length: DEV_PORTS[1] - DEV_PORTS[0] + 1 }, (_, i) => DEV_PORTS[0] + i), ...LIBRARY_PORTS, GROUPS_PORT, ENTRIES_PORT, SHARE_PORT, ...EDIT_BUTTON_PORTS, ...GALLERY_PORTS, ...INBOX_ODOO_PORTS, RELEASES_UI_PORT, TOKENS_PORT, ...AI_SUGGEST_PORTS, TRANSLATIONS_PORT, SSO_UI_PORT, ROLES_UI_PORT, FIELDS_UI_PORT, AUTHORS_PORT, ...PAGE_TYPES_PORTS, LINKS_PORT, CANVAS_SHELL_PORT, ...QA_PORTS, ...QA2_PORTS, DEMO_PORT, MDX_PORT, MCP_PUBLISH_PORT, ...IMPORT_PORTS, ...AI_SEO_PORTS];
  const busy = ours.filter((p) => taken.has(p));
  if (busy.length) {
    // never a quiet skip: a run that did not run must not look like a pass
    console.error(`\ne2e: port${busy.length > 1 ? 's' : ''} ${busy.join(', ')} in use (base ${PORT_BASE}). Another run? Set MARKSTAGE_E2E_PORT_BASE to another free base (say ${PORT_BASE + 200}).\n`);
    process.exit(1);
  }
}

// the site's health hook: what the host serves for every address
export const HEALTH_HOOK = `console.log(JSON.stringify({
  pages: [{ path: '/blog/hello-world/', status: 200 }, { path: '/blog/with-html/', status: 200 }, { path: '/old-post/', status: 301, redirectsTo: '/older-post/' }, { path: '/older-post/', status: 301, redirectsTo: '/blog/hello-world/' }],
  chains: [['/old-post/', '/older-post/', '/blog/hello-world/']],
  broken: [{ path: '/blog/gone/', linkedFrom: ['/blog/with-html/'] }],
}));
`;

// stands in for `astro dev` in the preview: the entry's text as a page, with a box wider than a phone
export const FAKE_DEV = `import fs from 'node:fs';
import http from 'node:http';
const server = http.createServer((req, res) => {
  const m = /^\\/blog\\/([a-z0-9-]+)\\/$/.exec(req.url);
  if (!m) return res.writeHead(404).end('not found');
  const text = fs.readFileSync('src/content/blog/' + m[1] + '.md', 'utf8').replace(/^---[\\s\\S]*?---\\n/, '');
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>' + m[1] + '</title></head><body style="font:16px/1.5 system-ui;margin:16px">'
    + text.split('\\n\\n').map((p) => '<p>' + esc(p) + '</p>').join('') + '<div class="pricing-table" style="width:560px;padding:12px;background:#e8eef9">A table wider than a phone</div></body></html>');
});
server.listen(Number(process.argv[2]), '127.0.0.1');
`;

/**
 * The drawer folded to its icon rail (80px) before the editor loads: for the tests that measure a layout at a given
 * window width (columns, the flow map), written when the left rail was 60px wide.
 */
export const foldNav = (ctx) => ctx.addInitScript(() => localStorage.setItem('markstage.drawer', JSON.stringify({ folded: true })));

/**
 * A fresh start for the next page: the tab goes to about:blank first, so the editor loads anew. When the editor is
 * still moving (a redirect, a hash change, an entry opening), the browser can abort that navigation
 * (net::ERR_ABORTED) or leave it waiting; each try waits 5 s at most for the blank page to commit and it is tried
 * again a few times instead of failing the test. Every e2e file uses this, never a bare goto('about:blank')
 * (test/e2e-hygiene.test.mjs).
 */
export async function blank(page) {
  for (let i = 0; ; i++) {
    try {
      await page.goto('about:blank', { waitUntil: 'commit', timeout: 5000 });
      return;
    } catch (e) {
      if (i >= 4 || !/ERR_ABORTED|interrupted by another navigation|Timeout/.test(String(e?.message))) throw e;
      await page.waitForTimeout(200);
    }
  }
}
