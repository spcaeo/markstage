// The dev API's author routes (docs/API-AUTHORS.md), the same answers as the Markstage server without sign-in or
// git: list, read, create, change, archive, rename and delete author files, and an author with posts is never
// deleted or renamed without saying where the posts go. Also the check every entry save makes: an author it names
// that is new to it must be one of the site's authors, and not archived.
import fs from 'node:fs';
import path from 'node:path';
import { AUTHOR_SLUG, authorProblems, cleanProfile, entryAuthors, newAuthorData, profileChanges, profileProblems, reassignChanges, slugOfName } from '@markstage/core/authors';
import { JsonEntry } from '@markstage/core/json';
import { authoredEntries, postsOf, readAuthor, readAuthors } from './authors-files.mjs';

const indentOf = (text) => /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? '  ';
const DEV_CAN = { edit: true, manage: true };

/** The answer for one author: the profile (email too: dev mode is the site's owner), its posts counted. */
const itemOf = (a, posts) => ({ ...a.profile, version: a.version, posts: posts.length, live: posts.filter((p) => p.status === 'published').length });

/**
 * 422 when a save names an author the site does not have (or one archived), among the authors it adds: one it
 * already named is left alone, so an old entry still saves. `c`: the collection; `before`/`after`: its data.
 */
export function checkEntryAuthors(cfg, c, before, after, HttpError) {
  if (!cfg.authors?.collections.includes(c.id)) return;
  const was = before ? entryAuthors(cfg.authors, c.fields.author, before) : [];
  const now = entryAuthors(cfg.authors, c.fields.author, after);
  const added = now.filter((s) => !was.includes(s));
  if (!added.length) return;
  const known = new Map([...readAuthors(cfg.authors)].map(([s, a]) => [s, a.profile]));
  const bad = authorProblems(now, known, { only: added });
  if (bad.length) throw new HttpError(422, 'unknown-author', bad[0].message, { fields: { [c.fields.author]: bad[0].message }, authors: bad });
}

