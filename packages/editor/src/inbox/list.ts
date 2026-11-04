// #/inbox?q=&kind=message|alert&status=new|handled|spam|held&form=&service=&who=me|none|<uid>&alert=failed&crm=failed&from=&to=&page=&open=<id>:
// every message the site's forms sent and every alert, newest first (editor and up). Every filter is in the URL, so
// a view can be linked to and Back undoes a filter; a row opens in the drawer (open=), where it is handled.
import { ApiError } from '../api';
import type { ScreenCtx } from '../host';
import { button, chips, drawer, el, failure, isEditorPlus, maybe, page, searchBox, state, when, whoami } from '../admin/ui';
import { usersBrief } from '../admin/api';
import * as api from './api';
import { crmMark } from './crm';
import { echoDate, localTimes } from '../dates';
import { mountItem, STATUS_LABEL, titleOf } from './item';

// Messages first (QA F27): the alerts are a view of their own, and "everything" is both (without the new-device
// sign-ins, which are account news: in the bar and under Alerts)
const KINDS: [string, string][] = [
  ['', 'Messages'],
  ['alert', 'Alerts'],
  ['all', 'Everything'],
];
const kindFor = (chip: string) => (chip === 'all' ? '' : chip || 'message');
const STATUSES: [string, string][] = [
  ['', 'Any status'],
  ['new', 'New'],
  ['handled', 'Handled'],
  ['spam', 'Spam'],
  ['held', 'Held'],
];
const FILTERS = ['q', 'kind', 'status', 'form', 'service', 'who', 'alert', 'crm', 'from', 'to'] as const;

