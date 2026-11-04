// A narrow header's [data-fold] controls (chrome.css hides them on a phone, QA F5, and when the page area is narrow):
// what it could not fit, as items of the More menu (more-menu.ts FoldedControl), each pressing the control it stands for.
import type { FoldedControl } from './more-menu';

const ICONS: [string, string][] = [['[data-view="visual"]', 'eye'], ['[data-view="source"]', 'code'], ['[data-sections]', 'sections'], ['[data-seo]', 'globe'], ['[data-library]', 'blocks'], ['[data-undo]', 'undo'], ['[data-redo]', 'redo'], ['[data-devices]', 'phone'], ['[data-preview]', 'eye']];

/** The header's [data-fold] controls the screen is too narrow for (hidden by the stylesheet), as menu items. */
export function foldedControls(app: HTMLElement): FoldedControl[] {
  const out: FoldedControl[] = [];
  for (const c of app.querySelectorAll<HTMLElement>('.ms-head__actions [data-fold]')) {
    if (c.hidden || getComputedStyle(c).display !== 'none') continue;
    const buttons = c.matches('[data-views]') ? [...c.querySelectorAll<HTMLButtonElement>('[data-view]')] : [c];
    for (const b of buttons) {
      const label = b.matches('[data-view]') ? b.title : (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/ \(.*\)$/, '');
      const icon = ICONS.find(([sel]) => b.matches(sel))?.[1];
      const pressed = b.getAttribute('aria-pressed') ?? (b.matches('[data-view]') ? b.getAttribute('aria-checked') : null);
      out.push({ label, icon, ...(pressed !== null ? { on: pressed === 'true' } : {}), run: () => (b instanceof HTMLAnchorElement ? void window.open(b.href, '_blank', 'noopener') : b.click()) });
    }
  }
  return out;
}
