// Authors (docs/API-AUTHORS.md): Ghost-style profiles kept as JSON files in the site's content, and the check every
// entry write makes: an author it names that is new to it must be one of the site's authors, and not archived. Every
// change is one commit by the signed-in person; an author who still has posts is never deleted or renamed without
// saying where the posts go (reassigned, or moved with the new slug, in the same commit).
//   GET    /authors                       {items: [Author], can: {manage}}
//   GET    /authors/:slug                 {author, posts: [{collection, id, title, status, url, date, role}], can}
//   POST   /authors {slug?, name, …}      201 {author}                                   editors and above
//   PUT    /authors/:slug {version, …}    {author}            editors and above; anyone their own profile (not archive)
//   POST   /authors/:slug/rename {version, to, movePosts?}   {author, moved, commit, job}  409 author-has-posts
//   DELETE /authors/:slug?version=&reassign=<slug>           {ok, moved, commit, job}      409 author-has-posts
// Author = the profile ({slug, name, role, bio, photo, email, website, social, seoTitle, seoDescription, archived}),
// with `url` (the author page), `version`, `posts` and `live` (counts). `email` only for editors and the person
// whose author it is.
import { can } from '../roles.mjs';
import { HttpError, conflict, forbidden } from '../util.mjs';
import { authorsConfig, authoredEntries, createAuthorFiles, postsOf } from './files.mjs';

