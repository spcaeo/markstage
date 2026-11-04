// #/audit?user=<uid>&action=<prefix>&from=<date>&to=<date>&before=<id>&item=<id>: who did what, when, from where
// (owner, administrator). Filters by person, kind of action and dates; pages back in time with `before` (Back
// returns to newer ones); a row opens its full record in the drawer. Append-only: nothing here changes it.
import type { ScreenCtx } from '../host';
import { echoDate } from '../dates';
import * as api from './api';
import { button, canManageUsers, chips, drawer, el, facts, failure, maybe, page, state, value, when, whoami } from './ui';

const KINDS: [string, string][] = [
  ['', 'Everything'],
  ['auth.', 'Sign-in'],
  ['user.', 'Users'],
  ['entry.', 'Content'],
  ['media.', 'Media'],
  ['job.', 'Publishing'],
  ['security.', 'Refused requests'],
];
const PER_PAGE = 50;

/** "entry.publish" -> "Published", in words a person reads. */
const WORDS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login.fail': 'Sign-in failed',
  'auth.login.recovery': 'Signed in with a recovery code',
  'auth.2fa.fail': 'Wrong two-step code',
  'auth.2fa.recovery-codes': 'Made new recovery codes',
  'auth.invite': 'Accepted an invitation',
  'auth.invite.fail': 'Invitation code refused',
  'auth.session.revoke': 'Signed out a device',
  'user.2fa.reset': 'Turned off a user’s two-step sign-in',
  'entry.protect': 'Password-protected',
  'entry.unprotect': 'Removed the password',
  'entry.purge': 'Deleted for good',
  'trash.purge': 'Emptied from trash',
  'trash.restore.any': 'Restored from trash',
  'media.delete.any': 'Deleted media',
  'media.delete.own': 'Deleted own media',
  'page.unlock.fail': 'Wrong page password',
  'snippet.create': 'Made a snippet',
  'snippet.update': 'Changed a snippet',
  'snippet.delete': 'Deleted a snippet',
  'template.create': 'Made a template',
  'template.update': 'Changed a template',
  'template.delete': 'Deleted a template',
  'security.csrf': 'Refused: no CSRF token',
  'security.origin': 'Refused: wrong origin',
  'auth.logout': 'Signed out',
  'auth.lockout': 'Account locked',
  'auth.password': 'Changed password',
  'auth.setup': 'Set up the server',
  'auth.2fa.enable': 'Turned on two-step sign-in',
  'auth.2fa.disable': 'Turned off two-step sign-in',
  'user.create': 'Invited a user',
  'user.update': 'Changed a user',
  'user.reset': 'Reset a password',
  'user.delete': 'Deleted a user',
  'user.revoke': 'Signed a user out',
  'entry.create': 'Created',
  'entry.save': 'Saved',
  'entry.source': 'Saved the source',
  'entry.delete': 'Deleted',
  'entry.restore': 'Restored from trash',
  'entry.import': 'Imported',
  'entry.duplicate': 'Duplicated',
  'entry.publish': 'Published',
  'entry.schedule': 'Scheduled',
  'entry.unpublish': 'Unpublished',
  'entry.move': 'Moved',
  'revision.restore': 'Restored a revision',
  'media.upload': 'Uploaded',
  'media.update': 'Changed alt text',
  'media.delete': 'Deleted media',
  'job.succeeded': 'Publish job succeeded',
  'job.failed': 'Publish job failed',
  'site.publish': 'Rebuilt the site',
};
const words = (a: string) => WORDS[a] ?? a;

