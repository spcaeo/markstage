#!/usr/bin/env node
// Draws the share images from one SVG design and renders them to PNG (rsvg-convert, then sharp to shrink them):
//   site/og/<kind>.png           1200 x 630, one per kind of page (config.mjs OG_IMAGES)
//   .github/social-preview.png   1280 x 640 (GitHub › Settings › Social preview)
// The editor screenshot on the right is site/media/hero.webp (scripts/site/capture-shots.mjs). Run after new
// screenshots:   npm run site:og
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from './build-site.mjs';
import { OG_IMAGES } from './config.mjs';

const KINDS = {
  home: { title: ['A visual editor', 'for Astro'], lines: ['Edit Markdown on the real page.', 'Every save is a clean git diff.'] },
  docs: { title: ['Markstage', 'documentation'], lines: ['Set up, write, deploy and run', 'the visual editor for Astro.'] },
  compare: { title: ['Markstage', 'compared'], lines: ['A git-based visual editor next to', 'hosted and git-based CMSs.'] },
  learn: { title: ['Markstage,', 'explained'], lines: ['Questions, answers and the words', 'of visual editing for Astro.'] },
};

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function socialSvg(width, height, kind, shot) {
  const k = KINDS[kind];
  const s = height / 630;
  const pad = 64 * s;
  const shotW = width * 0.46;
  const shotH = shotW * 0.625;
  const shotX = width - shotW * 0.9;
  const shotY = (height - shotH) / 2 + 40 * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="1" stop-color="#0e1020"/></linearGradient>
    <radialGradient id="glow" cx="0.8" cy="0.2" r="0.6"><stop offset="0" stop-color="#6366f1" stop-opacity="0.45"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></radialGradient>
    <clipPath id="clip"><rect x="${shotX}" y="${shotY}" width="${shotW}" height="${shotH}" rx="${14 * s}"/></clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  ${shot ? `<rect x="${shotX - 1}" y="${shotY - 1}" width="${shotW + 2}" height="${shotH + 2}" rx="${15 * s}" fill="#c7d2fe" opacity="0.5"/><image x="${shotX}" y="${shotY}" width="${shotW}" height="${shotH}" preserveAspectRatio="xMinYMin slice" clip-path="url(#clip)" xlink:href="data:image/png;base64,${shot}"/>` : ''}
  <g font-family="Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif">
    <g transform="translate(${pad} ${pad}) scale(${(56 * s) / 32})"><rect width="32" height="32" rx="8" fill="#4f46e5"/><path d="M8 22V10l8 8 8-8v12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 26h20" stroke="#c7d2fe" stroke-width="2" stroke-linecap="round"/></g>
    <text x="${pad + 72 * s}" y="${pad + 42 * s}" font-size="${40 * s}" font-weight="700" fill="#eef0fa">Markstage</text>
    ${k.title.map((t, i) => `<text x="${pad}" y="${pad + (165 + i * 60) * s}" font-size="${52 * s}" font-weight="800" fill="#ffffff" letter-spacing="-1">${esc(t)}</text>`).join('\n    ')}
    ${k.lines.map((l, i) => `<text x="${pad}" y="${pad + (285 + i * 40) * s}" font-size="${27 * s}" font-weight="500" fill="#c9cce0">${esc(l)}</text>`).join('\n    ')}
    <text x="${pad}" y="${height - pad}" font-size="${22 * s}" font-weight="600" fill="#a5b4fc">Source-available · Free to self-host · Content in git</text>
  </g>
</svg>
`;
}

async function main() {
  const sharp = (await import('sharp')).default;
  const hero = path.join(REPO_ROOT, 'site', 'media', 'hero.webp');
  const shot = fs.existsSync(hero) ? (await sharp(hero).resize(1200).png().toBuffer()).toString('base64') : null;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'markstage-og-'));
  try {
    const jobs = [
      ...Object.entries(OG_IMAGES).map(([kind, og]) => [kind, path.join(REPO_ROOT, 'site', og.path), 1200, 630]),
      ['home', path.join(REPO_ROOT, '.github', 'social-preview.png'), 1280, 640],
    ];
    for (const [kind, out, w, h] of jobs) {
      const svg = path.join(temp, `${kind}-${w}.svg`);
      const raw = path.join(temp, `${kind}-${w}.png`);
      fs.writeFileSync(svg, socialSvg(w, h, kind, shot));
      execFileSync('rsvg-convert', ['-w', String(w), '-h', String(h), '-o', raw, svg]);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, await sharp(raw).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer());
      console.log(`Wrote ${path.relative(REPO_ROOT, out)} (${w} x ${h}, ${Math.round(fs.statSync(out).size / 1024)} KB)`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
