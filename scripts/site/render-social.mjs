#!/usr/bin/env node
// Draws the share images from one HTML design and renders them with Chromium (Playwright), then sharp shrinks them:
//   site/og/<kind>.png           1200 x 630, one per kind of page (config.mjs OG_IMAGES)
//   .github/social-preview.png   1280 x 640 (GitHub › Settings › Social preview)
// The look is the site's (brand.mjs, look A): the logo with "Type it. Ship it." under the name, a headline with a lime
// highlight, and the real editor with its "/" block menu (site/media/blocks.webp, scripts/site/capture-shots.mjs)
// in a soft window. The caret never blinks here: these are still images. Fonts from site/fonts/. Run after new
// screenshots or a brand change:   npm run site:og
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { INK, LIME, lockupFile, PALETTE } from './brand.mjs';
import { REPO_ROOT } from './build-site.mjs';
import { OG_IMAGES } from './config.mjs';

// [before the highlight, the highlight, after it], and two short lines under it
const KINDS = {
  home: { title: ['Edit your site on the ', 'real page', '.'], lines: ['The visual editor for Astro sites.', 'Notion-style blocks, content in git.'] },
  docs: { title: ['Markstage ', 'docs', ''], lines: ['Set up, write, deploy and run', 'the visual editor for Astro.'] },
  compare: { title: ['Markstage ', 'compared', ''], lines: ['Beside WordPress, Ghost, Prismic', 'and other editors, with sources.'] },
  learn: { title: ['Markstage, ', 'explained', ''], lines: ['Questions, answers and the words', 'of visual editing for Astro.'] },
  story: { title: ['Why we ', 'built it', ''], lines: ['Our site left WordPress.', 'Writers still needed the real page.'] },
  showcase: { title: ['Built with ', 'Markstage', ''], lines: ['A WordPress site moved to Astro,', 'edited on the real page.'] },
  features: { title: ['Every feature, ', 'in plain words', ''], lines: ['Writing, sections, releases, SEO,', 'history, AI and MCP.'] },
  ai: { title: ['AI that drafts. ', 'People who publish.', ''], lines: ['An MCP server and AI suggestions,', 'with your own key.'] },
};

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The share image of one kind as an HTML page, `width` x `height` CSS pixels. */
export function socialHtml(width, height, kind, { shot = null, fonts = {} } = {}) {
  const k = KINDS[kind];
  const s = height / 630;
  const c = PALETTE.light;
  const logo = lockupFile('light', { height: Math.round(64 * s) });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Bricolage Grotesque'; src: url('${fonts.display ?? ''}') format('woff2'); font-weight: 800; }
@font-face { font-family: 'Figtree'; src: url('${fonts.text ?? ''}') format('woff2'); font-weight: 400 700; }
html, body { margin: 0; }
body { width: ${width}px; height: ${height}px; overflow: hidden; position: relative; color: ${INK}; background: ${c.page};
  font-family: Figtree, system-ui, sans-serif; }
.soft { position: absolute; right: 0; top: 0; bottom: 0; width: ${540 * s}px; background: ${c.soft}; border-radius: ${40 * s}px 0 0 ${40 * s}px; }
.text { position: absolute; left: ${64 * s}px; top: ${56 * s}px; width: ${600 * s}px; }
.text svg { display: block; }
h1 { margin: ${48 * s}px 0 ${22 * s}px; font: 800 ${66 * s}px/1.04 'Bricolage Grotesque', sans-serif; letter-spacing: -0.035em; }
.mark { background: ${LIME}; border-radius: 0.18em; padding: 0 0.12em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
p { margin: 0; font-size: ${27 * s}px; line-height: 1.4; font-weight: 500; color: ${c.muted}; }
.foot { position: absolute; left: ${64 * s}px; bottom: ${48 * s}px; display: flex; gap: ${10 * s}px; }
.foot span { border-radius: 999px; padding: ${7 * s}px ${16 * s}px; background: ${c.soft}; font-size: ${19 * s}px; font-weight: 600; }
.win { position: absolute; left: ${700 * s}px; top: ${70 * s}px; width: ${560 * s}px; height: ${490 * s}px; border-radius: ${28 * s}px; overflow: hidden;
  background: #fff; box-shadow: 0 0 0 1px #e3e8d6, 0 ${24 * s}px ${60 * s}px -${20 * s}px rgb(20 20 40 / 30%); }
.win img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: left top; }
</style></head><body>
<div class="soft"></div>
<div class="text">${logo}<h1>${esc(k.title[0])}<span class="mark">${esc(k.title[1])}</span>${esc(k.title[2])}</h1><p>${k.lines.map(esc).join('<br>')}</p></div>
${shot ? `<div class="win"><img src="${shot}" alt=""></div>` : ''}
<div class="foot"><span>Source-available</span><span>Free to self-host</span><span>Content in git</span></div>
</body></html>`;
}

async function main() {
  const sharp = (await import('sharp')).default;
  const blocks = path.join(REPO_ROOT, 'site', 'media', 'blocks.webp');
  const shot = fs.existsSync(blocks) ? `data:image/png;base64,${(await sharp(blocks).resize(1100).png().toBuffer()).toString('base64')}` : null;
  const woff = (f) => `data:font/woff2;base64,${fs.readFileSync(path.join(REPO_ROOT, 'site', 'fonts', f)).toString('base64')}`;
  const fonts = { display: woff('bricolage-grotesque-800.woff2'), text: woff('figtree.woff2') };
  const jobs = [
    ...Object.entries(OG_IMAGES).map(([kind, og]) => [kind, path.join(REPO_ROOT, 'site', og.path), 1200, 630]),
    ['home', path.join(REPO_ROOT, '.github', 'social-preview.png'), 1280, 640],
  ];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const [kind, out, w, h] of jobs) {
      await page.setViewportSize({ width: w, height: h });
      await page.setContent(socialHtml(w, h, kind, { shot, fonts }), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const raw = await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, await sharp(raw).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer());
      console.log(`Wrote ${path.relative(REPO_ROOT, out)} (${w} x ${h}, ${Math.round(fs.statSync(out).size / 1024)} KB)`);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
