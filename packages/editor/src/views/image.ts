// A Markdown image on the canvas, edited where it stands (docs/UX-BENCHMARK.md "Images"):
//   - a caption line under it, and an "Alt" toggle that swaps that line for the alt text in place;
//   - a "No alt text" badge until it has alt text or is marked decorative (a switch on the alt line); "Suggest" on
//     the alt line asks the AI for some (ai/editor.ts shows the suggestion under the line, at its own URL);
//   - when selected, a bar on the image: the widths from editor.images, replace, choose from the library, crop and
//     rotate;
//   - with no file yet, a drop zone: upload, drop or paste a file, or paste a URL.
// Drawn as the site renders it: <p><img></p>, or with a caption, a width or the decorative mark
// <figure class="…"><p><img></p><figcaption>…</figcaption></figure> (core figure.mjs). Changing between the two
// draws the view again; the field being typed in keeps the caret.
import type { Node as PMNode } from '@tiptap/pm/model';
import { assetUrl, contentSrc } from '../assets';
import { toast } from '../host';
import { ic } from '../icons';
import { figureAttr, figureParts, upload } from '../images';
import { finalSrc, imageFiles, isTemp, pickImages, startUpload } from '../media';
import { imagesConfig } from '../runtime';
import { field, type GetPos } from './base';
import { AtomView } from './core';
import type { EditorView } from '@tiptap/pm/view';

type Line = 'caption' | 'alt';

const isFigure = (a: PMNode['attrs']) => a.figure != null || !!a.caption;

/** The field to focus in the view drawn next at this position (the form changed while typing). */
let refocus: { pos: number; line: Line } | null = null;

const ui = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  e.contentEditable = 'false';
  e.dataset.msUi = '';
  return e;
};

const button = (cls: string, html: string, label: string, run: () => void) => {
  const b = ui('button', cls, html);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    run();
  });
  return b;
};

export class ImageView extends AtomView {
  dom: HTMLElement;
  private figure: boolean;
  private frame = Object.assign(document.createElement('span'), { className: 'ms-image__frame' });
  private img = document.createElement('img');
  private badge = button('ms-image__badge', `${ic('alert', 13)}<span>No alt text</span>`, 'Add alt text', () => this.show('alt', true));
  private bar = ui('span', 'ms-image__bar');
  private widths: HTMLButtonElement[] = [];
  /** only for images on this site: the browser keeps the pixels of another site's image from the page */
  private cropBtn = button('ms-image__tool', ic('crop', 15), 'Crop and rotate', () => void this.crop());
  private empty = ui('span', 'ms-image__empty');
  private line: HTMLElement;
  private cap = document.createElement('span');
  private alt = document.createElement('span');
  private altBtn = button('ms-image__altbtn', 'Alt', 'Edit the alt text', () => this.show(this.mode === 'alt' ? 'caption' : 'alt', true));
  private deco = ui('label', 'ms-image__deco', '<input type="checkbox"><span>Decorative</span>');
  private aiBtn = button('ms-image__aibtn', `${ic('sparkle', 13)}<span>Suggest</span>`, 'Suggest alt text', () =>
    this.dom.dispatchEvent(new CustomEvent('ms-ai-alt', { bubbles: true, detail: { pos: this.getPos() } })),
  );
  private mode: Line = 'caption';
  private selected = false;
  /** a field gets the focus in a moment (the view was drawn again while typing): keep its line */
  private holding = false;
  private syncCap: () => void;
  private syncAlt: () => void;

