// Settings → Alerts (#/settings/alerts?kind=<alert kind>): where alerts go and who gets which (docs/OPERATIONS.md
// "Messages and alerts, all in one place"). The channels (email with its sender name, Slack, a webhook), each with
// Send a test; then a row per kind of alert: on or off, who gets it (roles, named people, extra addresses) and by
// which channels. Owner and administrator; the server's GET / PUT site/alerts, audited. Secrets (the SMTP password,
// the Slack hook) never show here: they stay in the server's environment.
import { ApiError, request } from '../api';
import { copyable } from '../copy';
import type { ScreenCtx } from '../host';
import { h, ht } from '../panel-form';
import { viewerRole } from '../runtime';

type Channel = 'email' | 'slack' | 'webhook';
const CHANNELS: [Channel, string][] = [
  ['email', 'Email'],
  ['slack', 'Slack'],
  ['webhook', 'Webhook'],
];
const ROLES: [string, string][] = [
  ['owner', 'Owner'],
  ['administrator', 'Administrators'],
  ['editor', 'Editors'],
  ['author', 'Authors'],
  ['contributor', 'Contributors'],
];
interface Kind {
  kind: string;
  label: string;
  group?: string;
  on: boolean;
  roles: string[];
  users: { id: string; name: string }[];
  extra: string[];
  channels: Channel[];
  /** a safety alert: always on for the people it is about */
  safety?: boolean;
}
interface AlertsDoc {
  channels: Record<Channel, { on: boolean; from?: string; senderName?: string; host?: string; status?: string; detail?: string }>;
  kinds: Kind[];
  people?: { id: string; name: string }[];
  version: string;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function mountAlerts(el: HTMLElement, ctx: ScreenCtx): { update(c: ScreenCtx): void } {
  let doc: AlertsDoc | null = null;
  let draft: { senderName: string; kinds: Kind[] } | null = null;
  let missing = false;
  const base = () => (doc ? JSON.stringify({ senderName: doc.channels.email.senderName ?? '', kinds: doc.kinds }) : '');
  const dirty = () => !!draft && JSON.stringify(draft) !== base();
  ctx.guard(dirty);
  const manager = ['owner', 'administrator'].includes(viewerRole());

  const test = async (channel: Channel, out: HTMLElement) => {
    out.textContent = 'Sending…';
    try {
      const r = await request<{ channels: { channel: string; ok: boolean; detail: string }[] }>('site/notify/test', { method: 'POST', body: JSON.stringify({ channel }) });
      const c = r.channels.find((x) => x.channel === channel) ?? r.channels[0];
      out.textContent = c ? `${c.ok ? 'Sent' : 'Failed'}: ${c.detail}` : 'Nothing was sent.';
      out.dataset.kind = c?.ok ? 'ok' : 'error';
    } catch (err) {
      out.textContent = `Failed: ${(err as Error).message}`;
      out.dataset.kind = 'error';
    }
  };

  const channels = () => {
    const sec = h('section', 'ms-locks__group');
    sec.append(h('h3', 'ms-locks__h', 'Channels'), h('p', 'ms-locks__lead', 'How alerts leave Markstage. Passwords and hooks stay in the server’s settings, never here.'));
    const rows = h('div', 'ms-locks__rows');
    for (const [c, label] of CHANNELS) {
      const ch = doc!.channels[c] ?? { on: false };
      const row = h('div', `ms-locks__row${ch.on ? ' is-locked' : ''}`);
      const name = h('div', 'ms-alerts__channel');
      name.append(Object.assign(h('strong'), { textContent: label }));
      const say = h('span', 'ms-locks__lead');
      say.textContent = !ch.on ? 'Not set up on this server' : ch.status === 'error' ? `Not working: ${ch.detail ?? ''}` : c === 'email' ? 'From ' : `To ${ch.host ?? ''}`;
      if (ch.on && c === 'email' && ch.from) say.append(copyable(ch.from, { label: 'the sender address' }));
      name.append(say);
      const tools = h('div', 'ms-locks__parts');
      if (c === 'email' && ch.on) {
        const l = h('label', 'ms-locks__part');
        const i = Object.assign(h('input', 'ms-input'), { value: draft!.senderName, placeholder: 'Sender name', disabled: !manager });
        i.setAttribute('aria-label', 'Sender name (the name the mail comes from)');
        i.addEventListener('input', () => ((draft!.senderName = i.value), bar()));
        l.append(document.createTextNode('Sender name'), i);
        tools.append(l);
      }
      if (ch.on) {
        const out = h('span', 'ms-alerts__test');
        const b = Object.assign(h('button', 'ms-btn ms-btn--sm'), { type: 'button', textContent: 'Send a test' });
        b.addEventListener('click', () => void test(c, out));
        tools.append(b, out);
      }
      row.append(name, tools);
      rows.append(row);
    }
    sec.append(rows);
    return sec;
  };

  /** "Owner, Editors, Sam Lee, sales@…" */
  const whoSays = (k: Kind) => [...ROLES.filter(([r]) => k.roles.includes(r)).map(([, l]) => l), ...k.users.map((u) => u.name), ...k.extra].join(', ') || 'Nobody';

  const kinds = () => {
    const open = ctx.params().get('kind');
    const sec = h('section', 'ms-locks__group');
    sec.append(h('h3', 'ms-locks__h', 'Alerts'), h('p', 'ms-locks__lead', 'Each kind of alert: on or off, who gets it and how. Each person can still turn off what they get in My alerts, except safety alerts.'));
    const rows = h('div', 'ms-locks__rows');
    for (const k of draft!.kinds) {
      const row = h('div', `ms-alerts__kind${k.on ? ' is-locked' : ''}${open === k.kind ? ' is-picked' : ''}`);
      row.dataset.type = k.kind;
      const top = h('div', 'ms-locks__row');
      // a safety alert stays on (who gets it and how can still change)
      const on = Object.assign(h('input'), { type: 'checkbox', checked: k.on || !!k.safety, disabled: !manager || !!k.safety });
      on.setAttribute('aria-label', `${k.label}: on`);
      on.addEventListener('change', () => ((k.on = on.checked), draw()));
      const name = h('label', 'ms-locks__name');
      name.append(on, Object.assign(h('strong'), { textContent: k.label }), k.safety ? Object.assign(h('span', 'ms-adm-badge'), { textContent: 'always on', title: 'A safety alert: it can’t be turned off.' }) : '');
      const who = Object.assign(h('button', 'ms-btn ms-btn--sm ms-btn--quiet ms-alerts__who'), { type: 'button', textContent: whoSays(k) });
      who.setAttribute('aria-expanded', String(open === k.kind));
      who.title = 'Who gets it';
      who.addEventListener('click', () => ctx.go({ params: { kind: open === k.kind ? null : k.kind } }, true));
      const parts = h('div', 'ms-locks__parts');
      for (const [c, label] of CHANNELS) {
        const l = h('label', 'ms-locks__part');
        const x = Object.assign(h('input'), { type: 'checkbox', checked: k.channels.includes(c), disabled: !manager || !doc!.channels[c]?.on });
        x.setAttribute('aria-label', `${k.label} by ${label}`);
        x.addEventListener('change', () => ((k.channels = CHANNELS.map(([y]) => y).filter((y) => (y === c ? x.checked : k.channels.includes(y)))), bar()));
        l.append(x, document.createTextNode(label));
        parts.append(l);
      }
      top.append(name, who, parts);
      row.append(top);
      if (open === k.kind) row.append(whoEditor(k));
      rows.append(row);
    }
    sec.append(rows);
    return sec;
  };

  /** Who gets one kind: roles, named people, other addresses (one per line). */
  const whoEditor = (k: Kind) => {
    const box = h('div', 'ms-alerts__whobox');
    const roles = h('fieldset', 'ms-lockpop__parts');
    roles.append(Object.assign(h('legend'), { textContent: 'Roles' }));
    for (const [r, label] of ROLES) {
      const l = h('label');
      const c = Object.assign(h('input'), { type: 'checkbox', checked: k.roles.includes(r), disabled: !manager });
      c.addEventListener('change', () => ((k.roles = ROLES.map(([x]) => x).filter((x) => (x === r ? c.checked : k.roles.includes(x)))), draw()));
      l.append(c, document.createTextNode(label));
      roles.append(l);
    }
    const people = h('fieldset', 'ms-lockpop__parts');
    people.append(Object.assign(h('legend'), { textContent: 'People' }));
    for (const u of doc!.people ?? []) {
      const l = h('label');
      const c = Object.assign(h('input'), { type: 'checkbox', checked: k.users.some((x) => x.id === u.id), disabled: !manager });
      c.addEventListener('change', () => ((k.users = c.checked ? [...k.users, u] : k.users.filter((x) => x.id !== u.id)), draw()));
      l.append(c, document.createTextNode(u.name));
      people.append(l);
    }
    const extra = Object.assign(h('textarea', 'ms-input'), { rows: 2, value: k.extra.join('\n'), disabled: !manager, placeholder: 'sales@example.com' });
    extra.setAttribute('aria-label', 'Other addresses, one per line');
    const bad = h('span', 'ms-alerts__test');
    extra.addEventListener('change', () => {
      const list = extra.value.split(/[\s,;]+/).filter(Boolean);
      const wrong = list.filter((a) => !EMAIL.test(a));
      bad.textContent = wrong.length ? `Not an email address: ${wrong.join(', ')}` : '';
      bad.dataset.kind = wrong.length ? 'error' : '';
      k.extra = list.filter((a) => EMAIL.test(a));
      bar();
    });
    const l = h('label', 'ms-alerts__extra');
    l.append(document.createTextNode('Other addresses'), extra, bad);
    box.append(roles, people, l);
    return box;
  };

  const bar = () => {
    let b = el.querySelector<HTMLElement>('.ms-locks__bar');
    if (!manager || !doc) return;
    if (!b) el.append((b = h('div', 'ms-locks__bar')));
    const save = Object.assign(h('button', 'ms-btn ms-btn--primary'), { type: 'button', textContent: 'Save the alerts', disabled: !dirty() });
    const undo = Object.assign(h('button', 'ms-btn ms-btn--quiet'), { type: 'button', textContent: 'Discard', disabled: !dirty() });
    save.addEventListener('click', () => void store());
    undo.addEventListener('click', () => ((draft = JSON.parse(base())), draw()));
    b.replaceChildren(save, undo, h('span', 'ms-locks__note', dirty() ? 'Not saved yet.' : 'Saved.'));
  };

  const draw = () => {
    el.replaceChildren();
    const intro = h('div', 'ms-locks__intro');
    intro.append(h('h2', 'ms-locks__title', 'Alerts'), h('p', 'ms-locks__lead', 'What Markstage tells the team, and how: by email, Slack or a webhook, and always in the Inbox.'));
    el.append(intro);
    if (missing) return void el.append(h('p', 'ms-locks__note', 'Not on this server yet: alerts are set in its config (notify), and Site health sends a test.'));
    if (!doc || !draft) return void el.append(h('p', 'ms-locks__lead', 'Loading…'));
    if (!manager) el.append(h('p', 'ms-locks__note', 'Only an owner or an administrator changes these. Your own choices are in My alerts.'));
    el.append(channels(), kinds());
    bar();
    el.querySelector('.is-picked')?.scrollIntoView({ block: 'nearest' });
  };

  const store = async () => {
    if (!doc || !draft) return;
    try {
      const body = { senderName: draft.senderName, kinds: draft.kinds.map((k) => ({ kind: k.kind, on: k.on, roles: k.roles, userIds: k.users.map((u) => u.id), extra: k.extra, channels: k.channels })), version: doc.version };
      doc = await request<AlertsDoc>('site/alerts', { method: 'PUT', body: JSON.stringify(body) });
      draft = JSON.parse(base());
      ctx.toast('The alerts are saved.', 'ok');
    } catch (err) {
      ctx.toast(err instanceof ApiError && err.status === 409 ? 'Someone changed the alerts meanwhile: reload to see theirs.' : `Not saved: ${(err as Error).message}`, 'error');
    }
    draw();
  };

  draw();
  void request<AlertsDoc>('site/alerts').then(
    (d) => {
      doc = d;
      draft = JSON.parse(base());
      draw();
    },
    (err) => {
      if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return void ((missing = true), draw());
      el.replaceChildren(ht('p', 'ms-locks__note', `The alerts did not load: ${(err as Error).message}`));
    },
  );
  return { update: () => draw() };
}
