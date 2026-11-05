#!/usr/bin/env node
// Writes the brand files from scripts/site/brand.mjs. Run after a change to the mark, the wordmark or the palette:
//   npm run site:brand
//
//   assets/brand/markstage.svg, markstage-dark.svg           the mark, for light and dark backgrounds
//   assets/brand/markstage-logo.svg, markstage-logo-dark.svg  the mark, the wordmark and the tagline (the README header)
//   assets/brand/markstage-512.png, markstage-logo.png, markstage-logo-dark.png
//   site/icon.svg (the small mark, follows the browser's theme), site/favicon.ico (16, 32, 48: the small mark at 16
//   and 32 px, so it stays crisp in a tab), site/apple-touch-icon.png (180)
// Every file is still: the caret blinks only on the site, in CSS.
//
// PNGs are drawn by Chromium (Playwright) with a transparent background, then shrunk by sharp.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { faviconFile, lockupFile, markFile, PALETTE } from './brand.mjs';
import { REPO_ROOT } from './build-site.mjs';

const BRAND = path.join(REPO_ROOT, 'assets', 'brand');
const SITE = path.join(REPO_ROOT, 'site');

/** An .ico file holding PNG images (allowed since Windows Vista; every browser reads it). */
export function icoFile(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

async function main() {
  const sharp = (await import('sharp')).default;
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    console.log(`Wrote ${path.relative(REPO_ROOT, file)} (${Math.max(1, Math.round(fs.statSync(file).size / 1024))} KB)`);
  };
  const svgs = {
    mark: markFile('light'),
    markDark: markFile('dark'),
    logo: lockupFile('light', { height: 120 }),
    logoDark: lockupFile('dark', { height: 120 }),
  };
  write(path.join(BRAND, 'markstage.svg'), svgs.mark);
  write(path.join(BRAND, 'markstage-dark.svg'), svgs.markDark);
  write(path.join(BRAND, 'markstage-logo.svg'), svgs.logo);
  write(path.join(BRAND, 'markstage-logo-dark.svg'), svgs.logoDark);
  write(path.join(SITE, 'icon.svg'), faviconFile());

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    /** One SVG drawn at `width` x `height` CSS pixels, `scale` device pixels each, on `background` or transparent. */
    const png = async (svg, width, height, { scale = 1, background = 'transparent' } = {}) => {
      await page.setViewportSize({ width, height });
      const sized = svg.replace(/<svg ([^>]*?)width="[^"]*" height="[^"]*"/, '<svg $1').replace('<svg ', `<svg style="display:block;width:${width}px;height:${height}px" `);
      await page.setContent(`<!doctype html><html><body style="margin:0;background:${background}">${sized}</body></html>`);
      const shot = await page.screenshot({ omitBackground: background === 'transparent', scale: 'css', clip: { x: 0, y: 0, width, height } });
      return scale === 1 ? shot : sharp(shot).resize(width * scale).png().toBuffer();
    };
    const small = (buf) => sharp(buf).png({ compressionLevel: 9, palette: true, quality: 95 }).toBuffer();
    // device pixels: draw large, then shrink, so edges are smooth
    const big = async (svg, w, h) => sharp(await png(svg, w * 2, h * 2)).resize(w, h).png().toBuffer();
    write(path.join(BRAND, 'markstage-512.png'), await small(await big(svgs.mark, 512, 512)));
    const [lw, lh] = /viewBox="0 0 (\d+) (\d+)"/.exec(svgs.logo).slice(1).map(Number);
    write(path.join(BRAND, 'markstage-logo.png'), await small(await big(svgs.logo, lw * 2, lh * 2)));
    write(path.join(BRAND, 'markstage-logo-dark.png'), await small(await big(svgs.logoDark, lw * 2, lh * 2)));
    const icons = [];
    for (const size of [16, 32, 48]) {
      const favicon = markFile('light', { small: size <= 32 });
      icons.push({ size, data: await sharp(await png(favicon, size * 4, size * 4)).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer() });
    }
    write(path.join(SITE, 'favicon.ico'), icoFile(icons));
    // an Apple touch icon is square and opaque (iOS rounds its corners): the slash and caret on ink, edge to edge
    const touch = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 40 40" width="180" height="180"><rect x="-4" y="-4" width="40" height="40" fill="${PALETTE.light.tile}"/>${markFile('light').replace(/^<svg[^>]*>|<\/svg>\n$/g, '')}</svg>`;
    write(path.join(SITE, 'apple-touch-icon.png'), await small(await big(touch, 180, 180)));
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
