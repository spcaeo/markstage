// The screen check's glue (?device=…, landscape, region, theme): which page the frame shows (the preview's address,
// asked once per entry, page address and locale), the locale and the site theme the URL names, and the note when the
// frame does not have the writer's unsaved changes. The frame and its checks are device/stage.ts.
import { previewUrl, type Entry } from './api';
import { spellingChanges } from './device/spelling';
import { DeviceStage } from './device/stage';
import * as router from './router';
import type { ClientConfig } from './runtime';
import { editorDark, onEditorTheme } from './theme';

/** Off: every screen check param cleared. */
export const NO_SCREEN = { device: null, landscape: false, region: null, theme: null } as const;

export interface ScreenCheckDeps {
  entry(): Entry | null;
  inSource(): boolean;
  /** the entry's words as the writer sees them (title and body): the region's respellings are counted in them */
  text(): string;
  /** before the frame shows: the panels and menus over the canvas close */
  clear(): void;
  /** the frame is shown (`open`) or gone again: the view follows */
  shown(open: boolean): void;
  fail(message: string): void;
}

export class ScreenCheck {
  readonly stage: DeviceStage;
  /** the screen the button opens (the last one used) */
  private last = 'mobile';
  /** the frame follows unsaved changes (a preview server), or shows the saved file */
  private live = false;
  /** where the frame shows the open entry, asked once per entry, page address and locale */
  private framed: { key: string; url: string } | null = null;

  constructor(
    devicesEl: HTMLElement,
    checksEl: HTMLElement,
    private cfg: ClientConfig,
    private d: ScreenCheckDeps,
  ) {
    this.stage = new DeviceStage(devicesEl, checksEl, {
      onScreen: (device, landscape) => this.go({ device, landscape }),
      onClose: () => this.close(),
      // the page follows the editor's colours; a pick that differs from them is in the address (theme=light|dark)
      onTheme: (dark) => this.go({ theme: dark === editorDark() ? null : dark ? 'dark' : 'light' }),
      onRegion: (code) => {
        const l = cfg.locales?.list.find((x) => x.code === code);
        this.go({ region: !l || l.default ? null : code });
      },
    });
    // the editor's colours changed: a page that follows them follows
    onEditorTheme(() => this.isOpen && !router.route().theme && this.stage.setTheme(cfg.themes?.dark ?? null, editorDark()));
  }

  get isOpen(): boolean {
    return this.stage.isOpen;
  }

  private go(change: Partial<router.Route>): void {
    router.go(change);
    void this.show();
  }

  close(): void {
    this.go(NO_SCREEN);
  }

  /** The header's button: the last screen, or back to editing. */
  toggle(): void {
    this.go(router.route().device ? NO_SCREEN : { device: this.last });
  }

  /** Another entry opens: the next show() asks for its page. */
  reset(): void {
    this.stage.reset();
    this.framed = null;
  }

  /** The frame's note when it lacks the unsaved changes. */
  note(unsaved: boolean): void {
    this.stage.setNote(unsaved && !this.live ? 'Shows the last saved version. Save (⌘S) to see your changes here.' : null);
  }

  /** Shows the page on the URL's screen, or the canvas again. */
  async show(): Promise<void> {
    const r = router.route();
    const e = this.d.entry();
    if (!e?.url || !r.device || this.d.inSource()) {
      if (this.stage.isOpen) {
        this.stage.hide();
        this.d.shown(false);
      }
      return;
    }
    this.last = r.device;
    this.d.clear();
    // the locale shown: the URL's region, else the default one (none for a site without locales)
    const locales = this.cfg.locales?.list ?? [];
    const locale = locales.find((l) => l.code === r.region) ?? locales.find((l) => l.default) ?? null;
    if (r.region && locale?.code !== r.region) router.go({ region: null });
    try {
      const key = `${e.collection}/${e.id}${e.url}@${locale?.code ?? ''}`;
      if (this.framed?.key !== key) {
        const p = await previewUrl(e.collection, e.id, e.url, locale);
        this.framed = { key, url: p.url };
        this.live = p.live;
      }
      const now = router.route();
      if (this.d.entry() !== e || !now.device || this.d.inSource()) return;
      this.stage.show(now.device, now.landscape, this.framed.url);
      const dark = this.cfg.themes?.dark ?? null;
      this.stage.setTheme(dark, now.theme ? now.theme === 'dark' : editorDark());
      if (now.theme && !dark) router.go({ theme: null });
      if (locale) {
        const respelled = locale.spell ? locale : null;
        this.stage.setRegion(locales, locale.code, respelled, respelled?.spell ? spellingChanges(this.d.text(), respelled.spell) : []);
      }
      this.d.shown(true);
    } catch (err) {
      router.go(NO_SCREEN);
      this.d.fail(`The page cannot be shown: ${(err as Error).message}`);
    }
  }
}
