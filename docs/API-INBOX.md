# Markstage API: messages and alerts

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). Split out of it to keep each
file readable: who hears about what (the alert rules and each person's choices), the site's forms, and the Inbox.

## Alerts: who hears about what

The site's rules (Settings → Alerts) say per kind whether it is on, which roles and people it reaches (besides the
people it is about, such as who started the job), extra addresses, and the channels it leaves by (`email`, `slack`,
`webhook`); the editor always shows it. Each person then chooses per kind that can reach them (My alerts): on or off,
and `now` (mail at once), `digest` (one mail a day at `notify.digestHour`, server time) or `editor` (only in the
editor). A person's default is `now` when their role is in `notify.email.roles` (who got alert mail before there were
rules), else `editor`. **Safety** kinds (`backup.failed`, `user.invited`, `user.role`, `env.rules-changed`, `signin.new-device`) are always
on and always go by mail; a person chooses only `now` or `digest`. A rule's extra addresses default to
`notify.email.to`, except for a personal kind (a sign-in, a message given to you). Mail comes from the rules' sender
name (else the name in `notify.email.from`) at `notify.email.from`'s address; the subject keeps the site's name.

- `GET site/alerts` (editor and above) → `{version, digestHour, channels: {email: {on, from, senderName, host, status,
  detail, lastAt}, slack: {on, host, status, detail, lastAt}, webhook: {…}}, kinds: [{kind, label, group, safety, on,
  roles, users: [{id, name}], extra, channels}], people: [{id, name, role}]}`. A channel not set up is `{on: false}`;
  `status` is how its last send went (`ok`, `error` or null), `detail` its answer.
- `PUT site/alerts {version, senderName?, kinds: [{kind, on?, roles?, userIds?, extra?, channels?}]}` (owner,
  administrator): only the kinds and keys sent change. `409 stale` with `current` when `version` is stale; `400` in
  plain words for an unknown kind or role, a person who is not a user, more than 20 addresses or one that is not an
  address, a sender name with `< > @ " , ; :`, or a safety kind turned off or out of mail. Kept in
  `<dataDir>/alert-rules.json` (0600; addresses never go in the repo). Audited `site.alerts` `{changed: [{kind,
  from, to}], senderName?: {from, to}}` → the view plus `changed: [kinds, 'senderName']`.
- `GET me/alerts` (anyone signed in) → `{version, digestHour, kinds: [{kind, label, group, on, delivery, locked}]}`,
  the kinds that can reach this person (by role, by name, or about them); `PUT me/alerts {version?, kinds: [{kind, on,
  delivery}]}` → the view plus `changed` (`409 stale`; `400` for a safety kind off or `editor`; off keeps the
  delivery). Audited `me.alerts` `{changes: [{kind, from, to}]}` (`to` is a delivery or `off`).

`POST site/notify/test {channel?}` (owner, administrator) sends a test alert through that channel (or every one):
`{channels: [{channel: "email"|"slack"|"webhook", ok, detail}]}` (`detail`: "sent to …", "answered 200", or what went
wrong in plain words). `400` for an unknown channel; `409 not-set-up` without `notify` or that channel. Audited
(`notify.test`). `GET site/health` says which are set up: `alerts: {email, slack, webhook}`.

## Forms and the Inbox

The site's forms post to Markstage on the site's own host names (config.json `siteHosts`), never on the CMS host;
there the rest of Markstage answers `404`. Each form is described in the site's markstage.config `forms` (or
config.json `forms`; docs/CONFIG.md): its fields, the visitor context kept beside them, the spam checks, the daily
limit and the mail. Messages are kept in the data dir, never in the content repo.

`POST <basePath>/forms/<id>` (site host; form-encoded or JSON, at most 64 KB):

- **Origin** must be `https://` one of `siteHosts` (`403` otherwise, audited `security.origin`).
- **Limits:** at most `perDay` (3) messages a day from one address or for one email address, any case (`429`
  `{status: 429, error: limitMessage}`). The address is the connection's, or the hop a trusted proxy appended
  (`trustProxy`); a posted `ip` is ignored. Spam counts against a cap of 20 a day from one address and 60 a day
  from one network (an IPv4 /24, an IPv6 /64).
- **A flood:** past `perHour` (300) real messages (spam never counts) in an hour, the form is not turned off: a
  message is stored with status `held`, the visitor is answered as usual, nobody is mailed and nothing goes to the
  CRM yet, and the administrators get a `form.held` alert (once an hour per form, audited `forms.held`). Every
  minute, held messages go out oldest first while the hour is under the cap again (status `new`, the team mail, the
  thank-you, the CRM and the lead as for any message, "let through" in the history). Nobody can set `held` by hand;
  a person may still mark a held message handled or spam.
