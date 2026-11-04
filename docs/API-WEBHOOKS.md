# Markstage API: webhooks

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). A webhook tells another system
when something happens on the site: an entry is saved or published, a media file is added, the site goes live. Each
one is a named address that listens to the events it lists. Server code: `packages/server/src/webhooks/`.

- **Signed.** Each request is signed with the hook's own secret (HMAC-SHA256 of the time and the body), so the
  receiver knows it came from this server and was not replayed.
- **Tried again.** An address that does not answer 2xx is tried again after 1, 5, 30, 120 and 360 minutes; after the
  sixth try the delivery is given up and the owner and administrators get a "A webhook could not deliver an event"
  alert (kind `webhook.failed`, Settings → Alerts).
- **Logged.** Every delivery is kept for 30 days: the event, what was sent, each try's answer code, the first 500
  characters of the answer, how long it took.
- **Secrets stay in.** The secret is shown once, when it is made, and never again. A payload names what changed,
  never its text, a person's email or a secret. An answer kept in the log has the server's secrets and the hook's own
  secret replaced by `[hidden]`; an address is shown with its sign-in and query values hidden.
- **Public addresses only.** The address passes the same SSRF guard as the Library's import when it is saved and
  again at every send (public addresses only, checked after DNS, ports 80 and 443; docs/SECURITY.md "Fetching from
  the web"), must be https, and a redirect is never followed.
- **Production only.** Outside production a delivery is kept as `held` and never sent, unless the environment's
  `keep` lists `"webhooks"` (docs/API-ENV.md). (`"webhook"`, singular, is the alerts' webhook channel: a different
  thing.)
- Owner and administrators.

## Events

| Event | When |
|---|---|
| `entry.created` | A new entry was made (in the editor, by an agent, as a copy of another) |
| `entry.saved` | An entry was saved (also its source, in the source view) |
| `entry.imported` | An import created or updated an entry (docs/API-IMPORT.md) |
| `entry.published` / `entry.unpublished` | An entry was published or taken off the site |
| `entry.scheduled` | An entry was scheduled to publish later |
| `entry.moved` | An entry got a new id and address (`entry` is where it is now, `from` where it was) |
| `entry.deleted` / `entry.restored` | An entry went to the trash or came back |
| `release.published` | A release was published (docs/API-RELEASES.md) |
| `media.added` / `media.deleted` | A media file was uploaded, edited into a copy, added from stock or imported; or deleted |
| `site.live` | A job that deployed the site finished: the change is live |
| `site.failed` | A job failed at its build or deploy step |
| `ping` | A test from Settings (`POST webhooks/:wid/test`); never listed, always sent |

Events come from the audit log, after the thing is done: a save that was refused is no event.

## Hooks

| Route | Body | Answer |
|---|---|---|
| `GET webhooks` | | `{items: [hook], events: [string]}` |
| `POST webhooks` | `{name, url, events, active?}` | `201 {webhook: hook, secret}`: the secret is shown here only |
| `PATCH webhooks/:wid` | any of `{name, url, events, active}` | `{webhook: hook}` |
| `DELETE webhooks/:wid` | | `{ok: true}`; its pending deliveries are given up |
| `POST webhooks/:wid/secret` | | `{secret}`: a new one, shown once; the old one stops at once |
| `POST webhooks/:wid/test` | | `202 {delivery: {id}}`: a `ping`, sent now |

A hook: `{id, name, url, host, events, active, createdAt, updatedAt, last: {status, answer, at} | null, failing}`.
`url` has its query values hidden (`?token=[hidden]`); `failing` counts deliveries that were tried and not taken.

| Field | Rule | `422 invalid` with `field` |
|---|---|---|
| `name` | 1 to 80 characters | `name` |
| `url` | https, a public address, on port 443, no sign-in in it, at most 2000 characters | `url` |
| `events` | a non-empty list of the events above | `events` |
| `active` | true or false (default true) | `active` |

At most 20 hooks a site (`409 too-many`). Each change is audited (`webhook.create`, `webhook.update`,
`webhook.delete`, `webhook.secret`, `webhook.test`, `webhook.retry`) with the address's host only.

## Deliveries

| Route | Answer |
|---|---|
| `GET webhooks/:wid/deliveries?status=&page=&perPage=` | `{items: [delivery], total, page, perPage}`, newest first; `status` is `pending`, `delivered`, `gave-up` or `held`; `perPage` at most 200 (default 50) |
| `POST webhooks/:wid/deliveries/:did/retry` | `202 {delivery: {id}}`: one more try now; a delivered one is `409 delivered` |

A delivery: `{id, event, status, attempts, nextAt, answer, error, answerText, lastAt, durationMs, deliveredAt,
createdAt, payload}`. `answer` is the HTTP code of the last try, `answerText` the first 500 characters it said
(scrubbed), `error` why it was not taken, `nextAt` when it is tried again (`null` once delivered or given up).

## The request

```
POST <the hook's url>
Content-Type: application/json
User-Agent: Markstage/1 (webhook)
Markstage-Event: entry.published
Markstage-Delivery: wd_…
Markstage-Signature: t=1761728400,v1=5f2b…

{"id":"wd_…","event":"entry.published","at":"2026-10-29T09:00:00.000Z",
 "site":{"name":"Halden Logistics","url":"https://example.com"},
 "actor":{"id":"u_…","name":"Alice"},
 "entry":{"collection":"posts","id":"moving-day","url":"/blog/moving-day/"},
 "commit":"3f1c…"}
```

| Key | What |
|---|---|
| `id` | The delivery's id, the same on each try: a receiver can skip one it has seen |
| `event`, `at` | The event and when it happened |
| `site` | The site's name and address |
| `actor` | Who did it (`id: null` for the scheduler), by name |
| `entry` | `{collection, id, url}` for `entry.*` (`url`: the page's path, `null` when it has none) |
| `from` | `{collection, id}`: where a moved entry was |
| `release` | `{id}` for `release.published` |
| `job` | `{id, kind, step?}` for `site.live` and `site.failed` (`step`: where it failed) |
| `media` | `{id, paths, count?}` for `media.*`: the file's id (`null` for a batch) and paths under the site repo; `count` for a batch delete |
| `commit` | The commit the change made, when there is one |

Answer 2xx within 10 seconds to take it; anything else (or no answer, or a redirect) is tried again. The receiver's
answer is read up to 64 KB.

### Checking the signature

`Markstage-Signature` is `t=<unix seconds>,v1=<hex>`, where hex is HMAC-SHA256, keyed with the hook's secret, of
`<t>.<the raw body>`. Check it on the raw bytes, before parsing, with a constant-time compare, and refuse a `t` more
than five minutes old:

```js
import crypto from 'node:crypto';

function fromMarkstage(secret, header, rawBody, now = Date.now()) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (!t || !v1 || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return v1.length === want.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(want));
}
```

After `POST webhooks/:wid/secret` the old secret no longer signs: update the receiver with the new one.

Tests: `packages/server/test/webhooks.test.mjs`.
