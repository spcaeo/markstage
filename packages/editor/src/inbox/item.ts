// One Inbox item in the drawer: every value copyable (an address also opens), what it is now (status, who has it),
// and what to do with it: mark it handled or spam, give it to a person, add a note. Each change is saved at once
// against the item's version (409: someone changed it meanwhile, it is read again).
import { ApiError } from '../api';
import type { ScreenCtx } from '../host';
import { button, el, facts, failure, link, maybe, message, state, value, when } from '../admin/ui';
import * as api from './api';
import { localTimes } from '../dates';
import { crmRows } from './crm';

export const STATUS_LABEL: Record<api.InboxStatus, string> = { new: 'New', handled: 'Handled', spam: 'Spam', held: 'Held' };
/** The drawer's title: "Alert", or "Message · <form>". */
export const titleOf = (it: Pick<api.InboxItem, 'kind' | 'formLabel'>) => (it.kind === 'alert' ? 'Alert' : `Message${it.formLabel ? ` · ${it.formLabel}` : ''}`);
const META_LABEL: Record<string, string> = {
  referrer: 'Came from',
  landing: 'Landing page',
  page: 'Sent from',
  utmSource: 'UTM source',
  utmMedium: 'UTM medium',
  utmCampaign: 'UTM campaign',
  ip: 'IP address',
  location: 'Location (approximate)',
  userAgent: 'Browser',
};
const isAddress = (v: string) => /^(https?:\/\/|\/)/.test(v);
// a long value (the message itself) wraps and keeps its lines, so it reads whole
const shown = (v: string, label: string) => (isAddress(v) ? link(v, label) : value(v, label, v.length > 40 || v.includes('\n') ? 'ms-inbox__long' : ''));

interface Deps {
  ctx: ScreenCtx;
  people: api.Person[];
  me: string;
  /** shown by the location, as its licence asks */
  credits: string | null;
  /** the list reads again (status, assignee) */
  changed(): void;
  /** the drawer's title, from the item itself (its row may have left the list) */
  title(text: string): void;
}

