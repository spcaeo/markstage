// The screens before anyone is signed in:
//   #/sign-in?next=<hash>     email and password, or a single sign-on provider; then (step=code) the 2FA code or a
//                             recovery code. Back from a provider: ?sso=<why>&provider=<id> when it did not work,
//                             step=code&via=sso when two-step sign-in is on (the challenge is then in a cookie).
//                             When the site signs in only with its providers, the owner's password is behind with=password.
//   #/setup                   the first owner, with the setup code from `markstage-server setup-code`
//   #/accept-invite           an invited user (or one whose password was reset) sets their password
// Codes and the 2FA challenge are typed or kept in memory, never put in the URL. After signing in the page reloads
// at `next`, so the editor starts again with the new session.
import type { ScreenCtx } from '../host';
import * as api from './api';
import { button, el, field, forgetMe, form, newPassword, page, state, whoami } from './ui';

/** Where to go after signing in: a hash inside the editor, never back to these screens. */
function nextHash(ctx: ScreenCtx): string {
  const n = ctx.params().get('next') ?? '';
  return /^#\/(?!sign-in|setup|accept-invite)[^\s]*$/.test(n) ? n : '#/';
}

/** Start the editor again, signed in, at `hash`. */
function enter(hash: string): void {
  forgetMe();
  history.replaceState(null, '', hash);
  location.reload();
}

/** Why a single sign-on did not work, from the word the server sends back (docs/API-SSO.md). */
const SSO_WHY: Record<string, string> = {
  expired: 'The sign-in took too long or was started in another browser. Try again.',
  denied: 'The sign-in was cancelled at the provider.',
  provider: 'The provider’s answer could not be checked. Try again; if it keeps happening, ask an administrator to look at the audit log.',
  domain: 'Your email at the provider is not one this site lets in.',
  email: 'The provider did not confirm your email address.',
  'no-account': 'There is no account here for you. Ask an administrator to invite you, with the email you use at the provider.',
  disabled: 'Your account is turned off. Ask an administrator.',
  unknown: 'This site has no such sign-in provider.',
};

function card(host: HTMLElement, title: string, intro: string): HTMLElement {
  const p = page(host, title, intro, { narrow: true });
  p.root.classList.add('ms-adm--auth');
  return p.body;
}

/** "You are already signed in", with a way on and a way out. */
function signedIn(body: HTMLElement, me: api.Me, ctx: ScreenCtx): void {
  body.replaceChildren(
    state('empty', `Signed in as ${me.user!.name}`, me.user!.email, el('div.ms-adm-row', button('Continue', () => enter(nextHash(ctx)), { kind: 'primary' }), button('Sign out', async () => {
      await api.logout().catch(() => undefined);
      enter(`#/sign-in`);
    }, { icon: 'logout' }))),
  );
}

