// "How do I…" (More → How do I…, or ? anywhere but in text; ?side=help): a short guide in the right column. A
// search over the topics, each a task in a writer's words with a few steps and its keys; "Show me" points at the
// part of the screen it is about. The open topic is in the URL (topic=<id>), and so is the search (hq=).
import './styles/help.css';
import { copyable } from './copy';
import { TOPICS, type HelpTopic } from './help-topics';
import { ic } from './icons';
import { h } from './panel-form';

export interface HelpDeps {
  /** the writer opened or closed it (the URL follows) */
  onToggle(open: boolean): void;
  /** a topic opened or closed, or the search changed (the URL follows) */
  onState(topic: string | null, q: string): void;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export class HelpPanel {
  private list: HTMLElement;
  private search: HTMLInputElement;
  private topic: string | null = null;

  constructor(
    readonly el: HTMLElement,
    private d: HelpDeps,
  ) {
    el.innerHTML = `<header class="ms-panel__head"><h2 class="ms-panel__title">How do I…</h2><button type="button" class="ms-iconbtn ms-panel__close" aria-label="Close the guide (Esc)" title="Close the guide (Esc)">${ic('x', 16)}</button></header><div class="ms-panel__body ms-help"><input type="search" class="ms-input ms-help__q" placeholder="Search the guide" aria-label="Search the guide" /><div class="ms-help__list"></div></div>`;
    this.list = el.querySelector('.ms-help__list')!;
    this.search = el.querySelector('.ms-help__q')!;
    this.search.addEventListener('input', () => {
      this.draw();
      this.d.onState(this.topic, this.search.value);
    });
    el.querySelector('.ms-panel__close')!.addEventListener('click', () => this.close());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.stopPropagation();
        this.close();
      }
    });
    this.show(false);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  show(on: boolean): void {
    this.el.classList.toggle('is-open', on);
    this.el.inert = !on;
    this.el.setAttribute('aria-hidden', String(!on));
    if (on) this.draw();
  }

  open(): void {
    if (this.isOpen) return;
    this.show(true);
    this.d.onToggle(true);
    this.search.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.show(false);
    this.d.onToggle(false);
  }

  /** The URL's topic and search. */
  sync(topic: string | null, q: string): void {
    const t = TOPICS.some((x) => x.id === topic) ? topic : null;
    if (t === this.topic && q === this.search.value) return;
    this.topic = t;
    this.search.value = q;
    if (this.isOpen) this.draw();
  }

  private matches(): HelpTopic[] {
    const words = norm(this.search.value).split(/\s+/).filter(Boolean);
    return TOPICS.filter((t) => words.every((w) => norm(`${t.title} ${t.words} ${t.steps.join(' ')}`).includes(w)));
  }

  private draw(): void {
    this.list.replaceChildren();
    const found = this.matches();
    if (!found.length) this.list.append(Object.assign(h('p', 'ms-panel__note'), { textContent: 'Nothing in the guide matches. Try other words, or fewer.' }));
    for (const t of found) {
      const open = t.id === this.topic;
      const item = h('section', `ms-help__item${open ? ' is-open' : ''}`);
      const head = h('button', 'ms-help__head');
      head.type = 'button';
      head.setAttribute('aria-expanded', String(open));
      head.append(Object.assign(h('span'), { textContent: t.title }), h('span', 'ms-help__chev', ic('down', 13)));
      head.addEventListener('click', () => {
        this.topic = open ? null : t.id;
        this.draw();
        this.d.onState(this.topic, this.search.value);
        this.list.querySelector<HTMLElement>('.ms-help__item.is-open .ms-help__head')?.focus();
      });
      item.append(head);
      if (open) item.append(this.body(t));
      this.list.append(item);
    }
  }

  private body(t: HelpTopic): HTMLElement {
    const body = h('div', 'ms-help__body');
    const ol = h('ol', 'ms-help__steps');
    for (const s of t.steps) ol.append(Object.assign(h('li'), { textContent: s }));
    body.append(ol);
    if (t.keys?.length) {
      const keys = h('dl', 'ms-help__keys');
      for (const [k, what] of t.keys) {
        const dt = h('dt');
        dt.append(copyable(k, { label: 'keys' }));
        keys.append(dt, Object.assign(h('dd'), { textContent: what }));
      }
      body.append(keys);
    }
    const target = t.show ? document.querySelector<HTMLElement>(t.show) : null;
    if (target && target.offsetParent) {
      const b = h('button', 'ms-btn ms-btn--sm', `${ic('target', 13)}<span>Show me</span>`);
      b.type = 'button';
      b.addEventListener('click', () => spotlight(target));
      body.append(b);
    }
    return body;
  }
}

/** The key went to something the writer types in (where ? is just a character). */
export const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** A ring around `el` for a moment (it is scrolled into view first). */
export function spotlight(el: HTMLElement): void {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  el.classList.remove('ms-spot');
  void el.offsetWidth;
  el.classList.add('ms-spot');
  window.setTimeout(() => el.classList.remove('ms-spot'), 2600);
}
