// The editor's keys, window-wide: ⌘S saves, before anything else has its say; then, after the canvas and the menus
// had theirs (the canvas takes ⌘K for a link on selected text, a menu its own Esc): ⌘K opens or closes the search,
// ⌘F / ⌥⌘F the find bar in the article, ? the "How do I…" guide (not in text), and Esc closes the open side panel.
// Leaving the page with unsaved changes asks the browser's question.
import { publishFirst } from './publish-first';
import type { EntryPalette } from './palette';
import type { FindBar } from './find';
import type { HelpPanel } from './help';
import { typing } from './help';
import * as router from './router';

interface Closable {
  readonly isOpen: boolean;
  close(): void;
}

export interface ShortcutDeps {
  /** the editor's save; its outcome when it has one (false: it failed, the error shows) */
  save(): void | Promise<boolean>;
  palette: Pick<EntryPalette, 'isOpen' | 'open' | 'close'>;
  find: Pick<FindBar, 'open'>;
  /** ⌘F applies: an article is open on the canvas, with no screen over it */
  findable(): boolean;
  help: Pick<HelpPanel, 'isOpen' | 'open' | 'close' | 'sync'>;
  /** the guide has room beside the canvas */
  helpFits(): boolean;
  /** the block panel; `closed` re-places the floating tools after it */
  panel: Closable;
  closed(): void;
  post: Closable;
  /** the screen check's stage, and how to close the check */
  devices: Pick<Closable, 'isOpen'>;
  closeCheck(): void;
  isDirty(): boolean;
}

export function wireShortcuts(d: ShortcutDeps): void {
  // the top bar's Publish: the sheet publishes the saved version, so anything unsaved is saved first (publish-first.ts)
  const publish = document.querySelector<HTMLAnchorElement>('[data-publish]');
  publish?.addEventListener('click', (e) => {
    e.preventDefault();
    const to = (publish.getAttribute('href') ?? '').replace(/^#/, '');
    void publishFirst({ dirty: d.isDirty, save: d.save, open: () => void (location.hash = to) });
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        d.save();
      }
    },
    true,
  );
  // after the editor had its say (it takes ⌘K for links when text is selected, and menus take their own Esc)
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (d.palette.isOpen) d.palette.close();
      else d.palette.open();
    } else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyF' && d.findable()) {
      // ⌘F finds in the article (⌥⌘F with Replace), wherever the focus is
      e.preventDefault();
      d.find.open(e.altKey);
    } else if (e.key === '?' && !e.metaKey && !e.ctrlKey && !typing(e.target) && d.helpFits()) {
      // ? anywhere but in text: the "How do I…" guide, at the list of keyboard shortcuts (QA F25)
      e.preventDefault();
      if (d.help.isOpen) d.help.close();
      else {
        d.help.open();
        router.go({ side: 'help', topic: 'shortcuts', hq: '' });
        d.help.sync('shortcuts', '');
      }
    } else if (e.key === 'Escape' && d.panel.isOpen && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      d.panel.close();
      d.closed();
    } else if (e.key === 'Escape' && d.post.isOpen && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      d.post.close();
    } else if (e.key === 'Escape' && d.devices.isOpen && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      d.closeCheck();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (d.isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
