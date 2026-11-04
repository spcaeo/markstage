// One image field, the same wherever an entry has an image setting (Post settings, the pages editor's panels): the
// picture; Replace (upload, drop or paste onto it), Choose from library, Crop, Remove; the alt text, with what the
// page shows when it is empty (the site's altFallback: "Uses the title as alt text", else a warning); the file's
// path only under "Details". The value is what the content stores (2026/03/cover.jpg); nothing is saved until ⌘S.
// With `ai`, "Suggest alt text" asks the AI, and its suggestion shows under the alt text while the URL says so.
import './styles/image-picker.css';
import { mediaValue } from './assets';
import { suggestButton } from './ai/card';
import { copyable } from './copy';
import { ic } from './icons';
import { chooseImage } from './library';
import { imageFiles, isImageFile, pickImages, uploadMedia, type Media } from './media';
import { collection } from './runtime';
import { holds } from './settings/state';

/** What the page uses as alt text when none is written (config `altFallback`), and how the writer knows it. */
export interface AltFallback {
  /** "the title" */
  name: string;
  text(): string;
}

export type AltState = 'written' | 'fallback' | 'missing';

/** The one rule wherever alt text is counted: written; filled in by the site (altFallback); or nothing reaches the page. */
export const altState = (alt: string | null | undefined, fallback: string | null | undefined): AltState =>
  alt?.trim() ? 'written' : fallback?.trim() ? 'fallback' : 'missing';

/** How the writer knows the frontmatter key an altFallback names: "the title", else "the <its setting's label>". */
export function fieldName(collectionId: string, key: string): string {
  const c = collection(collectionId);
  if (key === (c?.titleKey ?? 'title')) return 'the title';
  const f = c?.settings?.find((d) => 'key' in d && d.key === key);
  return `the ${(f?.label ?? key).toLowerCase()}`;
}

export interface ImagePickerOpts {
  label: string;
  hint?: string;
  get(): string;
  /** a new value (null: the image is removed) */
  set(value: string | null): void;
  /** a stored value -> a URL the browser can show */
  url(value: string): string;
  /** the stored value for an uploaded or chosen image (default: its path inside the media folder) */
  value?(m: Media): string;
  /** `decorative`: the image is marked decorative, so it needs no alt text (screen readers skip it) */
  alt?: { get(): string; set(v: string): void; fallback?: AltFallback; decorative?(): boolean };
  /** where the page takes the picture from while the field is empty ("The cover image is used.") */
  empty?: string;
  /** the chooser's open state lives in the URL: the field asks for it here, and opens when library() is called */
  route?(open: boolean): void;
  /** AI alt text (ai/editor.ts): `ask` puts it in the URL; `card` is the suggestion while the URL says so */
  ai?: { ask(): void; card(alt: { get(): string; set(v: string): void }): HTMLElement | null };
}

export interface ImagePicker {
  el: HTMLElement;
  sync(): void;
  focus(): void;
  /** opens the library chooser (the URL says it is open) */
  library(): Promise<void>;
}

let uid = 0;

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  return n;
};

const tool = (icon: string, label: string, run: () => void) => {
  const b = make('button', 'ms-btn ms-btn--sm ms-imgpick__tool');
  b.type = 'button';
  b.innerHTML = `${ic(icon, 14)}<span>${label}</span>`;
  b.addEventListener('click', run);
  return b;
};

