// The device check (?device=…): the real page, as the site draws it, in a frame at a phone's, a tablet's or a
// desktop's width (or one the writer types), turned sideways if asked, scaled down to fit the window. The checks
// (measure.ts) run on the page each time it loads or the screen changes and list what does not fit (checks.ts).
// The editor never reads the frame: the page's agent (agent.ts) measures it and answers by postMessage, read only
// from the frame's own window and origin. One path for a production preview on its own origin and for dev.
import { copyable } from '../copy';
import { ic } from '../icons';
import { ChecksPanel } from './checks';
import { canRotate, clampWidth, MAX_WIDTH, MIN_WIDTH, PRESETS, screenOf, type Screen } from './devices';
import type { LocaleInfo, SiteTheme } from '../runtime';
import type { Measured } from './measure';
import { RegionRow } from './region';
import type { SpellingChange } from './spelling';

export interface StageOpts {
  /** the writer picked another screen (the URL follows) */
  onScreen: (device: string, landscape: boolean) => void;
  /** back to editing */
  onClose: () => void;
  /** the writer picked another locale */
  onRegion: (code: string) => void;
  /** the writer turned the site's dark scheme on or off */
  onTheme: (dark: boolean) => void;
}

const PAD = 24;

export class DeviceStage {
  readonly checks: ChecksPanel;
  private frame: HTMLIFrameElement;
  private box: HTMLElement;
  private stage: HTMLElement;
  private size: HTMLElement;
  private note: HTMLElement;
  private urlSlot: HTMLElement;
  private width: HTMLInputElement;
  private rotate: HTMLButtonElement;
  private screen: Screen | null = null;
  private device = '';
  private landscape = false;
  private src = '';
  private run = 0;
  private timer = 0;
  private region: RegionRow;
  /** the words the shown locale respells (as it spells them), highlighted in the page */
  private words: string[] = [];
  private themeSeg: HTMLElement;
  /** the site's dark scheme, shown on the page when `dark` (sent again each time the page loads) */
  private siteTheme: SiteTheme | null = null;
  private dark = false;

