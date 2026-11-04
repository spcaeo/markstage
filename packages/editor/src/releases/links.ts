// Share links (docs/API-RELEASES.md "Share links"): a release's preview, or one draft as it would go live, for people
// with no account. The card lists a release's or a draft's links (who made them, views, when they end) with Turn off;
// "New share link…" opens its panel (do=share). A new link's address is shown once, in that panel, with copy and
// open: it holds a secret, so it never goes into the editor's own URL (made=<link id> only says which link it was),
// and once the panel closes it is gone for good.
import type { ScreenCtx } from '../host';
import { button, drawer, el, field, form, message, state, value, when, link } from '../admin/ui';
import * as api from './api';
import { LINK_WORDS } from './words';

const NUM = new Intl.NumberFormat('en-GB');
/** The address of a link made in this tab, by link id: shown once, never stored or put in the URL. */
const madeHere = new Map<string, string>();

export interface LinksOpts {
  ctx: ScreenCtx;
  target: api.ShareTarget;
  /** what is shared, in words: "this release", "this draft" */
  what: string;
  /** a link can be made now (an open release; a draft) */
  canMake: boolean;
  /** why not, when it cannot */
  whyNot?: string;
  /** the count changed (the release page's tab says how many work) */
  changed?: () => void;
}

/** The links card, and its panel when the URL asks for it (do=share). `layout` is where the panel goes. */
export function linksCard(layout: HTMLElement, o: LinksOpts): HTMLElement {
  const { ctx } = o;
  const card = el('section.ms-adm-card.ms-rel-links', el('h2.ms-adm-h2', 'Share links'), state('loading', 'Loading the links…'));
  // the page draws a new card each time: an answer for one no longer on screen is dropped
  const alive = () => card.isConnected;
  const draw = (r: { links: api.ShareLink[]; on: boolean }) => {
    if (!alive()) return;
    const head = el('div.ms-adm-row', el('h2.ms-adm-h2', 'Share links'), el('span.ms-adm-grow'));
    if (r.on && o.canMake) head.append(button('New share link…', () => ctx.go({ params: { do: 'share', made: null } }, true), { small: true, icon: 'link' }));
    const parts: (Node | string)[] = [head];
    if (!r.on) parts.push(el('p.ms-adm-sub', 'Share links are not set up on this server. An administrator turns them on in the server’s settings.'));
    else parts.push(el('p.ms-adm-sub', `Anyone with a link sees ${o.what} as it would go live, without an account, until the link ends or is turned off. Search engines are kept out.`));
    if (r.on && !o.canMake && o.whyNot) parts.push(el('p.ms-adm-sub', o.whyNot));
    if (r.links.length) parts.push(table(r.links));
    else if (r.on) parts.push(el('p.ms-adm-sub', 'No links yet.'));
    card.replaceChildren(...parts);
    if (ctx.params().get('do') === 'share') panel(r.on);
  };

  function table(list: api.ShareLink[]): HTMLElement {
    const tb = el('tbody');
    for (const l of list) {
      const off = button('Turn off', () => void revoke(l), { small: true, kind: 'quiet' });
      tb.append(
        el(
          `tr${l.state === 'active' ? '' : '.is-past'}`,
          el('td', l.label ? value(l.label, 'label') : el('span.ms-adm-none', 'No label')),
          el('td', el(`span.ms-adm-badge${l.state === 'active' ? '.ms-adm-badge--ok' : ''}`, LINK_WORDS[l.state])),
          el('td.ms-num', NUM.format(l.views)),
          el('td', l.lastViewAt ? when(l.lastViewAt) : el('span.ms-adm-none', 'Not yet')),
          el('td', l.state === 'revoked' ? el('span', 'Turned off ', when(l.revokedAt)) : el('span', l.state === 'expired' ? 'Ended ' : 'Ends ', when(l.expiresAt))),
          el('td', l.createdBy.name ? value(l.createdBy.name, 'name') : '—'),
          el('td.ms-adm-cell--end', l.state === 'active' ? off : ''),
        ),
      );
    }
    return el('table.ms-adm-table.ms-adm-table--rows.ms-rel-linktable', el('thead', el('tr', el('th', 'Label'), el('th', 'State'), el('th.ms-num', 'Views'), el('th', 'Last seen'), el('th', 'Ends'), el('th', 'Made by'), el('th', ''))), tb);
  }

  async function revoke(l: api.ShareLink): Promise<void> {
    const answer = await ctx.ask(`Turn off ${l.label ? `“${l.label}”` : 'this link'}?`, 'Whoever has it then sees “This link was turned off”. It cannot be turned on again; make a new one if needed.', [['cancel', 'Keep it'], ['off', 'Turn it off', 'ms-btn ms-btn--danger']]);
    if (answer !== 'off') return;
    try {
      await api.revokeLink(l.id);
      ctx.toast('The link is turned off.', 'ok');
      madeHere.delete(l.id);
      o.changed?.();
      void load();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  function panel(on: boolean): void {
    const close = () => ctx.go({ params: { do: null, made: null } }, true);
    const d = drawer(layout, 'New share link', close);
    const made = ctx.params().get('made');
    if (made) {
      const url = madeHere.get(made);
      if (!url) {
        d.body.append(state('empty', 'The address is not shown again', 'A link’s address is shown once, when it is made, and is not kept. Make a new link if you need one.'));
        return;
      }
      d.body.append(
        el('section.ms-adm-secret.ms-rel-secret', { role: 'status' }, el('h3', 'Copy the link now'), el('p', 'It is shown this once: Markstage keeps no copy of it. Send it to the people who should see the preview.'), link(url, 'the share link', 'ms-rel-url')),
        el('div.ms-adm-actions', button('Done', close, { kind: 'primary' })),
      );
      return;
    }
    if (!on || !o.canMake) return void d.body.append(state('empty', 'No new link', !on ? 'Share links are not set up on this server.' : (o.whyNot ?? 'This cannot be shared now.')));
    d.body.append(
      el('p.ms-adm-sub', `A link to ${o.what} as it would go live, for people with no account.`),
      form(
        [field('label', 'Label (optional)', { maxlength: 100, placeholder: 'For the client' }), field('days', 'Works for (days)', { type: 'number', value: '7', required: true, inputmode: 'numeric', hint: 'From 1 to 30 days.' })],
        'Make the link',
        async (v) => {
          const r = await api.makeLink(o.target, { label: v.label || undefined, days: Number(v.days) });
          madeHere.set(r.link.id, r.url);
          o.changed?.();
          ctx.go({ params: { do: 'share', made: r.link.id } }, false);
        },
        { kind: 'primary' },
      ),
    );
    const days = d.body.querySelector<HTMLInputElement>('input[name="days"]');
    if (days) Object.assign(days, { min: '1', max: '30' });
    d.body.querySelector<HTMLInputElement>('input[name="label"]')?.focus();
  }

  async function load(): Promise<void> {
    try {
      draw(await api.links(o.target));
    } catch (e) {
      if (alive()) card.replaceChildren(el('h2.ms-adm-h2', 'Share links'), el('p.ms-adm-form__err', { role: 'alert' }, message(e)));
    }
  }
  void load();
  return card;
}