  constructor(node: PMNode, view: EditorView, getPos: GetPos) {
    super(node, view, getPos);
    this.figure = isFigure(node.attrs);
    this.dom = document.createElement(this.figure ? 'figure' : 'p');
    this.dom.contentEditable = 'false';
    this.line = document.createElement(this.figure ? 'figcaption' : 'span');
    this.line.className = 'ms-image__line';
    this.img.draggable = false;
    this.frame.append(this.img, this.badge, this.bar, this.empty);
    if (this.figure) {
      const p = document.createElement('p');
      p.append(this.frame);
      this.dom.append(p, this.line);
    } else this.dom.append(this.frame, this.line);

    const cfg = imagesConfig();
    this.cap.className = 'ms-image__cap';
    this.alt.className = 'ms-image__alt';
    this.syncCap = field(this.cap, {
      get: () => this.node.attrs.caption ?? '',
      set: (v) => this.setCaption(v),
      placeholder: 'Type a caption (optional)',
      label: 'Caption',
    });
    this.syncAlt = field(this.alt, {
      get: () => this.node.attrs.alt ?? '',
      set: (v) => this.setAttrs({ alt: v.trim() ? v : '' }),
      placeholder: 'Describe the image for people who cannot see it',
      label: 'Alt text',
    });
    const box = this.deco.querySelector('input')!;
    box.addEventListener('change', () => this.setDecorative(box.checked));
    if (cfg.captions) this.line.append(this.cap);
    this.line.append(this.alt, this.aiBtn, this.deco, this.altBtn);

    if (cfg.widths.length > 1) {
      const seg = ui('span', 'ms-image__seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Width');
      for (const w of cfg.widths) {
        const b = button('ms-image__w', w.label, `Width: ${w.label}`, () => this.setWidth(w.id));
        b.dataset.width = w.id;
        b.removeAttribute('title');
        this.widths.push(b);
        seg.append(b);
      }
      this.bar.append(seg);
    }
    this.bar.append(
      button('ms-image__tool', ic('upload', 15), 'Replace image', () => void this.replace()),
      button('ms-image__tool', ic('image', 15), 'Choose from library', () => void this.fromLibrary()),
      this.cropBtn,
    );
    this.drawEmpty();
    if (!cfg.captions) this.mode = 'alt';
    this.render();

    const r = refocus;
    if (r && r.pos === this.getPos()) {
      refocus = null;
      this.mode = r.line;
      this.holding = true;
      this.render();
      requestAnimationFrame(() => {
        this.focusLine(r.line);
        this.holding = false;
      });
    }
  }

  // ---------- writing ----------
  private patch(patch: Record<string, unknown>, typing: Line | null = null): void {
    const next = { ...this.node.attrs, ...patch };
    if (typing && isFigure(next) !== this.figure) refocus = { pos: this.getPos() ?? -1, line: typing };
    this.setAttrs(patch);
  }

  private setCaption(v: string): void {
    const caption = v.trim() ? v : null;
    this.patch({ caption, figure: figureAttr(figureParts(this.node.attrs.figure), caption) }, 'caption');
  }

  private setWidth(width: string): void {
    const parts = { ...figureParts(this.node.attrs.figure), width };
    this.patch({ figure: figureAttr(parts, this.node.attrs.caption) });
  }

  private setDecorative(on: boolean): void {
    const parts = { ...figureParts(this.node.attrs.figure), decorative: on };
    this.patch({ figure: figureAttr(parts, this.node.attrs.caption), ...(on ? { alt: '' } : {}) }, 'alt');
    if (!on) requestAnimationFrame(() => this.focusLine('alt'));
  }

  private async replace(): Promise<void> {
    const [file] = await pickImages();
    if (file) this.setAttrs({ src: upload(this.view, file) });
  }

  /** An image of the site's media library; its alt text there comes with it. */
  private async fromLibrary(): Promise<void> {
    const { chooseImage } = await import('../library');
    const m = await chooseImage();
    if (m) this.setAttrs({ src: contentSrc(m.path), ...(m.alt?.trim() ? { alt: m.alt.trim() } : {}) });
  }

  private async crop(): Promise<void> {
    const src = this.node.attrs.src as string;
    const { editImage } = await import('./image-edit');
    const out = await editImage(assetUrl(finalSrc(src)), src);
    if (!out) return;
    const { temp, done } = startUpload(out.file, out.name);
    const pos = this.getPos();
    this.setAttrs({ src: temp });
    try {
      const final = await done;
      this.settleAt(pos, temp, final);
      toast('Saved the edited image as a new file; the original is kept.', 'ok');
    } catch (err) {
      this.settleAt(pos, temp, src);
      toast(`Could not save the edited image: ${(err as Error).message}`, 'error');
    }
  }

