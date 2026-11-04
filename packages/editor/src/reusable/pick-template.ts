// The New sheet's templates (#/new/<collection>?template=<id>): Blank, then the Library's page templates for that
// collection, each with its picture and what it is for. A draft made from one starts with its blocks and settings;
// the server never keeps a slug, dates or author in a template. Hidden where the server keeps no Library.
import { el } from '../admin/ui';
import { snippetsHere } from '../snippets/api';
import * as api from './api';
import { picture } from './screen';

export interface TemplatePicker {
  el: HTMLElement;
  /** the chosen template (null: blank), as the URL says */
  set(id: string | null): void;
  chosen(): api.LibItem | null;
}

/** `onPick`: the writer chose one (the URL follows, then set()); `onShow`: what is chosen now, once the list is in. */
export function templatePicker(collection: string, start: string | null, onPick: (id: string | null) => void, onShow: (it: api.LibItem | null) => void, o: { blank: boolean } = { blank: true }): TemplatePicker {
  const box = el('fieldset.ms-new__templates');
  box.hidden = true;
  let items: api.LibItem[] = [];
  let id = start;
  const draw = () => {
    const cards = [...(o.blank ? [null] : []), ...items].map((it) => {
      const on = (it?.id ?? null) === id;
      const b = el('button.ms-new__tpl', { type: 'button', role: 'radio', 'aria-checked': String(on), title: it?.description ?? 'An empty draft' });
      b.classList.toggle('is-on', on);
      b.append(it ? picture(it) : el('span.ms-lib__pic', el('span.ms-lib__pickind', 'Blank')), el('strong', it?.name ?? 'Blank'), el('span.ms-adm-sub', it?.description || (it ? '' : 'Start from nothing')));
      b.addEventListener('click', () => onPick(it?.id ?? null));
      return b;
    });
    const row = el('div.ms-new__tplrow', { role: 'radiogroup', 'aria-label': 'Start from' }, ...cards);
    box.replaceChildren(el('legend.ms-field__label', 'Start from'), row);
    onShow(items.find((i) => i.id === id) ?? null);
  };
  // dev mode has no server, so no Library
  void (snippetsHere() ? api.all() : Promise.reject(new Error('no server'))).then(
    (r) => {
      items = r.items.filter((i) => i.kind === 'template' && i.collection === collection);
      box.hidden = !items.length;
      if (id && !items.some((i) => i.id === id)) onPick((id = null));
      draw();
    },
    () => (box.hidden = true),
  );
  return {
    el: box,
    set(next) {
      id = next;
      draw();
    },
    chosen: () => items.find((i) => i.id === id) ?? null,
  };
}
