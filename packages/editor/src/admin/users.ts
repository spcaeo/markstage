// #/users?q=&role=&status=&user=<uid>&action=invite&as=<role>: who can sign in, and what they may do (owner,
// administrator). With one manager only, a card recommends a second (a lost password and phone is otherwise a
// terminal job: markstage-server reset-password).
// The list filters by text, role and status; a row opens the person in the drawer (user=<uid>), where their name,
// role and author are edited and their password, two-step sign-in and sessions are reset. An invitation (and a
// password reset) gives a one-time setup code, shown once, with the address where it is used.
import type { ScreenCtx } from '../host';
import * as api from './api';
import { button, canManageUsers, chips, drawer, el, facts, failure, field, form, link, maybe, message, page, ROLE_HINT, ROLE_LABEL, searchBox, secretBox, select, state, value, when, whoami } from './ui';

const STATUS: [string, string][] = [
  ['', 'All'],
  ['active', 'Active'],
  ['invited', 'Invited'],
  ['disabled', 'Disabled'],
  ['no-2fa', 'Without two-step'],
];

/** Never signed in = still invited (or reset and not back yet). */
const statusOf = (u: api.User) => (u.disabled ? 'disabled' : u.lastLoginAt ? 'active' : 'invited');
const inviteUrl = () => `${location.origin}${location.pathname}#/accept-invite`;

