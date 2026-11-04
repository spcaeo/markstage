// The blocks to keep in the Library (reusable/save.ts asks where), and putting a snippet in the article (the block
// menu's Snippets). A snippet is stored in the saved shape (transform.ts), like an entry,
// so the server checks its links the same way; on the way in it becomes the editor's shape again.
import type { Editor, JSONContent } from '@tiptap/core';
import { modalize } from '../shell';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { toast } from '../host';
import { toContract, toEditor } from '../transform';
import type { Snippet } from './api';

/** The top-level blocks `from`..`to` (indexes, both included) as a snippet document. */
export function blocksDoc(editor: Editor, from: number, to: number): JSONContent {
  const nodes = (editor.getJSON().content ?? []).slice(from, to + 1);
  return toContract({ type: 'doc', content: nodes });
}

/** A name asked for in a dialog (a folder's new name); null when cancelled. */
export function askName(title: string, text: string, start: string): Promise<string | null> {
  const dlg = document.createElement('dialog');
  dlg.className = 'ms-dialog ms-snipsave';
  dlg.innerHTML = `<h2></h2><p></p><label class="ms-snipsave__field"><span>Name</span><input class="ms-input" maxlength="100"></label><div class="ms-dialog__tools"><button type="button" class="ms-btn" value="cancel">Cancel</button><button type="button" class="ms-btn ms-btn--primary" value="ok">Rename</button></div>`;
  dlg.querySelector('h2')!.textContent = title;
  dlg.querySelector('p')!.textContent = text;
  const input = dlg.querySelector('input')!;
  input.value = start;
  return new Promise((done) => {
    let answer: string | null = null;
    const ok = () => ((answer = input.value.trim() || null), dlg.close());
    dlg.querySelector('[value=ok]')!.addEventListener('click', ok);
    dlg.querySelector('[value=cancel]')!.addEventListener('click', () => dlg.close());
    input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), ok()));
    dlg.addEventListener('close', () => (dlg.remove(), done(answer)));
    document.body.append(dlg);
    modalize(dlg);
    dlg.showModal();
    input.select();
  });
}

/** Puts a snippet's blocks at `from`..`to` (an empty line it replaces, or a point after a block). */
export function insertSnippet(editor: Editor, s: Pick<Snippet, 'name' | 'doc'>, from: number, to: number): boolean {
  const { state, view } = editor;
  let nodes;
  try {
    nodes = (toEditor(s.doc).content ?? []).map((n) => state.schema.nodeFromJSON(n));
  } catch {
    toast(`“${s.name}” has blocks this editor doesn't know.`, 'error');
    return false;
  }
  if (!nodes.length) return false;
  const tr = state.tr.replaceWith(from, to, Fragment.fromArray(nodes));
  const end = Math.min(from + nodes.reduce((a, n) => a + n.nodeSize, 0), tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}
