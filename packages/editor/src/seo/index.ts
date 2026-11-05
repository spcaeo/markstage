// The SEO check (the header's SEO button, ?side=seo): in the right column, what search engines and social sites
// will see, while writing. From the text as it is now (unsaved changes too): the search result with Google's pixel
// widths, the focus keyphrase, the headings, the links, the images and the words. From the built page (the last
// saved version, seo/google.ts): what Google reads in its head and structured data, and the share image as each
// place cuts it. Every problem says what to do; a click on one shows its block in the text. "Suggest title and
// description" asks the AI for the search title and description (ai/editor.ts, ?suggest=seo), under the result, and
// "Suggest a fix" on a problem asks it for a fix of that one, shown as a diff under it (ai/fixes.ts, ?suggest=fix).
import '../styles/seo.css';
import { Extension, type Editor } from '@tiptap/core';
import { suggestButton } from '../ai/card';
import type { AiEditor } from '../ai/editor';
import type { SeoNow } from '../ai/fixes';
import { previewUrl, type Entry } from '../api';
import { copyable } from '../copy';
import { ic } from '../icons';
import { h } from '../panel-form';
import { Panel } from '../panel';
import { collection, imagesConfig, type SettingField } from '../runtime';
import { holds, type FrontmatterEdits } from '../settings/state';
import { undoKeys } from '../settings/undo-keys';
import { crumbs, drawGoogle, drawShare, live } from './built';
import { readBuilt, type BuiltPage } from './google';
import { titleIsH1 } from './h1';
import { headings, imageFindings, imagesOf, keyphrase, linkFindings, linksOf, wordCount, type Finding } from './text';
import { meter, note, rows, section, setCount, type FixHooks } from './view';
import { cutTo, DESCRIPTION_PX, descriptionWidth, TITLE_PX, titleWidth } from './width';

export interface SeoDeps {
  getEditor(): Editor | null;
  entry(): Entry | null;
  edits: FrontmatterEdits;
  /** the title as the writer sees it */
  title(): string;
  /** the canvas shows the title as the page's H1 */
  titleIsH1(): boolean;
  /** the site's page at `path` (null: none; undefined: the pages are not known yet) */
  page(path: string): { draft: boolean } | null | undefined;
  unsaved(): boolean;
  /** opens Post settings (to edit the search title and description) */
  openSettings(): void;
  /** the writer opened or closed it (the URL follows) */
  onToggle(open: boolean): void;
  /** the nofollow links are marked on the canvas, or not (the URL follows) */
  onNofollow(on: boolean): void;
  /** AI suggestions: the search title and description */
  ai?: AiEditor;
}

/** Under these widths a title or description is short (px): the meters turn amber, and a fix makes it fuller. */
const TITLE_SHORT = 280;
const DESCRIPTION_SHORT = 430;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? String(v[0] ?? '').trim() : '');

export class SeoPanel {
  private body: HTMLElement;
  private secs: Record<string, ReturnType<typeof section>> = {};
  private found: Record<string, Finding[]> = {};
  private summary: HTMLElement;
  private phrase: HTMLInputElement;
  private phraseOut: HTMLElement;
  private nofollow: HTMLInputElement;
  private timer = 0;
  private built: BuiltPage | null = null;
  private builtFor = '';
  private token = 0;
  private aiAsk: HTMLButtonElement | null = null;
  /** the page shows its title as its H1 (null: not known yet), as the headings were last read */
  private h1: boolean | null = null;

