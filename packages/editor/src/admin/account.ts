// #/account?tab=profile|password|2fa|sessions: the signed-in user's own account. Two-step sign-in is set up here:
// the password again, then the QR code (drawn on the page, the secret never leaves it) and a first code, then the
// recovery codes, shown once. The secret and the step that holds it live in memory only: a reload starts the
// setup again.
import type { ScreenCtx } from '../host';
import * as api from './api';
import { qrSvg } from './qr';
import { button, chips, el, facts, failure, field, forgetMe, form, maybe, newPassword, page, ROLE_LABEL, secretBox, state, value, when, whoami } from './ui';

const TABS: [string, string][] = [
  ['', 'Profile'],
  ['password', 'Password'],
  ['2fa', 'Two-step sign-in'],
  ['sessions', 'Sessions'],
];

export function mountAccount(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Your account', 'Your sign-in, two-step sign-in and where you are signed in.');
  p.actions.append(
    button('Sign out', async () => {
      await api.logout().catch(() => undefined);
      forgetMe();
      history.replaceState(null, '', '#/sign-in');
      location.reload();
    }, { icon: 'logout' }),
  );
  p.bar.hidden = false;
  // the pending 2FA setup (in memory only)
  let pending: { secret: string; otpauthUri: string } | null = null;
  let alive = true;

  async function render(): Promise<void> {
    p.bar.replaceChildren(chips(ctx, 'tab', 'Account sections', TABS));
    const loading = ctx.params().get('tab');
    p.body.replaceChildren(state('loading', loading === '2fa' ? 'Checking whether two-step sign-in is on…' : loading === 'sessions' ? 'Loading your sessions…' : 'Loading your account…'));
    let me: api.Me;
    try {
      me = await whoami(true);
    } catch (e) {
      p.body.replaceChildren(failure(e, () => void render()));
      return;
    }
    if (!alive) return;
    if (!me.user) return ctx.open(`#/sign-in?next=${encodeURIComponent('#/account')}`, false);
    const tab = ctx.params().get('tab') ?? '';
    if (tab === 'password') return passwordTab();
    if (tab === '2fa') return twoFactorTab(me.user);
    if (tab === 'sessions') return sessionsTab();
    profileTab(me.user, me.server ?? null);
  }

  function profileTab(u: api.User, server: api.Me['server'] | null): void {
    p.body.replaceChildren(
      el('section.ms-adm-card',
        facts([
          ['Name', value(u.name, 'name')],
          ['Email', value(u.email, 'email')],
          ['Role', ROLE_LABEL[u.role] ?? u.role],
          ['Author', u.authorSlug ? value(u.authorSlug, 'author name') : el('span.ms-adm-none', 'Not linked. Ask an administrator to link your account to an author, so your posts are yours.')],
          ['Two-step sign-in', u.twoFactor ? 'On' : 'Off'],
          ['Member since', when(u.createdAt)],
          ['User ID', value(u.id, 'user ID')],
          ['Markstage', server ? value(`${server.line ?? server.version}${server.commit ? ` (${server.commit})` : ''}`, 'Markstage version') : el('span.ms-adm-none', '—')],
        ]),
      ),
    );
  }

  function passwordTab(): void {
    const f = form(
      [
        field('currentPassword', 'Current password', { type: 'password', autocomplete: 'current-password', required: true }),
        ...newPassword('newPassword'),
      ],
      'Change password',
      async (v, fm) => {
        await api.changePassword(v.currentPassword, v.newPassword);
        fm.reset();
        ctx.toast('Password changed. You were signed out everywhere else.', 'ok');
      },
    );
    p.body.replaceChildren(el('section.ms-adm-card', el('p.ms-adm-lead', 'Changing it signs you out on every other device.'), f));
  }

  function twoFactorTab(u: api.User): void {
    const step = ctx.params().get('step');
    if (u.twoFactor && !step) {
      const wrap = el('section.ms-adm-card');
      const show = (which: 'codes' | 'off') => {
        const f = form(
          [field('password', 'Password', { type: 'password', autocomplete: 'current-password', required: true }), field('code', 'Code from your app', { autocomplete: 'one-time-code', inputmode: 'numeric', required: true, maxlength: 7 })],
          which === 'codes' ? 'Make new recovery codes' : 'Turn off two-step sign-in',
          async (v) => {
            if (which === 'codes') {
              const r = await api.newRecoveryCodes(v.password, v.code.replace(/\s/g, ''));
              wrap.replaceChildren(secretBox('New recovery codes', 'Save these somewhere safe now: they are not shown again. The old ones no longer work.', r.recoveryCodes, 'recovery code'));
            } else {
              await api.twoFactorDisable(v.password, v.code.replace(/\s/g, ''));
              ctx.toast('Two-step sign-in is off.', 'ok');
              void render();
            }
          },
          { kind: which === 'off' ? 'danger' : 'primary', extra: [button('Cancel', () => void render(), { kind: 'quiet' })] },
        );
        wrap.replaceChildren(f);
      };
      wrap.append(
        el('p.ms-adm-lead', el('strong', 'On. '), 'Signing in asks for a code from your authenticator app.'),
        el('div.ms-adm-row', button('New recovery codes', () => show('codes'), { icon: 'key' }), button('Turn off', () => show('off'), { kind: 'danger' })),
      );
      p.body.replaceChildren(wrap);
      return;
    }
    if (step === 'scan' && pending) return scanStep();
    // step 1: the password again
    const f = form([field('password', 'Password', { type: 'password', autocomplete: 'current-password', required: true })], 'Continue', async (v) => {
      pending = await api.twoFactorSetup(v.password);
      ctx.go({ params: { step: 'scan' } }, true);
    });
    p.body.replaceChildren(el('section.ms-adm-card', el('p.ms-adm-lead', el('strong', 'Off. '), 'Turn it on so a stolen password is not enough to sign in. You need an authenticator app (1Password, Google Authenticator, …).'), f));
  }

  function scanStep(): void {
    const { secret, otpauthUri } = pending!;
    const qr = el('div.ms-adm-qr', { html: qrSvg(otpauthUri, 200, 'QR code for your authenticator app') });
    const f = form(
      [field('code', 'The code your app shows', { autocomplete: 'one-time-code', inputmode: 'numeric', required: true, maxlength: 7 })],
      'Turn on',
      async (v) => {
        const r = await api.twoFactorEnable(v.code.replace(/\s/g, ''));
        pending = null;
        forgetMe();
        p.body.replaceChildren(
          el('section.ms-adm-card',
            el('p.ms-adm-lead', el('strong', 'Two-step sign-in is on.')),
            secretBox('Recovery codes', 'If you lose your phone, each of these signs you in once. Save them somewhere safe now: they are not shown again.', r.recoveryCodes, 'recovery code'),
            button('Done', () => ctx.go({ params: { step: null } }), { kind: 'primary' }),
          ),
        );
      },
      { extra: [button('Cancel', () => ((pending = null), ctx.go({ params: { step: null } })), { kind: 'quiet' })] },
    );
    p.body.replaceChildren(
      el('section.ms-adm-card.ms-adm-2fa',
        el('div', el('h2.ms-adm-h2', '1. Scan this with your app'), qr, el('p.ms-field__hint', 'Cannot scan? Type this key into the app:'), value(secret.replace(/(.{4})/g, '$1 ').trim(), 'setup key', 'ms-adm-mono')),
        el('div', el('h2.ms-adm-h2', '2. Type the code it shows'), f),
      ),
    );
  }

  async function sessionsTab(): Promise<void> {
    let list: api.Session[];
    try {
      list = await api.sessions();
    } catch (e) {
      p.body.replaceChildren(failure(e, () => void render()));
      return;
    }
    const table = el('table.ms-adm-table', el('thead', el('tr', el('th', 'Device'), el('th', 'IP address'), el('th', 'Signed in'), el('th', 'Last active'), el('th', { 'aria-label': 'Actions' }))));
    const tb = el('tbody');
    for (const s of list) {
      const revoke = s.current ? el('span.ms-adm-badge.ms-adm-badge--ok', 'This browser') : button('Sign out', async () => {
        await api.revokeSession(s.id);
        ctx.toast('Signed out on that device.', 'ok');
        void sessionsTab();
      }, { small: true });
      tb.append(el('tr', el('td', maybe(s.userAgent, 'user agent')), el('td', maybe(s.ip, 'IP address')), el('td', when(s.createdAt)), el('td', when(s.lastSeenAt)), el('td.ms-adm-cell--end', revoke)));
    }
    table.append(tb);
    const others = list.filter((s) => !s.current);
    const all = others.length
      ? button(`Sign out ${others.length} other${others.length === 1 ? '' : 's'}`, async () => {
          for (const s of others) await api.revokeSession(s.id);
          ctx.toast('Signed out everywhere else.', 'ok');
          void sessionsTab();
        }, { icon: 'logout' })
      : null;
    p.body.replaceChildren(el('section.ms-adm-card.ms-adm-card--flush', table), ...(all ? [el('div.ms-adm-row', all)] : []));
  }

  void render();
  return {
    update: () => void render(),
    destroy: () => {
      alive = false;
      pending = null;
    },
  };
}