export function mountInbox(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Messages', 'Every message people sent through the site’s forms, and every alert, newest first.');
  p.bar.hidden = false;
  const layout = el('div.ms-adm-split');
  let people: api.Person[] = [];
  let me = '';
  let data: api.InboxList | null = null;
  let loadedFor = '';
  let alive = true;

  /** The filters as the URL has them, in the server's words. */
  const query = (): api.InboxQuery => {
    const q = ctx.params();
    const get = (k: string) => q.get(k) ?? '';
    const who = get('who');
    return {
      q: get('q'),
      kind: kindFor(get('kind')),
      status: get('status'),
      form: get('form'),
      service: get('service'),
      assignee: who === 'me' ? me : who,
      alert: get('alert'),
      crm: get('crm'),
      from: get('from'),
      to: get('to'),
      page: Number(get('page')) > 1 ? Number(get('page')) : undefined,
    };
  };

  async function render(): Promise<void> {
    const viewer = await whoami();
    if (!isEditorPlus(viewer)) return void p.body.replaceChildren(state('denied', 'Not available to you', 'The Inbox is for editors, administrators and the owner.'));
    me = viewer.user!.id;
    const q = query();
    const key = JSON.stringify(q);
    if (key !== loadedFor) {
      p.body.replaceChildren(state('loading', 'Loading…'));
      try {
        if (!people.length) people = (await usersBrief()).map((u) => ({ id: u.id, name: u.name }));
        const r = await api.list(q);
        // gone, or the URL moved on while this list loaded: the newer render draws (never an old list under new filters)
        if (!alive || JSON.stringify(query()) !== key) return;
        data = r;
        loadedFor = key;
      } catch (e) {
        if (!alive || JSON.stringify(query()) !== key) return;
        if (e instanceof ApiError && e.status === 404 && !ctx.params().get('open')) {
          p.bar.replaceChildren();
          return void p.body.replaceChildren(state('empty', 'Not on this server yet', 'The Inbox needs the site’s forms served by this Markstage server.'));
        }
        return void p.body.replaceChildren(failure(e, () => ((loadedFor = ''), void render())));
      }
    }
    filters(q);
    table();
  }

  function pick(key: string, label: string, options: [string, string][]): HTMLSelectElement {
    const cur = ctx.params().get(key) ?? '';
    const s = el('select.ms-input.ms-adm-select', { 'aria-label': label });
    for (const [v, l] of options) s.append(el('option', { value: v, selected: v === cur }, l));
    s.addEventListener('change', () => ctx.go({ params: { [key]: s.value || null, page: null, open: null } }, true));
    return s;
  }

  function filters(q: api.InboxQuery): void {
    const f = data?.facets;
    const forms: [string, string][] = [['', 'Every form'], ...(f?.forms ?? []).map((x): [string, string] => [x.id, `${x.label} (${x.count})`])];
    const services: [string, string][] = [['', 'Any service'], ...(f?.services ?? []).map((x): [string, string] => [x.value, `${x.value} (${x.count})`])];
    const who: [string, string][] = [['', 'Anyone'], ['me', 'Assigned to me'], ['none', 'Not assigned'], ...people.map((u): [string, string] => [u.id, u.name])];
    const date = (key: 'from' | 'to', label: string) => {
      const i = el('input.ms-input.ms-adm-date', { type: 'date', 'aria-label': label, value: q[key] || undefined, max: new Date().toISOString().slice(0, 10) });
      i.addEventListener('change', () => ctx.go({ params: { [key]: i.value || null, page: null, open: null } }, true));
      const wrap = el('label.ms-adm-datewrap', el('span', label), i);
      echoDate(i);
      return wrap;
    };
    const any = FILTERS.some((k) => ctx.params().get(k));
    const clear = any ? button('Clear filters', () => ctx.go({ params: Object.fromEntries([...FILTERS, 'page', 'open'].map((k) => [k, null])) }, true), { kind: 'quiet', small: true }) : null;
    p.bar.replaceChildren(
      searchBox(ctx, 'q', 'Search names, emails and words'),
      chips(ctx, 'kind', 'Show', KINDS),
      chips(ctx, 'status', 'Status', STATUSES),
      forms.length > 2 ? pick('form', 'Form', forms) : '',
      services.length > 1 ? pick('service', 'Service', services) : '',
      pick('who', 'Assigned to', who),
      date('from', 'From'),
      date('to', 'To'),
      clear ?? '',
    );
    // the team was not told about some messages: one click lists them (and again shows everything)
    const failed = f?.alertFailed ?? 0;
    if (failed || q.alert === 'failed') {
      const on = q.alert === 'failed';
      const chip = button(on ? 'Showing the messages whose alert was not sent' : `${failed} message${failed === 1 ? '' : 's'} whose alert was not sent`, () => ctx.go({ params: { alert: on ? null : 'failed', page: null, open: null } }, true), { small: true, kind: on ? 'primary' : 'quiet', icon: 'alert' });
      chip.setAttribute('aria-pressed', String(on));
      p.bar.append(chip);
    }
    // and the messages the CRM (Odoo) does not have yet: a filter like the one above, with its count
    const notSent = f?.crmFailed ?? 0;
    if (notSent || q.crm === 'failed') {
      const on = q.crm === 'failed';
      const chip = button(on ? 'Showing the messages not sent to Odoo' : `${notSent} message${notSent === 1 ? '' : 's'} not sent to Odoo`, () => ctx.go({ params: { crm: on ? null : 'failed', page: null, open: null } }, true), { small: true, kind: on ? 'primary' : 'quiet', icon: 'alert' });
      chip.setAttribute('aria-pressed', String(on));
      chip.classList.add('ms-inbox__crmchip');
      p.bar.append(chip);
    }
    const csv = el('a.ms-btn.ms-btn--sm', { href: api.csvUrl(q), download: 'inbox.csv' }, 'Download CSV');
    csv.title = 'Everything these filters show, as a spreadsheet';
    p.actions.replaceChildren(csv);
  }

  function table(): void {
    const open = ctx.params().get('open');
    const items = data?.items ?? [];
    const t = el('table.ms-adm-table.ms-adm-table--rows', el('thead', el('tr', el('th', 'When'), el('th', 'From'), el('th', 'What'), el('th', 'Where'), el('th', 'Status'), el('th', 'Assigned'))));
    const tb = el('tbody');
    for (const it of items) {
      const what = el('a.ms-adm-rowlink', { href: '#' }, (it.kind === 'alert' ? localTimes(it.summary) : it.summary) || '(empty)');
      what.addEventListener('click', (e) => {
        e.preventDefault();
        ctx.go({ params: { open: it.id } }, true);
      });
      const from = it.kind === 'alert' ? el('span.ms-adm-none', 'Markstage') : it.from?.name || it.from?.email || el('span.ms-adm-none', '—');
      const where = it.kind === 'alert' ? el('span.ms-adm-badge', it.level === 'error' ? 'Alert' : 'Notice') : maybe(it.formLabel ?? it.form, 'form');
      tb.append(
        el(`tr${it.id === open ? '.is-open' : ''}${it.status === 'new' ? '.is-new' : ''}`,
          el('td', when(it.at)),
          el('td', from),
          el('td', what, it.service ? el('span.ms-adm-sub', ` · ${it.service}`) : null, it.imported ? el('span.ms-adm-sub', ` · Imported from ${it.imported.from === 'wordpress' ? 'WordPress' : it.imported.from}`) : null),
          el('td', where),
          el('td', el(`span.ms-adm-badge${it.status === 'new' ? '.is-new' : it.status === 'spam' ? '.ms-adm-badge--disabled' : ''}`, STATUS_LABEL[it.status]), it.alert === 'failed' ? el('span.ms-adm-badge.is-bad', { title: 'The mail to the team was not sent; it is tried again' }, 'Alert not sent') : null, it.crm?.state === 'failed' ? crmMark(it.crm) : null),
          el('td', it.assignee?.name ?? el('span.ms-adm-none', '—')),
        ),
      );
    }
    t.append(tb);
    const pageNo = data?.page ?? 1;
    const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;
    const paging = el('div.ms-adm-row',
      el('span.ms-adm-sub', data ? `${data.total} in all${pages > 1 ? ` · page ${pageNo} of ${pages}` : ''}` : ''),
      pageNo > 1 ? button('Newer', () => ctx.go({ params: { page: pageNo > 2 ? String(pageNo - 1) : null, open: null } }, true), { small: true, icon: 'up' }) : null,
      pageNo < pages ? button('Older', () => ctx.go({ params: { page: String(pageNo + 1), open: null } }, true), { small: true, icon: 'down' }) : null,
    );
    const credits = data?.credits ? el('p.ms-adm-sub.ms-inbox__credits', data.credits) : null;
    layout.replaceChildren(el('div.ms-adm-split__main', items.length ? el('section.ms-adm-card.ms-adm-card--flush', t) : state('empty', 'Nothing here', 'No messages or alerts match these filters.'), paging, credits));
    p.body.replaceChildren(layout);
    if (open) {
      const it = items.find((x) => x.id === open);
      // the row's title at once when it is listed; the item's own once it is read (a row the filters leave out has none)
      const d = drawer(layout, it ? titleOf(it) : 'Message', () => ctx.go({ params: { open: null } }, true));
      const title = (text: string) => {
        d.el.querySelector('h2')!.textContent = text;
        d.el.setAttribute('aria-label', text);
      };
      mountItem(d.body, open, { ctx, people, me, credits: data?.credits ?? null, changed: () => ((loadedFor = ''), void render()), title });
    }
  }

  void render();
  return {
    update: () => void render(),
    destroy: () => {
      alive = false;
    },
  };
}