  /** Sets the src of the image at `pos` if it still shows `temp`. */
  private settleAt(pos: number | undefined, temp: string, src: string): void {
    const n = pos === undefined ? null : this.view.state.doc.nodeAt(pos);
    if (!n || n.type.name !== 'image' || n.attrs.src !== temp) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos!, undefined, { ...n.attrs, src }).setMeta('addToHistory', false));
  }

  // ---------- the empty image: upload, drop, paste, URL ----------
  private drawEmpty(): void {
    const url = document.createElement('input');
    url.type = 'url';
    url.className = 'ms-image__url';
    url.placeholder = 'Or paste an image URL and press Enter';
    url.setAttribute('aria-label', 'Image URL');
    url.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = url.value.trim();
      if (/^(https?:\/\/|\/)\S+$/.test(v)) this.setAttrs({ src: v });
      else toast('Paste a full image address (https://…) or a site path (/…).', 'error');
    });
    url.addEventListener('paste', (e) => {
      const files = imageFiles(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      this.setAttrs({ src: upload(this.view, files[0]) });
    });
    const pick = button('ms-btn ms-btn--primary ms-image__pick', `${ic('upload', 15)}<span>Upload an image</span>`, 'Upload an image', async () => {
      const [file] = await pickImages();
      if (file) this.setAttrs({ src: upload(this.view, file) });
    });
    pick.removeAttribute('title');
    const lib = button('ms-btn ms-image__pick', `${ic('image', 15)}<span>Choose from library</span>`, 'Choose from library', () => void this.fromLibrary());
    lib.removeAttribute('title');
    const picks = ui('span', 'ms-image__picks', '');
    picks.append(pick, lib);
    this.empty.append(ui('span', 'ms-image__emptyicon', ic('image', 28)), picks, ui('span', 'ms-image__hint', 'or drop or paste an image here'), url);
    this.empty.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      this.empty.classList.add('is-over');
    });
    this.empty.addEventListener('dragleave', () => this.empty.classList.remove('is-over'));
    this.empty.addEventListener('drop', (e) => {
      this.empty.classList.remove('is-over');
      const files = imageFiles(e.dataTransfer);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      this.setAttrs({ src: upload(this.view, files[0]) });
    });
  }

  // ---------- drawing ----------
  private show(line: Line, focus = false): void {
    this.mode = imagesConfig().captions ? line : 'alt';
    this.render();
    if (focus) this.focusLine(this.mode);
  }

  private focusLine(line: Line): void {
    const t = line === 'alt' ? this.alt : this.cap;
    if (line === 'alt' && figureParts(this.node.attrs.figure).decorative) return;
    t.focus();
    const sel = getSelection();
    sel?.selectAllChildren(t);
    sel?.collapseToEnd();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type || isFigure(node.attrs) !== this.figure) return false;
    return super.update(node);
  }

  /** Back to the caption line, unless the writer is in the alt line now. */
  private resetLine(): void {
    if (imagesConfig().captions && !this.holding && !this.line.contains(document.activeElement)) this.mode = 'caption';
  }

  selectNode(): void {
    this.selected = true;
    this.resetLine();
    this.dom.classList.add('ProseMirror-selectednode');
    this.render();
  }

  deselectNode(): void {
    this.selected = false;
    this.dom.classList.remove('ProseMirror-selectednode');
    this.resetLine();
    this.render();
  }

  stopEvent(e: Event): boolean {
    const t = e.target as Element | null;
    return !!t?.closest?.('[data-ms-field], [data-ms-ui]');
  }

  render(): void {
    const a = this.node.attrs;
    const src = finalSrc(a.src ?? '');
    const parts = figureParts(a.figure);
    const url = src ? assetUrl(src) : '';
    if (this.img.getAttribute('src') !== url) url ? (this.img.src = url) : this.img.removeAttribute('src');
    this.img.alt = a.alt ?? '';
    if (a.title) this.img.title = a.title;
    else this.img.removeAttribute('title');

    const cls = ['ms-image', ...(this.figure && a.figure ? String(a.figure).split(/\s+/).filter(Boolean) : [])];
    if (this.selected) cls.push('ProseMirror-selectednode', 'is-selected');
    if (!src) cls.push('is-empty');
    if (isTemp(src)) cls.push('is-uploading');
    if (a.caption) cls.push('has-caption');
    if (this.mode === 'alt') cls.push('is-alt');
    this.dom.className = cls.join(' ');
    this.dom.dataset.width = parts.width;

    this.cropBtn.hidden = /^https?:/.test(src);
    const noAlt = !!src && !(a.alt ?? '').trim() && !parts.decorative;
    this.badge.hidden = !noAlt;
    this.cap.hidden = this.mode !== 'caption';
    this.alt.hidden = this.mode !== 'alt';
    this.deco.hidden = this.mode !== 'alt';
    this.aiBtn.hidden = this.mode !== 'alt' || parts.decorative || !src || isTemp(src);
    this.altBtn.hidden = !imagesConfig().captions;
    this.altBtn.classList.toggle('is-on', this.mode === 'alt');
    this.altBtn.classList.toggle('is-missing', noAlt);
    this.altBtn.setAttribute('aria-pressed', String(this.mode === 'alt'));
    (this.deco.querySelector('input') as HTMLInputElement).checked = parts.decorative;
    this.alt.classList.toggle('is-off', parts.decorative);
    this.alt.contentEditable = parts.decorative ? 'false' : 'true';
    this.alt.dataset.placeholder = parts.decorative ? 'Decorative: screen readers skip it' : 'Describe the image for people who cannot see it';
    for (const b of this.widths) {
      const on = b.dataset.width === parts.width;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.syncCap();
    this.syncAlt();
  }
}
