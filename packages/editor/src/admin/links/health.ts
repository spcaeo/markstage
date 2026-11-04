// The Links screen's Health view (index.ts): what to fix in the site's links, worst first, each with its one-click fix
// or a button that opens the page at the sentence. Filters (topic, kind) and the open finding are in the URL.
import type { ScreenCtx } from '../../host';
import { fixFinding, type Finding } from '../../topics';
import { button, el, link, message, state, undoToast, value } from '../ui';

const LEVEL = { high: 'Fix first', medium: 'Worth fixing', low: 'When there is time' };

/** The buttons of a finding: its one-click fix, its suggestions, or the page at the sentence. */
function actions(ctx: ScreenCtx, f: Finding, reload: () => void): HTMLElement {
  const row = el('div.ms-lh-actions');
  const run = (label: string, iconName: string) =>
    button(label, async () => {
      try {
        const r = await fixFinding(f.id);
        undoToast(ctx, `Done: ${label.toLowerCase()}.${r.job ? ' Publishing it.' : ''}`, f.fix?.kind === 'drop-page' ? null : r.commit, reload);
        reload();
      } catch (e) {
        ctx.toast(message(e), 'error');
      }
    }, { icon: iconName, kind: 'primary', small: true });
  if (f.fix?.kind === 'retarget') row.append(run(`Point it to ${f.fix.href}`, 'link'));
  if (f.fix?.kind === 'rel') row.append(run(`Mark it ${f.fix.rel}`, 'shield'));
  if (f.fix?.kind === 'drop-page') row.append(run('Take it out of the topic', 'trash'));
  if (f.fix?.kind === 'suggest-in') row.append(button('Pages that could link here', () => ctx.go({ params: { view: 'page', ref: f.ref, kind: null, f: null } }, true), { icon: 'link', small: true, kind: 'primary' }));
  if (f.fix?.kind === 'suggest-out') row.append(button('Suggested links', () => ctx.go({ params: { view: 'page', ref: f.ref, kind: null, f: null } }, true), { icon: 'link', small: true, kind: 'primary' }));
  const edit = f.page.edit;
  if (f.fix?.kind === 'place' && edit) row.append(button('Put it in a topic', () => ctx.open(`${edit}${edit.includes('?') ? '&' : '?'}s=1`, true), { icon: 'layers', small: true, kind: 'primary' }));
  if (f.open) row.append(button(f.sentence ? 'Open at the sentence' : 'Open the page', () => ctx.open(f.open!, true), { icon: 'open', small: true }));
  return row;
}

export function healthView(ctx: ScreenCtx, items: Finding[], reload: () => void): HTMLElement {
  if (!items.length) return state('empty', 'Nothing to fix here', 'Every page here has links in, links up to its main page, and clear link words.');
  const open = ctx.params().get('f');
  const list = el('ol.ms-lh');
  for (const f of items) {
    const li = el('li.ms-lh-row', { 'data-finding': f.id, 'data-kind': f.kind, tabindex: '-1' });
    li.classList.add(`is-${f.level}`);
    li.classList.toggle('is-open', f.id === open);
    const title = el('div.ms-lh-title', el('span.ms-lh-level', LEVEL[f.level]), f.page.edit ? el('a.ms-lh-page', { href: f.page.edit }, f.page.title) : el('span.ms-lh-page', f.page.title));
    li.append(title);
    if (f.page.url) li.append(link(f.page.url, 'page address', 'ms-lh-url'));
    li.append(el('p.ms-lh-msg', f.message));
    if (f.sentence) li.append(el('blockquote.ms-lh-sentence', f.sentence));
    if (f.href && f.kind.startsWith('outside')) li.append(el('div.ms-lh-href', link(f.href, 'link address')));
    else if (f.anchor) li.append(el('div.ms-lh-href', el('span.ms-lh-label', 'Link words'), value(f.anchor, 'link words')));
    li.append(actions(ctx, f, reload));
    li.addEventListener('focusin', () => {
      if (ctx.params().get('f') !== f.id) ctx.go({ params: { f: f.id } });
    });
    list.append(li);
  }
  return list;
}
