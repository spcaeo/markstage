// A Library section put on the page, one way for every place it comes from: the outline's picker (a click, Enter, a
// drag into the list), a drag onto the page itself (canvas-drop.ts) and Insert… (the list of places, by keyboard).
// The copy goes in as one undo step and the page is saved at once, so the site draws it where it landed. A save the
// server refuses (a lock, 423; the site's own check, 422; a synced copy changed in place, 409) takes the copy out
// again and says the server's words. Undo (the toast's) takes it out and saves, so the file is as it was, byte for
// byte; ⌘Z takes it out too, for the next save. A page whose layout is locked takes none, and says why first.
import { toast } from '../host';
import type { LibItem } from '../reusable/api';
import { copyOf } from './library';
import type { PageModel } from './model';
import { placeWords, layoutLock } from './places';

export interface PlaceCtx {
  model: PageModel;
  save: () => Promise<boolean>;
  /** the server's words for the save it just refused; null when it saved, or on a conflict (the writer chooses there) */
  refusal: () => string | null;
  select: (index: number | null) => void;
  /** the file as the server wrote it, taken in (what it stamps on a save, so Undo puts that back too) */
  refresh: () => Promise<void>;
  /** the picker and its list of places close */
  done: () => void;
  /** a section as the outline names it: "2. FAQ: Questions" */
  label: (index: number) => string;
}

/** The copy taken out again: the step undone when nothing came after it, else that section removed if still there. */
function takeOut(model: PageModel, index: number, value: unknown, after: string): boolean {
  if (JSON.stringify(model.data) === after) {
    model.undo();
    return true;
  }
  if (JSON.stringify(model.get(`sections.${index}`)) !== JSON.stringify(value)) return false;
  model.settle();
  model.change({ op: 'remove', path: `sections.${index}` });
  return true;
}

let busy = false;

/** A copy of `it` at `index` (between two sections), saved; false when it was not added. */
export async function place(c: PlaceCtx, it: LibItem, index: number): Promise<boolean> {
  const why = layoutLock(c.model);
  if (why) {
    toast(`“${it.name}” was not added. ${why}`, 'error');
    return false;
  }
  if (busy) return false;
  const m = c.model;
  m.settle();
  const where = placeWords(m, index, c.label);
  const value = copyOf(it);
  if (Array.isArray(m.get('sections'))) m.change({ op: 'insert', path: 'sections', index, value });
  else m.change({ op: 'set', path: 'sections', value: [value] });
  const after = JSON.stringify(m.data);
  c.done();
  c.select(index);
  busy = true;
  const ok = await c.save().finally(() => (busy = false));
  if (!ok) {
    const words = c.refusal();
    if (words === null) return false;
    if (takeOut(m, index, value, after)) c.select(null);
    toast(`“${it.name}” was not added: ${words}`, 'error');
    return false;
  }
  await c.refresh().catch(() => {});
  const saved = JSON.stringify(m.data);
  toast(`Added “${it.name}”${it.synced ? ' (synced)' : ''} ${where}.`, 'ok', {
    action: {
      label: 'Undo',
      run: () => {
        if (!takeOut(m, index, value, saved)) return void toast(`“${it.name}” is not where it was put any more: delete it from the Sections list.`, 'error');
        void c.save().then((done) => done && toast(`Took “${it.name}” out again.`, 'ok'));
      },
    },
  });
  return true;
}
