// The editor's route table: what a change of the URL does (Back, Forward, a typed or linked address; the editor's
// own router.go() is not read back). The search follows k and q. A screen is shown over the open entry and leaves it
// as it was; leaving a screen with unsaved changes asks it first. Another entry: this one's unsaved changes are asked
// about first, and the URL stays until the writer chooses. Otherwise each param shows its state: the page's own
// params, the view, Post settings, the header's sides and find, the Library chooser, the screen check, the block.
import type { EntryPalette } from './palette';
import type { PageHost } from './page-host';
import type { ScreenHost } from './screen-host';
import * as router from './router';

export interface RouteDeps {
  palette: Pick<EntryPalette, 'open' | 'close'>;
  screens: Pick<ScreenHost, 'isDirty' | 'canLeave' | 'close' | 'show'>;
  pageHost: Pick<PageHost, 'paramsChanged'>;
  /** back on the editor from a screen */
  afterScreen(r: router.Route): void;
  isDirty(): boolean;
  /** asks about the unsaved changes; true when the writer saved or discarded them */
  canLeave(): Promise<boolean>;
  /** the writer chose (saved or discarded): the changes are not asked about again */
  letGo(): void;
  load(c: string, id: string, block: router.Route['block']): Promise<void>;
  /** nothing open (#/): the entry closes and Home shows */
  home(): void;
  setView(view: router.Route['view']): Promise<void>;
  settings(open: boolean): void;
  renderHeader(): void;
  library(key: string): void;
  closeChooser(): void;
  showDevice(): void;
  /** selects that top-level block on the canvas */
  selectBlock(block: number): void;
}

export function routeEditor(d: RouteDeps): void {
  router.onNavigate((next, prev) => {
    if (next.k && (!prev.k || next.q !== prev.q)) d.palette.open(next.q);
    else if (!next.k && prev.k) d.palette.close();
    // a screen: shown over the open entry, which stays as it was
    const sameScreen = next.screen?.name === prev.screen?.name && next.screen?.args.join('/') === prev.screen?.args.join('/');
    if (next.screen || prev.screen) {
      if (prev.screen && !sameScreen && d.screens.isDirty()) {
        void d.screens.canLeave().then((ok) => {
          if (!ok) return;
          d.screens.close();
          router.resume();
        });
        return false;
      }
      d.screens.show(next);
      if (next.screen) return;
      return d.afterScreen(next);
    }
    if (next.mode === 'p' && JSON.stringify(next.extra) !== JSON.stringify(prev.extra) && next.id === prev.id) d.pageHost.paramsChanged(next.extra);
    if (next.id !== prev.id || next.collection !== prev.collection) {
      if (d.isDirty()) {
        // ask first; the URL stays on this entry until the writer chooses
        void d.canLeave().then((ok) => {
          if (!ok) return;
          // discarded or saved: do not ask again, then make the move that was asked about
          d.letGo();
          router.resume();
        });
        return false;
      }
      if (next.collection && next.id) void d.load(next.collection, next.id, next.block);
      else d.home();
      return;
    }
    if (next.view !== prev.view) {
      void d.setView(next.view);
      return;
    }
    if (next.settings !== prev.settings) d.settings(next.settings);
    if (next.side !== prev.side || next.nofollow !== prev.nofollow || next.topic !== prev.topic || next.hq !== prev.hq || JSON.stringify(next.find) !== JSON.stringify(prev.find)) d.renderHeader();
    if (next.lib && next.lib !== prev.lib) d.library(next.lib);
    if (prev.lib && !next.lib) d.closeChooser();
    if (next.device !== prev.device || next.landscape !== prev.landscape || next.region !== prev.region || next.theme !== prev.theme) d.showDevice();
    if (next.block !== null && next.block !== prev.block) d.selectBlock(next.block);
  });
}
