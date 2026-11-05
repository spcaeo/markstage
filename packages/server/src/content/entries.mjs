// Entries: read, list, create, duplicate, save, raw source, import, download, autosave. Every write goes through
// `saveEntry` (version check, permission guard, write, commit, all under one repo lock).
import { atLeast, can as canDo, canCreate, canRawHtml, entryCan } from '../roles.mjs';
import { INJECTION_KEY, injectionOf } from '../design/inject.mjs';
import { HttpError, badRequest, conflict, datedId, forbidden, invalid, notFound, nowIso, slugify } from '../util.mjs';
import { ID } from '../config.mjs';
import { listExtras } from './attention.mjs';
import { addedRawHtml, countChangedBlocks } from './converter.mjs';
import { lockReportOf, stampLocks } from './locks.mjs';
import { unsafeOf, unsafeUrls } from './urls.mjs';
import { createValidator } from './validate.mjs';
import { limitsCheck } from './limits.mjs';

// keys only the publish and protection routes may change
const STATUS_KEYS = ['draft', 'publishAt', 'protected'];
const EMPTY_MD = '---\n---\n';

export function createEntries(app) {
  const { store, converter, git, repoLock, audit, db } = app;
  // the site's own check of an entry, before any write (config `validate`), after the keys it declares it needs
  const siteValidate = createValidator(app.config) ?? (async () => {});
  const validate = async (c, id, text) => {
    requiredCheck(c, text);
    limitsCheck(c, text, store.fieldsOf(c, text), { taxonomy: c.tagFields ?? [] });
    await siteValidate(c, id, text);
  };

  const getPath = (o, key) => key.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
  const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
  /**
   * The keys the site's build needs (collection `required`) are there, and the ones a new entry is asked for
   * (`newEntry.ask`, a topic) are not empty: one entry without them would stop every later build, for everyone,
   * whichever way it came in (the editor, the API, an import, an agent).
   */
  function requiredCheck(c, text) {
    const need = [...new Set([...(c.required ?? []), ...(c.ask ?? [])])];
    if (!need.length) return;
    const f = store.fieldsOf(c, text);
    const ask = new Set(c.ask ?? []);
    const missing = need.filter((k) => (ask.has(k) ? blank(getPath(f, k)) : getPath(f, k) === undefined || getPath(f, k) === null));
    if (!missing.length) return unknownCheck(c, f);
    const name = (k) => c.labels?.[k] ?? k;
    const fields = Object.fromEntries(missing.map((k) => [k, `${name(k)} is needed.`]));
    const words = missing.map((k) => `“${name(k)}”`).join(', ');
    throw new HttpError(422, 'missing-field', `${missing.length === 1 ? `${words} is` : `${words} are`} needed before this entry can be saved: the site cannot build without ${missing.length === 1 ? 'it' : 'them'}.`, { fields, missing });
  }

  /**
   * A value the New sheet asks for that comes from another collection (a topic, `from: 'clusters'`) names one of
   * its entries; a wrong one is said to be wrong, with the choices, not "missing" (QA pass 2, N8).
   */
  function unknownCheck(c, f) {
    for (const [key, from] of Object.entries(c.askFrom ?? {})) {
      const v = getPath(f, key);
      if (blank(v) || typeof v !== 'string') continue;
      let source;
      try {
        source = store.collection(from);
      } catch {
        continue; // a collection this server does not keep: nothing to check against
      }
      if (store.exists(source, v)) continue;
      const label = (c.labels?.[key] ?? key).toLowerCase();
      const choices = store.ids(source).slice(0, 20);
      throw new HttpError(422, 'unknown-choice', `There is no ${label} “${v}”. Pick one of: ${choices.join(', ')}${choices.length === 20 ? ', …' : ''}.`, { fields: { [key]: `There is no ${label} “${v}”.` } });
    }
  }

  const authorOf = (user) => ({ name: user?.name ?? 'Markstage', email: user?.email ?? app.config.git.committerEmail });

  /** Parse an entry text or answer 422 (a save must leave a file the site can still read). */
  function parse(c, text) {
    if (c.format === 'json') {
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new HttpError(422, 'invalid', `This is not valid JSON: ${e.message}`);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(422, 'invalid', 'The entry must be a JSON object.');
      return { data };
    }
    if (!/^---\r?\n/.test(text)) throw new HttpError(422, 'invalid', 'The Markdown must start with a --- frontmatter block.');
    try {
      converter.parseFrontmatter(text);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(422, 'invalid', `The frontmatter is not valid YAML: ${e.message}`);
    }
    try {
      return converter.mdToDoc(text, c);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // an .mdx file the MDX reader cannot read (or cannot write back as it is): refused with its line, never saved
      if (e?.mdx) throw new HttpError(422, 'invalid-mdx', `This MDX cannot be read, so it cannot be saved: ${e.mdx.message}`, { mdx: e.mdx });
      throw new HttpError(422, 'invalid', `The Markdown could not be read: ${e.message}`);
    }
  }

  const rawOf = (c, parsed) => (c.format === 'md' && parsed ? converter.rawHtmlOf(parsed.doc) : []);

  /**
   * The rules every write must keep, checked on the final text (so a raw-source save cannot get around them):
   * status keys only change through the publish routes; non-editors keep themselves as author; a user without the
   * raw-HTML right cannot add or change raw HTML.
   */
  function guard(ctx, c, beforeText, afterText, can, { allowStatus = false, out, id } = {}) {
    const after = parse(c, afterText);
    const fa = store.fieldsOf(c, afterText);
    const fb = beforeText === null ? {} : store.fieldsOf(c, beforeText);
    // the page's address changes only through Move (links follow, the old address redirects), never by a save, a
    // restore or a replace across the site that edits the field the address is made from
    if (id && beforeText !== null) {
      const from = store.summarize(c, id, beforeText).url;
      const to = store.summarize(c, id, afterText).url;
      if (from && from !== to) throw new HttpError(422, 'moves', `This changes the page’s address (${from} to ${to ?? 'none'}). Use Move, so links and redirects follow.`, { from, to });
    }
    // the document and fields, and for Markdown the text as the site's CommonMark renderer reads it (S1)
    // each address once: the editor's document and the Markdown reader often find the same one
    const bad = [...new Set(c.format === 'md' ? [...unsafeUrls([after.doc, fa]), ...unsafeOf(converter.markdownUrls(afterText, c))] : unsafeUrls(after.data))];
    if (bad.length) throw new HttpError(422, 'invalid', `Links must start with http, https, mailto or tel, or be relative: ${bad[0]}`, { fields: { url: 'Unsafe link.' }, urls: bad });
    if (c.hasStatus && !allowStatus) {
      for (const k of STATUS_KEYS) {
        if (JSON.stringify(fa[k] ?? null) !== JSON.stringify(fb[k] ?? null)) throw new HttpError(422, 'invalid', `"${k}" changes only through Publish, Schedule or Unpublish.`, { fields: { [k]: 'Use the publish buttons.' } });
      }
    }
    if (c.hasStatus && !atLeast(ctx.user, 'editor')) {
      const author = fa[c.fields.author];
      // a custom role allowed to edit others' entries (a translator) leaves their author as it was
      const kept = Boolean(ctx.user.custom) && beforeText !== null && author === fb[c.fields.author];
      if (author !== ctx.user.authorSlug && !kept) throw forbidden('You can only write entries under your own author name.');
    }
    // a setting that picks from an integration's live options keeps to them (integrations/)
    app.integrations?.check(c, fa, fb);
    // an author it names that is new to it is one of the site's authors, not archived (authors/)
    app.authors?.check(c, fa, fb, beforeText === null);
    // a frame or page type it sets is one of the site's; a page's type changes for editors and above (page-types.mjs)
    app.pageTypes?.check(ctx, c, fa, fb, beforeText === null);
    // a custom role that allows an edit of some fields only (a translator's locale): nothing else changes
    if (ctx.user?.custom && beforeText !== null) app.customRoles.checkFields(ctx.user, c, id, fb, fa, c.format === 'md' && bodyOf(beforeText) !== bodyOf(afterText));
    // a page's code injection runs on the site: owner and administrator only, whichever route the text came by
    if (injectionChanged(c, beforeText, afterText) && !canDo(ctx.user, 'code.inject')) throw forbidden('Only an owner or administrator can change the code added to this page. Leave it as it is.');
    const parsedBefore = beforeText === null || beforeText === afterText ? null : parse(c, beforeText);
    if (!can.rawHtml) {
      const before = parsedBefore ? rawOf(c, parsedBefore) : beforeText === null ? [] : rawOf(c, after);
      if (addedRawHtml(before, rawOf(c, after)).length) throw forbidden(c.mdx ? 'Your role cannot add or change code or raw HTML in an MDX file. Ask an editor.' : 'Your role cannot add or change raw HTML. Ask an editor.');
    }
    // synced Library copies (library/synced.mjs): changed only through their item, detached by dropping the marker
    const synced = beforeText === afterText ? null : app.library?.synced.check(ctx, c, beforeText, afterText, { fa, fb });
    if (out && synced) out.synced = synced;
    // locks: a locked block may not be moved, deleted or changed (423, every role); only an owner, administrator or
    // editor adds, takes off or changes a lock (a synced copy brings its item's locks with it)
    if (parsedBefore) {
      // the site's rules, with those of the page's type (before and after the save) added
      const rules = app.pageTypes ? app.pageTypes.lockRules(c, fb, fa, app.locks.rules()) : app.locks.rules();
      const r = lockReportOf(c, { parsed: parsedBefore, fields: fb }, { parsed: after, fields: fa }, rules, [beforeText, afterText]);
      const changes = r.changes.filter((ch) => !(ch.change === 'lock' && synced?.lockPaths.has(ch.path)));
      if (changes.length && !atLeast(ctx.user, 'editor')) throw forbidden(`Only an owner, administrator or editor can lock or unlock blocks (${changes[0].label}).`);
      if (r.violations.length) throw new HttpError(423, 'locked', r.violations.length === 1 ? r.violations[0].message : `${r.violations[0].message} (and ${r.violations.length - 1} more)`, { blocks: r.violations });
      if (out) out.lockChanges = changes;
    }
    return after;
  }

  const bodyOf = (text) => String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const injectionChanged = (c, beforeText, afterText) => injectionOf(store, c, afterText) !== (beforeText === null ? 'null' : injectionOf(store, c, beforeText));

  function permissions(ctx, c, summary) {
    const can = entryCan(ctx.user, c, summary);
    // a custom role that allows an edit of some fields only: the editor shows the rest read-only (docs/API-ROLES.md)
    const fields = can.edit && ctx.user?.custom ? (ctx.user.custom.decide('entry.edit', { collection: c, entry: summary, user: ctx.user })?.fields ?? null) : null;
    return fields ? { ...can, fields } : can;
  }

  /** May this user edit this entry with a plain save? Saving a live or scheduled entry needs the publish right. */
  function assertEditable(ctx, c, summary) {
    const can = permissions(ctx, c, summary);
    if (!can.edit) throw forbidden('You cannot edit this entry.');
    // a custom role's own rule that allows the edit covers a live entry too (a translator's words), without the publish right
    const ruled = c.hasStatus && summary.status !== 'draft' && !can.publish ? ctx.user?.custom?.decide('entry.edit', { collection: c, entry: summary, user: ctx.user }) : null;
    if (c.hasStatus && summary.status !== 'draft' && !can.publish && ruled?.effect !== 'allow') throw forbidden('This entry is live or scheduled; your role cannot change it.');
    return can;
  }

  /**
   * Save an entry: inside the repo lock, check the version, build the new text from the current one, guard it,
   * write and commit. Returns {version, changedBlocks, commit, before, after}.
   */
  function saveEntry(ctx, c, id, { version, build, message, can: canOverride, allowStatus = false, action = 'entry.save', check }) {
    return repoLock.run(async () => {
      const current = store.read(c, id);
      if (version !== current.version) throw conflict('This entry changed since you opened it. Reload to see the latest.', { version: current.version });
      const summary = store.summarize(c, id, current.text);
      const can = canOverride ?? assertEditable(ctx, c, summary);
      if (check) check(summary, can);
      const built = await build(current);
      let text = built.text;
      const { changedBlocks } = built;
      if (text === current.text) return { version: current.version, changedBlocks: 0, commit: null, before: current.text, after: text, summary };
      const checked = {};
      guard(ctx, c, current.text, text, can, { allowStatus, out: checked, id });
      // who set each lock the save changed, and when: the server's word, not the editor's
      if (checked.lockChanges?.length) text = stampLocks(c, app.converter, text, checked.lockChanges, { by: ctx.user?.name ?? 'Markstage', at: nowIso(app.clock()).replace(/\.\d{3}Z$/, 'Z') });
      if (checked.synced?.stamp) text = app.library.synced.stamp(c, text);
      await validate(c, id, text);
      const written = store.write(c, id, text);
      const commit = await git.commit([written.rel], message ?? `Update ${c.id}/${id}`, authorOf(ctx.user));
      audit.log(ctx, action, { target: `${c.id}/${id}`, detail: { commit } });
      for (const ch of checked.lockChanges ?? []) audit.log(ctx, ch.change === 'unlock' ? 'entry.unlock' : 'entry.lock', { target: `${c.id}/${id}`, detail: { commit, change: ch.change, block: ch.label, path: ch.path, from: ch.from, to: ch.to, ...(ch.rule ? { rule: ch.rule } : {}) } });
      if (checked.lockChanges?.length) {
        const words = checked.lockChanges.map((ch) => `${{ lock: 'locked', unlock: 'unlocked', change: 'changed the lock on' }[ch.change] ?? 'changed the lock on'} ${ch.label}${ch.rule === 'site' ? " (the site's rule, on this page only)" : ''}`);
        app.notices?.tell({ kind: 'lock.changed', level: 'info', text: `${ctx.user?.name ?? 'Markstage'} ${words.join(', ')} in “${summary?.title || id}”.`, link: `#/e/${c.id}/${id}`, to: 'administrators' });
      }
      if (action !== 'code.inject' && injectionChanged(c, current.text, text)) audit.log(ctx, 'code.inject', { target: `${c.id}/${id}`, detail: { commit, via: action } });
      return {
        version: written.version,
        changedBlocks: changedBlocks ?? (c.format === 'md' ? countChangedBlocks(current.text, text) : 1),
        commit,
        before: current.text,
        after: text,
        summary: store.summarize(c, id, text),
      };
    });
  }

  /** Text from a save body: md {doc, frontmatter} | {source}; json {data} | {changes} | {source}. */
  function textFromBody(c, currentText, body) {
    // the submitted document is checked too (the parsed result is checked again in guard)
    const bad = unsafeUrls([body.doc, body.frontmatter, body.data]);
    if (bad.length) throw new HttpError(422, 'invalid', `Links must start with http, https, mailto or tel, or be relative: ${bad[0]}`, { fields: { url: 'Unsafe link.' }, urls: bad });
    if (typeof body.source === 'string') return { text: body.source };
    if (c.format === 'json') {
      if (Array.isArray(body.changes)) {
        if (body.changes.some((ch) => STATUS_KEYS.includes(String(ch?.path ?? '').split('.')[0]))) throw invalid({ changes: 'Status changes only through the publish routes.' });
        let text = converter.applyJsonChanges(currentText, body.changes, c);
        // the entry's modified date follows a change, in the file's own format (as the dev JSON save does), unless
        // the change sets it itself
        const mod = c.fields.modified;
        if (mod && text !== currentText && !body.changes.some((ch) => ch?.path === mod)) {
          const was = store.fieldsOf(c, currentText)?.[mod];
          const stamp = typeof was === 'string' ? stampLike(was, new Date(app.clock())) : null;
          if (stamp) text = converter.applyJsonChanges(text, [{ path: mod, value: stamp }], c);
        }
        return { text, changedBlocks: body.changes.length };
      }
      if (body.data && typeof body.data === 'object') {
        const indent = /^\{\r?\n([ \t]+)"/.exec(currentText)?.[1] ?? '  ';
        return { text: JSON.stringify(body.data, null, indent) + (currentText.endsWith('\n') ? '\n' : '') };
      }
      throw badRequest('Send data, changes or source.');
    }
    let text = currentText;
    let changedBlocks = null;
    if (body.doc !== undefined) {
      if (!body.doc || body.doc.type !== 'doc') throw badRequest('No document in the request.');
      text = converter.docToMd(body.doc, currentText, c);
      changedBlocks = converter.changedBlocks(body.doc, currentText, c);
    }
    if (body.frontmatter !== undefined) {
      if (!body.frontmatter || typeof body.frontmatter !== 'object' || Array.isArray(body.frontmatter)) throw badRequest('frontmatter must be an object.');
      if (STATUS_KEYS.some((k) => k in body.frontmatter)) throw invalid({ frontmatter: 'Status changes only through the publish routes.' });
      if (Object.keys(body.frontmatter).length) {
        text = converter.setFrontmatter(text, body.frontmatter);
        changedBlocks = null;
      }
    }
    if (body.doc === undefined && body.frontmatter === undefined) throw badRequest('Send doc, frontmatter or source.');
    return { text, changedBlocks: Number.isFinite(changedBlocks) ? changedBlocks : undefined };
  }

  /** The full entry answer for the editor. */
  function view(ctx, c, id) {
    const file = store.read(c, id);
    const summary = store.summarize(c, id, file.text);
    // an .mdx file the MDX reader cannot read opens read-only, in Source mode, with the reader's words (docs/MDX.md)
    let parsed;
    let unreadable = null;
    try {
      parsed = parse(c, file.text);
    } catch (e) {
      if (!(c.mdx && e?.code === 'invalid-mdx')) throw e;
      unreadable = e.extra?.mdx ?? { message: e.message, line: null, column: null };
      parsed = { doc: null };
    }
    const auto = db.prepare('SELECT saved_at, base_version FROM autosaves WHERE user_id = ? AND collection = ? AND entry_id = ?').get(ctx.user.id, c.id, id);
    const can = permissions(ctx, c, summary);
    return {
      id,
      collection: c.id,
      format: c.format,
      ...(c.mdx ? { mdx: true } : {}),
      ...(unreadable ? { unreadable } : {}),
      version: file.version,
      status: summary.status,
      url: summary.url,
      title: summary.title,
      author: summary.author,
      publishAt: summary.publishAt,
      ...(summary.held ? { held: summary.held } : {}),
      ...(c.format === 'md' ? { frontmatter: store.fieldsOf(c, file.text), doc: parsed.doc } : { data: parsed.data }),
      autosave: auto ? { savedAt: auto.saved_at, baseVersion: auto.base_version } : null,
      can: unreadable ? { ...can, edit: false } : can,
    };
  }

  /** A free id: `base` (or, from a title that gives none, "post-<today>"), else `base-2`, `base-3`, ... */
  function freeId(c, base) {
    const root = base.slice(0, 96).replace(/-+$/, '') || datedId(c, app.clock());
    let id = root;
    for (let n = 2; store.exists(c, id); n++) id = `${root.slice(0, 92).replace(/-+$/, '')}-${n}`;
    return id;
  }

  /**
   * The author of a new entry, never empty (a post without one breaks the site's build): the one given (editors
   * and up), else the creator's author name, else the collection's `defaultAuthor`, else 422.
   */
  function authorFor(ctx, c, given) {
    if (typeof given === 'string' && given.trim()) return given.trim();
    const author = ctx.user.authorSlug ?? c.defaultAuthor;
    if (author) return author;
    throw new HttpError(422, 'no-author', 'New entries need an author. Link your account to an author (Users, your account, Author), or set a defaultAuthor for this collection.');
  }

  /** Create an entry from what the New sheet (or a duplicate, an import) sends: a draft in a status collection. */
  async function createEntry(ctx, c, args, action = 'entry.create') {
    precheck(ctx, c, args.id);
    return repoLock.run(async () => {
      const { entryId, text } = await newEntryText(ctx, c, args);
      const written = store.write(c, entryId, text);
      const commit = await git.commit([written.rel], `Create ${c.id}/${entryId}`, authorOf(ctx.user));
      audit.log(ctx, action, { target: `${c.id}/${entryId}`, detail: { commit } });
      return entryId;
    });
  }

  function precheck(ctx, c, id) {
    if (!canCreate(ctx.user, c)) throw forbidden('Your role cannot create entries here.');
    if (id !== undefined && !ID.test(String(id))) throw invalid({ id: 'Use lowercase letters, digits and hyphens.' });
    if (c.hasStatus && !atLeast(ctx.user, 'editor') && !ctx.user.authorSlug) throw forbidden('Your account has no author name yet. Ask an administrator to set one.');
  }

  /**
   * Many new entries in one commit (an import's batch): [{c, id, source}] each built and checked as createEntry
   * builds and checks one, under one hold of the repo. One that is refused is a problem and the rest go on; the
   * written ones are committed together with `message`, audited one by one as `action`. {created: [{c, id, rel}],
   * problems: [{index, message}], commit}.
   */
  async function createMany(ctx, list, { message, action = 'entry.import' }) {
    return repoLock.run(async () => {
      const created = [];
      const problems = [];
      for (const [index, args] of list.entries()) {
        try {
          precheck(ctx, args.c, args.id);
          const { entryId, text } = await newEntryText(ctx, args.c, args);
          created.push({ c: args.c, id: entryId, rel: store.write(args.c, entryId, text).rel });
        } catch (e) {
          if (!(e instanceof HttpError)) throw e;
          problems.push({ index, message: e.extra?.fields ? Object.values(e.extra.fields)[0] : e.message });
        }
      }
      if (!created.length) return { created, problems, commit: null };
      let commit;
      try {
        commit = await git.commit(created.map((x) => x.rel), message, authorOf(ctx.user));
      } catch (e) {
        for (const x of created) store.removeRel(x.rel);
        throw e;
      }
      for (const x of created) audit.log(ctx, action, { target: `${x.c.id}/${x.id}`, detail: { commit } });
      return { created, problems, commit };
    });
  }

  /** The text of a new entry and its id, checked as a save is (the repo lock is held by the caller). */
  async function newEntryText(ctx, c, { id, title, frontmatter = {}, doc, data, source }) {
    const f = c.fields;
    const own = !atLeast(ctx.user, 'editor');
    {
      let text;
      let fm;
      if (typeof source === 'string') {
        text = source;
        fm = { ...store.fieldsOf(c, source) };
        parse(c, source);
      } else {
        fm = { ...frontmatter };
      }
      const name = title ?? fm[f.title];
      if (typeof name !== 'string' || !name.trim()) throw invalid({ title: 'Give it a title.' });
      const entryId = id ?? freeId(c, slugify((f.slug && fm[f.slug]) || name));
      if (store.exists(c, entryId)) throw new HttpError(409, 'id-taken', 'Another entry already has this address. Pick another one.', { id: entryId });
      store.fileOf(c, entryId, { mustExist: false });
      // the site's newEntry defaults (core newEntryFrontmatter: title and slug first, then the asked values, then the
      // defaults, which never override those), so a new entry has what the site's schema requires (a date, a canonical)
      const made = typeof source !== 'string' && c.newEntry && app.site?.newEntryFrontmatter;
      if (made) {
        const author = c.hasStatus && f.author ? authorFor(ctx, c, own ? undefined : fm[f.author]) : null;
        const who = { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role, authorSlug: ctx.user.authorSlug ?? null };
        fm = app.site.newEntryFrontmatter(c, { title: name.trim(), id: entryId, values: c.format === 'json' ? { ...(data ?? {}), ...fm } : fm, user: who, author, now: new Date(app.clock()) });
        if (c.format === 'json') data = { ...(data ?? {}), ...fm };
      }

      const set = { [f.title]: name.trim(), protected: null };
      if (f.slug) set[f.slug] = entryId;
      if (c.hasStatus) Object.assign(set, { draft: true, publishAt: null });
      // a JSON entry gets an author and a date only when its collection has them: named in the site's fields, in its
      // schema, or already in what it starts from (a page has neither by default); an article always has them
      const has = (role) => Boolean(f[role]) && (c.format === 'md' || (c.fieldsGiven ?? []).includes(role) || Boolean(c.schema?.fields && f[role] in c.schema.fields) || fm[f[role]] !== undefined || data?.[f[role]] !== undefined);
      if (c.hasStatus && has('author')) set[f.author] = authorFor(ctx, c, own ? undefined : fm[f.author]);
      if (c.hasStatus && has('date') && fm[f.date] === undefined && data?.[f.date] === undefined) set[f.date] = nowIso(app.clock());
      if (STATUS_KEYS.some((k) => k in frontmatter)) throw invalid({ frontmatter: 'New entries start as drafts.' });

      if (c.format === 'json') {
        const base = typeof source === 'string' ? JSON.parse(source) : { ...(data ?? {}) };
        for (const [k, v] of Object.entries(set)) if (v === null) delete base[k];
        else base[k] = v;
        text = JSON.stringify(base, null, 2) + '\n';
      } else if (typeof source === 'string') {
        text = converter.setFrontmatter(source, set);
      } else {
        const fields = { ...fm, ...set };
        for (const k of Object.keys(fields)) if (fields[k] === null) delete fields[k];
        text = converter.setFrontmatter(EMPTY_MD, fields);
        text = doc ? converter.docToMd(doc, text, c) : `${text}\n`;
      }
      const checked = {};
      guard(ctx, c, null, text, { rawHtml: canRawHtml(ctx.user) }, { allowStatus: true, out: checked });
      if (checked.synced?.stamp) text = app.library.synced.stamp(c, text);
      await validate(c, entryId, text);
      return { entryId, text };
    }
  }

  function routes(router) {
    const coll = (ctx) => store.collection(ctx.params.c);

    router.add('GET', '/collections', (ctx) =>
      store.collections.map((c) => {
        const { counts } = store.list(c, { perPage: 1 });
        const trash = db.prepare('SELECT COUNT(*) AS n FROM trash WHERE collection = ?').get(c.id).n;
        return { id: c.id, label: c.label, format: c.format, hasStatus: c.hasStatus, counts: { ...counts, trash }, can: { create: canCreate(ctx.user, c) } };
      }),
    );

    // the collection's field schema (site config `schema`), for the editor's forms
    router.add('GET', '/collections/:c/schema', (ctx) => {
      const c = coll(ctx);
      if (!c.schema) throw new HttpError(404, 'no-schema', 'This collection has no schema in the site config.');
      return { entry: c.schema };
    });

    router.add('GET', '/collections/:c/entries', async (ctx) => {
      const q = Object.fromEntries(ctx.query);
      if (q.status && !['draft', 'scheduled', 'published'].includes(q.status)) throw badRequest('Unknown status.');
      if (q.since && Number.isNaN(Date.parse(q.since))) throw badRequest('since must be a date.');
      const c = coll(ctx);
      const { warm, ...extras } = listExtras(app, c, q);
      // a filter on the publish rules' findings: the changed entries' findings first, yielding between them
      if (warm) await app.preflight.warm(c);
      return store.list(c, { ...q, ...extras });
    });

    router.add('GET', '/collections/:c/entries/:id', (ctx) => view(ctx, coll(ctx), ctx.params.id));

    router.add('POST', '/collections/:c/entries', async (ctx) => {
      const c = coll(ctx);
      let { frontmatter, doc, data } = ctx.body;
      // asked for by its page type (page-types.mjs): the type's template, and the type set
      const typed = app.pageTypes?.forCreate(ctx, c, ctx.body) ?? null;
      const tid = ctx.body.template ?? ctx.body.templateId ?? typed?.template;
      if (tid) {
        // a Library template (library/items.mjs): its frontmatter and blocks, never another entry's slug, dates or author
        await app.library.moveOld();
        const p = app.library.templateFor(ctx.user, String(tid), c);
        frontmatter = { ...(p.frontmatter ?? {}), ...(frontmatter ?? {}) };
        doc ??= p.doc;
        data = { ...(p.data ?? {}), ...(data ?? {}) };
      }
      if (typed) ({ frontmatter, data } = typed.apply({ frontmatter, data }));
      const id = await createEntry(ctx, c, { ...ctx.body, frontmatter, doc, data });
      ctx.status = 201;
      return view(ctx, c, id);
    });

    router.add('POST', '/collections/:c/entries/:id/duplicate', async (ctx) => {
      const c = coll(ctx);
      const src = store.read(c, ctx.params.id);
      const title = ctx.body.title ?? `${store.summarize(c, ctx.params.id, src.text).title} (copy)`;
      const id = ctx.body.id ?? freeId(c, `${ctx.params.id}-copy`);
      // the copy keeps everything but its status and (for non-editors) author, which createEntry sets
      let source = src.text;
      source = stripStatus(c, source);
      // the page's added code goes with the copy only for those who may add code
      if (!canDo(ctx.user, 'code.inject') && injectionOf(store, c, source) !== 'null') source = c.format === 'md' ? converter.setFrontmatter(source, { [INJECTION_KEY]: null }) : converter.applyJsonChanges(source, [{ path: INJECTION_KEY, delete: true }], c);
      const newId = await createEntry(ctx, c, { id, title, source }, 'entry.duplicate');
      ctx.status = 201;
      return view(ctx, c, newId);
    });

    router.add('PUT', '/collections/:c/entries/:id', async (ctx) => {
      const c = coll(ctx);
      const body = ctx.body;
      if (typeof body.source === 'string') throw badRequest('The raw text of an entry is saved from the Source view (its own route), not with the settings.');
      const out = await saveEntry(ctx, c, ctx.params.id, { version: body.version, build: (cur) => textFromBody(c, cur.text, body), message: body.message });
      db.prepare('DELETE FROM autosaves WHERE user_id = ? AND collection = ? AND entry_id = ?').run(ctx.user.id, c.id, ctx.params.id);
      return { ok: true, version: out.version, changedBlocks: out.changedBlocks, commit: out.commit };
    });

    router.add('GET', '/collections/:c/entries/:id/source', (ctx) => {
      const c = coll(ctx);
      const file = store.read(c, ctx.params.id);
      return { source: file.text, version: file.version, format: c.format };
    });

    router.add('PUT', '/collections/:c/entries/:id/source', async (ctx) => {
      const c = coll(ctx);
      const { source, version, message } = ctx.body;
      if (typeof source !== 'string') throw badRequest('Send the source text.');
      const out = await saveEntry(ctx, c, ctx.params.id, { version, build: () => ({ text: source }), message, action: 'entry.source' });
      db.prepare('DELETE FROM autosaves WHERE user_id = ? AND collection = ? AND entry_id = ?').run(ctx.user.id, c.id, ctx.params.id);
      return { ok: true, version: out.version, changedBlocks: out.changedBlocks, commit: out.commit };
    });

    router.add('GET', '/collections/:c/entries/:id/download', (ctx) => {
      const c = coll(ctx);
      const file = store.read(c, ctx.params.id);
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', c.format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8');
      ctx.res.setHeader('Content-Disposition', `attachment; filename="${ctx.params.id}${c.ext}"`);
      ctx.res.setHeader('Cache-Control', 'no-store');
      ctx.res.end(file.text);
    });

    router.add('POST', '/collections/:c/import', async (ctx) => {
      const c = coll(ctx);
      const { filename, source } = ctx.body;
      if (typeof source !== 'string' || typeof filename !== 'string' || !filename.toLowerCase().endsWith(c.ext)) throw invalid({ filename: `Choose a ${c.ext} file.` });
      const fm = (() => {
        parse(c, source);
        return store.fieldsOf(c, source);
      })();
      if (typeof fm[c.fields.title] !== 'string' || !fm[c.fields.title].trim()) throw invalid({ title: 'The file has no title in its frontmatter.' });
      const base = slugify((c.fields.slug && fm[c.fields.slug]) || filename.replace(/\.[^.]+$/, '').split(/[\\/]/).pop());
      const id = await createEntry(ctx, c, { id: freeId(c, base), source: stripStatus(c, source) }, 'entry.import');
      ctx.status = 201;
      return view(ctx, c, id);
    });

    // --- autosave: private per user, never the live file ------------------------------------------------------
    router.add('PUT', '/collections/:c/entries/:id/autosave', (ctx) => {
      const c = coll(ctx);
      store.read(c, ctx.params.id);
      const { baseVersion, doc, frontmatter, source, data } = ctx.body;
      const savedAt = nowIso(app.clock());
      db.prepare(
        `INSERT INTO autosaves (user_id, collection, entry_id, base_version, payload, saved_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, collection, entry_id) DO UPDATE SET base_version = excluded.base_version, payload = excluded.payload, saved_at = excluded.saved_at`,
      ).run(ctx.user.id, c.id, ctx.params.id, baseVersion ?? null, JSON.stringify({ doc, frontmatter, source, data }), savedAt);
      app.preview?.autosaved(ctx.user.id, c.id, ctx.params.id);
      app.autosaves?.record(ctx.user.id, c, ctx.params.id, baseVersion, JSON.stringify({ doc, frontmatter, source, data }));
      return { savedAt };
    });

    router.add('GET', '/collections/:c/entries/:id/autosave', (ctx) => {
      const c = coll(ctx);
      const row = db.prepare('SELECT * FROM autosaves WHERE user_id = ? AND collection = ? AND entry_id = ?').get(ctx.user.id, c.id, ctx.params.id);
      if (!row) throw notFound('No autosave.');
      return { savedAt: row.saved_at, baseVersion: row.base_version, ...JSON.parse(row.payload) };
    });

    router.add('DELETE', '/collections/:c/entries/:id/autosave', (ctx) => {
      db.prepare('DELETE FROM autosaves WHERE user_id = ? AND collection = ? AND entry_id = ?').run(ctx.user.id, coll(ctx).id, ctx.params.id);
      return { ok: true };
    });
  }

  /** Drop draft/publishAt from an imported file: createEntry makes it a draft. */
  function stripStatus(c, source) {
    return c.format === 'md' ? converter.setFrontmatter(source, { draft: null, publishAt: null, protected: null }) : converter.applyJsonChanges(source, STATUS_KEYS.map((path) => ({ path, delete: true })), c);
  }

  return { routes, saveEntry, createEntry, createMany, textFromBody, view, parse, guard, validate, assertEditable, permissions, authorOf, injectionChanged };
}

/** `now` written the way `was` is: a date, or a date and time in UTC with "Z" or "+00:00"; null for anything else. */
export function stampLike(was, now) {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (/^\d{4}-\d{2}-\d{2}$/.test(was)) return iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(was)) return iso;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(was)) return iso.replace(/Z$/, '+00:00');
  return null;
}
