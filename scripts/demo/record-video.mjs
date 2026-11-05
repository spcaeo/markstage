#!/usr/bin/env node
// Records the live demo's short video from a fresh demo build (docs/DEMO.md): a post opens on its page, a heading is
// edited, Save shows the git diff of that one line.
//
//   npm run demo:video
//
// Writes site/media/demo.mp4 and demo.webm (the home page and /demo/), site/media/demo-poster.webp (its first look) and
// docs/screenshots/demo.gif (the README, which cannot play a video file). Needs Playwright's Chromium, sharp and
// ffmpeg (FFMPEG, else ffmpeg on the PATH). The demo is built in .wt-demo-video (git-ignored) and served on
// 127.0.0.1:DEMO_VIDEO_PORT (default 23437, odd, checked free first); the browser is closed and the server stopped
// whatever happens, and the folder removed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemo } from './build-demo.mjs';
import { listening, serveStatic } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const WORK = path.join(ROOT, '.wt-demo-video');
const PORT = Number(process.env.DEMO_VIDEO_PORT ?? 23437);
const BASE = '/markstage/demo/';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const SIZE = { width: 1280, height: 760 };
const MP4 = path.join(ROOT, 'site', 'media', 'demo.mp4');
const WEBM = path.join(ROOT, 'site', 'media', 'demo.webm');
const POSTER = path.join(ROOT, 'site', 'media', 'demo-poster.webp');
const GIF = path.join(ROOT, 'docs', 'screenshots', 'demo.gif');

async function film(browser, url) {
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: path.join(WORK, 'raw'), size: SIZE } });
  await ctx.addInitScript(() => {
    try {
      // the first-visit hint at the foot of the canvas, already seen; the drawer folded, so the page has the room
      if (window === window.top) localStorage.setItem('markstage.hint.closed', '1'), localStorage.setItem('markstage.drawer', JSON.stringify({ folded: true }));
    } catch {
      // about:blank has no storage
    }
  });
  const page = await ctx.newPage();
  let poster = null;
  try {
    await page.goto(url);
    const heading = page.locator('.ms-canvas > .ProseMirror h2', { hasText: 'Text and lists' }).first();
    await heading.waitFor({ timeout: 60_000 });
    await page.locator('.ms-sheet.is-shell').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1800);
    poster = await page.screenshot({ type: 'png' });
    await heading.click();
    await page.keyboard.press('End');
    await page.waitForTimeout(400);
    await page.keyboard.type(', saved cleanly', { delay: 90 });
    await page.waitForTimeout(900);
    await page.locator('button[data-save]').click();
    await page.locator('dialog.ms-demo-dialog[open] .ms-demo-diff').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(3800);
    await page.locator('dialog.ms-demo-dialog[open]').getByRole('button', { name: 'Close' }).click();
    await page.waitForTimeout(1200);
  } finally {
    await ctx.close();
  }
  const raw = fs.readdirSync(path.join(WORK, 'raw')).find((f) => f.endsWith('.webm'));
  return { webm: path.join(WORK, 'raw', raw), poster };
}

async function main() {
  if (listening(PORT)) throw new Error(`Port ${PORT} is in use: set DEMO_VIDEO_PORT to another free odd port.`);
  fs.rmSync(WORK, { recursive: true, force: true });
  const out = path.join(WORK, 'out');
  await buildDemo({ out, base: BASE, install: 'https://spcaeo.github.io/markstage/#install' });
  const { chromium } = await import('playwright');
  const server = await serveStatic(out, BASE, PORT);
  const browser = await chromium.launch();
  let shot;
  try {
    shot = await film(browser, `http://127.0.0.1:${PORT}${BASE}editor/#/e/posts/hello-markstage`);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
  const ff = (...args) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  // H.264 for every browser, small: 24 fps, a high CRF (flat UI compresses well), no sound, fast start for the web
  ff('-i', shot.webm, '-an', '-vf', 'fps=24,scale=1280:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', MP4);
  // VP9 as well, for a browser without H.264 (Chromium builds without the licensed codecs)
  ff('-i', shot.webm, '-an', '-vf', 'fps=24', '-c:v', 'libvpx-vp9', '-crf', '42', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', WEBM);
  // the README's GIF: narrower and slower, one palette for the whole clip
  ff('-i', shot.webm, '-vf', 'fps=8,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', GIF);
  const sharp = (await import('sharp')).default;
  fs.writeFileSync(POSTER, await sharp(shot.poster).webp({ quality: 74, effort: 6 }).toBuffer());
  for (const f of [MP4, WEBM, POSTER, GIF]) console.log(`  ${path.relative(ROOT, f)} ${Math.round(fs.statSync(f).size / 1024)} KB`);
  if (!process.env.DEMO_KEEP) fs.rmSync(WORK, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