export async function authorsRoute({ parts, method: m, req, res, url, cfg, readBody, send, HttpError, readFrontmatter, setFrontmatter }) {
  if (parts[0] !== 'authors') return false;
  const acfg = cfg.authors;
  if (!acfg) throw new HttpError(404, 'no-authors', 'This site keeps no author files (markstage.config `authors`).');
  const all = () => authoredEntries(cfg, readFrontmatter);
  const one = (slug) => {
    const a = readAuthor(acfg, slug);
    if (!a) throw new HttpError(404, 'not-found', `There is no author “${slug}”.`);
    return a;
  };
  const checkVersion = (a, version) => {
    if (version !== a.version) throw new HttpError(409, 'conflict', 'This author changed since it was opened.', { version: a.version });
  };
  const patchOf = (body, whole) => {
    const p = cleanProfile(body);
    const bad = profileProblems(p, { whole });
    if (Object.keys(bad).length) throw new HttpError(422, 'invalid', Object.values(bad)[0], { fields: bad });
    return p;
  };
  const writeJson = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const apply = (text, changes) => {
    const e = JsonEntry.parse(text);
    for (const ch of changes) ch.delete ? e.has(ch.path) && e.remove(ch.path) : e.set(ch.path, ch.value);
    return e.text;
  };
  /** Give every post of `from` to `to`: [{collection, id, title}] changed (each file written once). */
  const movePosts = (from, to, entries) => {
    const moved = [];
    for (const e of entries.filter((x) => x.authors.includes(from))) {
      const c = cfg.collections.find((x) => x.id === e.collection);
      const changes = reassignChanges(acfg, c.fields.author, e.data, from, to);
      if (!changes) continue;
      const text = fs.readFileSync(e.file, 'utf8');
      const next = c.format === 'md' ? setFrontmatter(text, changes) : apply(text, Object.entries(changes).map(([k, v]) => (v === null ? { path: k, delete: true } : { path: k, value: v })));
      if (next !== text) fs.writeFileSync(e.file, next);
      moved.push({ collection: e.collection, id: e.id, title: e.title });
    }
    return moved;
  };
  const hasPosts = (slug, entries, what) => {
    const posts = postsOf(cfg, slug, readFrontmatter, entries);
    if (posts.length) throw new HttpError(409, 'author-has-posts', `${posts.length === 1 ? 'One entry names' : `${posts.length} entries name`} this author. ${what}`, { posts });
  };

  if (parts.length === 1 && m === 'GET') {
    const entries = all();
    const items = [...readAuthors(acfg).values()].map((a) => itemOf(a, postsOf(cfg, a.slug, readFrontmatter, entries)));
    send(res, 200, { items, can: DEV_CAN });
    return true;
  }
  if (parts.length === 1 && m === 'POST') {
    const body = await readBody(req);
    const p = patchOf(body, true);
    const slug = body.slug === undefined || body.slug === '' ? slugOfName(p.name) : String(body.slug);
    if (!AUTHOR_SLUG.test(slug)) throw new HttpError(422, 'invalid', 'The slug must be lowercase letters, digits and hyphens.', { fields: { slug: 'Use a-z, 0-9 and hyphens.' } });
    const file = path.join(acfg.absDir, `${slug}.json`);
    if (fs.existsSync(file)) throw new HttpError(409, 'slug-taken', `There is an author “${slug}” already.`, { slug });
    writeJson(file, `${JSON.stringify(newAuthorData(acfg, slug, { ...p, archived: false }), null, 2)}\n`);
    send(res, 201, { author: itemOf(readAuthor(acfg, slug), []) });
    return true;
  }
  const slug = parts[1];
  if (parts.length === 2 && m === 'GET') {
    const a = one(slug);
    const posts = postsOf(cfg, slug, readFrontmatter);
    send(res, 200, { author: itemOf(a, posts), posts, can: DEV_CAN });
    return true;
  }
  if (parts.length === 2 && m === 'PUT') {
    const body = await readBody(req);
    const a = one(slug);
    checkVersion(a, body.version);
    const text = apply(a.text, profileChanges(acfg, a.data, patchOf(body, false)));
    if (text !== a.text) fs.writeFileSync(a.file, text);
    send(res, 200, { author: itemOf(readAuthor(acfg, slug), postsOf(cfg, slug, readFrontmatter)) });
    return true;
  }
  if (parts.length === 3 && parts[2] === 'rename' && m === 'POST') {
    const body = await readBody(req);
    const a = one(slug);
    checkVersion(a, body.version);
    const to = String(body.to ?? '');
    if (!AUTHOR_SLUG.test(to)) throw new HttpError(422, 'invalid', 'The new slug must be lowercase letters, digits and hyphens.', { fields: { to: 'Use a-z, 0-9 and hyphens.' } });
    if (to === slug) throw new HttpError(422, 'invalid', 'That is its slug now.', { fields: { to: 'Choose another slug.' } });
    if (readAuthor(acfg, to)) throw new HttpError(409, 'slug-taken', `There is an author “${to}” already. To give them these posts, delete this author and pick “${to}”.`, { slug: to });
    const entries = all();
    if (body.movePosts !== true) hasPosts(slug, entries, 'Rename it and move them with it, or leave it as it is.');
    const file = path.join(acfg.absDir, `${to}.json`);
    writeJson(file, acfg.fields.slug ? apply(a.text, [{ path: acfg.fields.slug, value: to }]) : a.text);
    fs.unlinkSync(a.file);
    const moved = movePosts(slug, to, entries);
    send(res, 200, { author: itemOf(readAuthor(acfg, to), postsOf(cfg, to, readFrontmatter)), moved, commit: null, job: null });
    return true;
  }
  if (parts.length === 2 && m === 'DELETE') {
    const a = one(slug);
    checkVersion(a, url.searchParams.get('version'));
    const entries = all();
    const to = url.searchParams.get('reassign');
    if (!to) hasPosts(slug, entries, 'Give them to another author first.');
    let moved = [];
    if (to) {
      const target = readAuthor(acfg, to);
      if (!target || to === slug) throw new HttpError(422, 'invalid', `Pick another author to give the posts to (“${to}” is not one).`, { fields: { reassign: 'Pick another author.' } });
      if (target.profile.archived) throw new HttpError(422, 'invalid', `${target.profile.name} is archived. Pick another author.`, { fields: { reassign: 'Pick another author.' } });
      moved = movePosts(slug, to, entries);
    }
    fs.unlinkSync(a.file);
    send(res, 200, { ok: true, moved, commit: null, job: null });
    return true;
  }
  throw new HttpError(404, 'not-found', 'Dev mode has no such author route.');
}

