// The example blog's editor pack: a reading post's list of contents (src/pages/posts/[id].astro, its h2s) follows the
// canvas's headings as they are typed, when the canvas is drawn in the post's page (canvas.shell), and goes away
// when the post turns it off (Post settings "Show contents", frontmatter `contents: false`). A click on an item
// scrolls the canvas to its heading. EditorPack.shell, docs/CANVAS-FIDELITY.md.
import { defineEditorPack, type ShellCtx } from '@markstage/editor/pack';

let targets: HTMLElement[] = [];
const wired = new WeakSet<HTMLElement>();

function shell(ctx: ShellCtx): void {
  if (ctx.reason === 'scroll') return;
  const article = ctx.root.querySelector<HTMLElement>('article.post');
  // a reading post only: the page says so on its body (frame-reading)
  if (!article || !ctx.root.querySelector('.frame-reading')) return;
  const h2s = ctx.headings.filter((h) => h.level === 2 && h.text.trim() && h.el);
  targets = h2s.map((h) => h.el!);
  let nav = article.querySelector<HTMLElement>('nav.post__contents');
  if (ctx.entry.frontmatter.contents === false || !h2s.length) return void nav?.remove();
  if (!nav) {
    // where the page puts it: after the date line, before the cover and the text
    nav = Object.assign(document.createElement('nav'), { className: 'post__contents' });
    nav.setAttribute('aria-label', 'Contents');
    const date = article.querySelector('.post__date');
    if (date) date.after(nav);
    else article.insertBefore(nav, article.querySelector('.ms-canvas'));
  }
  const ol = document.createElement('ol');
  h2s.forEach((h, i) => {
    const a = Object.assign(document.createElement('a'), { href: `#h-${i}`, textContent: h.text });
    a.dataset.index = String(i);
    const li = document.createElement('li');
    li.append(a);
    ol.append(li);
  });
  nav.replaceChildren(ol);
  ctx.live(nav);
  if (wired.has(nav)) return;
  wired.add(nav);
  nav.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('a[data-index]');
    const el = a && targets[Number(a.dataset.index)];
    if (el) ctx.scrollTo(el);
  });
}

export default defineEditorPack({ name: 'example-blog', shell });
