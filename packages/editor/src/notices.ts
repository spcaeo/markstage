// What the Markstage server has to tell this person until they have seen it (docs/API.md "Notices"): a publish they
// started failed, a scheduled entry was held back as a draft, the server was down when one was due. A slim bar under
// the header shows the newest, with Open (its place in the editor), Seen, and "N more" (the Publishing screen, where
// all of them are). Asked again when the editor opens and when the writer goes somewhere else (at most every 20 s).
// Only with the server: `astro dev` keeps no notices.
import './styles/notices.css';
import { request } from './api';
import { localTimes } from './dates';
import { ic } from './icons';

interface Notice {
  id: string;
  at: string;
  kind: string;
  level: 'error' | 'warn' | 'info';
  text: string;
  link: string | null;
}

const EVERY = 20_000;

export class NoticesBar {
  readonly el = document.createElement('div');
  private asked = 0;
  private items: Notice[] = [];

  constructor(after: HTMLElement) {
    this.el.className = 'ms-notices';
    this.el.setAttribute('role', 'status');
    this.el.hidden = true;
    after.after(this.el);
    void this.refresh(true);
  }

  /** Asks the server again (not more than every 20 s unless `now`). */
  async refresh(now = false): Promise<void> {
    if (!now && Date.now() - this.asked < EVERY) return;
    this.asked = Date.now();
    try {
      this.items = (await request<{ items: Notice[] }>('notices')).items ?? [];
    } catch {
      // the bar waits for the next ask; nothing else depends on it
      return;
    }
    this.draw();
  }

  private async seen(id: string | null): Promise<void> {
    this.items = id ? this.items.filter((n) => n.id !== id) : [];
    this.draw();
    const path = id ? `notices/${encodeURIComponent(id)}/seen` : 'notices/seen';
    await request(path, { method: 'POST', body: '{}' }).catch(() => void this.refresh(true));
  }

  /** every notice listed here, with the full words (QA F26, F40) */
  private expanded = false;

  private line(n: Notice, full: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ms-notices__row';
    row.dataset.level = n.level;
    const icon = document.createElement('span');
    icon.className = 'ms-notices__icon';
    icon.innerHTML = ic(n.level === 'info' ? 'info' : 'alert', 15);
    const text = document.createElement('span');
    text.className = `ms-notices__text${full ? ' is-full' : ''}`;
    text.textContent = localTimes(n.text);
    text.title = full ? '' : 'Click to read the whole message';
    if (!full) text.addEventListener('click', () => this.toggle());
    row.append(icon, text);
    if (n.link) {
      const open = document.createElement('a');
      open.className = 'ms-notices__link';
      open.href = n.link;
      open.textContent = 'Open';
      row.append(open);
    }
    const seen = document.createElement('button');
    seen.type = 'button';
    seen.className = 'ms-notices__link';
    seen.textContent = 'Seen';
    seen.setAttribute('aria-label', `Seen: ${localTimes(n.text)}`);
    seen.addEventListener('click', () => void this.seen(n.id));
    row.append(seen);
    return row;
  }

  private toggle(): void {
    this.expanded = !this.expanded;
    this.draw();
  }

  private draw(): void {
    const n = this.items[0];
    this.el.hidden = !n;
    this.el.replaceChildren();
    this.el.classList.toggle('is-open', this.expanded);
    if (!n) return;
    this.el.dataset.level = n.level;
    if (!this.expanded) {
      const row = this.line(n, false);
      if (this.items.length > 1) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'ms-notices__more';
        more.textContent = `and ${this.items.length - 1} more`;
        more.title = 'Show them all here';
        more.addEventListener('click', () => this.toggle());
        row.append(more);
      }
      this.el.append(row);
      return;
    }
    // every notice, full words, with one button to clear them all and one to fold the list again
    const list = document.createElement('div');
    list.className = 'ms-notices__list';
    for (const x of this.items) list.append(this.line(x, true));
    const tools = document.createElement('div');
    tools.className = 'ms-notices__tools';
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'ms-notices__link';
    all.textContent = this.items.length > 1 ? `Seen, all ${this.items.length}` : 'Seen';
    all.addEventListener('click', () => void this.seen(null));
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'ms-notices__more';
    fold.textContent = 'Fold';
    fold.addEventListener('click', () => this.toggle());
    tools.append(all, fold);
    this.el.append(list, tools);
  }
}