export function mountUsers(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'People & access', 'Who can sign in, and what each person may do.');
  p.bar.hidden = false;
  const layout = el('div.ms-adm-split');
  let me: api.Me | null = null;
  let all: api.User[] = [];
  let custom: api.CustomRole[] = [];
  let alive = true;

  /** Roles this user may give: only the owner gives owner or administrator. */
  const grantable = (): api.Role[] => (me?.user?.role === 'owner' ? api.ROLES : api.ROLES.filter((r) => r !== 'owner' && r !== 'administrator'));

  async function load(): Promise<void> {
    p.body.replaceChildren(state('loading', 'Loading the people of this site…'));
    try {
      me = await whoami();
      if (!canManageUsers(me)) {
        p.body.replaceChildren(state('denied', 'Not available to you', 'Only the owner and administrators manage users.'));
        return;
      }
      [all, custom] = await Promise.all([api.users(), api.customRoles().catch(() => [] as api.CustomRole[])]);
    } catch (e) {
      p.body.replaceChildren(failure(e, () => void load()));
      return;
    }
    if (!alive) return;
    p.actions.replaceChildren(button('Invite someone', () => ctx.go({ params: { action: 'invite', user: null } }, true), { kind: 'primary', icon: 'plus' }));
    render();
  }

  function render(): void {
    // a role that may not manage users keeps "Not available to you": a change of filter must not draw the list
    if (!me || !canManageUsers(me)) return;
    const q = (ctx.params().get('q') ?? '').toLowerCase();
    const role = ctx.params().get('role') ?? '';
    const status = ctx.params().get('status') ?? '';
    p.bar.replaceChildren(searchBox(ctx, 'q', 'Search by name or email'), chips(ctx, 'role', 'Role', [['', 'All roles'], ...api.ROLES.map((r) => [r, ROLE_LABEL[r]] as [string, string])]), chips(ctx, 'status', 'Status', STATUS));
    const rows = all.filter(
      (u) =>
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.authorSlug ?? '').includes(q)) &&
        (!role || u.role === role) &&
        (!status || (status === 'no-2fa' ? !u.twoFactor && !u.disabled : statusOf(u) === status)),
    );
    const open = ctx.params().get('user');
    const table = el('table.ms-adm-table.ms-adm-table--rows', el('thead', el('tr', el('th', 'Name'), el('th', 'Role'), el('th', 'Author'), el('th', 'Two-step'), el('th', 'Last sign-in'))));
    const tb = el('tbody');
    for (const u of rows) {
      const name = el('a.ms-adm-rowlink', { href: `#/users?${new URLSearchParams({ ...Object.fromEntries(ctx.params()), user: u.id, action: '' }).toString().replace(/&action=$/, '')}` }, u.name);
      name.addEventListener('click', (e) => {
        e.preventDefault();
        ctx.go({ params: { user: u.id, action: null } }, true);
      });
      const st = statusOf(u);
      tb.append(
        el(`tr${u.id === open ? '.is-open' : ''}`,
          el('td', el('div.ms-adm-stack', name, value(u.email, 'email', 'ms-adm-sub'))),
          el('td', u.customRole ? el('div.ms-adm-stack', u.customRole.name, el('span.ms-adm-sub', `on ${ROLE_LABEL[u.role]}`)) : ROLE_LABEL[u.role], st !== 'active' ? el(`span.ms-adm-badge.ms-adm-badge--${st}`, st === 'disabled' ? 'Disabled' : 'Invited') : null),
          el('td', maybe(u.authorSlug, 'author name')),
          el('td', u.twoFactor ? el('span.ms-adm-badge.ms-adm-badge--ok', 'On') : el('span.ms-adm-none', 'Off')),
          el('td', when(u.lastLoginAt)),
        ),
      );
    }
    table.append(tb);
    const listBox = rows.length ? el('section.ms-adm-card.ms-adm-card--flush', table) : state('empty', 'Nobody matches', 'Try another search or filter.');
    const managers = all.filter((u) => !u.disabled && (u.role === 'owner' || u.role === 'administrator'));
    const alone =
      managers.length === 1 && managers[0].id === me.user?.id
        ? el('section.ms-adm-card.ms-adm-warnline', { role: 'note' },
            el('strong', 'Only you can manage users here. '),
            'If you lose your password and your authenticator, only someone with a terminal on the server can let you back in. Invite a second administrator you trust, with two-step sign-in. ',
            el('div.ms-adm-row', button('Invite an administrator', () => ctx.go({ params: { action: 'invite', as: 'administrator', user: null } }, true), { small: true, icon: 'plus' })))
        : null;
    layout.replaceChildren(el('div.ms-adm-split__main', alone, el('p.ms-adm-count', `${rows.length} of ${all.length} ${all.length === 1 ? 'person' : 'people'}`), listBox));
    p.body.replaceChildren(layout);
    const action = ctx.params().get('action');
    if (action === 'invite') inviteDrawer();
    else if (open) {
      const u = all.find((x) => x.id === open);
      if (u) userDrawer(u);
      else {
        const d = drawer(layout, 'Not available', close);
        d.body.append(state('denied', 'Not available to you', 'This person does not exist, or was removed.'));
      }
    }
  }

  const close = () => ctx.go({ params: { user: null, action: null, as: null } }, true);

  function inviteDrawer(): void {
    const d = drawer(layout, 'Invite someone', close);
    const roles = grantable();
    const f = form(
      [
        field('name', 'Name', { autocomplete: 'off', required: true }),
        field('email', 'Email', { type: 'email', autocomplete: 'off', required: true }),
        select('role', 'Role', roles.map((r) => [r, `${ROLE_LABEL[r]}: ${ROLE_HINT[r]}`]), roles.find((r) => r === ctx.params().get('as')) ?? 'author'),
        field('authorSlug', 'Author (optional)', { hint: 'The author name their posts carry (lowercase-with-hyphens). Authors and contributors need one to write posts.', pattern: '[a-z0-9][a-z0-9-]*' }),
      ],
      'Create the invitation',
      async (v) => {
        const r = await api.invite({ name: v.name, email: v.email, role: v.role as api.Role, ...(v.authorSlug ? { authorSlug: v.authorSlug } : {}) });
        all.push(r.user);
        d.body.replaceChildren(codeHandOff(r.user, r.setupCode, 'Invitation ready'), button('Open their profile', () => ctx.go({ params: { user: r.user.id, action: null } }, true)));
      },
      { extra: [button('Cancel', close, { kind: 'quiet' })] },
    );
    d.body.append(f);
    f.querySelector<HTMLInputElement>('input')?.focus();
  }

  /** The setup code and what to send the person (the address, their email, the code), each copyable. */
  function codeHandOff(u: api.User, code: string, title: string): HTMLElement {
    return el('div.ms-adm-stack',
      secretBox(title, `Send ${u.name} the code below. It works once, for 72 hours, and is not shown again. Send it separately from the address if you can.`, [code], 'setup code'),
      facts([
        ['Where', link(inviteUrl(), 'address to set the password')],
        ['Their email', value(u.email, 'email')],
      ]),
    );
  }

  function userDrawer(u: api.User): void {
    const d = drawer(layout, u.name, close);
    const self = u.id === me!.user!.id;
    const ownerOnly = (u.role === 'owner' || u.role === 'administrator') && me!.user!.role !== 'owner';
    const out = el('div.ms-adm-drawer__result');
    const act = async (run: () => Promise<void>) => {
      out.replaceChildren();
      try {
        await run();
      } catch (e) {
        out.replaceChildren(el('p.ms-adm-form__err', { role: 'alert' }, message(e)));
      }
    };
    d.body.append(
      facts([
        ['Email', value(u.email, 'email')],
        ['Status', statusOf(u) === 'active' ? 'Active' : statusOf(u) === 'disabled' ? 'Disabled' : 'Invited (has not signed in yet)'],
        ['Two-step sign-in', u.twoFactor ? 'On' : 'Off'],
        ['Last sign-in', when(u.lastLoginAt)],
        ['Member since', when(u.createdAt)],
        ['User ID', value(u.id, 'user ID')],
      ]),
    );
    if (ownerOnly) {
      d.body.append(el('p.ms-adm-note', 'Only the owner changes the owner or an administrator.'));
      return;
    }
    const roles = grantable().includes(u.role) ? grantable() : [u.role, ...grantable()];
    // the site's custom roles this person may give (one on administrator: the owner's), after the built-in ones
    const customs = u.role === 'owner' ? [] : custom.filter((r) => grantable().includes(r.base) || r.id === u.customRole?.id);
    const options: [string, string][] = [...roles.map((r) => [r, ROLE_LABEL[r]] as [string, string]), ...customs.map((r) => [`custom:${r.id}`, `${r.name} (on ${ROLE_LABEL[r.base]})`] as [string, string])];
    d.body.append(
      el('h3.ms-adm-h3', 'Details'),
      form(
        [
          field('name', 'Name', { value: u.name, required: true }),
          select('role', 'Role', options, u.customRole ? `custom:${u.customRole.id}` : u.role),
          field('authorSlug', 'Author', { value: u.authorSlug ?? '', hint: 'The author name their posts carry. Empty: not linked.', pattern: '[a-z0-9][a-z0-9-]*' }),
        ],
        'Save',
        async (v) => {
          const picked = v.role.startsWith('custom:') ? { customRole: v.role.slice(7) } : { role: v.role as api.Role };
          const r = await api.updateUser(u.id, { name: v.name, ...picked, authorSlug: v.authorSlug || null });
          all = all.map((x) => (x.id === r.id ? r : x));
          ctx.toast(`Saved ${r.name}.`, 'ok');
          render();
        },
      ),
      el('h3.ms-adm-h3', 'Access'),
      el('div.ms-adm-actions',
        button('Reset password', () => void act(async () => {
          const choice = await ctx.ask('Reset the password?', `${u.name} is signed out everywhere and sets a new password with a setup code you send them.`, [['cancel', 'Cancel'], ['go', 'Reset password', 'ms-btn ms-btn--danger']]);
          if (choice !== 'go') return;
          const r = await api.resetUser(u.id);
          out.replaceChildren(codeHandOff(u, r.setupCode, 'Password reset'));
          // the code is what they came for: at the top of the panel, in view (QA F37)
          out.closest('.ms-adm-drawer__body, .ms-adm-drawer')?.prepend(out);
          out.scrollIntoView({ block: 'start', behavior: 'smooth' });
          out.querySelector<HTMLElement>('.ms-copyable__text, .ms-adm-secret')?.focus();
        }), { icon: 'key' }),
        u.twoFactor ? button('Turn off two-step sign-in', () => void act(async () => {
          if ((await ctx.ask('Turn off two-step sign-in?', `For a lost phone. ${u.name} signs in with the password only until they turn it on again.`, [['cancel', 'Cancel'], ['go', 'Turn it off', 'ms-btn ms-btn--danger']])) !== 'go') return;
          await api.reset2fa(u.id);
          all = all.map((x) => (x.id === u.id ? { ...x, twoFactor: false } : x));
          ctx.toast('Two-step sign-in is off for them.', 'ok');
          render();
        }), { icon: 'shield' }) : null,
        button('Sign out everywhere', () => void act(async () => {
          const r = await api.revokeUserSessions(u.id);
          ctx.toast(`Signed out of ${r.revoked} session${r.revoked === 1 ? '' : 's'}.`, 'ok');
        }), { icon: 'logout' }),
        self ? null : button(u.disabled ? 'Enable' : 'Disable', () => void act(async () => {
          if (!u.disabled && (await ctx.ask(`Disable ${u.name}?`, 'They are signed out and cannot sign in until enabled again. Their posts stay.', [['cancel', 'Cancel'], ['go', 'Disable', 'ms-btn ms-btn--danger']])) !== 'go') return;
          const r = await api.updateUser(u.id, { disabled: !u.disabled });
          all = all.map((x) => (x.id === r.id ? r : x));
          render();
        }), { kind: u.disabled ? undefined : 'danger' }),
        self ? null : button('Delete', () => void act(async () => {
          if ((await ctx.ask(`Delete ${u.name}?`, 'They can no longer sign in. Their posts keep their author. This cannot be undone.', [['cancel', 'Cancel'], ['go', 'Delete', 'ms-btn ms-btn--danger']])) !== 'go') return;
          await api.deleteUser(u.id);
          all = all.filter((x) => x.id !== u.id);
          ctx.toast(`Deleted ${u.name}.`, 'ok');
          close();
        }), { kind: 'danger', icon: 'trash' }),
      ),
      out,
      ssoLinks(u),
    );
  }

  /** The providers this person signs in with (docs/API-SSO.md); shown when there is one. Unlinking makes their next
   *  sign-in there link again by their verified email. */
  function ssoLinks(u: api.User): HTMLElement {
    const box = el('div');
    const show = (links: api.SsoLink[]) => box.replaceChildren(...(links.length ? [
      el('h3.ms-adm-h3', 'Single sign-on'),
      facts(links.map((l) => [l.label, el('span.ms-adm-row', l.email ? value(l.email, 'email') : '', el('span.ms-adm-sub', `last ${when(l.lastAt)}`), button('Unlink', () => void api.unlinkSso(u.id, l.provider).then(() => {
        ctx.toast(`Unlinked ${l.label}.`, 'ok');
        show(links.filter((x) => x !== l));
      }, (e) => ctx.toast(message(e), 'error')), { kind: 'quiet', small: true }))] as [string, HTMLElement])),
    ] : []));
    void api.ssoLinks(u.id).then((links) => alive && show(links), () => undefined);
    return box;
  }

  void load();
  return {
    update: () => render(),
    destroy: () => {
      alive = false;
    },
  };
}
