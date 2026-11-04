// My alerts (#/my-alerts?kind=<alert kind>): what reaches me, for every signed-in person (docs/OPERATIONS.md
// "Messages and alerts, all in one place"). Each kind I may receive: on or off, and how (by email at once, in a
// daily digest, or only in the editor). Safety alerts (a failed backup, a sign-in to my account from a new device)
// can't be turned off. The server's GET / PUT me/alerts; a change is saved at once.
import { ApiError, request } from '../api';
import type { ScreenCtx } from '../host';
import { h } from '../panel-form';

type Delivery = 'now' | 'digest' | 'editor';
const DELIVERY: [Delivery, string][] = [
  ['now', 'Email at once'],
  ['digest', 'Daily digest'],
  ['editor', 'Only in Markstage'],
];
interface Mine {
  kinds: { kind: string; label: string; on: boolean; delivery: Delivery; locked?: boolean }[];
  version: string;
}

export function mountMyAlerts(el: HTMLElement, ctx: ScreenCtx): { update(): void; destroy(): void } {
  el.classList.add('ms-site-settings');
  let mine: Mine | null = null;
  let note = '';

  const put = async (k: Mine['kinds'][number], change: Partial<Pick<Mine['kinds'][number], 'on' | 'delivery'>>) => {
    if (!mine) return;
    const kinds = mine.kinds.map((x) => (x.kind === k.kind ? { kind: x.kind, on: change.on ?? x.on, delivery: change.delivery ?? x.delivery } : { kind: x.kind, on: x.on, delivery: x.delivery }));
    try {
      mine = await request<Mine>('me/alerts', { method: 'PUT', body: JSON.stringify({ kinds, version: mine.version }) });
      ctx.toast('Saved.', 'ok');
    } catch (err) {
      ctx.toast(err instanceof ApiError && err.status === 409 ? 'Changed in another tab meanwhile: here it is as it is now.' : `Not saved: ${(err as Error).message}`, 'error');
      mine = await request<Mine>('me/alerts').catch(() => mine);
    }
    draw();
  };

  const draw = () => {
    el.replaceChildren();
    const intro = h('div', 'ms-locks__intro');
    intro.append(h('h2', 'ms-locks__title', 'My alerts'), h('p', 'ms-locks__lead', 'What reaches you, and how. Everything is also in the Inbox for the people it is for.'));
    el.append(intro);
    if (note) return void el.append(h('p', 'ms-locks__note', note));
    if (!mine) return void el.append(h('p', 'ms-locks__lead', 'Loading…'));
    if (!mine.kinds.length) return void el.append(h('p', 'ms-locks__note', 'No alerts are sent to you on this site.'));
    const picked = ctx.params().get('kind');
    const rows = h('div', 'ms-locks__rows');
    rows.setAttribute('role', 'list');
    for (const k of mine.kinds) {
      const row = h('div', `ms-locks__row${k.on ? ' is-locked' : ''}${picked === k.kind ? ' is-picked' : ''}`);
      row.setAttribute('role', 'listitem');
      row.dataset.type = k.kind;
      const name = h('label', 'ms-locks__name');
      const on = Object.assign(h('input'), { type: 'checkbox', checked: k.on || !!k.locked, disabled: !!k.locked });
      on.setAttribute('aria-label', `${k.label}: send it to me`);
      on.addEventListener('change', () => void put(k, { on: on.checked }));
      name.append(on, Object.assign(h('strong'), { textContent: k.label }));
      if (k.locked) name.append(Object.assign(h('span', 'ms-adm-badge'), { textContent: 'always on', title: 'A safety alert: it can’t be turned off.' }));
      const how = h('select', 'ms-input ms-adm-select');
      how.setAttribute('aria-label', `${k.label}: how`);
      for (const [v, l] of DELIVERY) how.append(Object.assign(h('option'), { value: v, textContent: l, selected: v === k.delivery }));
      how.disabled = !k.on && !k.locked;
      how.addEventListener('change', () => void put(k, { delivery: how.value as Delivery }));
      row.append(name, how);
      rows.append(row);
    }
    el.append(rows);
    el.querySelector('.is-picked')?.scrollIntoView({ block: 'nearest' });
  };

  draw();
  void request<Mine>('me/alerts').then(
    (m) => ((mine = m), draw()),
    (err) => {
      note = err instanceof ApiError && (err.status === 404 || err.status === 405) ? 'Not on this server yet: alerts go to the people its config names.' : `Your alerts did not load: ${(err as Error).message}`;
      draw();
    },
  );
  return { update: () => draw(), destroy: () => el.replaceChildren() };
}
