// The media library as a chooser: every image of the site (the media API's list, the same as the #/media screen),
// searchable by name or alt text, with an upload (button, drop or paste) that is chosen at once. Used by every image
// field (image-picker.ts) and by images in the text. Resolves with the chosen image, or null (Cancel, Esc).
import './styles/library.css';
import { modalize } from './shell';
import { request } from './api';
import { ic } from './icons';
import { imageFiles, pickImages, uploadMedia, type Media } from './media';
import { config } from './runtime';

const PER_PAGE = 48;

/** The address the browser shows a library image from (dev and server answer it). */
export const mediaFileUrl = (id: string) => `${config().api}media/${encodeURIComponent(id)}/file`;

// the chooser open now: closed (as Cancel) when its address goes away (Back)
let openNow: (() => void) | null = null;
export const closeChooser = () => openNow?.();

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  return n;
};

export function chooseImage(o: { title?: string } = {}): Promise<Media | null> {
  return new Promise((done) => {
    const dlg = el('dialog', 'ms-dialog ms-lib');
    dlg.setAttribute('aria-labelledby', 'ms-lib-title');
    const head = el('div', 'ms-lib__head');
    const title = el('h2', '', o.title ?? 'Choose an image');
    title.id = 'ms-lib-title';
    const search = el('input', 'ms-input ms-lib__search');
    search.type = 'search';
    search.placeholder = 'Search by name or alt text';
    search.setAttribute('aria-label', 'Search the images');
    const upload = el('button', 'ms-btn ms-btn--sm');
    upload.type = 'button';
    upload.innerHTML = `${ic('upload', 14)}<span>Upload</span>`;
    head.append(title, search, upload);
    const status = el('p', 'ms-lib__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const grid = el('ul', 'ms-lib__grid');
    grid.setAttribute('aria-label', 'Images');
    const more = el('button', 'ms-btn ms-btn--sm ms-lib__more', 'Show more');
    more.type = 'button';
    more.hidden = true;
    const body = el('div', 'ms-lib__body');
    body.append(grid, more);
    const tools = el('div', 'ms-dialog__tools');
    const hint = el('span', 'ms-lib__hint', 'Drop or paste an image here to upload it.');
    const cancel = el('button', 'ms-btn', 'Cancel');
    cancel.type = 'button';
    const ok = el('button', 'ms-btn ms-btn--primary', 'Use this image');
    ok.type = 'button';
    ok.disabled = true;
    tools.append(hint, cancel, ok);
    dlg.append(head, status, body, tools);
    document.body.append(dlg);

    let items: Media[] = [];
    let total = 0;
    let page = 1;
    let picked: Media | null = null;
    let query = '';
    let seq = 0;

    const end = (m: Media | null) => {
      openNow = null;
      dlg.close();
      dlg.remove();
      done(m);
    };
    openNow?.();
    openNow = () => end(null);
    const select = (m: Media | null) => {
      picked = m;
      ok.disabled = !m;
      for (const b of grid.querySelectorAll<HTMLButtonElement>('.ms-lib__tile')) b.setAttribute('aria-pressed', String(b.dataset.id === m?.id));
    };
    const tile = (m: Media) => {
      const b = el('button', 'ms-lib__tile');
      b.type = 'button';
      b.dataset.id = m.id;
      b.setAttribute('aria-pressed', String(m.id === picked?.id));
      b.setAttribute('aria-label', `${m.filename}${m.alt ? `: ${m.alt}` : ''}`);
      b.title = m.alt ? `${m.filename}\n${m.alt}` : m.filename;
      const pic = el('span', 'ms-lib__img');
      const img = el('img', '');
      img.src = mediaFileUrl(m.id);
      img.alt = '';
      img.loading = 'lazy';
      pic.append(img);
      b.append(pic, el('span', 'ms-lib__name', m.filename), el('span', 'ms-lib__meta', m.width && m.height ? `${m.width}×${m.height}` : ''));
      b.addEventListener('click', () => select(m));
      b.addEventListener('dblclick', () => end(m));
      const li = el('li', '');
      li.append(b);
      return li;
    };
    const count = () =>
      (status.textContent = total ? `${total} image${total === 1 ? '' : 's'}${query ? ` matching “${query}”` : ''}` : query ? `Nothing matches “${query}”.` : 'No images yet. Upload one, or drop it here.');

    async function load(next: number): Promise<void> {
      const mine = ++seq;
      if (next === 1) status.textContent = 'Loading…';
      try {
        const r = await request<{ items: Media[]; total: number }>(`media?${new URLSearchParams({ ...(query ? { q: query } : {}), kind: 'image', page: String(next), perPage: String(PER_PAGE) })}`);
        if (mine !== seq) return;
        items = next === 1 ? r.items : [...items, ...r.items];
        total = r.total;
        page = next;
        if (next === 1) grid.replaceChildren();
        grid.append(...r.items.map(tile));
        more.hidden = items.length >= total;
        count();
      } catch (err) {
        if (mine === seq) status.textContent = `The images could not be loaded: ${(err as Error).message}`;
      }
    }

    async function add(files: File[]): Promise<void> {
      if (!files.length) return;
      let last: Media | null = null;
      for (const f of files) {
        status.textContent = `Uploading ${f.name || 'the image'}…`;
        try {
          last = await uploadMedia(f, f.name || 'image');
        } catch (err) {
          status.textContent = `Could not upload ${f.name || 'the image'}: ${(err as Error).message}`;
          return;
        }
      }
      // the new image is first in the list (newest first), chosen
      query = '';
      search.value = '';
      await load(1);
      if (last) {
        select(items.find((m) => m.id === last!.id) ?? last);
        status.textContent = `Uploaded ${last.filename}. ${ok.textContent} to put it in.`;
      }
    }

    let timer = 0;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        query = search.value.trim();
        void load(1);
      }, 250);
    });
    search.addEventListener('keydown', (e) => {
      // Enter in the search uses the only (or the picked) image
      if (e.key === 'Enter' && (picked || items.length === 1)) end(picked ?? items[0]!);
    });
    more.addEventListener('click', () => void load(page + 1));
    upload.addEventListener('click', async () => void add(await pickImages(true)));
    dlg.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      dlg.classList.add('is-over');
    });
    dlg.addEventListener('dragleave', (e) => {
      if (!dlg.contains(e.relatedTarget as Node)) dlg.classList.remove('is-over');
    });
    dlg.addEventListener('drop', (e) => {
      dlg.classList.remove('is-over');
      const files = imageFiles(e.dataTransfer);
      if (!files.length) return;
      e.preventDefault();
      void add(files);
    });
    dlg.addEventListener('paste', (e) => {
      const files = imageFiles(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      void add(files);
    });
    cancel.addEventListener('click', () => end(null));
    ok.addEventListener('click', () => picked && end(picked));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      end(null);
    });
    modalize(dlg);
    dlg.showModal();
    search.focus();
    void load(1);
  });
}
