// The right column (block settings panel and Post settings drawer) is resizable: drag its left edge, or focus the
// edge and use the arrow keys. 320 to 560 px, 360 by default; the width is remembered in this browser.
const KEY = 'markstage.panelWidth';
const MIN = 320;
const MAX = 560;

const clamp = (n: number) => Math.round(Math.min(MAX, Math.max(MIN, n)));

function remembered(): number | null {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n > 0 ? clamp(n) : null;
  } catch {
    return null;
  }
}

function remember(n: number): void {
  try {
    localStorage.setItem(KEY, String(n));
  } catch {
    // private window or blocked storage: the width just is not kept
  }
}

/** Gives each panel in `app` a grip on its left edge; they share one width (--ms-panel-w on `app`). */
export function resizablePanels(app: HTMLElement, panels: HTMLElement[]): void {
  const set = (n: number) => app.style.setProperty('--ms-panel-w', `${clamp(n)}px`);
  const start = remembered();
  if (start) set(start);
  const width = () => parseFloat(getComputedStyle(app).getPropertyValue('--ms-panel-w')) || 360;
  for (const panel of panels) {
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'ms-panel__grip';
    grip.setAttribute('aria-label', 'Panel width: drag, or use the left and right arrow keys');
    grip.title = 'Drag to resize';
    grip.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      grip.setPointerCapture(ev.pointerId);
      app.classList.add('is-resizing');
      const right = app.getBoundingClientRect().right;
      const move = (e: PointerEvent) => set(right - e.clientX);
      const up = () => {
        app.classList.remove('is-resizing');
        grip.removeEventListener('pointermove', move);
        remember(width());
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up, { once: true });
      grip.addEventListener('pointercancel', up, { once: true });
    });
    grip.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      set(width() + (ev.key === 'ArrowLeft' ? 16 : -16));
      remember(width());
    });
    panel.prepend(grip);
  }
}