export function mountItem(body: HTMLElement, id: string, d: Deps): void {
  body.replaceChildren(state('loading', 'Loading…'));
  let it: api.InboxDetail;

  const save = async (change: { status?: api.InboxStatus; assigneeId?: string | null }, said: string) => {
    try {
      it = await api.change(id, { ...change, version: it.version });
      d.ctx.toast(said, 'ok');
      d.changed();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        d.ctx.toast('Someone changed this meanwhile; here it is as it is now.', 'info');
        d.changed();
      } else d.ctx.toast(`Not saved: ${message(e)}`, 'error');
    }
  };

  const draw = () => {
    d.title(titleOf(it));
    const rows: [string, Node | string][] = [
      ['When', el('span', when(it.at), ' · ', value(it.at, 'time'))],
      ['Status', STATUS_LABEL[it.status]],
      ['Assigned to', it.assignee ? value(it.assignee.name, 'name') : el('span.ms-adm-none', 'nobody')],
    ];
    if (it.kind === 'alert') {
      rows.push(['Alert', value(localTimes(it.summary), 'alert')], ['Kind', maybe(it.alertKind, 'alert kind')]);
      if (it.link) rows.push(['In the editor', el('a', { href: it.link }, 'Open it')]);
    } else {
      if (it.formLabel || it.form) rows.push(['Form', value(it.formLabel ?? it.form!, 'form')]);
      for (const f of it.fields) rows.push([f.label, f.value ? shown(f.value, f.label.toLowerCase()) : el('span.ms-adm-none', '—')]);
    }
    if (it.kind === 'message' && it.imported) rows.push(['Imported from', it.imported.from === 'wordpress' ? 'WordPress' : it.imported.from]);
    // the team mail: said only when it did not simply go
    if (it.alert === 'failed' || it.alert === 'pending') {
      const next = it.alertNextAt ? el('span', ' · tried again ', when(it.alertNextAt)) : '';
      rows.push(['Alert to the team', el('span', it.alert === 'failed' ? `Not sent (${it.alertTries ?? 0} tr${it.alertTries === 1 ? 'y' : 'ies'})` : 'Waiting to be sent', next)]);
      if (it.alertError) rows.push(['Why', shown(it.alertError, 'error')]);
    }
    // the CRM (Odoo): sent with its lead, waiting, or not sent with why and "Send to Odoo again"
    rows.push(...crmRows(it, { ctx: d.ctx, got: (now) => ((it = now), draw()), changed: d.changed }));
    for (const [k, v] of Object.entries(it.meta ?? {})) {
      if (!v) continue;
      const label = META_LABEL[k] ?? k;
      rows.push([label, k === 'location' && d.credits ? el('div', shown(v, label.toLowerCase()), el('div.ms-adm-sub.ms-inbox__credits', d.credits)) : shown(v, label.toLowerCase())]);
    }
    rows.push(['Reference', value(it.id, 'reference')]);

    // what to do: one status at a time, then who has it
    const acts = el('div.ms-adm-row.ms-inbox__acts');
    if (it.status !== 'handled') acts.append(button('Mark handled', () => void save({ status: 'handled' }, 'Marked handled.'), { kind: 'primary', small: true, icon: 'check' }));
    if (it.status !== 'new') acts.append(button(it.status === 'spam' ? 'Not spam' : 'Mark as new', () => void save({ status: 'new' }, 'Marked as new.'), { small: true }));
    if (it.status !== 'spam' && it.kind === 'message') acts.append(button('Spam', () => void save({ status: 'spam' }, 'Marked as spam.'), { small: true, kind: 'quiet' }));
    const who = el('select.ms-input.ms-adm-select', { 'aria-label': 'Assign to' }, el('option', { value: '' }, 'Nobody'));
    for (const u of [...d.people].sort((a, b) => (a.id === d.me ? -1 : b.id === d.me ? 1 : 0))) who.append(el('option', { value: u.id, selected: u.id === it.assignee?.id }, u.id === d.me ? `${u.name} (me)` : u.name));
    who.addEventListener('change', () => void save({ assigneeId: who.value || null }, who.value ? `Given to ${who.selectedOptions[0]!.textContent}.` : 'Nobody has it now.'));
    acts.append(el('label.ms-adm-datewrap', el('span', 'Assign to'), who));

    // notes: newest last, as a conversation reads
    const notes = el('div.ms-inbox__notes');
    for (const n of it.notes) notes.append(el('div.ms-inbox__note', el('div.ms-adm-sub', `${n.by.name} · `, when(n.at)), value(n.text, 'note')));
    const text = el('textarea.ms-input', { rows: '3', 'aria-label': 'A note for the team', placeholder: 'A note for the team (only people in Markstage see it)' });
    const add = button('Add note', async () => {
      const t = text.value.trim();
      if (!t) return text.focus();
      try {
        it.notes.push(await api.addNote(id, t));
        text.value = '';
        draw();
      } catch (e) {
        d.ctx.toast(`The note was not added: ${message(e)}`, 'error');
      }
    }, { small: true });

    body.replaceChildren(acts, facts(rows), el('h3.ms-adm-h3', 'Notes'), it.notes.length ? notes : el('p.ms-adm-sub', 'No notes yet.'), text, el('div.ms-adm-row', add));
    if (it.history?.length) {
      const h = el('ul.ms-inbox__history');
      for (const x of it.history) h.append(el('li', when(x.at), ` · ${x.by?.name ?? 'Markstage'}: ${x.change}`));
      body.append(el('h3.ms-adm-h3', 'What happened'), h);
    }
  };

  void api.item(id).then(
    (x) => {
      it = x;
      draw();
    },
    (e) => body.replaceChildren(failure(e)),
  );
}
