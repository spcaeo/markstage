// Crop and rotate an image in a dialog, at its full size; the result is a new file (the caller uploads it, the
// original stays in the media folder). Dragging inside the frame moves it, the corner and edge handles size it,
// arrow keys nudge it (Shift: 10 px); the aspect buttons fix its ratio.
import { ic } from '../icons';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ASPECTS: [string, number | null][] = [
  ['Free', null],
  ['16:9', 16 / 9],
  ['4:3', 4 / 3],
  ['1:1', 1],
];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN = 16;
const OUT_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const load = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be loaded.'));
    img.src = url;
  });

/** Draws `img` turned by `turns` quarter turns, at `scale`. */
function rotated(img: HTMLImageElement, turns: number, scale = 1): HTMLCanvasElement {
  const side = turns % 2 === 1;
  const c = document.createElement('canvas');
  c.width = Math.round((side ? img.naturalHeight : img.naturalWidth) * scale);
  c.height = Math.round((side ? img.naturalWidth : img.naturalHeight) * scale);
  const g = c.getContext('2d')!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((turns * Math.PI) / 2);
  g.drawImage(img, (-img.naturalWidth * scale) / 2, (-img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
  return c;
}

/**
 * Opens the dialog for the image at `url` (`src` as the content writes it, for the new file's name). Resolves with
 * the edited file, or null when cancelled.
 */
export async function editImage(url: string, src: string): Promise<{ file: File; name: string } | null> {
  let img: HTMLImageElement;
  try {
    img = await load(url);
  } catch (err) {
    alert((err as Error).message);
    return null;
  }
  const base = (src.split(/[?#]/)[0].split('/').pop() ?? 'image').replace(/\.[^.]*$/, '').replace(/-edited(-\d+)?$/, '') || 'image';
  const ext = (src.split(/[?#]/)[0].split('.').pop() ?? '').toLowerCase();
  const type = OUT_TYPES[ext] ?? 'image/png';
  const outExt = type.split('/')[1].replace('jpeg', 'jpg');

  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'ms-imgedit';
    back.innerHTML = `<div class="ms-imgedit__box" role="dialog" aria-modal="true" aria-label="Crop and rotate">
      <header class="ms-imgedit__head"><h2>Crop and rotate</h2><span class="ms-imgedit__size"></span></header>
      <div class="ms-imgedit__stage"><canvas></canvas><div class="ms-imgedit__crop" tabindex="0" aria-label="Crop area: drag to move, arrow keys to nudge">${HANDLES.map((h) => `<i data-h="${h}"></i>`).join('')}</div></div>
      <footer class="ms-imgedit__foot">
        <span class="ms-seg" role="group" aria-label="Aspect ratio">${ASPECTS.map(([l], i) => `<button type="button" data-aspect="${i}" aria-pressed="${i === 0}" class="ms-seg__btn${i === 0 ? " is-on" : ""}">${l}</button>`).join('')}</span>
        <button type="button" class="ms-btn" data-turn="-1" aria-label="Rotate left">${ic('undo', 15)}</button>
        <button type="button" class="ms-btn" data-turn="1" aria-label="Rotate right">${ic('redo', 15)}</button>
        <button type="button" class="ms-btn" data-reset>Reset</button>
        <span class="ms-imgedit__gap"></span>
        <button type="button" class="ms-btn" data-cancel>Cancel</button>
        <button type="button" class="ms-btn ms-btn--primary" data-apply>Save as a new image</button>
      </footer></div>`;
    document.body.append(back);
    const stage = back.querySelector<HTMLElement>('.ms-imgedit__stage')!;
    const canvas = back.querySelector('canvas')!;
    const cropEl = back.querySelector<HTMLElement>('.ms-imgedit__crop')!;
    const sizeEl = back.querySelector<HTMLElement>('.ms-imgedit__size')!;

    let turns = 0;
    let aspect: number | null = null;
    let W = 0;
    let H = 0;
    let scale = 1;
    let crop: Rect = { x: 0, y: 0, w: 0, h: 0 };

    const fitAspect = (r: Rect): Rect => {
      if (!aspect) return r;
      let w = r.w;
      let h = w / aspect;
      if (h > H) (h = H), (w = h * aspect);
      if (w > W) (w = W), (h = w / aspect);
      return clamp({ x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h });
    };
    const clamp = (r: Rect): Rect => {
      const w = Math.min(Math.max(r.w, MIN), W);
      const h = Math.min(Math.max(r.h, MIN), H);
      return { x: Math.min(Math.max(r.x, 0), W - w), y: Math.min(Math.max(r.y, 0), H - h), w, h };
    };
    const draw = () => {
      cropEl.style.cssText = `left:${crop.x * scale}px;top:${crop.y * scale}px;width:${crop.w * scale}px;height:${crop.h * scale}px`;
      sizeEl.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)} px`;
    };
    const layout = (keep = false) => {
      const side = turns % 2 === 1;
      W = side ? img.naturalHeight : img.naturalWidth;
      H = side ? img.naturalWidth : img.naturalHeight;
      const room = { w: Math.min(innerWidth - 120, 1000), h: innerHeight - 220 };
      scale = Math.min(room.w / W, room.h / H, 1);
      const shown = rotated(img, turns, scale);
      canvas.width = shown.width;
      canvas.height = shown.height;
      canvas.getContext('2d')!.drawImage(shown, 0, 0);
      stage.style.width = `${shown.width}px`;
      stage.style.height = `${shown.height}px`;
      if (!keep) crop = fitAspect({ x: 0, y: 0, w: W, h: H });
      draw();
    };
    layout();

    // dragging: move inside, size from a handle
    cropEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cropEl.setPointerCapture(e.pointerId);
      const h = (e.target as HTMLElement).dataset.h ?? '';
      const start = { ...crop };
      const sx = e.clientX;
      const sy = e.clientY;
      const move = (ev: PointerEvent) => {
        const dx = (ev.clientX - sx) / scale;
        const dy = (ev.clientY - sy) / scale;
        if (!h) return ((crop = clamp({ ...start, x: start.x + dx, y: start.y + dy })), draw());
        let { x, y, w, h: hh } = start;
        if (h.includes('w')) (x = Math.min(start.x + dx, start.x + start.w - MIN)), (w = start.w - (x - start.x));
        if (h.includes('e')) w = start.w + dx;
        if (h.includes('n')) (y = Math.min(start.y + dy, start.y + start.h - MIN)), (hh = start.h - (y - start.y));
        if (h.includes('s')) hh = start.h + dy;
        x = Math.max(x, 0);
        y = Math.max(y, 0);
        w = Math.min(Math.max(w, MIN), W - x);
        hh = Math.min(Math.max(hh, MIN), H - y);
        if (aspect) {
          // the dragged side leads; the other follows the ratio, anchored at the opposite side
          if (h === 'n' || h === 's') w = hh * aspect;
          else hh = w / aspect;
          if (x + w > W) (w = W - x), (hh = w / aspect);
          if (y + hh > H) (hh = H - y), (w = hh * aspect);
          if (h.includes('w')) x = start.x + start.w - w;
          if (h.includes('n')) y = start.y + start.h - hh;
        }
        crop = clamp({ x, y, w, h: hh });
        draw();
      };
      cropEl.addEventListener('pointermove', move);
      cropEl.addEventListener('pointerup', () => cropEl.removeEventListener('pointermove', move), { once: true });
    });
    cropEl.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      crop = clamp({ ...crop, x: crop.x + d[0], y: crop.y + d[1] });
      draw();
    });

    const close = (out: { file: File; name: string } | null) => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(out);
    };
    const save = () => {
      const full = rotated(img, turns);
      const out = document.createElement('canvas');
      out.width = Math.round(crop.w);
      out.height = Math.round(crop.h);
      out.getContext('2d')!.drawImage(full, Math.round(crop.x), Math.round(crop.y), out.width, out.height, 0, 0, out.width, out.height);
      out.toBlob(
        (blob) => {
          if (!blob) return alert('The edited image could not be made.');
          const name = `${base}-edited.${outExt}`;
          close({ file: new File([blob], name, { type: blob.type }), name });
        },
        type,
        0.9,
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close(null));
      else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) (e.preventDefault(), save());
    };
    document.addEventListener('keydown', onKey, true);

    back.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button');
      if (e.target === back) return close(null);
      if (!b) return;
      if (b.dataset.aspect) {
        aspect = ASPECTS[Number(b.dataset.aspect)][1];
        for (const x of back.querySelectorAll<HTMLButtonElement>('[data-aspect]')) {
          x.classList.toggle('is-on', x === b);
          x.setAttribute('aria-pressed', String(x === b));
        }
        crop = fitAspect(crop);
        draw();
      } else if (b.dataset.turn) {
        turns = (turns + Number(b.dataset.turn) + 4) % 4;
        layout();
      } else if ('reset' in b.dataset) {
        turns = 0;
        layout();
      } else if ('cancel' in b.dataset) close(null);
      else if ('apply' in b.dataset) save();
    });
    back.querySelector<HTMLButtonElement>('[data-apply]')!.focus();
  });
}
