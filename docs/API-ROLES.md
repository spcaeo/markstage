# Markstage API: custom roles

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). The five built-in roles
(docs/API-PERMISSIONS.md) fit most sites. A custom role fits the rest: a translator who changes one locale's words
of any page and nothing else, an author who also answers the site's forms, an editor who may not upload, a
contractor who edits pages but never deletes during a freeze. Server code: `packages/server/src/custom-roles/`.

- **Built on a base role.** A custom role names one of `administrator`, `editor`, `author` or `contributor`. A
  person given it has that base as their `role` (so every rank in the table still holds) and the custom role on top.
- **Rules in the promotion rules' shape.** The same engine as Environments (docs/ENVIRONMENTS.md "Promotion rules",
  `env/rules.mjs`) decides which rules apply: `action`, `what` (kinds and paths), `when` (hours and freezes) and
  `effect` read the same in both, and are checked by the same code.
- **Deny wins; an allow adds; no rule leaves the base.** A rule that denies takes a right away. One that allows gives
  a right the base lacks, but never one that is the owner's and administrators' only (managing people, the audit
  log, webhooks, code on the site, backups, rollbacks): those are refused when the role is saved. When no rule
  applies, the base role decides, as if there were no custom role.
- **In this environment.** Roles live in the server's database, like its people, and are not promoted.
- The owner and administrators make, change, remove and give them; a role built on `administrator` is the owner's
  alone to make, change, remove or give. Every change is audited (`role.create`, `role.update`, `role.delete`,
  `user.update` with `customRole`) and tells the administrators ("A custom role was made, changed or removed", kind
  `roles.changed`, a safety alert).

## A role

```json
{
  "id": "translator-fr",
  "name": "French translator",
  "base": "contributor",
  "rules": [
    { "id": "fr-words", "name": "Edits the French words of posts", "action": ["entry.edit"],
      "collections": ["posts"], "fields": ["locales.fr-ca.**"], "effect": "allow" },
    { "id": "no-live", "name": "Never publishes or deletes", "action": ["entry.publish", "entry.delete"], "effect": "deny" }
  ]
}
```

| Key | What |
|---|---|
| `id` | `^[a-z][a-z0-9-]{0,39}$`, not a built-in role's name; fixed once made |
| `name` | What people see (at most 60 characters) |
| `base` | `administrator`, `editor`, `author` or `contributor` |
| `rules` | At most 50 (below); at most 30 roles a site |

A rule:

| Key | What |
|---|---|
| `id`, `name` | Unique in the role; the name is how a refusal explains itself |
| `action` | Entry actions `entry.create`, `entry.edit`, `entry.publish` (also schedule and unpublish), `entry.delete`, `entry.rawHtml`; or abilities by name (`inbox.read`, `media.upload`, `site.publish`, …: `GET roles` lists them with the least built-in role that has each) |
| `effect` | `allow` or `deny` |
| `collections` | Entry actions only: the collections it is about (default: all) |
| `own` | Entry actions only: `true` = only the person's own entries (their `authorSlug` is the entry's author) |
| `what` | Entry actions only: `{only, not, any}` of kinds (`pages`, `menus`, `media`, `data`, `content`, …) or paths (`src/content/blog/**`), as in the promotion rules |
| `when` | `{windows: [{days, from, to, tz}], freezes: [{from, until?, words?}]}`, as in the promotion rules: an allow applies only inside its hours and not during a freeze; a deny with freezes applies only during one |
| `fields` | One allow rule on `entry.edit` only: the keys its edit may change, as dotted globs (`locales.fr-ca.**`, `seo.*`, `title`); `body` is the Markdown body. When every rule that allows an edit names fields, a save that changes anything else is `403` with `{allowed, outside}` |

Things to know:

- **A live entry.** Saving a live or scheduled entry needs the publish right (the change goes live). A rule of the
  person's own role that allows `entry.edit` on it covers that too, without the publish right: a translator corrects
  live pages' words but cannot publish, schedule or unpublish them.
- **Someone else's entry.** An allow without `own` lets the person save others' entries in its scope; the entry
  keeps its author (a non-editor otherwise only writes under their own name).
- **The editor knows.** An entry's `can` (`GET collections/:c/entries/:id`) then has `fields`: the globs its edit
  may change, so the editor shows the rest read-only (packages/editor/src/field-access.ts, the same matching as the
  server): a banner says what the role changes; the title, the text and its blocks' settings, and every Post settings
  field outside the globs are greyed out but still readable and copyable (a picture setting counts when every key it
  writes is covered); "Draft translation" offers only the regions it covers; the Source view is read-only (it is the
  whole file); a save sends only the covered keys. A page in the pages editor does the same (packages/editor/src/pages):
  every change goes through the page model, which keeps only the covered keys; the panel's fields outside the globs
  are greyed out, the page's words outside them can't be typed into on the canvas, and unless the role covers
  `sections` no section can be added, moved, duplicated or deleted (the outline, the grip menu and drops on the canvas
  say why). A person who may only read the page (`can.edit` false) sees all of it greyed out, with that reason.
- **The server's own stamps don't count.** A page's `modified` date is set by the server on every save, so it is
  not a field the person changed: a role that covers `sections` saves a section edit without also needing `modified`.
- **Fields come from the save itself.** The check compares the file before and after, whichever route the text came
  by (the editor, the source view, an import, an agent), so it cannot be gone around.
- **Agents.** An AI assistant's token (docs/API-MCP.md) acts as its person, custom role included: a translator's
  agent changes the same words and nothing else. What an agent may read follows the base role (docs/API-MCP.md
  "Reads follow the role").

## Routes

| Route | Body | Answer |
|---|---|---|
| `GET roles` | | `{builtin, bases, custom: [role], actions: {entry, abilities: [{name, min}]}, kinds, collections: [{id, label}]}` |
| `POST roles` | a role | `201 {role}` |
| `PUT roles/:rid` | `{name, base, rules, version}` | `{role}`; `409` with `current` when it changed since it was loaded. A new base moves its people to that rank |
| `DELETE roles/:rid` | | `{ok, people}`: the people with it keep its base role |
| `POST roles/check` | `{userId, action, collection?, id?}` | `{user, action, allowed, by: 'rule' \| 'base', rule, fields, words, trace: [{rule, matched, why}]}`: a dry run of what that person may do now, and why |

A role as answered: `{id, name, base, rules, version, people, updatedAt}`. A mistake is `422 invalid` with `field`
and the reason in words, for example "users.manage stays with the owner and administrators: a custom role may take
it away (deny), not give it."

**In the editor**, Settings → Roles (`#/settings/roles`) lists the roles with their rules as sentences, makes and
changes them (`?role=<id>`, `?role=new`, a rule's form at `&rule=<id>`, the changes kept for the tab until Save) and
asks "What may they do?" (`&as=<uid>&do=<action>&in=<collection>&entry=<id>`: POST roles/check, with each rule's
part). A role built on administrator shows only to the owner as one to change. Proof: `e2e/roles.e2e.mjs`.

A person is given a role with `PATCH users/:uid {customRole: "<id>"}` (docs/API.md "Users"); `{role: "<built-in>"}`
takes it away. `User.customRole` is `{id, name}` or null.

Tests: `packages/server/test/custom-roles.test.mjs`.