export async function createAuthors(app) {
  const loaded = await authorsConfig(app.config);
  if (!loaded) return { enabled: false, check: () => {}, withPlanned: (planned, fn) => fn(), routes: (router) => router.add('GET', '/authors', () => {
    throw new HttpError(404, 'no-authors', 'This site keeps no author files (site config `authors`).');
  }) };
  const { core, acfg } = loaded;
  const files = createAuthorFiles(app.config, loaded);
  const { store, git, repoLock, audit, converter } = app;
  // authors a running rename is about to make (the posts it moves are checked against them)
  let pending = null;

  const known = () => {
    const m = new Map(files.all().map((a) => [a.slug, a.profile]));
    for (const [s, p] of pending ?? []) m.set(s, p);
    return m;
  };
  const mayManage = (user) => can(user, 'authors.manage');
  const own = (user, slug) => Boolean(user?.authorSlug) && user.authorSlug === slug;
  const shown = (user, a, posts) => {
    const p = mayManage(user) || own(user, a.slug) ? a.profile : core.publicProfile(a.profile);
    return { ...p, url: core.authorUrl(acfg, a.slug), version: a.version, posts: posts.length, live: posts.filter((x) => x.status === 'published').length };
  };
  const authorOf = (user) => app.entries.authorOf(user);

  /**
   * The check every entry write makes (entries.guard): the authors the new text names that the old one did not must
   * be the site's, and not archived (422 unknown-author). An author the entry already had is left alone.
   */
  function check(c, after, before, isNew = false) {
    if (!acfg.collections.includes(c.id)) return;
    const was = isNew ? [] : core.entryAuthors(acfg, c.fields.author, before);
    const now = core.entryAuthors(acfg, c.fields.author, after);
    const added = now.filter((s) => !was.includes(s));
    if (!added.length) return;
    const bad = core.authorProblems(now, known(), { only: added });
    if (bad.length) throw new HttpError(422, 'unknown-author', bad[0].message, { fields: { [c.fields.author]: bad[0].message }, authors: bad });
  }

  const patchOf = (body, whole) => {
    const p = core.cleanProfile(body ?? {});
    const bad = core.profileProblems(p, { whole });
    if (Object.keys(bad).length) throw new HttpError(422, 'invalid', Object.values(bad)[0], { fields: bad });
    return p;
  };
  const sameVersion = (a, version) => {
    if (version !== a.version) throw conflict('This author changed since you opened it. Reload to see the latest.', { version: a.version });
  };
  const needManage = (ctx, what) => {
    if (!mayManage(ctx.user)) throw forbidden(`Only editors and above can ${what}.`);
  };

  /** Each post of `from` given to `to`: the changes [{c, id, before, after, title, status}], each checked as a save. */
  async function moves(ctx, entries, from, to) {
    const list = [];
    const problems = [];
    for (const e of entries.filter((x) => x.authors.includes(from))) {
      const ch = core.reassignChanges(acfg, e.c.fields.author, e.fields, from, to);
      if (!ch) continue;
      const after = e.c.format === 'md' ? converter.setFrontmatter(e.text, ch) : converter.applyJsonChanges(e.text, Object.entries(ch).map(([k, v]) => (v === null ? { path: k, delete: true } : { path: k, value: v })), e.c);
      const h = { c: e.c, id: e.id, before: e.text, after: app.many.stamped(e.c, e.text, after), title: e.summary.title, status: e.summary.status };
      const problem = await app.many.problemOf(ctx, h);
      if (problem) problems.push({ collection: e.c.id, id: e.id, title: e.summary.title, problem });
      list.push(h);
    }
    if (problems.length) throw new HttpError(422, 'posts-refused', `${problems.length === 1 ? 'One post' : `${problems.length} posts`} cannot be changed, so nothing was: “${problems[0].title}”: ${problems[0].problem}`, { problems });
    return list;
  }
  const hasPosts = (entries, slug, what) => {
    const posts = postsOf(entries, slug);
    if (posts.length) throw new HttpError(409, 'author-has-posts', `${posts.length === 1 ? 'One entry names' : `${posts.length} entries name`} this author. ${what}`, { posts });
  };
  const moved = (list) => list.map((h) => ({ collection: h.c.id, id: h.id, title: h.title }));

  function routes(router) {
    router.add('GET', '/authors', (ctx) => {
      const entries = authoredEntries(store, core, acfg);
      return { items: files.all().map((a) => shown(ctx.user, a, postsOf(entries, a.slug))), can: { manage: mayManage(ctx.user) } };
    });

    router.add('GET', '/authors/:slug', (ctx) => {
      const a = files.read(ctx.params.slug);
      const posts = postsOf(authoredEntries(store, core, acfg), a.slug);
      return { author: shown(ctx.user, a, posts), posts, can: { edit: mayManage(ctx.user) || own(ctx.user, a.slug), manage: mayManage(ctx.user) } };
    });

    router.add('POST', '/authors', async (ctx) => {
      needManage(ctx, 'add authors');
      const p = patchOf(ctx.body, true);
      const given = ctx.body?.slug;
      const slug = given === undefined || given === null || given === '' ? core.slugOfName(p.name) : String(given);
      if (!core.AUTHOR_SLUG.test(slug)) throw new HttpError(422, 'invalid', 'The slug must be lowercase letters, digits and hyphens.', { fields: { slug: 'Use a-z, 0-9 and hyphens.' } });
      const out = await repoLock.run(async () => {
        if (files.exists(slug)) throw new HttpError(409, 'slug-taken', `There is an author “${slug}” already.`, { slug });
        const w = files.write(slug, `${JSON.stringify(core.newAuthorData(acfg, slug, { ...p, archived: false }), null, 2)}\n`);
        const commit = await git.commit([w.rel], `Add author ${slug}`, authorOf(ctx.user));
        audit.log(ctx, 'author.create', { target: `authors/${slug}`, detail: { commit } });
        return files.read(slug);
      });
      ctx.status = 201;
      return { author: shown(ctx.user, out, []) };
    });

    router.add('PUT', '/authors/:slug', async (ctx) => {
      const slug = ctx.params.slug;
      if (!mayManage(ctx.user) && !own(ctx.user, slug)) throw forbidden('You can change your own author profile only.');
      const p = patchOf(ctx.body, false);
      if ('archived' in p && !mayManage(ctx.user)) throw forbidden('Only editors and above can archive an author.');
      const a = await repoLock.run(async () => {
        const cur = files.read(slug);
        sameVersion(cur, ctx.body?.version);
        const changes = core.profileChanges(acfg, cur.data, p);
        if (!changes.length) return cur;
        const text = converter.applyJsonChanges(cur.text, changes);
        const w = files.write(slug, text);
        const archived = 'archived' in p && p.archived !== cur.profile.archived;
        const commit = await git.commit([w.rel], archived ? `${p.archived ? 'Archive' : 'Bring back'} author ${slug}` : `Update author ${slug}`, authorOf(ctx.user));
        audit.log(ctx, archived ? 'author.archive' : 'author.update', { target: `authors/${slug}`, detail: { commit, ...(archived ? { archived: p.archived } : { fields: changes.map((c) => c.path) }) } });
        return files.read(slug);
      });
      return { author: shown(ctx.user, a, postsOf(authoredEntries(store, core, acfg), slug)) };
    });

    router.add('POST', '/authors/:slug/rename', async (ctx) => {
      needManage(ctx, 'rename authors');
      const slug = ctx.params.slug;
      const to = String(ctx.body?.to ?? '');
      if (!core.AUTHOR_SLUG.test(to)) throw new HttpError(422, 'invalid', 'The new slug must be lowercase letters, digits and hyphens.', { fields: { to: 'Use a-z, 0-9 and hyphens.' } });
      if (to === slug) throw new HttpError(422, 'invalid', 'That is its slug now.', { fields: { to: 'Choose another slug.' } });
      const out = await repoLock.run(async () => {
        const cur = files.read(slug);
        sameVersion(cur, ctx.body?.version);
        if (files.exists(to)) throw new HttpError(409, 'slug-taken', `There is an author “${to}” already. To give them these posts, delete this author and pick “${to}”.`, { slug: to });
        const entries = authoredEntries(store, core, acfg);
        if (ctx.body?.movePosts !== true) hasPosts(entries, slug, 'Rename it and move them with it, or leave it as it is.');
        pending = new Map([[to, { ...cur.profile, slug: to }]]);
        let list;
        try {
          list = await moves(ctx, entries, slug, to);
        } finally {
          pending = null;
        }
        const text = acfg.fields.slug ? converter.applyJsonChanges(cur.text, [{ path: acfg.fields.slug, value: to }]) : cur.text;
        const before = await git.dirty();
        const w = files.write(to, text);
        files.remove(slug);
        for (const h of list) store.write(h.c, h.id, h.after);
        // the author page's old address redirects to the new one (the site's redirects hook)
        let extra = { files: [] };
        const [from, next] = [core.authorUrl(acfg, slug), core.authorUrl(acfg, to)];
        try {
          if (from && next) extra = await app.redirectsHook.recordMove([{ from, to: next }], before);
        } catch (e) {
          files.write(slug, cur.text);
          files.remove(to);
          for (const h of list) store.write(h.c, h.id, h.before);
          throw e;
        }
        const paths = [w.rel, cur.rel, ...list.map((h) => store.read(h.c, h.id).rel), ...extra.files];
        const commit = await git.commit(paths, `Rename author ${slug} to ${to}${list.length ? ` (${list.length} entr${list.length === 1 ? 'y' : 'ies'})` : ''}`, authorOf(ctx.user));
        audit.log(ctx, 'author.rename', { target: `authors/${slug}`, detail: { to, commit, entries: list.map((h) => `${h.c.id}/${h.id}`) } });
        return { list, commit, author: files.read(to) };
      });
      const job = app.many.deploy(ctx, { kind: 'author', target: `authors/${to}`, list: out.list, commit: out.commit });
      return { author: shown(ctx.user, out.author, postsOf(authoredEntries(store, core, acfg), to)), moved: moved(out.list), commit: out.commit, job };
    });

    router.add('DELETE', '/authors/:slug', async (ctx) => {
      needManage(ctx, 'delete authors');
      const slug = ctx.params.slug;
      const to = ctx.query.get('reassign');
      const out = await repoLock.run(async () => {
        const cur = files.read(slug);
        sameVersion(cur, ctx.query.get('version'));
        const entries = authoredEntries(store, core, acfg);
        let list = [];
        if (!to) hasPosts(entries, slug, 'Give them to another author first.');
        else {
          if (to === slug || !core.AUTHOR_SLUG.test(to) || !files.exists(to)) throw new HttpError(422, 'invalid', `Pick another author to give the posts to (“${to}” is not one).`, { fields: { reassign: 'Pick another author.' } });
          const target = files.read(to);
          if (target.profile.archived) throw new HttpError(422, 'invalid', `${target.profile.name} is archived. Pick another author.`, { fields: { reassign: 'Pick another author.' } });
          list = await moves(ctx, entries, slug, to);
        }
        for (const h of list) store.write(h.c, h.id, h.after);
        const r = files.remove(slug);
        const commit = await git.commit([r.rel, ...list.map((h) => store.read(h.c, h.id).rel)], `Delete author ${slug}${list.length ? `, ${list.length} entr${list.length === 1 ? 'y' : 'ies'} given to ${to}` : ''}`, authorOf(ctx.user));
        audit.log(ctx, 'author.delete', { target: `authors/${slug}`, detail: { commit, ...(to ? { reassign: to } : {}), entries: list.map((h) => `${h.c.id}/${h.id}`) } });
        return { list, commit };
      });
      const job = app.many.deploy(ctx, { kind: 'author', target: `authors/${slug}`, list: out.list, commit: out.commit });
      return { ok: true, moved: moved(out.list), commit: out.commit, job };
    });
  }

  /**
   * Run `fn` while the authors in `planned` (Map slug -> profile) count as the site's: an import's plan checks its
   * entries against the authors its run will create first. Nothing is written.
   */
  async function withPlanned(planned, fn) {
    const before = pending;
    pending = new Map([...(before ?? []), ...planned]);
    try {
      return await fn();
    } finally {
      pending = before;
    }
  }

  /**
   * Many new authors in one commit (an import): [{slug, name, bio?, website?}], each checked as POST /authors checks
   * one; one whose slug is taken is left out. {created: [slug], commit}. Editors and up.
   */
  async function createMany(ctx, list, message) {
    needManage(ctx, 'add authors');
    return repoLock.run(async () => {
      const rels = [];
      const created = [];
      for (const a of list) {
        if (files.exists(a.slug) || !core.AUTHOR_SLUG.test(a.slug)) continue;
        const p = patchOf({ name: a.name, ...(a.bio ? { bio: a.bio } : {}), ...(a.website ? { website: a.website } : {}) }, true);
        rels.push(files.write(a.slug, `${JSON.stringify(core.newAuthorData(acfg, a.slug, { ...p, archived: false }), null, 2)}\n`).rel);
        created.push(a.slug);
      }
      if (!rels.length) return { created, commit: null };
      let commit;
      try {
        commit = await git.commit(rels, message, authorOf(ctx.user));
      } catch (e) {
        for (const slug of created) files.remove(slug);
        throw e;
      }
      for (const slug of created) audit.log(ctx, 'author.create', { target: `authors/${slug}`, detail: { commit, via: 'import' } });
      return { created, commit };
    });
  }

  return { enabled: true, acfg, core, files, check, routes, withPlanned, createMany, url: (slug) => core.authorUrl(acfg, slug) };
}
