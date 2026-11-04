# Markstage API: single sign-on (OpenID Connect)

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). A site whose people already
sign in somewhere (Google Workspace, Microsoft Entra ID, Okta, Auth0, Keycloak, any OpenID Connect provider) lets
them sign in to Markstage there: "Sign in with <provider>" on the sign-in screen. Server code:
`packages/server/src/auth/sso.mjs` (the routes), `oidc.mjs` (the provider and the ID token), `sso-config.mjs` (the
config).

- **A person is found, not guessed.** First by the provider's own id for them (`sub`, linked on their first sign-in
  there), else by their email when the provider says it is verified (an invited person), else made, when the
  provider's `autoCreate` allows their email's domain. Anyone else is turned away (`no-account`).
- **The role is Markstage's.** The provider says who someone is, never what they may do: an invited person keeps the
  role they were invited with, a person made by `autoCreate` gets its role (`contributor`, `author` or `editor`;
  administrators are made by a person), and the owner and administrators change it in Users as usual.
- **Two-step sign-in is still the person's own.** Someone with it on gives their code after the provider, as after a
  password.
- **The password can stay, or be the owner's alone.** With `passwordLogin: false` only the owner signs in with a
  password, for when the provider is down; everyone else is sent to the provider (`403` on `POST auth/login`).
- **Nothing the provider sends is kept** but the link (provider, `sub`, the email it gave last, when). Every step is
  audited: `auth.sso` (signed in), `auth.sso.fail` (and why), `auth.sso.link`, `auth.sso.unlink`, `user.create` with
  `via: "sso:<id>"`; a person made by `autoCreate` tells the administrators (kind `user.invited`).

## Config (the server's config.json)

```json
{
  "sso": {
    "providers": [
      { "id": "google", "label": "Google", "issuer": "https://accounts.google.com", "clientId": "1234.apps.googleusercontent.com",
        "domains": ["example.com"], "autoCreate": { "role": "author" } }
    ],
    "passwordLogin": true
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `providers` | | One to five providers. |
| `providers[].id` | | A short lowercase name (`google`, `entra`). It is in the redirect URI and the secret's variable. |
| `providers[].label` | the id | The name on the button: "Sign in with Google". |
| `providers[].issuer` | | The provider's issuer URL, exactly as its discovery document names it (`<issuer>/.well-known/openid-configuration`). https (http only for a loopback provider outside production). |
| `providers[].clientId` | | The client id the provider gave this site. |
| `providers[].clientSecretFile` | | An absolute path outside the content repo holding the client secret, when it is not in the environment. |
| `providers[].scopes` | `["openid", "email", "profile"]` | Must include `openid` and `email`. |
| `providers[].domains` | any | Only emails at these domains get in through this provider (checked on every sign-in, linked or not). |
| `providers[].autoCreate` | none | `{role}`: a person at one of `domains` with no account gets one on their first sign-in. Needs `domains`. |
| `passwordLogin` | `true` | `false`: passwords for the owner only. |

**The client secret** is `MARKSTAGE_SSO_<ID>_SECRET` in the server's environment (`<ID>` the id in capitals, `-` as
`_`: `MARKSTAGE_SSO_GOOGLE_SECRET`), or the file named by `clientSecretFile`; never config.json (a `clientSecret` key
is refused). It is read at each sign-in, so a new one is used without a restart, and it is scrubbed from every answer
and log. The server does not start without it, nor with a key it does not know, an http issuer in production,
`autoCreate` without `domains` or with `administrator`, or scopes without `openid` and `email`: each in words.

**At the provider**, register a web client with this redirect URI (the public origin and the editor's base path):

```
https://cms.example.com/markstage/api/auth/sso/<id>/callback
```

## Routes

| Method + path | Body | Answer |
|---|---|---|
| `GET auth/sso` *(pre-auth)* | | `{providers: [{id, label}], passwordLogin}`; `{providers: [], passwordLogin: true}` with no `sso` |
| `GET auth/sso/:id/start?next=<hash>` *(pre-auth)* | | `302` to the provider. `next` is where the editor opens after (`#/…`, never sign-in, setup or accept-invite; anything else is `#/`) |
| `GET auth/sso/:id/callback` *(pre-auth)* | | `302` into the editor at `next`, signed in; or to `#/sign-in?step=code&via=sso&next=` for the two-step code; or to `#/sign-in?sso=<why>&provider=<id>` |
| `POST auth/login/2fa` *(pre-auth)* | `{code}` or `{recoveryCode}`, no `challenge` | After `via=sso`: the challenge is in its cookie. `{user, csrfToken}` + cookie |
| `GET users/:uid/sso` | | `[{provider, label, email, createdAt, lastAt}]` the providers this person is linked to (owner, administrator) |
| `DELETE users/:uid/sso/:provider` | | `{ok}`; their next sign-in there links again by their verified email (`404` when there is no link) |

