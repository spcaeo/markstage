// Signed out while editing (the session ended, or was signed out somewhere else): sign in again over the editor, so
// what is not saved stays where it is, and the save that found no session runs again. The same person only: someone
// else signing in goes to the sign-in screen (the page starts again, with their rights).
// With single sign-on (docs/API-SSO.md) the site's providers are offered too: signing in there leaves the page, so
// the unsaved changes go to the recovery copy first (keep.ts) and the provider brings the person back to the same
// address, where the entry offers them again. On a site that signs in with its providers only, the password is the
// owner's alone.
import './styles/signin.css';
import { ssoStartUrl, type SsoProviders } from './admin/api';
import { ApiError, onUnauthorized, request } from './api';
import { passwordInput, withEye } from './password';
import { modalize } from './shell';

export interface SignInDeps {
  /** an entry is open in the editor (not a screen): the place to sign in over */
  here(): boolean;
  /** the sign-in screen, as without an open entry */
  toScreen(): void;
  /** signed in again */
  back(): void;
  /** the owner keeps a password when the site signs in with its providers only */
  owner: boolean;
  /** about to leave for a provider: true once the unsaved changes are kept to be offered on the way back */
  leave(): Promise<boolean>;
}

export function signInHere(email: string, d: SignInDeps): void {
  let open = false;
  onUnauthorized(() => {
    if (open) return;
    if (!d.here()) return d.toScreen();
    open = true;
    void ask(email, d).then((r) => {
      open = false;
      if (r === 'in') d.back();
      else if (r === 'other') d.toScreen();
    });
  });
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

function field(label: string, input: HTMLInputElement): HTMLLabelElement {
  const l = h('label', { className: 'ms-signin__field' });
  l.append(h('span', { textContent: label }), input.type === 'password' ? withEye(input) : input);
  return l;
}

/** 'in' signed in; 'other' someone else wants to sign in; 'later' closed (the next request asks again). */
function ask(email: string, d: SignInDeps): Promise<'in' | 'other' | 'later'> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { className: 'ms-dialog ms-signin' });
    dlg.setAttribute('aria-labelledby', 'ms-signin-title');
    const form = h('form');
    const title = h('h2', { id: 'ms-signin-title', textContent: 'Sign in again' });
    const lead = h('p', { textContent: 'Your session has ended. Sign in to go on: what you have not saved is still here, and is saved once you are back.' });
    const who = h('input', { type: 'email', value: email, readOnly: true, autocomplete: 'username' });
    const pass = passwordInput(false);
    const code = h('input', { required: true, autocomplete: 'one-time-code', inputMode: 'numeric', maxLength: 7 });
    const recovery = h('input', { required: true, autocomplete: 'off' });
    const fields = h('div', { className: 'ms-signin__fields' });
    fields.append(field('Email', who), field('Password', pass));
    const error = h('p', { className: 'ms-signin__error', hidden: true });
    error.setAttribute('role', 'alert');
    const submit = h('button', { type: 'submit', className: 'ms-btn ms-btn--primary', textContent: 'Sign in' });
    const other = h('button', { type: 'button', className: 'ms-btn ms-btn--quiet', textContent: 'Sign in as someone else' });
    const tools = h('div', { className: 'ms-dialog__tools' });
    tools.append(other, submit);
    const sso = h('div', { className: 'ms-signin__sso', hidden: true });
    const or = h('p', { className: 'ms-signin__or', textContent: 'or', hidden: true });
    form.append(title, lead, sso, or, fields, error, tools);
    dlg.append(form);
    document.body.append(dlg);

    // the site's providers, when it has any (a reload of this list is not needed: it changes with a restart)
    let warned = false;
    const toProvider = async (p: { id: string; label: string }, passwords: boolean) => {
      error.hidden = true;
      // the second press goes anyway, after the warning (the browser then asks about leaving with unsaved changes)
      if (!(await d.leave()) && !warned) {
        warned = true;
        error.textContent = `Your unsaved changes cannot be kept in this browser while you sign in with ${p.label}. Copy them somewhere first${passwords ? ', or sign in with your password' : ''}; press Sign in with ${p.label} again to go anyway.`;
        error.hidden = false;
        return;
      }
      location.assign(ssoStartUrl(p.id, location.hash || '#/'));
    };
    void request<SsoProviders>('auth/sso')
      .then((r) => {
        if (!r.providers.length) return;
        const passwords = r.passwordLogin || d.owner;
        sso.replaceChildren(...r.providers.map((p) => {
          const b = h('button', { type: 'button', className: passwords ? 'ms-btn' : 'ms-btn ms-btn--primary', textContent: `Sign in with ${p.label}` });
          b.addEventListener('click', () => void toProvider(p, passwords));
          return b;
        }));
        sso.hidden = false;
        if (passwords) or.hidden = false;
        else {
          // the provider only: no password to ask for
          fields.hidden = submit.hidden = true;
          pass.required = false;
          lead.textContent = 'Your session has ended. Sign in to go on: what you have not saved is kept in this browser and offered again when you are back.';
          sso.querySelector('button')?.focus();
        }
      })
      .catch(() => undefined);

    let challenge: string | null = null;
    let useRecovery = false;
    const codeStep = () => {
      lead.textContent = 'Two-step sign-in is on for this account.';
      const swap = h('button', { type: 'button', className: 'ms-btn ms-btn--quiet ms-btn--sm', textContent: useRecovery ? 'Use the app instead' : 'Use a recovery code' });
      swap.addEventListener('click', () => ((useRecovery = !useRecovery), codeStep()));
      fields.replaceChildren(useRecovery ? field('Recovery code', recovery) : field('Code from your authenticator app', code), swap);
      submit.textContent = 'Verify';
      (useRecovery ? recovery : code).focus();
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      try {
        if (!challenge) {
          const r = await request<{ twoFactorRequired?: boolean; challenge?: string }>('auth/login', { method: 'POST', body: JSON.stringify({ email, password: pass.value }) });
          if (r.twoFactorRequired && r.challenge) {
            challenge = r.challenge;
            return codeStep();
          }
        } else {
          const body = useRecovery ? { recoveryCode: recovery.value.trim() } : { code: code.value.replace(/\s/g, '') };
          await request('auth/login/2fa', { method: 'POST', body: JSON.stringify({ challenge, ...body }) });
        }
        dlg.close('in');
      } catch (err) {
        error.textContent = err instanceof ApiError && err.status === 0 ? 'The server cannot be reached. Try again in a moment.' : (err as Error).message;
        error.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });
    other.addEventListener('click', () => dlg.close('other'));
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'in' ? 'in' : dlg.returnValue === 'other' ? 'other' : 'later');
      dlg.remove();
    });
    modalize(dlg);
    dlg.showModal();
    pass.focus();
  });
}
