#!/usr/bin/env node
// Draws the share images from one HTML design and renders them with Chromium (Playwright), then sharp shrinks them:
//   site/og/<kind>.png           1200 x 630, one per kind of page (config.mjs OG_IMAGES)
//   .github/social-preview.png   1280 x 640 (GitHub › Settings › Social preview)
// The look is the site's stage (brand.mjs): the editor screenshot (site/media/hero.webp, scripts/site/capture-shots.mjs)
// under an arch, lit from above, on a brass floor line; the wordmark and headings in the site's display font
// (site/fonts/). Run after new screenshots or a brand change:   npm run site:og
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { lockupFile, PALETTE } from './brand.mjs';
import { REPO_ROOT } from './build-site.mjs';
import { OG_IMAGES } from './config.mjs';

const KINDS = {
  home: { title: ['Edit the real page.', 'Keep the content in git.'], lines: ['A visual editor for Astro sites,', 'free to self-host.'] },
  docs: { title: ['Markstage', 'documentation'], lines: ['Set up, write, deploy and run', 'the visual editor for Astro.'] },
  compare: { title: ['Markstage', 'compared'], lines: ['A git-based visual editor next to', 'hosted and git-based CMSs.'] },
  learn: { title: ['Markstage,', 'explained'], lines: ['Questions, answers and the words', 'of visual editing for Astro.'] },
  story: { title: ['Why we built', 'Markstage'], lines: ['Our site left WordPress.', 'Writers still needed the real page.'] },
  showcase: { title: ['Built with', 'Markstage'], lines: ['A WordPress site moved to Astro,', 'edited on the real page.'] },
};

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The share image of one kind as an HTML page, `width` x `height` CSS pixels. */
export function socialHtml(width, height, kind, { shot = null, font = '' } = {}) {
  const k = KINDS[kind];
  const s = height / 630;
  const c = PALETTE.dark;
  const logo = lockupFile('dark', { height: Math.round(52 * s) });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Big Shoulders Display'; src: url('${font}') format('woff2'); font-weight: 800; }
html, body { margin: 0; }
body { width: ${width}px; height: ${height}px; overflow: hidden; position: relative; color: ${c.ink};
  font-family: Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif;
  background: radial-gradient(48% 70% at 74% 0%, rgb(245 192 79 / 26%), transparent 70%), ${PALETTE.light.stage}; }
.text { position: absolute; left: ${64 * s}px; top: ${60 * s}px; width: ${640 * s}px; }
.text svg { display: block; }
h1 { margin: ${54 * s}px 0 ${22 * s}px; font: 800 ${72 * s}px/0.95 'Big Shoulders Display', sans-serif; color: #fff; }
p { margin: 0; font-size: ${27 * s}px; line-height: 1.4; font-weight: 500; color: #e2c9d1; }
.foot { position: absolute; left: ${64 * s}px; bottom: ${52 * s}px; font-size: ${21 * s}px; font-weight: 600; color: ${c.pool}; }
.stage { position: absolute; right: ${-40 * s}px; bottom: ${70 * s}px; width: ${560 * s}px; height: ${430 * s}px;
  border-radius: 50% 50% 0 0 / ${60 * s}px ${60 * s}px 0 0; background: rgb(255 255 255 / 4%); border: 1px solid rgb(255 255 255 / 14%); border-bottom: 0; }
.stage img { position: absolute; left: ${34 * s}px; right: 0; bottom: 0; width: ${560 * s}px; height: ${350 * s}px; object-fit: cover; object-position: left top;
  border-radius: ${12 * s}px 0 0 0; box-shadow: 0 0 ${60 * s}px rgb(245 192 79 / 22%); }
.floor { position: absolute; right: 0; bottom: ${64 * s}px; width: ${600 * s}px; height: ${5 * s}px; border-radius: 4px;
  background: linear-gradient(90deg, transparent, ${c.pool} 14%, ${c.pool}); }
</style></head><body>
<div class="text">${logo}<h1>${k.title.map(esc).join('<br>')}</h1><p>${k.lines.map(esc).join('<br>')}</p></div>
${shot ? `<div class="stage"><img src="${shot}" alt=""></div><div class="floor"></div>` : ''}
<div class="foot">Source-available · Free to self-host · Content in git</div>
</body></html>`;
}

async function main() {
  const sharp = (await import('sharp')).default;
  const hero = path.join(REPO_ROOT, 'site', 'media', 'hero.webp');
  const shot = fs.existsSync(hero) ? `data:image/png;base64,${(await sharp(hero).resize(1200).png().toBuffer()).toString('base64')}` : null;
  const font = `data:font/woff2;base64,${fs.readFileSync(path.join(REPO_ROOT, 'site', 'fonts', 'big-shoulders-display-800.woff2')).toString('base64')}`;
  const jobs = [
    ...Object.entries(OG_IMAGES).map(([kind, og]) => [kind, path.join(REPO_ROOT, 'site', og.path), 1200, 630]),
    ['home', path.join(REPO_ROOT, '.github', 'social-preview.png'), 1280, 640],
  ];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const [kind, out, w, h] of jobs) {
      await page.setViewportSize({ width: w, height: h });
      await page.setContent(socialHtml(w, h, kind, { shot, font }), { waitUntil: 'load' });
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
