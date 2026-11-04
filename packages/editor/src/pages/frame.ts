// The real page in a frame, drawn in editor mode (its fields carry data-ms-* bindings), and the editor's side of
// the page agent's messages (agent.ts). The page runs the preview agent (the preview server adds it; in dev the
// Astro integration does): when it says 'ready' or 'rendered' the editor greets the page agent ('page:hello') and
// it answers 'page:ready'. Messages are taken only from this frame's window and origin, and sent only to that origin.
// That proves where a message came from, not that the page agent sent it: any script on the page can send them. So
// the editor takes only fields its own schema has (frame-fields.ts), and the page's "⌘S" never saves (index.ts).
import type { BoundField, FromPage, SectionRect, ToPage } from './types';

export interface FrameEvents {
  ready: (fields: BoundField[], sections: number[]) => void;
  edit: (path: string, value: string) => void;
  pick: (path: string, kind: BoundField['kind']) => void;
  section: (index: number) => void;
  editing: (on: boolean) => void;
  /** ⌘S pressed on the page (unproven: any script on the page can say it), so the editor never saves on it */
  save: () => void;
  stale: () => void;
  /** where the sections are drawn (while a Library drag is over the page) */
  rects: (rects: SectionRect[], height: number) => void;
  /** the page has rendered (the preview agent's 'ready' or 'rendered'), before the page agent answers */
  shown?: () => void;
  /** the preview's own expired page is in the frame (preview-enter 403): a fresh preview URL is needed */
  expired?: () => void;
}

export class PageFrame {
  readonly el: HTMLIFrameElement;
  private origin = '';
  private url = '';
  private onMessage = (e: MessageEvent) => {
    if (e.source !== this.el.contentWindow || e.origin !== this.origin) return;
    const msg = e.data as FromPage | { markstage: 'ready' | 'rendered' | 'preview-expired' } | null;
    if (!msg || typeof msg !== 'object' || typeof msg.markstage !== 'string') return;
    if (msg.markstage === 'ready' || msg.markstage === 'rendered') {
      this.events.shown?.();
      this.post({ markstage: 'page:hello' });
    } else if (msg.markstage === 'preview-expired') this.events.expired?.();
    else if (msg.markstage === 'page:ready' && Array.isArray(msg.fields)) this.events.ready(msg.fields.filter(validField), (msg.sections ?? []).filter(Number.isInteger));
    else if (msg.markstage === 'page:edit' && typeof msg.path === 'string' && typeof msg.value === 'string') this.events.edit(msg.path, msg.value);
    else if (msg.markstage === 'page:pick' && typeof msg.path === 'string') this.events.pick(msg.path, msg.kind);
    else if (msg.markstage === 'page:section' && Number.isInteger(msg.index)) this.events.section(msg.index);
    else if (msg.markstage === 'page:editing') this.events.editing(msg.on === true);
    else if (msg.markstage === 'page:key' && msg.key === 's') this.events.save();
    else if (msg.markstage === 'page:stale') this.events.stale();
    else if (msg.markstage === 'page:rects' && Array.isArray(msg.rects)) this.events.rects(msg.rects.filter(validRect), Number(msg.height) || 0);
  };

  constructor(
    host: HTMLElement,
    private events: FrameEvents,
  ) {
    this.el = document.createElement('iframe');
    this.el.className = 'msp-frame';
    this.el.title = 'The page, editable';
    // the agent may have said 'ready' before this frame's listener knew its origin
    this.el.addEventListener('load', () => this.post({ markstage: 'page:hello' }));
    host.append(this.el);
    window.addEventListener('message', this.onMessage);
  }

  open(url: string): void {
    this.url = url;
    this.origin = new URL(url, location.href).origin;
    this.el.src = url;
  }

  /** Draws the page again (after a save, the site renders the new file). */
  reload(): void {
    if (this.url) this.el.src = this.url;
  }

  post(msg: ToPage): void {
    if (this.origin) this.el.contentWindow?.postMessage(msg, this.origin);
  }

  destroy(): void {
    this.post({ markstage: 'page:off' });
    window.removeEventListener('message', this.onMessage);
    this.el.remove();
  }
}

const KINDS = new Set(['text', 'rich', 'image', 'link', 'list']);
function validField(f: unknown): f is BoundField {
  const x = f as BoundField;
  return !!x && typeof x.path === 'string' && /^[A-Za-z0-9_.-]{1,300}$/.test(x.path) && KINDS.has(x.kind);
}
const validRect = (r: unknown): r is SectionRect => {
  const x = r as SectionRect;
  const side = (v: unknown) => v === undefined || Number.isFinite(v);
  return !!x && Number.isInteger(x.index) && x.index >= 0 && Number.isFinite(x.top) && Number.isFinite(x.bottom) && x.bottom >= x.top && side(x.left) && side(x.right);
};
