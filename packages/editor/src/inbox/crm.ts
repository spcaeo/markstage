// A message on its way to the CRM (forms.<id>.crm, docs/API-INBOX.md "Odoo"): the "Not sent to Odoo" mark the list
// and the drawer show, with why on hover or focus (and its copy icon), and the drawer's row with "Send to Odoo
// again", which says the server's words when it is refused.
import { ApiError } from '../api';
import type { ScreenCtx } from '../host';
import { button, el, message, value, when } from '../admin/ui';
import * as api from './api';

let seq = 0;

/** "Not sent to Odoo": a badge that is focusable; hovering or focusing it shows why, with a copy icon. */
export function crmMark(crm: api.InboxCrm): HTMLElement {
  const why = crm.error || 'It was not sent; it is tried again.';
  const id = `ms-inbox-crm-${++seq}`;
  return el('span.ms-inbox__crm',
    el('span.ms-adm-badge.is-bad', { tabindex: '0', 'aria-describedby': id }, `Not sent to ${crm.name}`),
    el('span.ms-inbox__why', { id, role: 'tooltip' }, value(why, `why it was not sent to ${crm.name}`)),
  );
}

interface Deps {
  ctx: ScreenCtx;
  /** the message as the server has it now (after a try, or a refusal that carries it) */
  got(it: api.InboxDetail): void;
  /** the list reads again */
  changed(): void;
}

/** The drawer's rows for the CRM: how it went, and "Send to Odoo again" while it has not gone. */
export function crmRows(it: api.InboxDetail, d: Deps): [string, Node | string][] {
  const crm = it.crm;
  if (!crm) return [];
  const label = `Sent to ${crm.name}`;
  if (crm.state === 'sent') return [[label, el('span', 'Yes · lead ', crm.leadId ? value(crm.leadId, `${crm.name} lead id`) : '?', it.crmAt ? el('span', ' · ', when(it.crmAt)) : '')]];
  if (crm.state === 'pending') return [[label, 'Waiting to be sent']];
  const tries = it.crmTries ?? 0;
  const next = it.crmNextAt ? el('span', ' · tried again ', when(it.crmNextAt)) : el('span', ' · not tried again by itself');
  const again = button(`Send to ${crm.name} again`, async () => {
    again.disabled = true;
    try {
      const now = await api.sendAgain(it.id);
      d.ctx.toast(`Sent to ${crm.name} (lead ${now.crm?.leadId ?? '?'}).`, 'ok');
      d.got(now);
    } catch (e) {
      // the server's words: "Not sent: …" (it is the message as it is now), or why it is not sent at all
      d.ctx.toast(message(e), 'error');
      const item = e instanceof ApiError ? (e.data?.item as api.InboxDetail | undefined) : undefined;
      if (item) d.got(item);
      else again.disabled = false;
    }
    d.changed();
  }, { small: true, icon: 'refresh' });
  return [
    [label, el('div.ms-inbox__crmrow', crmMark(crm), el('span.ms-adm-sub', ` ${tries} tr${tries === 1 ? 'y' : 'ies'}`, next), again)],
    ['Why', value(it.crmError || 'Not known', 'why it was not sent')],
  ];
}
