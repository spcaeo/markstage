# Markstage API: integration fields

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). An integration field is a
Post settings choice whose options come from another system: a product catalogue, a list of offices, a CRM's
plans. The server fetches the list from a JSON address on a schedule and keeps it; editors pick from it as they
type; a save keeps the field to the list. Server code: `packages/server/src/integrations/`.

- **Fetched by the server, on a schedule.** Each list is fetched when the server starts and then every `every`
  minutes. The editor never calls the other system: it reads the kept list.
- **Kept.** The last good list stays when a fetch fails, so editors still pick from it (marked stale). The failure is
  tried again after 15 minutes (or `every`, if shorter), and the owner and administrators get one "An integration's
  list of options could not be fetched" alert (kind `integration.failed`, Settings → Alerts) when it starts failing,
  not on every try.
- **Through the guard.** The address passes the same SSRF guard as the Library's import (public addresses only,
  checked after DNS and at each redirect, ports 80 and 443; docs/SECURITY.md "Fetching from the web"). A sign-in
  header goes to the first address's own site only: a redirect elsewhere is asked without it.
- **Capped.** At most `maxKB` read (default 1 MB, at most 5 MB; the size counts after unzipping) in 15 seconds; at
  most 5000 options kept; each value, text and detail one line of at most 200 characters.
- **Secrets stay out.** A sign-in comes from a `MARKSTAGE_INTEGRATION_*` environment variable or a file outside the
  repo (a Docker secret), read at each fetch (a new one is used without a restart). It is never in the config, an
  answer, the audit log or an error; the address is shown by its host only.
- Every signed-in role reads the lists; editors and up fetch one again now.

## The config

In markstage.config (server only; docs/CONFIG.md "Top level"):

```js
export default defineConfig({
  integrations: {
    products: {
      label: 'Products',
      url: 'https://shop.example.com/api/products.json',
      every: 60,
      list: 'data.items',
      value: 'sku',
      text: 'name',
      detail: 'price',
      auth: { header: 'Authorization', scheme: 'Bearer', env: 'MARKSTAGE_INTEGRATION_SHOP' },
    },
  },
  collections: [
    { id: 'posts', format: 'md', dir: 'src/content/blog',
      settings: [{ type: 'select', key: 'product', label: 'Product', integration: 'products' }] },
  ],
});
```

| Key | Default | What |
|---|---|---|
| name (the key) | | `^[a-z][a-z0-9-]{0,39}$`; at most 20 integrations |
| `label` | the name | What the editor calls the list |
| `url` | required | The JSON address: https, no sign-in in it |
| `every` | `60` | Minutes between fetches, 5 to 1440 |
| `list` | the answer itself | Where the list is in the answer (a key or a dotted path such as `data.items`) |
| `value` | required | The key (or dotted path) of each item that is stored in the entry |
| `text` | required | The key of each item that is shown (the value when an item has none) |
| `detail` | none | A key shown beside it (a price, a code) |
| `maxKB` | `1024` | The largest answer read, 1 to 5120 |
| `auth` | none | `{header = 'Authorization', scheme?, env}` or `{header, scheme?, keyFile}`: `env` names a variable that starts with `MARKSTAGE_INTEGRATION_` (so the config cannot send another of the server's secrets), `keyFile` an absolute path outside the site repo. The header is `<scheme> <secret>`, or the secret alone without `scheme`. |

A setting picks from it with `{type: 'select', key, integration: '<name>'}`. A name that `integrations` does not
list stops the server's start, in words. Items with no value, or a value already seen, are skipped (counted in
`skipped`). Values are kept as strings: `40` is `"40"`.

## Routes

| Route | Answer |
|---|---|
| `GET integrations` | `{items: [integration]}` |
| `GET integrations/:name/options?q=&value=&limit=` | `{items: [option], total, current: [option], missing: [value], fetchedAt, stale, status}` |
| `POST integrations/:name/refresh` | `{integration}`: fetched now. Editors and up; once a minute (`429 too-soon` with `Retry-After`). Audited `integration.refresh`. |

An integration: `{name, label, host, every, status, fetchedAt, triedAt, nextAt, error, count, skipped, stale}`.
`status` is `ok`, `failed` (the last try failed; the list, if any, is the last good one) or `never` (not fetched
yet). `stale` is true when the last try failed or the list is older than two rounds. `error` says why, in words,
with any secret hidden.

An option: `{value, text, detail}`. `q` matches the text, value or detail, ignoring case. `limit` is at most 200
(default 50). Pass the entry's current value as `value` (repeatable) to get its words back in `current`, or to see
in `missing` that it has left the list. An unknown name is `404`.

## Saving

A save (every route that writes an entry: the editor, the source view, an import, an agent) is checked against the
kept list for each setting bound to an integration:

- the same value as before is kept, even when it has left the list since (nothing breaks when a product is
  retired; the editor shows it as gone);
- an empty value (or none) is fine;
- a new value must be in the list: else `422 invalid` with `fields: {<key>: "Not one of the Products options now."}`;
- before the first good fetch there is no list, and any value is taken.

Tests: `packages/server/test/integrations.test.mjs`.