`<why>`, the word the sign-in screen turns into a sentence:

| `sso=` | When |
|---|---|
| `expired` | No state for this browser, used already, for another provider, or older than 10 minutes |
| `denied` | The provider sent `error` (the person cancelled, or the provider refused) |
| `provider` | The discovery document, the token exchange or the ID token did not pass (the audit's `auth.sso.fail` says which check) |
| `domain` | The email is not at one of the provider's `domains` |
| `email` | No link yet, and no verified email to find the person by |
| `no-account` | No person with that email, and no `autoCreate` for it; or the person is linked to another account at this provider |
| `disabled` | The account is turned off |
| `unknown` | No such provider |

## What is checked

- **The state, bound to the browser.** `start` makes a random state, nonce and PKCE verifier (S256), keeps them on
  the server (the state as a hash) for 10 minutes, and puts the state in an HttpOnly cookie
  (`__Host-markstage-sso`, `SameSite=Lax` so it comes back on the provider's redirect). The callback needs the
  state in the URL to equal the cookie and an unused row for this provider; it is used once. So a sign-in started in
  one browser cannot be finished in another (no signing someone in as the attacker), and a callback URL cannot be
  replayed.
- **The provider.** Its discovery document must name the configured issuer; it is kept an hour. Its keys are fetched
  again, at most once a minute, when a token names one not seen yet. Every call goes through the SSRF guard
  (docs/SECURITY.md): public addresses only, sizes and times capped. The token request sends the client secret in
  the body (`client_secret_post`) and the PKCE verifier, with no redirect followed.
- **The ID token.** Signed with RS256, PS256 or ES256 by a key the provider lists (never `none`, never HMAC), the key
  of the right type; `iss` the issuer; `aud` this client (and `azp` when there are several); `exp` not passed and
  `iat` not ahead (60 seconds' leeway); `nonce` this sign-in's; `sub` present. Anything else is `sso=provider`.
- **The two-step challenge** for a person with it on goes in an HttpOnly cookie (`__Host-markstage-sso-step`,
  5 minutes, cleared when used), never in the URL; it allows 5 codes like a password sign-in's.
- **Sessions** are the same as after a password: the browser's previous session revoked, a new token and CSRF
  token, the new-device alert.

**In the editor.** The sign-in screen shows "Sign in with <label>" for each provider and, back from one that did not
work, why (`?sso=<why>`); with `passwordLogin: false` the password form is behind "Owner: sign in with a password"
(`with=password`). When a session ends while an entry is open, "Sign in again" offers the providers too: the unsaved
changes go to this browser's recovery copy first, the page goes to the provider and comes back to the same address,
and the entry offers the changes back (Restore). Where no copy can be kept (a page in the pages editor, a browser
without IndexedDB) it says so before leaving. Proof: `e2e/sso.e2e.mjs`.

Proof: `packages/server/test/sso.test.mjs` against a provider on loopback (`test/fake-oidc.mjs`): the sign-in by
email then by `sub` after the email changed, state from another browser and replay refused, an external `next`
dropped, seven tampered tokens refused (stranger key, `none`, HS256, issuer, audience, nonce, expiry), unverified
email, unknown person, disabled person, a domain not allowed, `autoCreate` making an author, two-step sign-in after
the provider, links listed and undone, passwords for the owner only, and the config's refusals.
