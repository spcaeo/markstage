// Settings → Tokens (#/settings/tokens): each person's own tokens, of two kinds. A command line token is for the
// laptop's markstage (login, status, promote) and reaches the Environments routes only; an AI assistant's token is for
// the MCP server (docs/API-MCP.md) and reaches it only: it reads the site as its person and, if allowed, drafts.
// ?new=cli or ?new=mcp opens the form for that kind; the secret is shown once, right after it is made, and is never
// put in the URL. Each kind's scopes come from the server (scopes, mcpScopes).
import type { ScreenCtx } from '../host';
import { button, el, link, message, secretBox, state, value, when } from '../admin/ui';
import { apiPath } from '../api';
import * as api from './api';

type Kind = 'cli' | 'mcp';
const SCOPE_WORDS: Record<string, string> = {
  'env:read': 'See environments and plans',
  'env:promote': 'Make and run plans (the rules still decide)',
  'mcp:read': 'Read the site: pages, articles, the Library and releases, as you see them',
  'mcp:draft': 'Write drafts and put changes into a release for you to publish (it never publishes)',
};
const KIND_WORDS: Record<Kind, string> = { cli: 'Command line', mcp: 'AI assistant (MCP)' };
const STATUS_WORDS: Record<api.Token['status'], string> = { active: 'Active', expired: 'Expired', revoked: 'Revoked' };
const kindOf = (t: api.Token): Kind => (t.scopes.some((s) => s.startsWith('mcp:')) ? 'mcp' : 'cli');
/** what a token can do, in words: an AI assistant that may draft can read too, so it is said once */
const canWords = (t: api.Token) => (t.scopes.includes('mcp:draft') ? [SCOPE_WORDS['mcp:draft']] : t.scopes.map((s) => SCOPE_WORDS[s] ?? s)).join('; ');