  constructor(
    readonly el: HTMLElement,
    private button: HTMLButtonElement,
    private d: SeoDeps,
  ) {
    el.innerHTML = `<header class="ms-panel__head"><h2 class="ms-panel__title">SEO</h2><div class="ms-checks__tools"><button type="button" class="ms-btn ms-btn--quiet" data-recheck title="Read the saved page again">Check again</button><button type="button" class="ms-iconbtn ms-panel__close" aria-label="Close the SEO check (Esc)" title="Close the SEO check (Esc)">${ic('x', 16)}</button></div></header><div class="ms-panel__body ms-seo"></div>`;
    this.body = el.querySelector('.ms-seo')!;
    this.summary = h('div', 'ms-seo-sum');
    this.body.append(this.summary);
    for (const [id, title] of [
      ['result', 'Search result'],
      ['keyphrase', 'Focus keyphrase'],
      ['headings', 'Headings'],
      ['links', 'Links'],
      ['images', 'Images'],
      ['words', 'Words'],
      ['google', 'What Google sees'],
      ['share', 'When shared'],
    ] as const) {
      this.secs[id] = section(id, title);
      this.body.append(this.secs[id].el);
    }
    // the keyphrase field and the nofollow switch stay while the rest is drawn again
    this.phrase = Object.assign(h('input', 'ms-input'), { type: 'text', placeholder: 'The words people search for', spellcheck: false });
    this.phrase.setAttribute('aria-label', 'Focus keyphrase');
    this.phrase.addEventListener('input', () => this.setPhrase(this.phrase.value));
    this.phraseOut = h('div', 'ms-seo-list');
    this.secs.keyphrase.body.append(this.phrase, this.phraseOut);
    const nf = h('label', 'ms-seo-switch');
    this.nofollow = Object.assign(h('input'), { type: 'checkbox' });
    nf.append(this.nofollow, document.createTextNode('Mark nofollow links in the text'));
    this.nofollow.addEventListener('change', () => this.d.onNofollow(this.nofollow.checked));
    this.secs.links.el.append(nf);
    el.querySelector('.ms-panel__close')!.addEventListener('click', () => this.close());
    el.querySelector('[data-recheck]')!.addEventListener('click', () => void this.readPage(true));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.stopPropagation();
        this.close();
        this.d.getEditor()?.view.focus();
      }
    });
    button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    d.edits.onChange(() => this.later());
    undoKeys(el, d.edits);
    this.show(false);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  /** Shows or hides it without telling the URL (it already says so). */
  show(on: boolean): void {
    this.el.classList.toggle('is-open', on);
    this.el.inert = !on;
    this.el.setAttribute('aria-hidden', String(!on));
    this.button.setAttribute('aria-pressed', String(on));
    if (on) {
      this.refresh();
      void this.readPage();
    }
  }

  open(): void {
    if (this.isOpen) return;
    this.show(true);
    this.d.onToggle(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.show(false);
    this.d.onToggle(false);
  }

  /** The URL's nofollow mark (nf=1): the switch follows it. */
  markNofollow(on: boolean): void {
    this.nofollow.checked = on;
  }

  /** Another entry opened: its built page is read when shown. */
  reset(): void {
    this.builtFor = '';
    this.built = null;
    if (this.isOpen) void this.readPage();
  }

  /** This entry was saved: its page is read again. The site takes a moment to build the change, so while the page
   *  reads as before it is read again, a second apart, a few times. */
  saved(): void {
    this.builtFor = '';
    if (this.isOpen) void this.readPage(false, 4);
  }

  extension() {
    const self = this;
    return Extension.create({
      name: 'seoCheck',
      onCreate: () => self.later(),
      onUpdate: () => self.later(),
    });
  }

  private later(): void {
    clearTimeout(this.timer);
    if (this.isOpen) this.timer = window.setTimeout(() => this.refresh(), 300);
  }

  private settings(): SettingField[] {
    const e = this.d.entry();
    return (e && collection(e.collection)?.settings) || [];
  }

  private field<T extends SettingField['type']>(type: T) {
    return this.settings().find((f) => f.type === type) as Extract<SettingField, { type: T }> | undefined;
  }

  private get(key?: string): string {
    return key ? str(this.d.edits.get(key)) : '';
  }

  /** The search title and description as Google gets them: the SEO fields, else the title and the excerpt. */
  private search(): { title: string; description: string } {
    const seo = this.field('seo');
    const excerpt = this.settings().find((f) => f.type === 'textarea' && /excerpt|summary|description/i.test(f.key));
    return { title: this.get(seo?.title) || this.d.title(), description: this.get(seo?.description) || this.get(excerpt && 'key' in excerpt ? excerpt.key : undefined) };
  }

  /** Where an accepted suggestion goes: the SEO fields; with none, the description goes to the excerpt. */
  private aiKeys(): { title?: string; description?: string } {
    const seo = this.field('seo');
    const excerpt = this.settings().find((f) => f.type === 'textarea' && /excerpt|summary|description/i.test(f.key));
    return { title: seo?.title, description: seo?.description ?? (excerpt && 'key' in excerpt ? excerpt.key : undefined) };
  }

  /** The search result now and where a fix goes (ai/fixes.ts): what the fix cards read when asked and accepted. */
  private seoNow = (): SeoNow => {
    const s = this.search();
    const tw = titleWidth(s.title);
    const dw = descriptionWidth(s.description);
    return {
      ...s,
      keys: this.aiKeys(),
      titleProblem: tw > TITLE_PX ? 'title-long' : tw < TITLE_SHORT ? 'title-short' : null,
      descriptionProblem: !s.description ? 'description-missing' : dw > DESCRIPTION_PX ? 'description-long' : dw < DESCRIPTION_SHORT ? 'description-short' : null,
      titleIsH1: this.h1,
    };
  };

  /** The rows' "Suggest a fix" and its card (none without AI in the editor). */
  private fixHooks(): FixHooks | undefined {
    const ai = this.d.ai;
    return ai && { offered: (id) => ai.fixOffered(id), ask: (id) => ai.fixAsk(id), card: (id) => ai.fix(id, this.seoNow), seen: [] };
  }

  /** Puts the caret in the block a finding is about, to fix it there (the URL says which block). */
  private go = (block: number) => {
    const editor = this.d.getEditor();
    if (!editor) return;
    editor.view.focus();
    Panel.selectBlock(editor, block);
  };

  /** Draws the sections that read the text again. */
  refresh(): void {
    clearTimeout(this.timer);
    const editor = this.d.getEditor();
    const entry = this.d.entry();
    if (!this.isOpen || !editor || !entry) return;
    const doc = editor.state.doc;
    const s = this.search();
    const fix = this.fixHooks();
    const keys = this.aiKeys();
    // the ask buttons and the cards are drawn again as they are: what had the focus in them keeps it (⌘Z there works)
    const focused = this.body.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;

    // the search result, cut where Google cuts it
    const r = this.secs.result;
    r.body.replaceChildren();
    const tw = titleWidth(s.title);
    const dw = descriptionWidth(s.description);
    const serp = h('div', 'ms-seo-serp');
    // the live address, as Google writes it (copy and open give the full one)
    const at = live(entry.url ?? '');
    serp.append(
      copyable(crumbs(entry.url ?? ''), { label: 'the live address', copy: at, open: at, className: 'ms-seo-serp__url' }),
      Object.assign(h('span', 'ms-seo-serp__title'), { textContent: cutTo(s.title, TITLE_PX, titleWidth) || 'No title' }),
      Object.assign(h('span', 'ms-seo-serp__desc'), { textContent: cutTo(s.description, DESCRIPTION_PX, descriptionWidth) || 'No description: Google writes one from the text.' }),
    );
    const t = meter('Title', tw, TITLE_PX, TITLE_SHORT);
    const de = meter('Description', dw, DESCRIPTION_PX, DESCRIPTION_SHORT);
    const result: Finding[] = [];
    // a fix sets the SEO field: none to set, no fix
    const tf = keys.title ? 'title' : undefined;
    const df = keys.description ? 'description' : undefined;
    if (t.level === 'error') result.push({ level: 'warn', text: `The title is ${tw - TITLE_PX} px too wide: Google cuts it (as above).`, fix: tf });
    if (t.level === 'warn') result.push({ level: 'warn', text: 'The title is short: there is room to say more of what the page offers.', fix: tf });
    if (!s.description) result.push({ level: 'warn', text: 'No meta description: Google picks words from the text.', fix: df });
    else if (de.level === 'error') result.push({ level: 'warn', text: `The description is ${dw - DESCRIPTION_PX} px too wide: Google cuts it.`, fix: df });
    else if (de.level === 'warn') result.push({ level: 'warn', text: 'The description is short: Google may write its own.', fix: df });
    const edit = Object.assign(h('button', 'ms-btn ms-btn--sm ms-btn--quiet'), { type: 'button', textContent: 'Edit in Post settings' });
    edit.addEventListener('click', () => this.d.openSettings());
    r.body.append(serp, t.el, de.el);
    rows(r.body, result, undefined, fix);
    const tools = h('div', 'ms-seo-tools');
    tools.append(edit);
    r.body.append(tools);
    const ai = this.d.ai;
    if (ai && (keys.title || keys.description)) {
      // the same button each time it is drawn: the card gives the focus back to it
      this.aiAsk ??= suggestButton('Suggest title and description', () => ai.seoAsk(), 'ms-btn--sm');
      tools.append(this.aiAsk);
      r.body.append(...ai.seo(keys));
    }
    this.found.result = result;

    // the focus keyphrase
    const kpKey = this.field('seo')?.keyphrase;
    this.secs.keyphrase.el.hidden = !kpKey;
    if (kpKey) {
      if (!holds(this.phrase)) this.phrase.value = this.get(kpKey);
      const kp = keyphrase({ phrase: this.phrase.value, searchTitle: s.title, title: this.d.title(), description: s.description, url: entry.url ?? '', doc });
      this.phraseOut.replaceChildren();
      if (!this.phrase.value.trim()) this.phraseOut.append(note('Type the words this page should be found for; the checks show where they appear.'));
      rows(this.phraseOut, kp, this.go);
      this.found.keyphrase = kp;
    } else this.found.keyphrase = [];

    // the headings, as an outline; the built page says whether the layout shows the title as the H1
    const own: string[] = [];
    doc.forEach((n) => void (n.type.name === 'heading' && n.attrs.level === 1 && own.push(n.textContent)));
    this.h1 = titleIsH1(this.built?.h1 ?? null, own, this.d.title(), this.d.titleIsH1());
    const hd = headings(doc, { text: this.d.title(), h1: this.h1 });
    const hs = this.secs.headings.body;
    hs.replaceChildren();
    rows(hs, hd.findings, this.go, fix);
    const tree = h('ol', 'ms-seo-tree');
    for (const x of hd.list) {
      const li = h('li', 'ms-seo-tree__item');
      li.dataset.level = String(x.level);
      const b = Object.assign(h('button', 'ms-seo-tree__go'), { type: 'button' });
      b.append(Object.assign(h('span', 'ms-seo-tree__lv'), { textContent: `H${x.level}` }), Object.assign(h('span'), { textContent: x.text || 'Empty heading' }));
      if (x.block === null) b.title = 'The title';
      b.addEventListener('click', () => (x.block === null ? document.querySelector<HTMLElement>('.ms-canvas .ms-title')?.focus() : this.go(x.block)));
      li.append(b);
      tree.append(li);
    }
    hs.append(tree);
    this.found.headings = hd.findings;

    // the links
    const links = linksOf(doc);
    const lf = linkFindings(links, this.d.page);
    const ls = this.secs.links.body;
    ls.replaceChildren();
    const nofollow = links.filter((l) => /\bnofollow\b/i.test(l.rel)).length;
    ls.append(
      note(
        `${links.filter((l) => l.kind === 'site').length} to pages of the site, ${links.filter((l) => l.kind === 'away').length} to other sites${nofollow ? `, ${nofollow} nofollow` : ''}${links.some((l) => l.target === '_blank') ? `, ${links.filter((l) => l.target === '_blank').length} open in a new tab` : ''}.`,
        'ms-seo-counts',
      ),
    );
    rows(ls, lf, this.go, fix);
    this.found.links = lf;

    // the images: their descriptions and names, and how big they are against how big they show
    const images = imagesOf(doc, imagesConfig().decorativeClass);
    const imf = [...imageFindings(images), ...this.measureImages(editor)];
    const is = this.secs.images.body;
    is.replaceChildren(note(images.length ? `${images.length} image${images.length === 1 ? '' : 's'} in the text.` : 'No images in the text.', 'ms-seo-counts'));
    rows(is, imf, this.go, fix);
    this.found.images = imf;

    // the words
    const n = wordCount(doc.textBetween(0, doc.content.size, ' ', ' '));
    const ws = this.secs.words.body;
    ws.replaceChildren(note(`${n.toLocaleString()} words, about ${Math.max(1, Math.round(n / 230))} min read.`, 'ms-seo-counts'));
    const wf: Finding[] = n < 300 ? [{ level: 'warn', text: 'Under 300 words: a short page rarely ranks for anything but its own name.' }] : [];
    rows(ws, wf);
    this.found.words = wf;
    this.counts();
    const again = focused && !focused.isConnected && focused.dataset.aiFix ? this.body.querySelector<HTMLElement>(`[data-ai-fix="${focused.dataset.aiFix}"]`) : focused;
    if (again?.isConnected && document.activeElement !== again) again.focus({ preventScroll: true });
    // a fix the URL asks for whose problem is not drawn (fixed already) closes
    if (fix) this.d.ai?.fixesShown(fix.seen);
  }

  /** Images much larger than they show, or heavy files (what the browser loaded for the canvas). */
  private measureImages(editor: Editor): Finding[] {
    const out: Finding[] = [];
    for (const img of editor.view.dom.querySelectorAll('img')) {
      if (!img.complete || !img.naturalWidth || !img.clientWidth) continue;
      let block: number | undefined;
      try {
        block = editor.state.doc.resolve(editor.view.posAtDOM(img, 0)).index(0);
      } catch {
        block = undefined;
      }
      const name = (img.getAttribute('src') ?? '').split('/').pop()?.split('?')[0] || 'An image';
      const shown = img.clientWidth;
      if (img.naturalWidth > shown * 2.5) out.push({ level: 'warn', text: `${name} is ${img.naturalWidth} px wide and shows at ${shown} px: a smaller file loads faster.`, block });
      const res = performance.getEntriesByName(img.currentSrc)[0] as PerformanceResourceTiming | undefined;
      const kb = res?.encodedBodySize ? Math.round(res.encodedBodySize / 1024) : 0;
      if (kb > 300) out.push({ level: 'warn', text: `${name} is ${kb} KB: over 300 KB slows the page. Save it as WebP or smaller.`, block });
    }
    return out;
  }

  private setPhrase(v: string): void {
    const key = this.field('seo')?.keyphrase;
    if (!key) return;
    const was = this.d.edits.get(key);
    // a list of keyphrases (Rank Math's): the first is the one checked here, the others stay
    this.d.edits.set(key, Array.isArray(was) ? (v.trim() ? [v.trim(), ...was.slice(1)] : was.slice(1)) : v.trim());
  }

  /** Reads the built page (once per entry and save, or when asked) and draws its sections. */
  private async readPage(force = false, retries = 0): Promise<void> {
    const e = this.d.entry();
    const g = this.secs.google;
    const sh = this.secs.share;
    if (!e?.url) {
      g.el.hidden = sh.el.hidden = true;
      return;
    }
    g.el.hidden = sh.el.hidden = false;
    const key = `${e.collection}/${e.id}@${e.version}`;
    const mine = ++this.token;
    if (force || this.builtFor !== key) {
      this.builtFor = key;
      const was = this.built ? JSON.stringify(this.built) : null;
      if (!this.built) g.body.replaceChildren(note('Reading the saved page…', 'is-busy'));
      try {
        const p = await previewUrl(e.collection, e.id, e.url);
        this.built = await readBuilt(p.url);
        if (retries && JSON.stringify(this.built) === was) window.setTimeout(() => mine === this.token && void this.readPage(true, retries - 1), 1000);
      } catch (err) {
        this.built = null;
        if (mine !== this.token) return;
        g.body.replaceChildren(note(`The page cannot be read: ${(err as Error).message}.`));
        this.found.google = [];
      }
    }
    if (mine !== this.token) return;
    // the headings again, now that the page says what its H1 is
    this.refresh();
    if (this.built) this.found.google = drawGoogle(g.body, this.built, e.url);
    if (this.d.unsaved()) g.body.prepend(note('Shows the last saved version. Save (⌘S) to see your changes here.', 'is-unsaved'));
    const cover = this.settings().find((f) => f.type === 'image');
    const social = this.field('social');
    const s = this.search();
    this.found.share = await drawShare(sh.body, this.built, {
      image: this.get(social?.image) || this.get(cover && 'key' in cover ? cover.key : undefined),
      title: this.get(social?.title) || s.title,
      description: this.get(social?.description) || s.description,
      focal: cover?.type === 'image' && cover.focal ? this.get(cover.focal) : '',
    });
    if (mine === this.token) this.counts();
  }

  /** Each section's count, and the summary at the top. */
  private counts(): void {
    let errors = 0;
    let warns = 0;
    for (const [id, s] of Object.entries(this.secs)) {
      const f = this.found[id] ?? [];
      setCount(s.count, f);
      errors += f.filter((x) => x.level === 'error').length;
      warns += f.filter((x) => x.level === 'warn').length;
    }
    this.summary.className = `ms-seo-sum${errors ? ' is-error' : warns ? ' is-warn' : ' is-ok'}`;
    this.summary.replaceChildren();
    this.summary.innerHTML = ic(errors ? 'alert' : warns ? 'info' : 'check', 16);
    const text = h('div');
    text.append(
      Object.assign(h('strong'), { textContent: errors || warns ? [errors && `${errors} to fix`, warns && `${warns} to look at`].filter(Boolean).join(', ') : 'Nothing to fix' }),
      Object.assign(h('span'), { textContent: errors ? 'Fix the red ones before publishing.' : 'Each one says what to do; a click shows it in the text.' }),
    );
    this.summary.append(text);
  }
}
