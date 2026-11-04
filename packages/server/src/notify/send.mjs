// Alerts out of the editor (docs/DEPLOY.md "Alerts"): each notice (a failed publish, deploy or backup, a scheduled
// entry held back or late) also goes, once, by email, to Slack and to a webhook, as config `notify` and the alert
// rules say. Mail comes from the sender name set in Settings → Alerts. A channel that is down never stops the work
// that raised the alert; it is logged, and its last answer shows in Settings → Alerts. "Send a test" sends one
// through one channel (or all of them) and says what each answered.
//   POST /site/notify/test   (owner, administrator) {channel?} → {channels: [{channel, ok, detail}]}
import { can } from '../roles.mjs';
import { HttpError, badRequest, forbidden } from '../util.mjs';
import { CHANNELS } from './kinds.mjs';
import { addressOf, sendMail } from './smtp.mjs';

const firstSentence = (text) => {
  const s = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
};

export function createAlerts(app) {
  const { config } = app;
  const n = config.notify;
  const appUrl = (link) => (link ? `${config.publicOrigin}${config.basePath}/#${link.replace(/^#/, '')}` : null);

  /** Who gets the mail: the listed addresses, then every active user with one of the listed roles. */
  function recipients() {
    const users = n.email.roles.length ? app.users.list().filter((u) => !u.disabled && n.email.roles.includes(u.role)).map((u) => u.email) : [];
    return [...new Set([...n.email.to, ...users].map((a) => a.toLowerCase()))];
  }

  // the mail is the site's (its people read "<siteName>: …"), with Markstage only as the editor's name
  const siteName = typeof config.siteName === 'string' && config.siteName.trim() ? config.siteName.replace(/[\r\n]+/g, ' ').trim() : null;

  function mailOf(a, url) {
    const site = config.siteUrl ?? config.publicOrigin;
    const by = siteName ? `the ${siteName} editor (Markstage)` : 'Markstage';
    // its own words (a form message: every field, and Reply-To the visitor) and the link; no signature, the team
    // reads it as the site's own mail
    if (a.mail) return { subject: a.mail.subject, replyTo: a.mail.replyTo ?? null, text: [a.mail.text, '', url ? `Open it in Markstage: ${url}` : null].filter((l) => l !== null).join('\n') };
    return {
      subject: `${siteName ?? 'Markstage'}: ${firstSentence(a.text)}`,
      text: [a.text, '', url ? `Open it in Markstage: ${url}` : null, '', `Site: ${site}`, `When: ${a.at}`, '', `Sent by ${by} at ${config.publicOrigin}.`].filter((l) => l !== null).join('\n'),
    };
  }

  /** The From line: the sender name from Settings → Alerts (else the one in notify.email.from) and the address. */
  const fromOf = () => {
    const name = app.alertRules?.senderName();
    return name ? `${name} <${addressOf(n.email.from)}>` : n.email.from;
  };

  const post = async (to, body) => {
    const res = await fetch(to, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    await res.body?.cancel();
    if (!res.ok) throw new Error(`answered ${res.status}`);
    return `answered ${res.status}`;
  };

  /**
   * Send one alert {kind, level, text, link, at, mail?} through every channel: [{channel, ok, detail}]. Never throws.
   * `who` (from the alert rules, notify/rules.mjs): {emails, slack, webhook}, who gets the mail and whether the other
   * channels carry it; without it (the test alert) the mail goes to notify.email's addresses and roles. `only`: just
   * that channel (a test of one).
   */
  async function send(a, who = null, { only = null } = {}) {
    if (!n) return [];
    const url = appUrl(a.link);
    const tries = [];
    if (n.email && (!who || who.emails.length) && (!only || only === 'email')) {
      tries.push([
        'email',
        (async () => {
          const to = who ? [...new Set(who.emails.map((e) => e.toLowerCase()))] : recipients();
          if (!to.length) throw new Error('nobody to send to (notify.email.to and roles name no one)');
          const m = mailOf(a, url);
          const r = await sendMail({ ...n.email, from: fromOf(), to, subject: m.subject, text: m.text, replyTo: m.replyTo ?? null });
          return `sent to ${r.accepted.join(', ')}`;
        })(),
      ]);
    }
    if (n.slack && who?.slack !== false && (!only || only === 'slack')) tries.push(['slack', post(n.slack, { text: url ? `${a.text} <${url}|Open in Markstage>` : a.text })]);
    if (n.webhook && who?.webhook !== false && (!only || only === 'webhook')) tries.push(['webhook', post(n.webhook, { kind: a.kind, level: a.level, text: a.text, url, at: a.at })]);
    // all at once, each settled (one that is down must not leave another's failure unheard)
    const settled = await Promise.allSettled(tries.map(([, p]) => p));
    const out = settled.map((r, i) => {
      const channel = tries[i][0];
      app.alertRules?.note(channel, r.status === 'fulfilled', r.status === 'fulfilled' ? r.value : r.reason.message);
      if (r.status === 'fulfilled') return { channel, ok: true, detail: r.value };
      const where = channel === 'email' ? '' : ` (${new URL(channel === 'slack' ? n.slack : n.webhook).host})`;
      console.error(`[markstage] alert by ${channel}${where} failed: ${r.reason.message}`);
      return { channel, ok: false, detail: r.reason.message };
    });
    return out;
  }

  function routes(router) {
    router.add('POST', '/site/notify/test', async (ctx) => {
      if (!can(ctx.user, 'site.health')) throw forbidden('Only an owner or administrator can send a test alert.');
      if (!n) throw new HttpError(409, 'not-set-up', 'No alerts are set up on this server (notify in config.json, docs/DEPLOY.md "Alerts").');
      const only = ctx.body?.channel ?? null;
      if (only !== null && !CHANNELS.includes(only)) throw badRequest(`channel is one of ${CHANNELS.join(', ')}.`);
      if (only && !n[only]) throw new HttpError(409, 'not-set-up', `No ${only === 'email' ? 'mail' : only === 'slack' ? 'Slack' : 'webhook'} is set up on this server (notify.${only} in config.json, docs/DEPLOY.md "Alerts").`);
      // outside production with mail 'actor', the test goes to the person who sent it only
      const who = config.environment?.mail === 'actor' ? { emails: [ctx.user.email], slack: true, webhook: true } : null;
      const channels = await send({ kind: 'notify.test', level: 'info', text: `A test alert from Markstage, sent by ${ctx.user.name} from ${only ? 'Settings → Alerts' : 'Site health'}. If you got this, alerts reach you here.`, link: only ? '#/settings/alerts' : '#/health', at: new Date(app.clock()).toISOString() }, who, { only });
      app.audit.log(ctx, 'notify.test', { target: 'notify', ok: channels.every((c) => c.ok), detail: { channels: channels.map((c) => ({ channel: c.channel, ok: c.ok })) } });
      return { channels };
    });
  }

  /** For Site health: which channels are set up (no addresses or hooks). */
  const status = () => ({ email: Boolean(n?.email), slack: Boolean(n?.slack), webhook: Boolean(n?.webhook) });

  /** One person's daily digest: the alerts they chose to get once a day, in one mail. {ok, detail}. */
  async function digest(user, items) {
    if (!n?.email) return { ok: true, detail: 'no mail set up' };
    const lines = items.flatMap((i) => [`- ${i.text}`, ...(i.link ? [`  ${appUrl(i.link)}`] : []), `  (${i.at})`, '']);
    const by = siteName ? `the ${siteName} editor (Markstage)` : 'Markstage';
    const text = [`Your alerts since the last digest (${items.length}):`, '', ...lines, `You get these once a day because of your choices in My alerts: ${appUrl('#/my-alerts')}`, '', `Sent by ${by} at ${config.publicOrigin}.`].join('\n');
    try {
      const r = await sendMail({ ...n.email, from: fromOf(), to: [user.email], subject: `${siteName ?? 'Markstage'}: your daily alerts (${items.length})`, text });
      return { ok: true, detail: `sent to ${r.accepted.join(', ')}` };
    } catch (e) {
      console.error(`[markstage] the daily alert digest was not sent: ${e.message}`);
      return { ok: false, detail: e.message };
    }
  }

  return { send, digest, routes, status };
}
