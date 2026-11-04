// The right column's panels beside the Outline (side.ts): the SEO check (?side=seo), the "How do I…" guide
// (?side=help) and the Library (?side=library, reusable/panel.ts), made here with what they read from the open entry.
import type { Editor } from '@tiptap/core';
import type { AiEditor } from './ai/editor';
import type { Entry } from './api';
import { HelpPanel } from './help';
import type { PostSettings } from './post';
import { LibraryPanel } from './reusable/panel';
import { useEdits } from './reusable/save';
import * as router from './router';
import { SeoPanel } from './seo';
import type { SidePanels } from './side';
import type { SitePages } from './site-pages';

interface Deps {
  getEditor(): Editor | null;
  entry(): Entry | null;
  post: PostSettings;
  pages: SitePages;
  app: HTMLElement;
  unsaved(): boolean;
  /** the header follows (the nofollow marks) */
  renderHeader(): void;
  /** AI suggestions (the SEO check's title and description) */
  ai: AiEditor;
}

export function addSides(sides: SidePanels, $: <T extends HTMLElement = HTMLElement>(sel: string) => T, d: Deps) {
  const seo = new SeoPanel($('.ms-seo-panel'), $<HTMLButtonElement>('[data-seo]'), {
    getEditor: d.getEditor,
    entry: d.entry,
    edits: d.post.edits,
    title: () => d.post.title(),
    titleIsH1: () => d.app.querySelector('.ms-title')?.tagName === 'H1',
    page: (path) => {
      if (!d.pages.known) return undefined;
      const e = d.pages.at(path);
      return e ? { draft: e.status === 'draft' } : null;
    },
    unsaved: d.unsaved,
    openSettings: () => d.post.open(),
    onToggle: (open) => sides.toggled('seo', open),
    onNofollow: (on) => (router.go({ nofollow: on }), d.renderHeader()),
    ai: d.ai,
  });
  sides.add('seo', seo, $('[data-seo]'));
  const help = new HelpPanel($('.ms-help-panel'), { onToggle: (open) => sides.toggled('help', open), onState: (topic, hq) => router.go({ topic, hq }) });
  sides.add('help', help);
  useEdits(d.post.edits);
  const library = new LibraryPanel($('.ms-library-panel'), $<HTMLButtonElement>('[data-library]'), { getEditor: d.getEditor, onToggle: (open) => sides.toggled('library', open) });
  sides.add('library', library, $('[data-library]'));
  return { seo, help, library };
}