- **Spam:** kept with status `spam` and answered like a real message (`200`), so a bot learns nothing; nobody is
  told or mailed. The reasons (column `spam`): `honeypot`, the hidden field filled in; `no-page`, the form has a
  `started` name but the post has no start time (the page's script always sends one, so the post did not come from
  the page: a script posting straight to the form, Origin forged); `too-fast`, a `started` time less than
  `minSeconds` (3) ago (a start time up to a day ahead of the server's clock is a visitor's clock running fast and
  goes through; further ahead is `no-page`); `no-human`, the form has `human` and the post has no good pass (below),
  the one spam answered `400` instead (see there).
- **The human check** (`human`, opt-in, Cloudflare Turnstile; forms/human.mjs): the page shows Cloudflare's widget
  with the public `siteKey`, and the widget posts a one-time pass as `cf-turnstile-response` (`human.field`). Before
  the message is stored Markstage asks Cloudflare (siteverify, 5 s at most) with `<env>_SECRET` from the environment
  (`TURNSTILE_SECRET` by default) and the visitor's address. No pass, or one Cloudflare refuses (bad, old, used
  twice) or one made for another host than `siteHosts`, or for another widget action than `human.action`: kept as
  `no-human` spam, nobody mailed, and answered `400 {error: "Our spam check did not go through. Please reload the
  page and send the form again."}`, never a thank-you, because a real visitor may be behind it (a pass that expired
  while the page slept, a page older than the check); telling a bot so is no help to it, it still needs a pass.
  Cloudflare's error codes decide, its HTTP status only when it gives none. Cloudflare out of reach, or our secret
  missing or wrong: the message goes through as usual, so a real visitor is never lost to an outage, and its history
  says "let through without the human check" and why. Cloudflare is only asked when nothing else gave the bot away, and not at all from an address or network over
  its day's cap (`429` first).
  The secret is never logged, audited or kept; Cloudflare's test secrets (`1x…AA` passes, `2x…AA` fails) work on a
  local machine.
- **Fields:** only the form's own fields are kept (anything else posted is dropped). Text loses control characters,
  one-line fields lose line breaks; `required`, `min`, `max`, `type` (`email`, `tel`: 7 to 15 digits, and a +1 number must have an area code and exchange that can exist, `url`: http(s))
  and `options` are checked: `400 {status: 400, error, fields: {key: message}}`.
- **Then:** the message is stored, and only then `200 {status: 200, message}` (a page with no script,
  `Sec-Fetch-Mode: navigate`, gets `303` to `thanks`): the answer never waits on mail. Editors and above get a `form.message` notice, and the alert channels carry it: the email is the team mail (every
  field and where the visitor came from, `Reply-To` the visitor, subject `team.subject`). With `reply` (or one set
  in Settings → Forms, below), the visitor gets the thank-you mail through `notify.email`, from the alerts' sender
  name (greeted by name unless the name looks like a link or an address). A team mail that fails is kept on the
  message (`alert: 'failed'`, the reason, its history) and tried again after 5, 15, 60, 240 and 720 minutes, then
  daily, 12 tries in all; Site health counts them (`forms: {alertFailed}`).
- **Place:** with a city database on the server (docs/DEPLOY.md "Forms"), `meta.location` is the approximate place
  of the visitor's address ("Toronto, Ontario, Canada"), looked up when the message comes in; never what was posted.
  Its parts (city, region, country code) are kept beside it for a CRM's own fields (not in the API).
- **CRM:** a form with `crm` (docs/CONFIG.md) also sends each message to Odoo as a lead, after the answer (below,
  "Odoo"). Spam never goes, and nor does anything outside production.
- **Retention** (hourly): messages are kept forever unless the form sets `keepDays`; spam goes after 30 days, and
  the visitor's address and browser are cleared after 30 days (`forms.retention` in the audit with the counts).

The Inbox: every message from the site's forms and the viewer's own alerts in one list (editor and above; owner and
administrator also delete, export and see addresses). A message is `new`, `handled`, `spam` or `held` (by the server, during a flood), can be given to a
person, and gets notes for the team; an alert is `new` until seen (`handled`).

