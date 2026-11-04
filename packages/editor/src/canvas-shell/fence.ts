// The editor's own copy of the site's CSS (config `css`), kept out of the page shell (docs/CANVAS-FIDELITY.md).
// The editor loads the site's stylesheets for its own use (packs, dialogs, the canvas without the shell), unscoped.
// Inside the shell the page's CSS is already there, scoped to it (css.ts); the unscoped copy would reach the page too,
// and there it is wrong in two ways: its `html` / `:root` are the editor's (`:root:not([data-theme=dark]) .logo-night`
// hides the page's night logo in a dark canvas), and its media queries measure the browser's window, not the canvas.
// So each of its rules is fenced (css.ts fenceSheet): it matches outside the shell only. The editor's integration
// marks the copy: it imports each file with `?ms-site`, and Vite's dev server names the <style> it makes after it.
import { fenceSheet } from './css';

/** The <style> elements of the editor's copy of the site's CSS (the import's query, on Vite's dev id). */
export const SITE_COPY = 'style[data-vite-dev-id$="?ms-site"]';

/** Fences the editor's copy of the site's CSS now and whenever the dev server replaces it (a change to the file). */
export function fenceSiteCopy(): void {
  const fenced = new WeakMap<HTMLStyleElement, string>();
  const run = () => {
    for (const el of document.querySelectorAll<HTMLStyleElement>(SITE_COPY)) {
      const text = el.textContent ?? '';
      if (fenced.get(el) === text) continue;
      let out: string;
      try {
        out = fenceSheet(text);
      } catch {
        continue; // a sheet the browser cannot read whole stays as it is
      }
      fenced.set(el, out);
      el.textContent = out;
    }
  };
  run();
  new MutationObserver(run).observe(document.head, { childList: true, subtree: true, characterData: true });
}
