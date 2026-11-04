// Images into the site: the media API (docs/API.md "Media") and the uploads still running. While a file uploads,
// its image shows a temporary blob: URL; when the server answers, every image with that URL gets the path the
// content writes (relative to the entry's file, as the site's other images are). Saving waits for running uploads.
import { request } from './api';
import { contentSrc } from './assets';

export interface Media {
  id: string;
  filename: string;
  /** repo path, e.g. src/assets/uploads/2026/10/chart.webp */
  path: string;
  url: string;
  type: string;
  width: number | null;
  height: number | null;
  bytes: number;
  alt: string;
  uploadedBy: string;
  uploadedAt: string;
}

/** What the media API accepts (it checks the bytes again). */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
export const isImageFile = (f: Blob) => IMAGE_TYPES.includes(f.type);
const MAX_BYTES = 10 * 1024 * 1024;

export function uploadMedia(file: Blob, filename: string): Promise<Media> {
  return request<Media>(`media?filename=${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
}

const running = new Map<string, Promise<string>>();
const finished = new Map<string, string>();

export const isTemp = (src: string | null | undefined) => !!src && src.startsWith('blob:');
/** The content path an upload's temporary URL became (undo and redo may bring the temporary one back). */
export const finalSrc = (src: string) => finished.get(src) ?? src;
export const uploading = () => running.size > 0;
/** Resolves when every running upload has finished (or failed). */
export const settled = () => Promise.allSettled([...running.values()]).then(() => undefined);

/**
 * Starts uploading `file`: `temp` is a URL to show at once, `done` the src to write (rejects with a message the
 * writer can read). Files that are not images, or larger than 10 MB, are refused before sending.
 */
export function startUpload(file: File, name = file.name || 'image'): { temp: string; done: Promise<string> } {
  const temp = URL.createObjectURL(file);
  const done = (async () => {
    if (!isImageFile(file)) throw new Error(`“${name}” is not an image the site takes (JPEG, PNG, GIF, WebP or AVIF).`);
    if (file.size > MAX_BYTES) throw new Error(`“${name}” is larger than 10 MB.`);
    const m = await uploadMedia(file, name);
    const src = contentSrc(m.path);
    finished.set(temp, src);
    return src;
  })();
  running.set(temp, done);
  void done.catch(() => {}).finally(() => running.delete(temp));
  return { temp, done };
}

/** Opens the file chooser for images; resolves with the chosen files (none when cancelled). */
export function pickImages(multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: IMAGE_TYPES.join(','), multiple });
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

/** The image files in a paste or a drop. */
export const imageFiles = (data: DataTransfer | null): File[] => [...(data?.files ?? [])].filter(isImageFile);
