// The editor's own colours: Light, Dark, or System (follows the computer). A preference of this browser, kept in
// localStorage (it may be unavailable: the editor then follows the computer), not part of any address. The tokens
// are in styles/theme.css; the switch sits in the person's menu (with the server) and in More.
import './styles/theme.css';
import { ic } from './icons';

export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'markstage:theme';
const CHOICES: [ThemePref, string, string][] = [
  ['light', 'Light', 'sun'],
  ['dark', 'Dark', 'moon'],
  ['system', 'System', 'monitor'],
];

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* storage blocked: follow the computer */
  }
  return 'system';
}

/** Puts the preference on the editor's body (data-ms-theme; none for System). */
export function applyTheme(p: ThemePref = themePref()): void {
  const body = document.body;
  if (p === 'system') delete body.dataset.msTheme;
  else body.dataset.msTheme = p;
}

export function setTheme(p: ThemePref): void {
  try {
    if (p === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* kept for this visit only */
  }
  applyTheme(p);
  window.dispatchEvent(new Event('ms-theme'));
}

/** The editor is dark now (Dark, or System on a dark computer). The screen check's page follows it. */
export function editorDark(): boolean {
  const p = themePref();
  return p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}

/** Calls `fn` when the editor's colours change (a new preference, or the computer's under System). */
export function onEditorTheme(fn: () => void): void {
  window.addEventListener('ms-theme', fn);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => themePref() === 'system' && fn());
}

/** "Theme  [Light | Dark | System]": a row for a menu; picking one applies it at once. */
export function themeRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ms-themerow';
  row.innerHTML = `<span id="ms-theme-label">Theme</span><div class="ms-seg" role="radiogroup" aria-labelledby="ms-theme-label"></div>`;
  const seg = row.querySelector('.ms-seg')!;
  const draw = () => {
    const now = themePref();
    for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.theme === now;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
  };
  for (const [id, label, icon] of CHOICES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ms-seg__btn';
    b.setAttribute('role', 'radio');
    b.dataset.theme = id;
    b.title = id === 'system' ? 'Follow the computer' : `${label} editor`;
    b.innerHTML = `${ic(icon, 13)}<span></span>`;
    b.querySelector('span')!.textContent = label;
    b.addEventListener('click', () => {
      setTheme(id);
      draw();
    });
    seg.append(b);
  }
  draw();
  return row;
}