export function mountAudit(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Activity', 'Who did what, when and from where. Nothing here can be changed or deleted.');
  p.bar.hidden = false;
  const layout = el('div.ms-adm-split');
  let people: { id: string; name: string }[] = [];
  let items: api.AuditItem[] = [];
  let next: number | null = null;
  let loadedFor = '';
  let alive = true;

  /** A user id as their name (the id copyable), anything else as it is. */
  const target = (t: string | null) => {
    const u = t ? people.find((x) => x.id === t) : null;
    return u ? el('span', { title: t! }, u.name) : maybe(t, 'target');
  };

  /** The query the URL asks for (without the open item). */
  const query = () => {
    const q = ctx.params();
    return { user: q.get('user') ?? '', action: q.get('action') ?? '', from: q.get('from') ?? '', to: q.get('to') ?? '', before: q.get('before') ?? '' };
  };

  async function render(): Promise<void> {
    const q = query();
    const key = JSON.stringify(q);
    if (key !== loadedFor) {
      p.body.replaceChildren(state('loading', 'Loading…'));
      try {
        const me = await whoami();
        if (!canManageUsers(me)) {
          p.body.replaceChildren(state('denied', 'Not available to you', 'Only the owner and administrators read the audit log.'));
          return;
        }
        if (!people.length) people = (await api.users()).map((u) => ({ id: u.id, name: u.name }));
        // `to` is a whole day: up to its end
        const r = await api.audit({
          user: q.user || undefined,
          action: q.action || undefined,
          from: q.from ? new Date(`${q.from}T00:00:00`).toISOString() : undefined,
          to: q.to ? new Date(`${q.to}T23:59:59.999`).toISOString() : undefined,
          before: q.before ? Number(q.before) : undefined,
          limit: PER_PAGE,
        });
        // gone, or the URL moved on while this loaded: the newer render draws (never an old list under new filters)
        if (!alive || JSON.stringify(query()) !== key) return;
        items = r.items;
        next = r.next;
        loadedFor = key;
      } catch (e) {
        if (!alive || JSON.stringify(query()) !== key) return;
        p.body.replaceChildren(failure(e, () => ((loadedFor = ''), void render())));
        return;
      }
    }
    filters(q);
    table(q);
  }

  function filters(q: ReturnType<typeof query>): void {
    const who = el('select.ms-input.ms-adm-select', { 'aria-label': 'Person' }, el('option', { value: '' }, 'Everyone'));
    for (const u of people) who.append(el('option', { value: u.id, selected: u.id === q.user }, u.name));
    who.addEventListener('change', () => ctx.go({ params: { user: who.value || null, before: null, item: null } }, true));
    const date = (key: 'from' | 'to', label: string) => {
      const i = el('input.ms-input.ms-adm-date', { type: 'date', 'aria-label': label, value: q[key] || undefined, max: new Date().toISOString().slice(0, 10) });
      i.addEventListener('change', () => ctx.go({ params: { [key]: i.value || null, before: null, item: null } }, true));
      const wrap = el('label.ms-adm-datewrap', el('span', label), i);
      echoDate(i);
      return wrap;
    };
    const clear = q.user || q.action || q.from || q.to ? button('Clear filters', () => ctx.go({ params: { user: null, action: null, from: null, to: null, before: null, item: null } }, true), { kind: 'quiet', small: true }) : null;
    p.bar.replaceChildren(chips(ctx, 'action', 'Kind of action', KINDS), who, date('from', 'From'), date('to', 'To'), clear ?? '');
  }

  function table(q: ReturnType<typeof query>): void {
    const open = ctx.params().get('item');
    const t = el('table.ms-adm-table.ms-adm-table--rows', el('thead', el('tr', el('th', 'When'), el('th', 'Who'), el('th', 'What'), el('th', 'On'), el('th', 'IP address'))));
    const tb = el('tbody');
    for (const it of items) {
      const what = el('a.ms-adm-rowlink', { href: '#' }, words(it.action));
      what.addEventListener('click', (e) => {
        e.preventDefault();
        ctx.go({ params: { item: String(it.id) } }, true);
      });
      tb.append(
        el(`tr${String(it.id) === open ? '.is-open' : ''}${it.ok ? '' : '.is-bad'}`,
          el('td', when(it.at)),
          el('td', it.userName ?? el('span.ms-adm-none', 'nobody signed in')),
          el('td', what, it.ok ? null : el('span.ms-adm-badge.ms-adm-badge--disabled', 'refused')),
          el('td', target(it.target)),
          el('td', maybe(it.ip, 'IP address')),
        ),
      );
    }
    t.append(tb);
    const paging = el('div.ms-adm-row',
      q.before ? button('Newer', () => history.back(), { small: true, icon: 'up' }) : null,
      next !== null ? button('Older', () => ctx.go({ params: { before: String(next), item: null } }, true), { small: true, icon: 'down' }) : null,
    );
    layout.replaceChildren(el('div.ms-adm-split__main', items.length ? el('section.ms-adm-card.ms-adm-card--flush', t) : state('empty', 'Nothing here', 'No actions match these filters.'), paging));
    p.body.replaceChildren(layout);
    if (open) {
      const it = items.find((x) => String(x.id) === open);
      const d = drawer(layout, it ? words(it.action) : 'Not on this page', () => ctx.go({ params: { item: null } }, true));
      if (!it) d.body.append(state('empty', 'Not on this page', 'Clear the filters or page back to find it.'));
      else {
        d.body.append(
          facts([
            ['When', el('span', when(it.at), ' · ', value(it.at, 'time'))],
            ['Who', it.userName ? value(it.userName, 'name') : 'nobody signed in'],
            ['Action', value(it.action, 'action')],
            ['Result', it.ok ? 'Done' : 'Refused'],
            ['On', target(it.target)],
            ['IP address', maybe(it.ip, 'IP address')],
            ['Browser', maybe(it.userAgent, 'user agent')],
            ['Record', value(String(it.id), 'record number')],
          ]),
        );
        if (it.detail !== null && it.detail !== undefined) {
          const text = JSON.stringify(it.detail, null, 2);
          d.body.append(el('h3.ms-adm-h3', 'Details'), el('div.ms-adm-code', value(text, 'details')));
        }
      }
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
