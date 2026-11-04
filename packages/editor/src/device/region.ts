// The Region row of the screen check (?region=): one button per locale of the site, so the writer sees the page as
// each locale renders it; next to it, what the canvas holds ("Editing the source text (US spelling)"), and for a
// locale that respells the text, how many changes it makes (highlighted in the page, listed in the checks).
import type { LocaleInfo } from '../runtime';

export class RegionRow {
  readonly el: HTMLElement;
  private seg: HTMLElement;
  private hint: HTMLElement;
  private note: HTMLElement;

  constructor(onRegion: (code: string) => void) {
    this.el = document.createElement('div');
    this.el.className = 'ms-devbar__region';
    this.el.hidden = true;
    this.el.innerHTML = `<span class="ms-devbar__label" id="ms-region-label">Region</span><div class="ms-seg" role="radiogroup" aria-labelledby="ms-region-label"></div><span class="ms-devbar__hint"></span><span class="ms-devbar__spell" hidden></span>`;
    this.seg = this.el.querySelector('.ms-seg')!;
    this.hint = this.el.querySelector('.ms-devbar__hint')!;
    this.note = this.el.querySelector('.ms-devbar__spell')!;
    this.seg.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('[data-region]');
      if (b) onRegion(b.dataset.region!);
    });
  }

  /** Draws the switch (hidden for a site with fewer than two locales). */
  set(list: LocaleInfo[], current: string): void {
    this.el.hidden = list.length < 2;
    if (this.el.hidden) return;
    if (this.seg.childElementCount !== list.length) {
      this.seg.replaceChildren(
        ...list.map((l) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'ms-seg__btn';
          b.setAttribute('role', 'radio');
          b.dataset.region = l.code;
          b.title = `The page as ${l.label} sees it (${l.prefix || '/'})`;
          b.innerHTML = '<span></span><small></small>';
          b.querySelector('span')!.textContent = l.label;
          b.querySelector('small')!.textContent = l.code;
          return b;
        }),
      );
    }
    for (const b of this.seg.querySelectorAll<HTMLButtonElement>('[data-region]')) {
      const on = b.dataset.region === current;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
    // the canvas holds the text as written: the locales that do not respell it show it unchanged
    const plain = list.find((l) => !l.hasSpelling && l.variety);
    this.hint.textContent = plain ? `Editing the source text (${plain.variety} spelling)` : 'Editing the source text';
    this.hint.title = list.some((l) => l.hasSpelling)
      ? `The canvas and the file hold one text. ${list
          .filter((l) => l.hasSpelling)
          .map((l) => `The ${l.label} site respells it when the site is built`)
          .join('; ')}.`
      : 'The canvas and the file hold one text, shown on every locale.';
  }

  /** The respelling note for the locale shown (null: it shows the text as written). */
  spelling(locale: LocaleInfo | null, changes: number): void {
    this.note.hidden = !locale;
    if (!locale) return;
    const site = `the ${locale.variety ?? locale.label} site`;
    this.note.textContent = changes ? `${changes} spelling change${changes === 1 ? '' : 's'} on ${site}, highlighted` : `No spelling changes on ${site}`;
  }
}
