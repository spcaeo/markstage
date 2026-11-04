// A plan's before and after screenshots (docs/ENVIRONMENTS.md: every page whose HTML changed, at 1440 and 390 wide),
// one page per row, the live page on the left and the plan's build on the right. ?w=390 shows the phone width; a
// picture opens full size in a new tab.
import type { ScreenCtx } from '../host';
import { el, link } from '../admin/ui';
import * as api from './api';

const WIDTHS: [string, string][] = [
  ['1440', 'Desktop (1440)'],
  ['390', 'Phone (390)'],
];
const KIND_WORDS: Record<string, string> = { changed: 'Changed', added: 'New page', removed: 'Removed' };

function picture(p: api.Plan, file: string | null, label: string): HTMLElement {
  if (!file) return el('div.ms-env-shot.is-none', el('span.ms-adm-sub', label === 'Before' ? 'Not on the live site' : 'Not in the new build'));
  const src = api.shotUrl(p.id, file);
  const img = el('img', { src, alt: `${label}`, loading: 'lazy' }) as HTMLImageElement;
  const a = el('a.ms-env-shot', { href: src, target: '_blank', rel: 'noopener', title: `${label}: open full size` }, img);
  // never a broken picture: a plain box that says why (the route's own words when it gives them)
  img.addEventListener('error', () => void failed(src).then((why) => a.replaceWith(el('div.ms-env-shot.is-none', { role: 'img', 'aria-label': `${label}: ${why}` }, el('span.ms-adm-sub', why)))), { once: true });
  return a;
}

/** Why a screenshot did not load: not there yet (404), or what the server said. */
async function failed(src: string): Promise<string> {
  try {
    const res = await fetch(src, { credentials: 'same-origin' });
    if (res.status === 404) return 'Screenshot not ready yet';
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return `Screenshot failed: ${body?.message ?? (res.ok ? 'the file is not a picture' : `the server answered ${res.status}`)}`;
  } catch {
    return 'Screenshot failed: the server cannot be reached';
  }
}

export function shotsCard(p: api.Plan, ctx: ScreenCtx): HTMLElement | null {
  const s = p.shots;
  if (!s) return null;
  const head = el('div.ms-adm-row', el('h2.ms-adm-h2', 'Before and after'));
  if (s.status !== 'done' || !s.pages.length) return el('section.ms-adm-card', head, el('p.ms-adm-sub', s.words || 'No screenshots.'));
  const w = ctx.params().get('w') === '390' ? 390 : 1440;
  const seg = el('div.ms-seg', { role: 'radiogroup', 'aria-label': 'Width' });
  for (const [v, l] of WIDTHS) {
    const b = el('button.ms-seg__btn', { type: 'button', role: 'radio', 'aria-checked': String(Number(v) === w) }, l);
    if (Number(v) === w) b.classList.add('is-on');
    b.addEventListener('click', () => ctx.go({ params: { w: v === '1440' ? null : v } }, true));
    seg.append(b);
  }
  head.append(el('span.ms-adm-grow'), el('span.ms-adm-sub', `${s.pages.length} page${s.pages.length === 1 ? '' : 's'}`), seg);
  const rows = el('div.ms-env-shots');
  for (const pg of s.pages) {
    const shot = pg.shots.find((x) => x.width === w) ?? pg.shots[0];
    rows.append(
      el(`div.ms-env-shotrow.ms-env-shotrow--w${w}`,
        el('div.ms-adm-row', link(pg.path, 'page path'), el('span.ms-adm-badge', KIND_WORDS[pg.kind] ?? pg.kind)),
        shot ? el('div.ms-env-pair', el('figure', el('figcaption.ms-adm-sub', 'Before (live)'), picture(p, shot.before, 'Before')), el('figure', el('figcaption.ms-adm-sub', 'After (this plan)'), picture(p, shot.after, 'After'))) : el('p.ms-adm-sub', 'No screenshot at this width.'),
      ),
    );
  }
  return el('section.ms-adm-card', head, s.words ? el('p.ms-adm-sub', s.words) : '', rows);
}