- `GET inbox?q=&kind=message|alert&status=new|handled|spam|held&form=&service=&assignee=<user id>|none&alert=failed&crm=failed&from=&to=&page=`
  → `{items, total, page, pages, perPage: 50, facets: {forms: [{id, label, count}], services: [{value, count}],
  status: {new, handled, spam, held}, alertFailed, crmFailed}, credits}`, newest first. `credits`: the line the city database asks
  to show with its places (DB-IP's: "IP Geolocation by DB-IP (https://db-ip.com), CC BY 4.0"), or null. A message item: `{id, kind: 'message', at, status, form, formLabel, from:
  {name, email}, service, summary, assignee: {id, name} | null, imported: {from: 'wordpress', id} | null, alert: null | 'pending' |
  'sent' | 'none' | 'failed', crm: null | {state: 'pending' | 'sent' | 'failed', name: 'Odoo', leadId, error}}` (`error`: why, when failed); an alert:
  `{id, kind: 'alert', at, status, alertKind, level, link, summary, assignee: null}`. Spam is left out unless asked
  for; `form`, `service`, `assignee`, `alert`, `crm`, `status=spam` and `status=held` list messages only. `q` finds text in the name, email, fields
  and context, and in an alert's words (`%` and `_` are literal). `from` and `to` are days (`2026-10-28`, UTC). `400`
  in words for anything else. The `form.message` alerts are the messages themselves, so they are not listed twice.
- `GET inbox/:id` → the item plus `fields: [{key, label, type, value}]` (in the form's order; a field the form no
  longer has under its own name), `meta: {page, referrer, landing, referringDomain, utmSource, utmMedium,
  utmCampaign, location}` (owner and administrator also get `ip` and `userAgent`), `spam`, `alertTries`, `alertError`,
  `alertNextAt`, `crmTries`, `crmError`, `crmNextAt`, `crmAt`, `notes: [{id, at, by: {id, name}, text}]`, `history: [{at, by: {id, name} | null, change}]` and `version` (`r<n>`; an alert: `seen` or
  `unseen`). `404` for another person's alert.
- `PATCH inbox/:id {status?, assigneeId?, version}`: `409 stale` with `current` when someone changed it meanwhile.
  `assigneeId` is an active editor, administrator or owner (or `null`); they get a `form.assigned` alert. Each change
  goes in the history ("marked it handled", "gave it to Sam") and is audited `inbox.change` `{form, status?: {from,
  to}, assignee?: {from, to}}`, never the message text. On an alert only `status` (seen or not); giving it or spam
  is `400`.
- `POST inbox/:id/notes {text}` (at most 5000 characters) → `201 {id, at, by, text}`; audited `inbox.note`.
- `POST inbox/:id/crm` ("Send to Odoo again"; editor and above): one try now → the message, or `502 crm-failed`
  `{message: "Not sent: …", item}`. `409 sent` when it is in Odoo already, `409 not-for-crm` for a message its form
  did not send (or that came from WordPress: old leads are never sent again). Audited `inbox.crm` `{form, lead}`
  with `ok`.
- `DELETE inbox/:id` (owner, administrator; with its notes and history): audited `inbox.delete` `{form, at, status}`.
- `GET inbox.csv?…the same filters` (owner, administrator): every matching message (`inbox.csv`), columns
  `reference, form, at, status, assigned to`, one per field, the context values, `notes`, `imported from`,
  `imported id`; a cell starting with `=`, `+`, `-` or `@` is made text. Audited `inbox.export` with the count.

The thank-you mail (Settings → Forms; owner, administrator): the site's `forms.<id>.reply` gives the first words; a
change here is kept in `<dataDir>/forms-settings.json` (0600) and wins until it is put back. `GET site/forms` →
`{version, siteName, variables, forms: [{id, label, canReply, reply: {subject, text} | null, fromConfig, changed}]}`;
`PUT site/forms/:id/reply {version, on, subject, text}` (`on: false`: none) and `DELETE site/forms/:id/reply
{version}` (back to the site's own): `409 stale`, `404` for no such form, `400` in words; audited `forms.reply`.

Old WordPress contact messages come in with `markstage-server forms import-wordpress` (docs/DEPLOY.md "Forms").
They are never sent to Odoo: WordPress kept no record of which went (its `wp_contact` table has no such column).

### Odoo

A form with `crm: {kind: 'odoo', source, …}` (docs/CONFIG.md "Forms") sends each message to Odoo as a lead, the way
the old WordPress theme did (`functions.php` `odooInsert`), over XML-RPC (`src/forms/crm.mjs`, `xmlrpc.mjs`):

1. `/xmlrpc/2/common` `authenticate(db, email, password, {})` → the user id.
2. `/xmlrpc/2/object` `execute_kw` `search` on `utm.source` (`name` = `crm.source`), `res.country` (`code` = the
   visitor's country code) and `res.country.state` (`name` = the visitor's region): the first id, or `false`. They
   are looked up, never created, as before. No place: no country or state search.
3. `crm.lead` `create` with the old theme's keys and values:

| Odoo field | Value |
|---|---|
| `name`, `contact_name` | the form's `name` field |
| `email_from` | the form's `email` field |
| `phone` | `crm.phone` (default the `phone` or `number` field) |
| `mobile_country_code` | the visitor's country code from their address (the city file), in capitals, e.g. `CA`; nothing found: empty |
| `description` | `crm.description` (default the first long text): tags out, on one line, HTML-escaped (WordPress's `sanitize_text_field` then `esc_html`) |
| `country_id`, `state_id`, `source_id` | the ids found above, or `false` |
| `city` | the visitor's city from the city database (empty without one) |
| `url`, `referred`, `landing_url`, `refering_domain` | `meta.page`, `meta.referrer`, `meta.landing`, `meta.referringDomain` |
| `is_auto_created` | `true` |

Left out on purpose: the file attachment (the old handler attached a server file named in the request) and its
`res.users` search (its answer was never used). Ids go as numbers and a missing one as `false`; the old code sent
the source id as text and a missing id as `0` or `""`, which Odoo reads the same way.

### Leads for analytics (Skald)

A form with `leads: {kind: 'skald', url, …}` (docs/CONFIG.md "Forms") also tells an analytics tool about each real
message, as a lead, so the tool can count it and join it to the visit (`src/forms/leads.mjs`). Skald only for now,
signed exactly as Skald's own `skald-lead.cjs` signs it:

- `POST <leads.url>` (Skald's lead hook, `https://app.skaldanalytics.com/traffic-hooks/<site>/lead`), JSON, with
  `X-Skald-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.
- The lead: `external_ref` (the message's id, so a repeat is never counted twice), `action` (`leads.action`, default
  `contact`), `email` and `name` (the form's fields), `ip` (the visitor's address as Markstage recorded it: the
  connection, or the hop a trusted proxy appended; Skald looks up the country and drops it), `vid` (the visitor id
  the page posted in `leads.vid`, Skald's `skald('id')`, when it is one), `test: true` (when the page posted `1` in
  `leads.test`: a team's own test, which Skald keeps out of its counts).

Spam (the honeypot, no start time, a form sent too fast, no human-check pass) never goes, and nothing goes outside production. It runs after the message
is stored and the visitor answered; a send that fails is tried again like the Odoo push (5, 15, 60, 240, 720 minutes,
then daily; given up after 12 tries). Each outcome is in the message's history ("sent to Skald as a lead", "not sent
to Skald as a lead: …"), `GET /inbox/:mid` has `lead` (how it went), and Site health counts the ones that did not
go. The secret is read from the environment at each send (`SKALD_LEAD_SECRET`; `leads.env` picks another prefix) and
is never written, logged or audited.
`test/odoo.test.mjs` reads the keys out of a verbatim copy of the theme's `$leadData` array
(`test/odoo-lead-data.php.txt`) and checks that the lead the stand-in Odoo gets has those keys and no others, so a
field left out or renamed fails it.

When: after the message is stored and the visitor answered, never in the way of it. It is marked `pending`, then
`sent` with the lead's id (`crm.leadId`; history "sent to Odoo (lead 123)"), or `failed` with the reason in words
(`crmError`), tried again after 5, 15, 60, 240 and 720 minutes, then daily, 12 tries in all (history "not sent to
Odoo: …", then "gave up…"); "Send to Odoo again" tries at once. Site health: `forms.crm: {forms: [{form, label, kind,
name, on, problem}], failed}`.
In the editor's Inbox: a "Not sent to Odoo" mark on the message (why on hover or focus, with a copy icon), the
filter `#/inbox?crm=failed` with its count ("2 messages not sent to Odoo"), and in the message's drawer
(`&open=<id>`) its tries, when it is tried next, why, and "Send to Odoo again", which shows the server's words when it
is refused (`502` "Not sent: …", `409` "It is in Odoo already (lead N)."). Proof: `e2e/inbox-odoo.e2e.mjs`.

The connection is read from the environment at each push, never from a file in the repo: `<env>_URL` (https; http
only on this machine; no sign-in in it), `<env>_DB`, `<env>_EMAIL`, `<env>_PASSWORD`, and `<env>_ENABLE` = `true`
(`env` defaults to `ODOO`: the old theme's names). Without `_ENABLE=true` nothing is marked or sent, as before;
anything else missing fails in words that name the variable. The values are never logged, audited, kept or
answered: an error that quotes one has it replaced by `[hidden]`.
