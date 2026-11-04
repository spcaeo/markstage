// "Summarize changes" on a plan that can still run (?suggest=summary): the AI words what the plan brings, next to
// the Reason it goes live with. Accepting puts it in the Reason box as if typed (⌘Z in the box undoes it, and so
// does the toast's Undo); it is sent with Promote, through the same rules as a typed reason.
import type { ScreenCtx } from '../host';
import { suggestButton, suggestCard, type Card } from '../ai/card';
import type * as api from './api';

const MAX = 500;

/** Writes `text` into the box as typing does, so the box's own undo takes it back; then `input` runs. */
function typeInto(box: HTMLTextAreaElement, text: string): void {
  box.focus();
  box.select();
  if (!document.execCommand('insertText', false, text)) {
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function summaryAi(ctx: () => ScreenCtx, reason: HTMLTextAreaElement) {
  let card: Card | null = null;
  let forPlan = '';
  // where the card goes, kept across redraws (a redraw would move the Reason box and lose its undo)
  const slot = document.createElement('div');
  slot.className = 'ms-env-ai';
  const close = () => ctx().go({ params: { suggest: null } }, true);
  return {
    button: () => suggestButton('Summarize changes', () => ctx().go({ params: { suggest: 'summary' } }, true)),
    /** the place of the card, with the card while the URL asks for it (made once, so it is asked once) */
    card(p: api.Plan): HTMLElement {
      if (ctx().params().get('suggest') !== 'summary') {
        card?.destroy();
        card = null;
        return slot;
      }
      if (card && forPlan === p.id) return (card.sync(), slot);
      card?.destroy();
      forPlan = p.id;
      card = suggestCard({
        title: 'Suggested summary of the changes',
        fields: [{ name: 'text', label: 'Reason', now: () => reason.value, multiline: true, empty: 'No reason written yet' }],
        body: () => ({ kind: 'summary', plan: p.id }),
        accept: (v) => {
          const old = reason.value;
          typeInto(reason, v.text.trim().slice(0, MAX));
          ctx().toast(`The summary is the reason now${v.text.trim().length > MAX ? ` (its first ${MAX} characters)` : ''}. It goes with ${p.action === 'sync' ? 'Sync' : 'Promote'}.`, 'ok', {
            action: { label: 'Undo', run: () => typeInto(reason, old) },
          });
          return null;
        },
        close,
      });
      slot.replaceChildren(card.el);
      return slot;
    },
    destroy: () => card?.destroy(),
  };
}