  constructor(
    readonly el: HTMLElement,
    checksEl: HTMLElement,
    private o: StageOpts,
  ) {
    el.innerHTML = `
      <div class="ms-devbar">
        <div class="ms-seg ms-devbar__presets" role="radiogroup" aria-label="Screen">${PRESETS.map(
          (p) => `<button type="button" class="ms-seg__btn" role="radio" data-device="${p.id}" title="${p.label}, ${p.width} px wide">${ic(p.icon, 14)}<span>${p.label}</span><small>${p.width}</small></button>`,
        ).join('')}</div>
        <label class="ms-devbar__custom" title="Any width from ${MIN_WIDTH} to ${MAX_WIDTH} px">Width <input class="ms-input" type="number" min="${MIN_WIDTH}" max="${MAX_WIDTH}" step="1" inputmode="numeric" aria-label="Screen width in pixels"> px</label>
        <button type="button" class="ms-iconbtn ms-iconbtn--lg" data-rotate aria-pressed="false">${ic('rotate', 16)}</button>
        <div class="ms-seg ms-devbar__theme" role="radiogroup" aria-label="The site's colours">
          <button type="button" class="ms-seg__btn" role="radio" data-theme="light" aria-label="Light">${ic('sun', 14)}</button>
          <button type="button" class="ms-seg__btn" role="radio" data-theme="dark" aria-label="Dark">${ic('moon', 14)}</button>
        </div>
        <span class="ms-devbar__size"></span>
        <span class="ms-devbar__url"></span>
        <span class="ms-devbar__note" hidden></span>
        <button type="button" class="ms-btn ms-devbar__done" data-done>Back to editing <kbd>Esc</kbd></button>
      </div>
      <div class="ms-devstage"><div class="ms-devframe"><iframe title="The page"></iframe></div></div>`;
    const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
    this.frame = q('iframe');
    this.box = q('.ms-devframe');
    this.stage = q('.ms-devstage');
    this.size = q('.ms-devbar__size');
    this.note = q('.ms-devbar__note');
    this.urlSlot = q('.ms-devbar__url');
    this.width = q('.ms-devbar__custom input');
    this.rotate = q('[data-rotate]');
    this.themeSeg = q('.ms-devbar__theme');
    this.themeSeg.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('[data-theme]');
      if (b && this.siteTheme && b.getAttribute('aria-disabled') !== 'true') o.onTheme(b.dataset.theme === 'dark');
    });
    this.region = new RegionRow((code) => o.onRegion(code));
    this.note.before(this.region.el);
    this.checks = new ChecksPanel(checksEl, {
      onReveal: (id) => this.reveal(id),
      onWord: (word) => this.src && this.frame.contentWindow?.postMessage({ markstage: 'reveal-word', word }, this.origin()),
      onRerun: () => this.check(),
      onClose: () => o.onClose(),
    });
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-device]')) b.addEventListener('click', () => o.onScreen(b.dataset.device!, this.landscape));
    this.width.addEventListener('change', () => {
      const n = Number(this.width.value);
      if (Number.isFinite(n) && n > 0) o.onScreen(String(clampWidth(n)), false);
    });
    this.width.addEventListener('keydown', (e) => e.key === 'Enter' && this.width.dispatchEvent(new Event('change')));
    this.rotate.addEventListener('click', () => canRotate(this.device) && o.onScreen(this.device, !this.landscape));
    q('[data-done]').addEventListener('click', () => o.onClose());
    // the agent says when the page is drawn ('rendered'); a page without it still gets a check (that says so)
    this.frame.addEventListener('load', () => this.later(1500));
    new ResizeObserver(() => this.fit()).observe(this.stage);
    window.addEventListener('message', (e) => this.answer(e));
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Shows `url` on the screen `device` (a preset or a width). */
  show(device: string, landscape: boolean, url: string): void {
    const first = this.el.hidden;
    this.el.hidden = false;
    this.checks.show(true);
    const changed = device !== this.device || landscape !== this.landscape;
    this.device = device;
    this.landscape = landscape;
    this.screen = screenOf(device, landscape);
    const s = this.screen;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-device]')) {
      const on = b.dataset.device === s.preset;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
    if (document.activeElement !== this.width) this.width.value = String(s.width);
    this.width.closest('label')!.classList.toggle('is-on', !s.preset);
    const turn = canRotate(device);
    this.rotate.disabled = !turn;
    this.rotate.setAttribute('aria-pressed', String(s.landscape));
    this.rotate.title = this.rotate.ariaLabel = turn ? (s.landscape ? 'Turn upright' : 'Turn sideways') : 'Only a tablet or a phone turns';
    this.frame.style.width = `${s.width}px`;
    this.frame.style.height = `${s.height}px`;
    this.frame.title = `The page at ${s.width} px`;
    this.checks.setWidth(s.width);
    this.fit();
    if (url !== this.src) {
      this.run++;
      this.src = url;
      this.checks.message('Loading the page…', true);
      this.frame.src = url;
      const path = new URL(url).pathname;
      this.urlSlot.replaceChildren(copyable(path, { label: 'page URL', copy: url, open: url, className: 'ms-copyable--url' }));
    } else if (changed || first) {
      this.run++; // a check of the screen before is no longer wanted
      this.checks.message('Checking…', true);
      this.later(450);
    }
  }

  hide(): void {
    this.el.hidden = true;
    this.checks.show(false);
    this.run++;
    clearTimeout(this.timer);
  }

  /** Forgets the page (another entry opens): the next show() loads it again. */
  reset(): void {
    this.src = '';
    this.frame.removeAttribute('src');
  }

  /** The line under the bar: why the frame may not show what the canvas shows. */
  setNote(text: string | null): void {
    this.note.hidden = !text;
    this.note.textContent = text ?? '';
  }

  /** Scales the screen down until it fits the space (never up). */
  private fit(): void {
    const s = this.screen;
    if (!s || this.el.hidden) return;
    const w = this.stage.clientWidth - PAD * 2;
    const hgt = this.stage.clientHeight - PAD * 2;
    const k = Math.max(0.1, Math.min(1, w / s.width, hgt / s.height));
    this.frame.style.transform = `scale(${k})`;
    this.box.style.width = `${Math.floor(s.width * k)}px`;
    this.box.style.height = `${Math.floor(s.height * k)}px`;
    this.size.textContent = `${s.width} × ${s.height}${k < 1 ? ` · ${Math.round(k * 100)}%` : ''}`;
  }

  /** The frame page's origin: the only one whose messages are read, and the only one written to. */
  private origin(): string {
    return new URL(this.src).origin;
  }

  private later(ms: number): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.check(), ms);
  }

  /** Asks the page's agent to check the page as it is now; its answer comes to answer(). */
  check(): void {
    if (this.el.hidden || !this.src) return;
    const run = ++this.run;
    this.checks.message('Checking…', true);
    this.frame.contentWindow?.postMessage({ markstage: 'measure', run }, this.origin());
    // the agent waits up to 2.5 s for images and fonts; no answer after that means the page has no agent
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => run === this.run && this.checks.message('The checks cannot reach this page.'), 6000);
  }

  private answer(e: MessageEvent): void {
    if (!this.src || e.source !== this.frame.contentWindow || e.origin !== this.origin()) return;
    const msg = e.data as { markstage?: string; run?: number; result?: Measured } | null;
    if (msg?.markstage === 'ready') {
      this.mark();
      this.paint();
    } else if (msg?.markstage === 'rendered') {
      this.mark();
      this.paint();
      this.later(150);
    } else if (msg?.markstage === 'measured' && msg.run === this.run && msg.result) {
      clearTimeout(this.timer);
      this.checks.render(msg.result);
    }
  }

  /** The Region row and, for a locale that respells the text, its changes (listed, and highlighted in the page). */
  setRegion(list: LocaleInfo[], current: string, respelled: LocaleInfo | null, changes: SpellingChange[]): void {
    this.region.set(list, current);
    this.region.spelling(respelled, changes.reduce((n, c) => n + c.count, 0));
    this.checks.spelling(respelled ? `${respelled.variety ?? respelled.label} spelling` : null, changes);
    const words = respelled ? changes.map((c) => c.to) : [];
    if (words.join('\n') === this.words.join('\n')) return;
    this.words = words;
    this.mark();
  }

  /** The theme switch: the site's dark scheme on the page (`site` null: the site has none, the switch is greyed). */
  setTheme(site: SiteTheme | null, dark: boolean): void {
    const changed = dark !== this.dark;
    this.siteTheme = site;
    this.dark = !!site && dark;
    for (const b of this.themeSeg.querySelectorAll<HTMLButtonElement>('[data-theme]')) {
      const on = (b.dataset.theme === 'dark') === this.dark;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-disabled', String(!site));
      b.title = !site ? 'This site has no dark mode' : b.dataset.theme === 'dark' ? 'The page in the site’s dark colours' : 'The page in the site’s light colours';
    }
    this.themeSeg.classList.toggle('is-disabled', !site);
    this.themeSeg.title = site ? '' : 'This site has no dark mode';
    if (changed && site) {
      this.paint();
      // the checks again: contrast and sizes may differ in the other scheme
      this.later(300);
    }
  }

  private paint(): void {
    const t = this.siteTheme;
    if (this.src && t) this.frame.contentWindow?.postMessage({ markstage: 'theme', attr: t.attr, value: t.value, on: this.dark }, this.origin());
  }

  private mark(): void {
    if (this.src) this.frame.contentWindow?.postMessage({ markstage: 'mark', words: this.words }, this.origin());
  }

  private reveal(id: number): void {
    if (this.src) this.frame.contentWindow?.postMessage({ markstage: 'reveal', id }, this.origin());
  }
}
