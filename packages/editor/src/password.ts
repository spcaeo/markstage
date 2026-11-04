// Every password input in the editor goes through here (the owner's rule, 2026-11-02): an eye button shows or hides
// what is typed, the browser may save the password (a real form, autocomplete current-password or new-password, an
// email field with autocomplete username next to it), and a new password is typed twice. The guard
// test/password-fields.test.ts refuses a password input made anywhere else.
import { ic } from './icons';

/** Wraps `input` (type password) with the eye button; the wrapper takes the input's place in a form. */
export function withEye(input: HTMLInputElement): HTMLElement {
  const eye = document.createElement('button');
  eye.type = 'button';
  eye.className = 'ms-iconbtn ms-pw__eye';
  eye.tabIndex = -1;
  const set = (shown: boolean) => {
    input.type = shown ? 'text' : 'password';
    eye.innerHTML = ic(shown ? 'eye-off' : 'eye', 16);
    eye.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
    eye.title = shown ? 'Hide password' : 'Show password';
    eye.setAttribute('aria-pressed', String(shown));
  };
  set(false);
  eye.addEventListener('click', () => {
    set(input.type === 'password');
    input.focus();
  });
  const wrap = document.createElement('div');
  wrap.className = 'ms-pw';
  wrap.append(input, eye);
  return wrap;
}

/** A password input: `fresh` for a new password (the browser offers to save it), else the current one. */
export function passwordInput(fresh: boolean, props: Record<string, unknown> = {}): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'password';
  i.required = true;
  i.autocomplete = fresh ? 'new-password' : 'current-password';
  i.spellcheck = false;
  if (fresh) i.minLength = 12;
  Object.assign(i, props);
  return i;
}

export const PASSWORD_HINT = 'At least 12 characters. Not your email, not a common password.';
export const MISMATCH = 'The two passwords are not the same.';

/**
 * The confirm inputs (`data-confirms` = the name of the input they repeat) that differ from their input; a form
 * refuses to submit while there is one.
 */
export function mismatched(form: HTMLFormElement): HTMLInputElement[] {
  return [...form.querySelectorAll<HTMLInputElement>('input[data-confirms]')].filter((c) => {
    const first = form.querySelector<HTMLInputElement>(`input[name="${c.dataset.confirms}"]`);
    return !!first && first.value !== c.value;
  });
}
