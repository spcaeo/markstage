// "Move to…" in the order component's menu: every place the items can go, as a list to filter and pick from (for
// long lists and for another parent in a tree). Resolves with the place, or null (Cancel, Esc).
import { flatten, type Place } from '@markstage/core';
import { modalize } from '../shell';
import type { OrderItem } from './index';

interface Choice {
  text: string;
  depth: number;
  to: Place;
}

/** The places for `moving` (ids, with their children): after any other item, inside it (tree), or first. */
function choices(items: OrderItem[], moving: Set<string>, tree: boolean, maxDepth: number, below: number, fits: (to: Place) => boolean): Choice[] {
  const rows = flatten(items);
  const gone = new Set<string>();
  for (const r of rows) if (moving.has(r.item.id) || (r.parent && gone.has(r.parent))) gone.add(r.item.id);
  const out: Choice[] = [{ text: 'To the top', depth: 0, to: { parent: null, index: 0 } }];
  for (const r of rows) {
    if (gone.has(r.item.id)) continue;
    // its index among the siblings that stay
    const stays = rows.filter((x) => x.parent === r.parent && !gone.has(x.item.id) && x.index <= r.index).length;
    out.push({ text: `After “${r.item.label}”`, depth: r.depth, to: { parent: r.parent, index: stays } });
    if (tree && r.depth + 1 + below <= maxDepth) out.push({ text: `Inside “${r.item.label}”, first`, depth: r.depth + 1, to: { parent: r.item.id, index: 0 } });
  }
  return out.filter((c) => fits(c.to));
}

export function moveToDialog(o: { noun: string; count: number; items: OrderItem[]; moving: Set<string>; tree: boolean; maxDepth: number; below: number; fits?: (to: Place) => boolean }): Promise<Place | null> {
  return new Promise((done) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'ms-dialog ms-moveto';
    dlg.setAttribute('aria-labelledby', 'ms-moveto-title');
    const h = document.createElement('h2');
    h.id = 'ms-moveto-title';
    h.textContent = o.count === 1 ? `Move the ${o.noun} to…` : `Move ${o.count} ${o.noun}s to…`;
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.className = 'ms-input';
    filter.placeholder = 'Filter';
    filter.setAttribute('aria-label', 'Filter the places');
    const list = document.createElement('div');
    list.className = 'ms-moveto__list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Places');
    const tools = document.createElement('div');
    tools.className = 'ms-dialog__tools';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ms-btn';
    cancel.textContent = 'Cancel';
    tools.append(cancel);
    dlg.append(h, filter, list, tools);
    document.body.append(dlg);
    const all = choices(o.items, o.moving, o.tree, o.maxDepth, o.below, o.fits ?? (() => true));
    const end = (to: Place | null) => {
      dlg.close();
      dlg.remove();
      done(to);
    };
    const draw = () => {
      const q = filter.value.trim().toLowerCase();
      list.replaceChildren(
        ...all
          .filter((c) => !q || c.text.toLowerCase().includes(q))
          .map((c) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ms-moveto__item';
            b.setAttribute('role', 'option');
            b.style.setProperty('--depth', String(c.depth));
            b.textContent = c.text;
            b.addEventListener('click', () => end(c.to));
            return b;
          }),
      );
    };
    filter.addEventListener('input', draw);
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        list.querySelector<HTMLElement>('button')?.focus();
      }
    });
    list.addEventListener('keydown', (e) => {
      const items = [...list.querySelectorAll<HTMLElement>('button')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') items[Math.min(i + 1, items.length - 1)]?.focus();
      else if (e.key === 'ArrowUp') (i <= 0 ? filter : items[i - 1])?.focus();
      else return;
      e.preventDefault();
    });
    cancel.addEventListener('click', () => end(null));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      end(null);
    });
    draw();
    modalize(dlg);
    dlg.showModal();
    filter.focus();
  });
}