export function mountSignIn(host: HTMLElement, ctx: ScreenCtx) {
  let challenge: string | null = null;
  let alive = true;
  let sso: api.SsoProviders = { providers: [], passwordLogin: true };

  function passwordStep(body: HTMLElement): void {
    const f = form(
      [field('email', 'Email', { type: 'email', autocomplete: 'username', required: true }), field('password', 'Password', { type: 'password', autocomplete: 'current-password', required: true })],
      'Sign in',
      async (v) => {
        const r = await api.login(v.email, v.password);
        if (r.twoFactorRequired && r.challenge) {
          challenge = r.challenge;
          ctx.go({ params: { step: 'code' } }, true);
          return;
        }
        enter(nextHash(ctx));
      },
    );
    body.replaceChildren(f);
    f.querySelector<HTMLInputElement>('input')?.focus();
  }

  /** "Sign in with <provider>": a link, the browser goes there and comes back signed in, at `next`. */
  function providers(): HTMLElement | null {
    if (!sso.providers.length) return null;
    return el('div.ms-adm-row', ...sso.providers.map((p) => el(sso.passwordLogin ? 'a.ms-btn' : 'a.ms-btn.ms-btn--primary', { href: api.ssoStartUrl(p.id, nextHash(ctx)) }, `Sign in with ${p.label}`)));
  }

  function codeStep(body: HTMLElement): void {
    // after single sign-on the server keeps the challenge in a cookie; otherwise a reload loses it (kept in memory only)
    const viaSso = ctx.params().get('via') === 'sso';
    if (!challenge && !viaSso) return void ctx.go({ params: { step: null } });
    const recovery = ctx.params().get('with') === 'recovery';
    const input = recovery
      ? field('recoveryCode', 'Recovery code', { autocomplete: 'off', required: true, hint: 'One of the codes you saved when you turned on two-step sign-in. Each works once.' })
      : field('code', 'Code from your authenticator app', { autocomplete: 'one-time-code', inputmode: 'numeric', required: true, pattern: '[0-9 ]{6,7}', maxlength: 7, hint: 'Six digits. It changes every 30 seconds.' });
    const other = button(recovery ? 'Use the app instead' : 'Use a recovery code', () => ctx.go({ params: { with: recovery ? null : 'recovery' } }), { kind: 'quiet', small: true });
    const back = button('Back', () => ctx.go({ params: { step: null, with: null, via: null } }), { kind: 'quiet', small: true });
    const f = form([input], 'Verify', async (v) => {
      await api.login2fa(viaSso ? null : challenge, recovery ? { recoveryCode: v.recoveryCode } : { code: v.code.replace(/\s/g, '') });
      enter(nextHash(ctx));
    }, { extra: [other, back] });
    body.replaceChildren(el('p.ms-adm-lead', 'Two-step sign-in is on for this account.'), f);
    f.querySelector<HTMLInputElement>('input')?.focus();
  }

  const body = card(host, 'Sign in', 'Sign in to edit the site.');
  async function render(): Promise<void> {
    body.replaceChildren(state('loading', 'Checking who is signed in…'));
    let me: api.Me;
    try {
      me = await whoami(true);
    } catch {
      me = { user: null, csrfToken: null, setupRequired: false, devMode: false };
    }
    if (!alive) return;
    if (me.user) return signedIn(body, me, ctx);
    // the shell sends any screen to sign-in when a request finds no session, the public ones too: send those back
    const n = ctx.params().get('next') ?? '';
    if (/^#\/(setup|accept-invite)(\?|$)/.test(n)) return ctx.open(n, false);
    if (me.setupRequired) {
      body.replaceChildren(state('empty', 'Set up the first account', 'Nobody can sign in yet. The owner sets up the first account with the setup code from the server.', button('Set up', () => ctx.open('#/setup'), { kind: 'primary' })));
      return;
    }
    sso = await api.ssoProviders().catch(() => sso);
    if (!alive) return;
    if (ctx.params().get('step') === 'code') return codeStep(body);
    const q = ctx.params();
    const why = q.get('sso');
    const from = sso.providers.find((p) => p.id === q.get('provider'))?.label;
    const said = why ? el('p.ms-adm-note.is-bad', { role: 'alert' }, `${from ? `Signing in with ${from} did not work. ` : ''}${SSO_WHY[why] ?? SSO_WHY.provider}`) : null;
    // the site signs in with its providers only: the owner keeps a password, for when a provider is down
    if (!sso.passwordLogin && q.get('with') !== 'password') {
      body.replaceChildren(...[said, providers(), el('p.ms-adm-foot', el('a', { href: `#/sign-in?with=password&next=${encodeURIComponent(nextHash(ctx))}` }, 'Owner: sign in with a password'))].filter((x): x is HTMLElement => !!x));
      return;
    }
    passwordStep(body);
    const or = providers();
    if (or) body.append(el('p.ms-adm-foot', 'or'), or);
    if (said) body.prepend(said);
    if (sso.passwordLogin) body.append(el('p.ms-adm-foot', 'Got an invitation or a reset code? ', el('a', { href: '#/accept-invite' }, 'Set your password')));
  }
  void render();
  return {
    update: () => void render(),
    destroy: () => {
      alive = false;
      challenge = null;
    },
  };
}

export function mountSetup(host: HTMLElement, ctx: ScreenCtx) {
  const body = card(host, 'Set up Markstage', 'Create the owner account. There is exactly one owner; they invite everyone else.');
  void whoami(true)
    .catch(() => null)
    .then((me) => {
      if (me?.user) return signedIn(body, me, ctx);
      if (me && !me.setupRequired) {
        body.replaceChildren(state('empty', 'Already set up', 'This server has its owner. Sign in, or ask the owner for an invitation.', button('Sign in', () => ctx.open('#/sign-in'), { kind: 'primary' })));
        return;
      }
      body.replaceChildren(
        form(
          [
            field('setupCode', 'Setup code', { required: true, hint: 'Run `markstage-server setup-code` on the server. It is valid for a short time.' }),
            field('name', 'Your name', { autocomplete: 'name', required: true }),
            field('email', 'Email', { type: 'email', autocomplete: 'username', required: true }),
            ...newPassword('password', 'Password'),
          ],
          'Create the owner account',
          async (v) => {
            await api.setup({ setupCode: v.setupCode, name: v.name, email: v.email, password: v.password });
            enter('#/account');
          },
        ),
      );
    });
  return { destroy() {} };
}

export function mountAcceptInvite(host: HTMLElement, ctx: ScreenCtx) {
  const body = card(host, 'Set your password', 'For an invitation, or after an administrator reset your password. They gave you the email and a setup code.');
  void whoami(true)
    .catch(() => null)
    .then((me) => {
      if (me?.user) return signedIn(body, me, ctx);
      body.replaceChildren(
        form(
          [
            field('email', 'Email', { type: 'email', autocomplete: 'username', required: true }),
            field('setupCode', 'Setup code', { required: true, hint: 'From the person who invited you. It is valid for 72 hours and works once.' }),
            field('name', 'Your name (optional)', { autocomplete: 'name' }),
            ...newPassword('password'),
          ],
          'Set password and sign in',
          async (v) => {
            await api.acceptInvite({ email: v.email, setupCode: v.setupCode, password: v.password, ...(v.name ? { name: v.name } : {}) });
            enter('#/');
          },
        ),
        el('p.ms-adm-foot', 'Already have a password? ', el('a', { href: '#/sign-in' }, 'Sign in')),
      );
    });
  return { destroy() {} };
}
