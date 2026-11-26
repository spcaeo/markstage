// The small parts both head screens are built from: a switch with its hint, a text field with its hint and its message
// under it, and the Save bar (Save, Discard, and the "someone else changed it" note). Plain words, one hint sentence
// under every option (docs/EDITOR-UX.md). The inputs are form fields, so none has a copy icon.
import { h, ht } from '../../panel-form';

let n = 0;
/** An id for a hint or message, so the field it belongs to can point at it (aria-describedby). */
export const uid = (prefix: string) => `${prefix}-${++n}`;

/** A checkbox row: the name, and one sentence under it saying what changes. `extra` is for what follows the hint. */
export function switchRow(o: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }): { row: HTMLElement; extra: HTMLElement } {
  const row = h('div', 'ms-hk__switch');
  const hintId = uid('ms-hk-hint');
  const label = h('label', 'ms-hk__switchlabel');
  const box = Object.assign(h('input'), { type: 'checkbox', checked: o.checked, disabled: !!o.disabled });
  box.setAttribute('aria-describedby', hintId);
  box.addEventListener('change', () => o.onChange(box.checked));
  label.append(box, ht('strong', '', o.label));
  const hint = ht('p', 'ms-hk__hint', o.hint);
  hint.id = hintId;
  const extra = h('div', 'ms-hk__extra');
  row.append(label, hint, extra);
  return { row, extra };
}

export interface TextOpts {
  label: string;
  hint: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  /** a code-like value (an ID, an address) is shown in the monospace face */
  mono?: boolean;
  type?: 'text' | 'number';
  /** the message under the field now (a wrong value, or the server's refusal), or '' */
  message?: string;
  onInput: (value: string) => void;
}

/**
 * A labelled text input with its hint under it and a message line under that. `setMessage` changes the message
 * without redrawing the screen, so typing never loses its place.
 */
export function textField(o: TextOpts): { field: HTMLElement; input: HTMLInputElement; setMessage: (m: string) => void } {
  const field = h('div', 'ms-hk__field');
  const id = uid('ms-hk-in');
  const hintId = `${id}-hint`;
  const msgId = `${id}-msg`;
  const label = ht('label', 'ms-hk__label', o.label);
  label.htmlFor = id;
  const input = Object.assign(h('input', `ms-input${o.mono ? ' ms-input--code' : ''}`), { id, type: o.type ?? 'text', value: o.value, placeholder: o.placeholder ?? '', disabled: !!o.disabled });
  if (o.type === 'number') Object.assign(input, { min: '1', max: '500', step: '1' });
  input.autocomplete = 'off';
  input.spellcheck = false;
  const hint = ht('p', 'ms-hk__hint', o.hint);
  hint.id = hintId;
  const msg = h('p', 'ms-hk__msg');
  msg.id = msgId;
  msg.setAttribute('aria-live', 'polite');
  const setMessage = (m: string) => {
    msg.textContent = m;
    input.setAttribute('aria-invalid', String(!!m));
    input.setAttribute('aria-describedby', m ? `${hintId} ${msgId}` : hintId);
  };
  setMessage(o.message ?? '');
  input.addEventListener('input', () => o.onInput(input.value));
  field.append(label, input, hint, msg);
  return { field, input, setMessage };
}

export interface BarState {
  dirty: boolean;
  /** something in the form is wrong: Save waits */
  blocked?: boolean;
  saving?: boolean;
  /** the file changed under this page: Save is replaced by the way to reload */
  stale?: boolean;
}

/** The Save bar. One main button; Discard puts the form back as it was loaded. */
export function saveBar(o: { save: string; saved: string; unsaved: string; onSave: () => void; onDiscard: () => void; onReload: () => void }): { el: HTMLElement; render: (s: BarState) => void } {
  const el = h('div', 'ms-locks__bar ms-hk__bar');
  const render = (s: BarState) => {
    if (s.stale) {
      const reload = Object.assign(h('button', 'ms-btn ms-btn--primary'), { type: 'button', textContent: 'Reload the settings' });
      reload.addEventListener('click', o.onReload);
      const note = ht('span', 'ms-locks__note ms-hk__stale', 'Someone else changed these settings; reload to see theirs. Your changes here were not saved.');
      note.setAttribute('role', 'alert');
      el.replaceChildren(reload, note);
      return;
    }
    const save = Object.assign(h('button', 'ms-btn ms-btn--primary'), { type: 'button', textContent: s.saving ? 'Saving…' : o.save, disabled: !s.dirty || !!s.blocked || !!s.saving });
    const undo = Object.assign(h('button', 'ms-btn ms-btn--quiet'), { type: 'button', textContent: 'Discard', disabled: !s.dirty || !!s.saving });
    save.addEventListener('click', o.onSave);
    undo.addEventListener('click', o.onDiscard);
    el.replaceChildren(save, undo, ht('span', 'ms-locks__note', s.blocked ? 'Fix the marked fields to save.' : s.dirty ? o.unsaved : o.saved));
  };
  return { el, render };
}
