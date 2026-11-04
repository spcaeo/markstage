// A frontmatter image (the cover) edited where the head shows it, through its Post settings field (type 'image'):
// replace it by upload or drop or from the media library, crop and rotate it (a new file), its alt text with a "No
// alt text" badge (a calm "Uses the title as alt text" when the site fills it in: altFallback), its focal
// point (when the field names a `focal` key), remove it. With no image, a drop zone that adds one. The values are
// pending frontmatter changes, saved with the entry like the drawer's.
import { mediaValue } from './assets';
import { toast } from './host';
import { ic } from './icons';
import { altState } from './image-picker';
import { chooseImage } from './library';
import { imageFiles, pickImages, uploadMedia, type Media } from './media';
import type { SettingField } from './runtime';
import { holds, type FrontmatterEdits } from './settings/state';

type ImageField = Extract<SettingField, { type: 'image' }>;

export interface HeadImageDeps {
  edits: FrontmatterEdits;
  /** changes to these keys are drawn in place (the head is not drawn again while typing) */
  live: (key: string, sync?: () => void) => void;
  /** how the writer knows the field's altFallback key ("the title") */
  altName?: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

const btn = (cls: string, html: string, label: string, run: () => void) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.innerHTML = html;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    run();
  });
  return b;
};

/** `el` (the site's element holding the img, or null for none yet) with the editing parts on it. */
export function headImage(el: HTMLElement | null, f: ImageField, d: HeadImageDeps): HTMLElement {
  const { edits } = d;
  const src = str(edits.get(f.key));
  const box = el && src ? el : Object.assign(document.createElement('div'), { className: 'ms-headimg__empty' });
  box.classList.add('ms-headimg');
  const ui = document.createElement('div');
  ui.className = 'ms-headimg__ui';
  ui.contentEditable = 'false';

  // one step of the settings' history each
  const setImage = (value: string | null) =>
    edits.group(() => {
      for (const k of f.clears ?? []) edits.set(k, null);
      if (f.focal) edits.set(f.focal, null);
      edits.set(f.key, value);
    });
  const chose = (m: Media) =>
    edits.group(() => {
      setImage(mediaValue(m.path));
      if (f.alt && m.alt?.trim()) edits.set(f.alt, m.alt.trim());
    });
  const library = async () => {
    const m = await chooseImage({ title: `Choose ${f.label.toLowerCase()}` });
    if (m) chose(m);
  };
  const upload = async (file: File | undefined, name?: string) => {
    if (!file) return;
    box.classList.add('is-uploading');
    try {
      chose(await uploadMedia(file, name ?? file.name));
    } catch (err) {
      box.classList.remove('is-uploading');
      toast(`Could not upload: ${(err as Error).message}`, 'error');
    }
  };
  box.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    box.classList.add('is-over');
  });
  box.addEventListener('dragleave', () => box.classList.remove('is-over'));
  box.addEventListener('drop', (e) => {
    box.classList.remove('is-over');
    const [file] = imageFiles(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    void upload(file);
  });

  if (!src) {
    const add = btn('ms-headimg__add', `${ic('image', 16)}<span>Add ${f.label.toLowerCase()}</span>`, `Add ${f.label.toLowerCase()}`, async () => void upload((await pickImages())[0]));
    add.removeAttribute('title');
    const lib = btn('ms-headimg__add', `${ic('image', 16)}<span>Choose from library</span>`, 'Choose from library', () => void library());
    lib.removeAttribute('title');
    box.append(add, lib, Object.assign(document.createElement('span'), { className: 'ms-headimg__hint', textContent: 'or drop an image here' }));
    return box;
  }

  const img = box.querySelector('img');
  const bar = document.createElement('div');
  bar.className = 'ms-headimg__bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', f.label);
  ui.append(bar);
  box.append(ui);

  // alt text: a badge while it has none (a calm note when the site fills it in: altFallback), and a small field
  let altPop: HTMLElement | null = null;
  if (f.alt) {

    const fb = f.altFallback;
    const badge = btn('ms-image__badge ms-headimg__badge', '', 'Add alt text', () => {
      // "Write a better one" starts from what the page uses now
      if (fb && !str(edits.get(f.alt!)).trim()) {
        area.value = str(edits.get(fb)).trim();
        edits.set(f.alt!, area.value);
      }
      toggleAlt(true);
      area.select();
    });
    const syncBadge = () => {
      const state = altState(str(edits.get(f.alt!)), fb ? str(edits.get(fb)) : '');
      badge.hidden = state === 'written';
      badge.classList.toggle('is-calm', state === 'fallback');
      badge.innerHTML = state === 'fallback' ? `${ic('info', 13)}<span>Uses ${d.altName ?? 'the title'} as alt text</span><span class="ms-headimg__better">Write a better one</span>` : `${ic('alert', 13)}<span>No alt text</span>`;
      badge.setAttribute('aria-label', state === 'fallback' ? `Uses ${d.altName ?? 'the title'} as alt text. Write a better one` : 'Add alt text');
    };
    syncBadge();
    ui.append(badge);
    altPop = document.createElement('label');
    altPop.className = 'ms-headimg__alt';
    altPop.hidden = true;
    altPop.innerHTML = '<span>Alt text</span><textarea rows="2" placeholder="Describe the image for people who cannot see it"></textarea>';
    const area = altPop.querySelector('textarea')!;
    area.value = str(edits.get(f.alt));
    // a change in Post settings shows here too
    d.live(f.alt, () => {
      if (!holds(area)) area.value = str(edits.get(f.alt!));
      if (img) img.alt = area.value;
      syncBadge();
    });
    area.addEventListener('input', () => {
      edits.set(f.alt!, area.value);
      if (img) img.alt = area.value;
      syncBadge();
    });
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        toggleAlt(false);
      }
    });
    ui.append(altPop);
  }
  const altBtn = f.alt ? btn('ms-headimg__tool ms-headimg__tool--text', 'Alt', 'Edit the alt text', () => toggleAlt(altPop!.hidden === true)) : null;
  function toggleAlt(open: boolean): void {
    if (!altPop) return;
    altPop.hidden = !open;
    box.classList.toggle('is-alt', open);
    altBtn?.setAttribute('aria-pressed', String(open));
    if (open) altPop.querySelector('textarea')!.focus();
  }

  // focal point: click on the image to set it
  let focalBtn: HTMLButtonElement | null = null;
  if (f.focal && img) {
    const dot = document.createElement('span');
    dot.className = 'ms-headimg__dot';
    const layer = document.createElement('div');
    layer.className = 'ms-headimg__focal';
    layer.hidden = true;
    layer.append(dot, Object.assign(document.createElement('span'), { className: 'ms-headimg__focalhint', textContent: 'Click the part of the image that must stay in view' }));
    const show = () => {
      const [x = '50%', y = '50%'] = str(edits.get(f.focal!)).split(/\s+/);
      dot.style.left = x;
      dot.style.top = y;
      img.style.objectPosition = `${x} ${y}`;
    };
    show();
    d.live(f.focal, show);
    layer.addEventListener('click', (e) => {
      const r = img.getBoundingClientRect();
      const x = Math.round(Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * 100);
      const y = Math.round(Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1) * 100);
      edits.set(f.focal!, `${x}% ${y}%`);
      show();
    });
    ui.prepend(layer); // under the bar
    focalBtn = btn('ms-headimg__tool', ic('target', 15), 'Focal point', () => {
      layer.hidden = layer.hidden !== true;
      box.classList.toggle('is-focal', layer.hidden !== true);
      focalBtn!.setAttribute('aria-pressed', String(layer.hidden !== true));
    });
  }

  bar.append(
    btn('ms-headimg__tool', ic('upload', 15), `Replace ${f.label.toLowerCase()}`, async () => void upload((await pickImages())[0])),
    btn('ms-headimg__tool', ic('image', 15), 'Choose from library', () => void library()),
    btn('ms-headimg__tool', ic('crop', 15), 'Crop and rotate', async () => {
      if (!img) return;
      const { editImage } = await import('./views/image-edit');
      const out = await editImage(img.currentSrc || img.src, src);
      if (out) await upload(out.file, out.name);
    }),
    ...(focalBtn ? [focalBtn] : []),
    ...(altBtn ? [altBtn] : []),
    btn('ms-headimg__tool', ic('trash', 15), `Remove ${f.label.toLowerCase()}`, () => {
      // its alt text goes with it
      if (f.alt) edits.set(f.alt, null);
      setImage(null);
    }),
  );
  return box;
}
