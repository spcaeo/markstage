// The step's boxes that are not pages (flow.ts; flow-river.ts places them): the column headings, the note where a
// column is empty, and the "To fix" box under the page picked, one row per missing link with Accept (it adds the
// link at the sentence the suggestion found; Undo on the toast) and Skip (remembered for everyone), or "Open the page"
// when no sentence fits or the suggestion was skipped.
import type { ScreenCtx } from '../../host';
import { toast } from '../../host';
import { undo } from '../../suggestion-card';
import { acceptSuggestion, skipSuggestion, type JourneyMissing } from '../../topics';
import { el } from '../ui';
import type { FlowModel, FlowNode } from './flow-model';
import { placed } from './flow-node';
import type { Box } from './flow-river';

const say = (e: unknown) => (e instanceof Error ? e.message : String(e));
const WHAT: Record<JourneyMissing['kind'], string> = { 'no-lead-link': 'its group lead', 'no-money-link': 'the service page', 'no-pillar-link': 'the main page' };

/** A column's heading, or the note in a column with no page. */
export function stepText(b: Box, focus: FlowNode, n: { from: number; to: number; both: number }): HTMLElement {
  const words: Record<string, string> = {
    from: `Comes from · ${n.from}`,
    to: `Goes to · ${n.to}`,
    page: `${focus.code} · the page`,
    both: `Both ways ⇄ · ${n.both}`,
    'none-in': 'No page of this topic links here.',
    'none-out': 'This page links to no page of this topic.',
  };
  return placed(el(b.kind === 'head' ? 'p.ms-fl-colhead' : 'p.ms-fl-note', words[b.say ?? ''] ?? ''), b);
}

/** The To fix box: the page's missing links, each with what adds it. */
export function fixBox(ctx: ScreenCtx, m: FlowModel, fixes: JourneyMissing[], b: Box, done: () => void): HTMLElement {
  const box = placed(el('section.ms-fl-fix', { 'aria-label': `To fix: ${fixes.length} missing ${fixes.length === 1 ? 'link' : 'links'}` }), b);
  box.append(el('p.ms-fl-fix__head', el('span.ms-fl-dot', { 'aria-hidden': 'true' }), `To fix · ${fixes.length}`));
  for (const f of fixes) {
    const a = m.all.get(f.from)?.code ?? '?';
    const z = m.all.get(f.to)?.code ?? '?';
    const s = f.suggestion;
    const hint = s ? (s.how === 'link' && s.sentence ? `Links the words “${s.anchor}” in: ${s.sentence}` : `No sentence fits yet: write one with the words “${s.anchor}”.`) : 'Its suggestion was skipped: open the page and write a sentence that links there.';
    const row = el('div.ms-fl-fix__row', { title: hint }, el('p.ms-fl-fix__what', `${a} should link to ${z} (${WHAT[f.kind]})`));
    const btns = el('p.ms-fl-fix__btns');
    const busy = (on: boolean) => btns.querySelectorAll('button').forEach((x) => (x.disabled = on));
    const btn = (label: string, run: () => void, kind = '') => {
      const x = el(`button.ms-btn.ms-btn--sm${kind ? `.ms-btn--${kind}` : ''}`, { type: 'button', 'aria-label': `${label}: ${a} should link to ${z}` }, label);
      x.addEventListener('click', run);
      btns.append(x);
    };
    if (s?.how === 'link')
      btn('Accept', async () => {
        busy(true);
        try {
          const r = await acceptSuggestion(s);
          toast(`Linked “${s.anchor}” on “${s.fromTitle}”.${r.job ? ' Publishing it.' : ''}`, 'ok', r.commit ? { action: { label: 'Undo', run: () => void undo(r.commit!).then(() => (toast('Undone.', 'ok'), done()), (e) => toast(say(e), 'error')) } } : {});
          done();
        } catch (e) {
          busy(false);
          toast(say(e), 'error');
        }
      }, 'primary');
    else btn('Open the page', () => ctx.open(f.open, true));
    if (s)
      btn('Skip', async () => {
        busy(true);
        try {
          await skipSuggestion(s);
          done();
        } catch (e) {
          busy(false);
          toast(say(e), 'error');
        }
      }, 'quiet');
    row.append(btns);
    box.append(row);
  }
  return box;
}