export function mountTokens(host: HTMLElement, ctx: ScreenCtx): { update(c: ScreenCtx): void } {
  let data: Awaited<ReturnType<typeof api.tokens>> | null = null;
  /** the secret of the token just made: in this page only, gone on reload */
  let made: { token: api.Token; secret: string } | null = null;

  async function load(): Promise<void> {
    try {
      data = await api.tokens();
    } catch (e) {
      host.replaceChildren(state('error', 'Your tokens did not load', message(e)));
      return;
    }
    draw();
  }

  function draw(): void {
    const d = data!;
    const asked = ctx.params().get('new');
    const open: Kind | null = asked === 'cli' || asked === 'mcp' ? asked : null;
    const head = el('div.ms-env-rules__head', el('div', el('h2.ms-locks__title', 'Tokens'), el('p.ms-locks__lead', 'A token lets a program act as you, and it is for one of two things, never both. A command line token lets markstage on your laptop see the environments and promote. An AI assistant token lets an assistant read the site as you see it and, if you allow it, write drafts; a person still publishes. No token manages tokens.')));
    const newButton = (k: Kind, label: string, primary: boolean) => button(label, () => ((made = null), ctx.go({ params: { new: k } }, true)), { kind: primary ? 'primary' : undefined, icon: 'plus' });
    const bar = el('div.ms-adm-row', el('span.ms-adm-grow'), open ? '' : newButton('mcp', 'New AI assistant token', false), open ? '' : newButton('cli', 'New command line token', true));
    const t = el('table.ms-adm-table', el('thead', el('tr', el('th', 'Name'), el('th', 'For'), el('th', 'Can'), el('th', 'Made'), el('th', 'Expires'), el('th', 'Last used'), el('th', 'Status'), el('th', ''))));
    const tb = el('tbody');
    for (const k of d.tokens) {
      const revoke = k.status === 'active' ? button('Revoke', async () => {
        try {
          await api.revokeToken(k.id);
          ctx.toast(`“${k.name}” revoked: it stops working now${kindOf(k) === 'cli' ? ', even in the middle of a job' : ''}.`, 'ok');
          void load();
        } catch (e) {
          ctx.toast(message(e), 'error');
        }
      }, { small: true, kind: 'danger' }) : '';
      tb.append(el(`tr${made?.token.id === k.id ? '.is-open' : ''}`, el('td', value(k.name, 'token name')), el('td', KIND_WORDS[kindOf(k)]), el('td', canWords(k)), el('td', when(k.createdAt)), el('td', when(k.expiresAt)), el('td', when(k.lastUsedAt)), el('td', el(`span.ms-adm-badge${k.status === 'active' ? '.ms-adm-badge--ok' : ''}`, STATUS_WORDS[k.status])), el('td.ms-adm-cell--end', revoke)));
    }
    t.append(tb);
    host.replaceChildren(head, open ? newForm(d, open) : '', bar, d.tokens.length ? el('section.ms-adm-card.ms-adm-card--flush', t) : el('p.ms-adm-sub', 'No tokens yet.'));
  }

  /** What to do with the secret just made: the command for its kind. */
  function madeCard(card: HTMLElement, kind: Kind, secret: string): void {
    // this server's addresses as the editor reaches them (its basePath may not be /markstage): the MCP endpoint, and
    // the editor's own address, which the command line takes and keeps with the token
    const mcp = new URL(apiPath('mcp'), location.href).href;
    const address = new URL(apiPath(''), location.href).href.replace(/\/api\/?$/, '');
    if (kind === 'cli') {
      card.append(
        secretBox('Your new token', 'Copy it now: it is shown only this once. Paste it when markstage login asks for it.', [secret], 'token'),
        el('h3.ms-adm-h3', 'On your laptop'),
        el('div.ms-adm-code', value(`npx markstage login ${address}`, 'command')),
        el('p.ms-adm-sub', 'Then markstage status shows the environments, and markstage promote <branch> staging makes a plan.'),
      );
      return;
    }
    const config = JSON.stringify({ mcpServers: { markstage: { command: 'npx', args: ['markstage', 'mcp', address] } } });
    card.append(
      secretBox('Your new token', 'Copy it now: it is shown only this once. Give it to your AI assistant through the command below, never in a link or a chat.', [secret], 'token'),
      el('h3.ms-adm-h3', 'On the computer the assistant runs on'),
      el('div.ms-adm-code', value(`npx markstage mcp login ${address}`, 'command')),
      el('p.ms-adm-sub', 'It asks for the token and keeps it. Then add Markstage to the assistant’s MCP servers:'),
      el('div.ms-adm-code', value(config, 'MCP server config')),
      el('p.ms-adm-sub', 'An assistant that connects over HTTP itself uses this address, with the token in the Authorization header:'),
      el('div.ms-adm-code', link(mcp, 'MCP address')),
    );
  }

  function newForm(d: NonNullable<typeof data>, kind: Kind): HTMLElement {
    const card = el('section.ms-adm-card.ms-env-token');
    if (made) {
      madeCard(card, kindOf(made.token), made.secret);
      card.append(el('div.ms-adm-actions', button('Done', () => ((made = null), ctx.go({ params: { new: null } }, true)), { kind: 'primary' })));
      return card;
    }
    const nid = 'ms-token-name';
    const did = 'ms-token-days';
    const name = el('input.ms-input', { id: nid, maxlength: '80', value: kind === 'cli' ? 'Laptop' : 'AI assistant' });
    const days = el('input.ms-input', { id: did, type: 'number', min: '1', max: String(d.maxDays), value: '30' });
    const scopes = el('fieldset.ms-rule__boxes', el('legend.ms-field__label', 'It can'));
    if (kind === 'cli') for (const s of d.scopes) scopes.append(el('label.ms-rule__box', el('input', { type: 'checkbox', value: s, checked: true }), ` ${SCOPE_WORDS[s] ?? s}`));
    else
      // reading always comes with it, and the screen says so; writing drafts is asked for
      for (const s of d.mcpScopes ?? []) {
        const always = s === 'mcp:read';
        const hid = `ms-token-scope-${s.replace(':', '-')}`;
        scopes.append(el('label.ms-rule__box', el('input', { type: 'checkbox', value: s, checked: always, disabled: always, ...(always ? { 'aria-describedby': hid } : {}) }), ` ${SCOPE_WORDS[s] ?? s}`));
        if (always) scopes.append(el('p.ms-adm-sub', { id: hid }, 'Reading always comes with it.'));
      }
    const err = el('p.ms-adm-form__err', { role: 'alert' });
    const go = button('Make the token', async () => {
      const list = [...scopes.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
      const n = Number(days.value);
      if (!name.value.trim()) return void (err.textContent = kind === 'cli' ? 'Give it a name, like the laptop it is for.' : 'Give it a name, like the assistant it is for.');
      if (!list.length) return void (err.textContent = 'Tick what it can do.');
      if (!Number.isInteger(n) || n < 1 || n > d.maxDays) return void (err.textContent = `It lasts 1 to ${d.maxDays} days.`);
      go.disabled = true;
      try {
        made = await api.makeToken({ name: name.value.trim(), scopes: list, days: n });
        data = await api.tokens();
        draw();
      } catch (e) {
        go.disabled = false;
        err.textContent = message(e);
      }
    }, { kind: 'primary' });
    card.append(
      el('h3.ms-adm-h3', kind === 'cli' ? 'New command line token' : 'New AI assistant token'),
      el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: nid }, 'Name'), name),
      scopes,
      el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: did }, `Days it lasts (at most ${d.maxDays})`), days),
      err,
      el('div.ms-adm-actions', go, button('Cancel', () => ctx.go({ params: { new: null } }, true), { kind: 'quiet' })),
    );
    return card;
  }

  void load();
  return {
    update(c) {
      ctx = c;
      if (data) draw();
    },
  };
}
