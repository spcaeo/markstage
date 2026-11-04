// The section gallery's part of the preview agent (preview-agent.ts): in a sample page (one section in a copy of its
// page, preview/gallery.mjs on the server) it hides everything around the section, so the section is drawn alone,
// and says how tall the page then is; or shows the whole page again. Every picture in what is shown loads first, lazy
// ones too (a lazy picture below the frame's first screen would never load in a scaled frame), so the height and the
// frame hold them.
//   editor -> page  { markstage: 'gallery', alone }   page -> editor  { markstage: 'gallery:shown', found, height }
import { onRequest } from '../device/agent';

const MARK = 'data-ms-gallery-hidden';
const STYLE = `[${MARK}]{display:none!important}html,body{min-height:0!important}`;

/** Hides every element beside the section and beside each of its parents (not scripts or styles), or shows them again. */
export function alone(doc: Document, on: boolean): HTMLElement | null {
  for (const e of doc.querySelectorAll(`[${MARK}]`)) e.removeAttribute(MARK);
  doc.getElementById('ms-gallery-style')?.remove();
  const sec = doc.querySelector<HTMLElement>('[data-ms-section]');
  if (!on || !sec) return sec;
  for (let n: HTMLElement = sec; n.parentElement && n !== doc.body; n = n.parentElement) {
    for (const sib of n.parentElement.children) if (sib !== n && !/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sib.tagName)) sib.setAttribute(MARK, '');
  }
  const style = doc.createElement('style');
  style.id = 'ms-gallery-style';
  style.textContent = STYLE;
  doc.head.append(style);
  return sec;
}

/** How long a picture may take before the height is said without it. */
const IMAGE_WAIT_MS = 8000;

/**
 * Loads every picture in `root` now, lazy ones too, and resolves once each has loaded or failed, or after `ms`. The
 * gallery shows every picture of a section, wherever it sits in the frame.
 */
export function loadImages(root: ParentNode, ms = IMAGE_WAIT_MS): Promise<void> {
  const imgs = [...root.querySelectorAll('img')];
  for (const img of imgs) if (img.loading === 'lazy') img.loading = 'eager';
  const waits = imgs.filter((i) => !i.complete).map((i) => new Promise<void>((done) => (i.addEventListener('load', () => done(), { once: true }), i.addEventListener('error', () => done(), { once: true }))));
  return Promise.race([Promise.all(waits).then(() => undefined), new Promise<void>((done) => setTimeout(done, ms))]);
}

onRequest('gallery', (msg, reply) => {
  if (msg.markstage !== 'gallery') return false;
  const win = window;
  const sec = alone(win.document, msg.alone === true);
  const root = msg.alone === true && sec ? sec : win.document;
  // Alone, the height ends at the section (a wrapper at least as tall as the screen, as many sites have, would else
  // keep the frame's own height); two frames: the hidden parts are out of the layout before it is read
  let said = -1;
  const say = () =>
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => {
        const end = msg.alone === true && sec ? sec.getBoundingClientRect().bottom + parseFloat(win.getComputedStyle(sec).marginBottom || '0') : win.document.body.getBoundingClientRect().bottom;
        const height = Math.ceil(end + win.scrollY);
        if (height === said) return;
        said = height;
        reply({ markstage: 'gallery:shown', found: !!sec, height });
      }),
    );
  // the pictures first; one still loading after the wait says the height again when it lands, if that changed it
  void loadImages(root).then(() => {
    say();
    for (const img of root.querySelectorAll('img')) if (!img.complete) img.addEventListener('load', say, { once: true });
  });
  return true;
});
