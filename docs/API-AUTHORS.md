# Authors

Ghost-style author management. The people a site's posts are by each have a profile, kept as one JSON file in the
site's own content (`src/content/authors/<slug>.json` by default), so the site's build reads them like any other
content and git keeps their history. A post names its author by slug, and may list co-authors.

What an editor sees:

- **Authors** (More menu, `#/authors`): every author with their role, slug, post counts and author page; add,
  edit, archive, change a slug, delete.
- **Post settings → Author**: a searchable list of the site's authors instead of a text box, "Add … as a new
  author" when the name is not there, co-authors as chips, and a plain warning (never an error) when the post names
  an author the site does not have.

Code: `packages/core/src/authors.mjs` (pure: config, profiles, checks, Person JSON-LD), `packages/server/src/authors/`
(the server's routes), `packages/astro/src/api-authors.mjs` (the same routes in `astro dev`),
`packages/astro/src/authors.mjs` (`@markstage/astro/authors`, the site's helpers), and in the editor
`src/admin/authors/` (the screen) and `src/settings/author-field.ts` (the field).

## Turning it on

In `markstage.config.mjs` (docs/CONFIG.md, key `authors`):

```js
export default defineConfig({
  authors: { coAuthors: 'coAuthors' },   // or `authors: true` for every default
  collections: [
    {
      id: 'posts', format: 'md', dir: 'src/content/posts', hasStatus: true,
      // a text or select setting of the author key becomes the author picker
      settings: [{ type: 'text', key: 'author', label: 'Author' }],
    },
  ],
});
```

| Key | Default | What it does |
| --- | --- | --- |
| `dir` | `'src/content/authors'` | The folder of `<slug>.json` files, inside the project. Never `.git`, never an md collection's folder. |
| `url` | `'/author/{slug}/'` | The author page, a site path with `{slug}`. It is the Person's `url`, the address the Authors screen shows (copy, open), and the redirect a new slug records. `null`: the site has no author pages. |
| `coAuthors` | `null` | The frontmatter key of the co-author list (slugs after the primary author). `null`: one author per post. |
| `organization` | `null` | The Organization `@id` a Person `worksFor` (an address such as `https://example.com/#organization`). |
| `collections` | every collection with a status | The collections whose author field names an author. |
| `fields` | below | The file's own keys for each profile field, over the defaults. `null` leaves a field out (not `name`): the editor does not offer it and nothing writes it. |

The default keys follow a common shape (`designation`, `avatar`, a nested `seo`), so an existing folder of author
files works as it is:

| Profile field | File key | Notes |
| --- | --- | --- |
| `slug` | `id` | Also the file name. Lowercase letters, digits and hyphens, at most 100. |
| `name` | `name` | Required. |
| `role` | `designation` | Job title or what they write about: the Person's `jobTitle`. |
| `bio` | `bio` | Markdown. |
| `photo` | `avatar` | A path inside the media folder (from the media library), a site path, or an address. |
| `email` | `email` | **Private.** Never in `@markstage/astro/authors`, never on a page; the server shows it only to editors and above and to the person themselves. |
| `website` | `website` | An https address; the first `sameAs`. |
| `social` | `social` | A list of profile addresses (LinkedIn, X, GitHub…): `sameAs`. At most 20. |
| `seoTitle` | `seo.title` | The author page's title in search results. |
| `seoDescription` | `seo.description` | The line under it. |
| `archived` | `archived` | `true`: kept with their posts, gone from the pickers and the hub. |

An entry names its author in its `author` field (the collection's `fields.author`). A value that is not a slug of
the site (an old free-text name) keeps working: the post is not touched, the picker shows a warning, and the next
save that changes the author picks a real one.

## The checks

- **On save.** An entry save (editor, Source mode, a new entry, bulk changes, the dev API) may not *add* an author
  the site does not have, or one that is archived: `422 unknown-author`, with `fields: {author: "…"}` and
  `authors: [{slug, problem: "unknown"|"archived", message}]`. An author the entry already named is left alone, so
  old posts still save.
- **In the build.** The integration's build step reads every entry of the author collections: one that names an
  author the site does not have fails the build, naming the file and the author:

  ```
  markstage: an entry names an author the site does not have (src/content/authors):
    src/content/posts/old.md: “guest-writer” is not one of the site's authors. Pick an author, or add “guest-writer” as an author first.
  ```

  An archived author passes (their old posts still build). `markstage({checkAuthors: false})` turns the check off.

## Routes

The same on the Markstage server (`/markstage/api/…`, signed in, each change one git commit by the person) and in
`astro dev` (no sign-in, no git). Every answer that is not a `GET` takes the author's `version` (the file's hash):
a stale one is `409 conflict`.

| Route | Does |
| --- | --- |
| `GET /authors` | `{items: [Author], can: {manage}}`, in name order, archived ones too (`archived: true`). `404 no-authors` when the site keeps none. |
| `GET /authors/:slug` | `{author, posts: [{collection, id, title, status, url, date, role: "author"\|"co-author"}], can: {edit, manage}}`; posts newest first. |
| `POST /authors {name, slug?, role?, …}` | Editors and above. `slug` defaults to one made from the name ("Ana María" → `ana-maria`); `409 slug-taken`. `201 {author}`. Commit `Add author <slug>`. |
| `PUT /authors/:slug {version, …fields}` | Change the profile: only the keys sent, and only the ones that differ, are written into the file (the rest stays byte for byte); an empty value takes the key out. Editors and above, and anyone for their own author (`authorSlug`), except `archived`. `{author}`. Commit `Update author <slug>`, or `Archive`/`Bring back author <slug>`. |
| `POST /authors/:slug/rename {version, to, movePosts}` | A new slug. With posts, `movePosts: true` is needed (`409 author-has-posts` with the posts otherwise): the file and every post that names them change in **one commit** (`Rename author a to b (N entries)`); live posts are published again; the old author page redirects to the new one (the site's redirects hook). `{author, moved, commit, job}`. |
| `DELETE /authors/:slug?version=&reassign=<slug>` | Delete. With posts, `reassign` is needed (`409 author-has-posts` with the posts otherwise): the posts go to that author (not archived) and the file goes, in **one commit**; a co-author already credited is not listed twice. `{ok, moved, commit, job}`. |

`Author` is the profile (the fields above) plus `url` (the author page, a site path, or `null`), `version`, `posts`
and `live` (how many entries name them, and how many of those are published). `email` is there only for editors
and above and the person themselves. Errors: `422 invalid` with `fields: {<field>: words}` (a name missing, a
website or profile link that is not an https address, a slug with other characters), and `422 posts-refused` when
any post to be changed would fail its own save checks: then nothing is changed.

Audit actions: `author.create`, `author.update`, `author.archive`, `author.rename`, `author.delete`. The ability is
`authors.manage` (editors and above, docs/API-PERMISSIONS.md).

A change to a profile is not published by itself (the site shows it after the next build): the screen's toast
offers **Publish now** when the author has live posts.

## The Authors screen

Every state is in the URL, so each can be linked to, reloaded and gone back from:

| Hash | Shows |
| --- | --- |
| `#/authors?q=&show=archived` | The list: photo or initials, name and role, slug (copy), posts and live posts (right-aligned), author page (copy, open). `q` searches name, role and slug; `show=archived` lists the archived ones. |
| `#/authors?action=new` | The "New author" form (editors and above). |
| `#/authors/<slug>` | One author on the right: the profile, the slug and author page (copy, open), the private email for those who may see it, website and profile links (copy, open), and their posts (open in the editor; their pages copy and open). Edit, Archive or Bring back, Change slug, Delete. |
| `#/authors/<slug>?action=edit&library=1` | The profile form; `library=1` while the photo's media library is open. |
| `#/authors/<slug>?action=rename&to=<slug>` | Change the slug: the new author page shown as it is typed; the posts that move with it listed. |
| `#/authors/<slug>?action=delete&to=<slug>` | Delete: with posts, they are listed and given to the author chosen in `to`. |

An author signed in as themselves (Users → author) sees the list and may edit their own profile; another author's
email and the add, archive, rename and delete actions are not there for them, and the server refuses them anyway.

## The site's pages: `@markstage/astro/authors`

```ts
import { getAuthors, getAuthor, getEntriesByAuthor, personJsonLd } from '@markstage/astro/authors';
```

| Helper | Gives |
| --- | --- |
| `getAuthors({archived?})` | Every author in name order (archived ones only with `archived: true`): the profile without the email, with `url`. |
| `getAuthor(slug)` | One author (archived too: old posts still credit them), or `null`. |
| `getEntriesByAuthor(slug, {collection?, coAuthored?})` | Their **published** entries, newest first: `{collection, id, title, url, date, role, data}`. Drafts, future-dated and protected entries are never in it (except in a preview build, `MARKSTAGE_PREVIEW=1`, which counts them all). `coAuthored: false`: only where they are the primary author. |
| `personJsonLd(author, {url?, image?, organization?, context?})` | schema.org `Person`: `@id` and `url` (the author page on `siteUrl`), `name`, `image`, `jobTitle` (the role), `description` (the search description), `sameAs` (website, then profile links), `worksFor: {"@id": organization}` when configured. A photo kept as a media path needs `image`, the address the site serves it at (a built image); a site path or an address is used as it is. `context: false` leaves out `@context` for an `@graph`. |

They read the files the config names, during the build and in `astro dev`; `authorsOf(cfg)` gives the same helpers
for a normalized config (scripts, tests).

### An author hub and author pages

The example blog has both (`examples/blog/src/pages/author/`).

`src/pages/author/index.astro`, the hub:

```astro
---
import { getAuthors, getEntriesByAuthor } from '@markstage/astro/authors';
const authors = await Promise.all((await getAuthors()).map(async (a) => ({ ...a, posts: (await getEntriesByAuthor(a.slug)).length })));
---
<ul>{authors.map((a) => <li><a href={a.url}>{a.name}</a> {a.role} · {a.posts} posts</li>)}</ul>
```

`src/pages/author/[slug].astro`, one page per author (archived ones too, so old links keep working):

```astro
---
import { getAuthors, getEntriesByAuthor, personJsonLd } from '@markstage/astro/authors';
export async function getStaticPaths() {
  return (await getAuthors({ archived: true })).map((author) => ({ params: { slug: author.slug }, props: { author } }));
}
const { author } = Astro.props;
const posts = await getEntriesByAuthor(author.slug);
const json = JSON.stringify(await personJsonLd(author)).replace(/</g, '\\u003c');
---
<div><script type="application/ld+json" set:html={json} /></div>
<h1>{author.name}</h1>
<ul>{posts.map((p) => <li><a href={p.url}>{p.title}</a></li>)}</ul>
```

A post's byline links each author: `getAuthor(post.data.author)`, then the `coAuthors` list. Add `author` (a string)
and `coAuthors` (a list of strings) to the collection's schema in `content.config.ts`.