export function imagePicker(o: ImagePickerOpts): ImagePicker {
  const id = `ms-imgpick-${++uid}`;
  const el = make('div', 'ms-field ms-imgpick');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-labelledby', `${id}-label`);
  const label = make('div', 'ms-field__label', o.label);
  label.id = `${id}-label`;

  const pic = make('div', 'ms-imgpick__pic');
  pic.tabIndex = 0;
  pic.setAttribute('aria-label', `${o.label}: drop or paste an image here to use it`);
  const img = make('img', '');
  img.alt = '';
  const none = make('div', 'ms-imgpick__none');
  pic.append(img, none);
  const status = make('p', 'ms-imgpick__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const upload = tool('upload', 'Upload', async () => void use((await pickImages())[0]));
  const lib = tool('image', 'Choose from library', () => (o.route ? o.route(true) : void library()));
  const crop = tool('crop', 'Crop', () => void cropIt());
  const remove = tool('trash', 'Remove', () => {
    o.set(null);
    status.textContent = `${o.label} removed.`;
  });
  const tools = make('div', 'ms-imgpick__tools');
  tools.append(upload, lib, crop, remove);

  el.append(label, pic, tools, status);

  // the alt text, and what the page shows while it is empty
  let altInput: HTMLTextAreaElement | null = null;
  let altBox: HTMLElement | null = null;
  let altAsk: HTMLButtonElement | null = null;
  const altCard = make('div', 'ms-imgpick__ai');
  const note = make('p', 'ms-imgpick__note');
  if (o.alt) {
    const alt = o.alt;
    const box = (altBox = make('div', 'ms-imgpick__alt'));
    const lab = make('label', 'ms-field__label', 'Alt text');
    lab.htmlFor = `${id}-alt`;
    altInput = make('textarea', 'ms-input ms-input--area');
    altInput.id = `${id}-alt`;
    altInput.rows = 2;
    altInput.placeholder = 'What the image shows, for people who cannot see it';
    altInput.addEventListener('input', () => {
      alt.set(altInput!.value);
      drawNote();
    });
    const skip = make('p', 'ms-imgpick__skip', 'Decorative: screen readers skip this image, so it needs no alt text.');
    const head = make('div', 'ms-imgpick__althead');
    head.append(lab);
    if (o.ai) head.append((altAsk = suggestButton('Suggest alt text', () => o.ai!.ask(), 'ms-btn--sm')));
    box.append(head, altInput, note, skip, altCard);
    el.append(box);
  }

  // the path, for those who need it
  const details = make('details', 'ms-imgpick__details');
  details.append(make('summary', '', 'Details'));
  const pathLab = make('label', 'ms-field__label', 'File');
  pathLab.htmlFor = `${id}-path`;
  const pathRow = make('span', 'ms-field__row');
  const pathTools = make('span', 'ms-field__tools');
  const path = make('input', 'ms-input');
  path.id = `${id}-path`;
  path.spellcheck = false;
  path.placeholder = '2026/10/picture.webp';
  path.addEventListener('change', () => o.set(path.value.trim() || null));
  const size = make('p', 'ms-field__hint');
  pathRow.append(path, pathTools);
  details.append(pathLab, pathRow, size);
  if (o.hint) details.append(make('p', 'ms-field__hint', o.hint));
  el.append(details);

  function drawNote(): void {
    if (!o.alt) return;
    const has = !!o.get();
    const fb = o.alt.fallback;
    const state = altState(o.alt.get(), fb?.text());
    note.replaceChildren();
    note.dataset.state = has ? state : 'written';
    if (!has || state === 'written' || o.alt.decorative?.()) return;
    const icon = make('span', 'ms-imgpick__icon');
    icon.innerHTML = ic(state === 'fallback' ? 'info' : 'alert', 13);
    if (state === 'fallback') {
      const text = make('span', '', `Uses ${fb!.name} as alt text: “${fb!.text().trim()}”. `);
      const better = make('button', 'ms-linkbtn', 'Write a better one');
      better.type = 'button';
      better.addEventListener('click', () => {
        altInput!.value = fb!.text().trim();
        o.alt!.set(altInput!.value);
        altInput!.focus();
        altInput!.select();
        drawNote();
      });
      text.append(better);
      note.append(icon, text);
    } else note.append(icon, make('span', '', 'No alt text: people who cannot see the image get nothing.'));
  }

  async function use(file: File | undefined, name?: string): Promise<void> {
    if (!file) return;
    if (!isImageFile(file)) return void (status.textContent = `“${file.name}” is not an image the site takes (JPEG, PNG, GIF, WebP or AVIF).`);
    el.classList.add('is-busy');
    status.textContent = `Uploading ${name ?? file.name ?? 'the image'}…`;
    try {
      const m = await uploadMedia(file, name ?? (file.name || 'image'));
      chose(m);
      status.textContent = `Uploaded ${m.filename}.`;
    } catch (err) {
      status.textContent = `Could not upload: ${(err as Error).message}`;
    } finally {
      el.classList.remove('is-busy');
    }
  }

  function chose(m: Media): void {
    o.set(o.value ? o.value(m) : mediaValue(m.path));
    // the library's alt text describes this picture: it comes with it (else the field's stays)
    if (o.alt && m.alt?.trim()) o.alt.set(m.alt.trim());
    sync();
  }

  let open = false;
  async function library(): Promise<void> {
    if (open) return;
    open = true;
    const m = await chooseImage({ title: `Choose ${o.label.toLowerCase()}` });
    open = false;
    o.route?.(false);
    if (m) {
      chose(m);
      status.textContent = `${m.filename} chosen.`;
    }
    lib.focus();
  }

  async function cropIt(): Promise<void> {
    const v = o.get();
    if (!v) return;
    const { editImage } = await import('./views/image-edit');
    const out = await editImage(img.currentSrc || img.src, v);
    if (out) await use(out.file, out.name);
  }

  // drop or paste onto the field
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    el.classList.add('is-over');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget as Node)) el.classList.remove('is-over');
  });
  el.addEventListener('drop', (e) => {
    el.classList.remove('is-over');
    const [file] = imageFiles(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    void use(file);
  });
  pic.addEventListener('paste', (e) => {
    const [file] = imageFiles(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    void use(file);
  });

  function sync(): void {
    const v = o.get();
    const url = v ? o.url(v) : '';
    if (img.getAttribute('src') !== url) url ? img.setAttribute('src', url) : img.removeAttribute('src');
    img.hidden = !url;
    none.hidden = !!url;
    none.textContent = o.empty ? `No image. ${o.empty}` : 'No image. Upload one, drop or paste it here, or choose one from the library.';
    upload.querySelector('span')!.textContent = v ? 'Replace' : 'Upload';
    crop.hidden = !v;
    remove.hidden = !v;
    // no picture, no alt text
    if (altBox) {
      altBox.hidden = !v;
      // decorative: the box says so instead of asking for alt text
      altBox.classList.toggle('is-decorative', !!o.alt?.decorative?.());
    }
    if (!holds(path)) path.value = v;
    // copy and open, for the path as it is now
    if (pathTools.dataset.v !== v) {
      pathTools.dataset.v = v;
      pathTools.replaceChildren(v ? copyable(v, { label: 'file path', open: new URL(url, location.origin).href, iconsOnly: true }) : '');
    }
    size.textContent = v && img.naturalWidth ? `${img.naturalWidth} × ${img.naturalHeight} pixels` : '';
    if (altInput && !holds(altInput)) altInput.value = o.alt!.get();
    drawNote();
    if (o.ai && o.alt) {
      const deco = !!o.alt.decorative?.();
      altAsk!.hidden = deco;
      const alt = o.alt;
      const card = v && !deco ? o.ai.card({ get: () => alt.get(), set: (x) => (alt.set(x), sync()) }) : null;
      if (card && card.parentElement !== altCard) altCard.replaceChildren(card);
      if (!card) altCard.replaceChildren();
    }
  }
  img.addEventListener('load', () => (size.textContent = `${img.naturalWidth} × ${img.naturalHeight} pixels`));
  sync();
  return { el, sync, focus: () => (o.get() ? (altInput ?? lib) : upload).focus(), library };
}
