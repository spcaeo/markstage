// The canvas of an entry whose text the person may not change (read-only, or a role that changes some fields only:
// field-access.ts): no change reaches the document by any route (a block's settings, the toolbar, a drop, a paste, a
// recovered draft), not only typing, so a save never carries a text the server refuses.
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

export const BodyLock = Extension.create({
  name: 'msBodyLock',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ filterTransaction: (tr) => !tr.docChanged || editor.isEditable })];
  },
});
