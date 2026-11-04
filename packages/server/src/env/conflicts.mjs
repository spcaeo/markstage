// A plan's conflicts in plain words, and the content-aware merge that clears most of them: a page both sides edited
// is merged block by block (Markdown) or leaf by leaf (JSON data), as the editor merges two people's saves
// (@markstage/core merge.mjs). What both sides changed differently stays a conflict for a person to decide:
// keep this environment's version (ours), take the incoming one (theirs), or give the text (side by side).
import { kindsOf } from './rules.mjs';

const core = await import('@markstage/core').catch(() => null);
const MAX_SIDE = 400_000;
const FRONT = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
// frontmatter leaves a save sets to its own time: both sides moving one is not a conflict (the later wins)
const STAMPS = /^(modified|updated|updatedAt|lastModified|modifiedAt)$/;

const GROUP = { pages: 'pages', menus: 'pages', data: 'pages', content: null, sections: 'templates', templates: 'templates', styles: 'styles', config: 'config', deploy: 'config', media: 'media', code: 'other' };
export const GROUPS = ['pages', 'templates', 'styles', 'config', 'media', 'other'];

/** The group a file is shown under (pages, templates, styles, config, media, other). */
export const groupOf = (kinds) => kinds.map((k) => GROUP[k]).find(Boolean) ?? 'other';

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null);

export function createConflictWords(app) {
  const site = () => ({ collections: app.config.collections, mediaDir: app.config.media.dir, libraryDir: app.config.library?.dir, kinds: app.site?.environment?.kinds });

  /** The entry a repo path is, with its title from `text` when it can be read: {collection, id, title} or null. */
  function entryOf(rel, text) {
    const c = app.config.collections.find((x) => rel.startsWith(`${x.dir.replace(/\/+$/, '')}/`) && rel.endsWith(x.ext));
    if (!c) return null;
    const id = rel.slice(c.dir.replace(/\/+$/, '').length + 1, -c.ext.length);
    let title = id;
    try {
      if (text) title = app.store.summarize(c, id, text).title || id;
    } catch {
      // a text that does not read as an entry keeps its file name
    }
    return { collection: c.id, id, title, label: c.label ?? c.id };
  }

  const fileOf = (rel, status, extra = {}) => {
    const kinds = kindsOf(rel, site());
    return { path: rel, status, kinds, group: groupOf(kinds), ...extra };
  };

  /**
   * Try the content-aware merge of one conflicted file: {text} when it merges cleanly, else {blocks} (how many
   * places both sides changed differently) or null when the file is not one it can read.
   */
  function tryMerge(rel, base, ours, theirs) {
    if (!core || ours === null || theirs === null) return null;
    if (rel.endsWith('.json')) {
      try {
        const r = core.mergeData(base === null ? {} : JSON.parse(base), JSON.parse(ours), JSON.parse(theirs));
        return r.conflicts.length ? { blocks: r.conflicts.length, where: r.conflicts.slice(0, 5) } : { text: `${JSON.stringify(r.merged, null, 2)}\n` };
      } catch {
        return null;
      }
    }
    if (rel.endsWith('.md') || rel.endsWith('.mdx') || rel.endsWith('.markdoc')) {
      try {
        // the frontmatter leaf by leaf (a save-time stamp both sides moved takes the later one), the body by block
        const fm = [base ?? '', ours, theirs].map((t) => core.readFrontmatter(t));
        const data = core.mergeData(...fm);
        const open = data.conflicts.filter((k) => !STAMPS.test(k));
        for (const k of data.conflicts.filter((x) => STAMPS.test(x))) data.merged[k] = [fm[1][k], fm[2][k]].map(String).sort().at(-1);
        const body = core.mergeBlocks(...[base ?? '', ours, theirs].map((t) => core.splitBlocks(core.bodyOf(t))));
        const blocks = body.conflicts + open.length;
        if (blocks) return { blocks, where: open.slice(0, 5) };
        const changes = {};
        for (const k of new Set([...Object.keys(fm[1]), ...Object.keys(data.merged)])) if (JSON.stringify(fm[1][k] ?? null) !== JSON.stringify(data.merged[k] ?? null)) changes[k] = data.merged[k] ?? null;
        const head = core.hasFrontmatter(ours) ? FRONT.exec(Object.keys(changes).length ? core.setFrontmatter(ours, changes) : ours)[0] : '';
        return { text: `${head}${head ? '\n' : ''}${body.merged.join('\n\n')}\n` };
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * One conflict for the plan: {id, path, entry, kind, words, ours, theirs, merged?, resolved}. `who` is who last
   * changed it here ({name, at}); `here` and `incoming` name the two sides (e.g. "production", "staging").
   */
  function describe({ index, path: rel, base, ours, theirs, who, here, incoming, merge }) {
    const entry = entryOf(rel, ours ?? theirs);
    const what = entry ? `the ${entry.label.replace(/s$/, '').toLowerCase()} “${entry.title}” (${rel})` : rel;
    const by = who ? ` (${who.name}, ${day(who.at)})` : '';
    let kind;
    let words;
    if (ours === null) {
      kind = 'removed-here';
      words = `${what}: ${here} removed it${by}; ${incoming} changed it.`;
    } else if (theirs === null) {
      kind = 'removed-incoming';
      words = `${what}: ${incoming} removed it; ${here} changed it${by}.`;
    } else if (base === null) {
      kind = 'added-both';
      words = `${what}: both ${here}${by} and ${incoming} added a file here, and they differ.`;
    } else {
      kind = merge?.blocks ? 'blocks' : 'text';
      words = merge?.blocks
        ? `${what}: ${here} changed it${by} and ${incoming} changed it too, in ${merge.blocks} place${merge.blocks === 1 ? '' : 's'} both changed differently.`
        : `${what}: ${here} changed it${by} and ${incoming} changed it too.`;
    }
    const cut = (t) => (t === null ? null : t.length > MAX_SIDE ? `${t.slice(0, MAX_SIDE)}\n[… cut: the file is longer]` : t);
    return { id: `c${index + 1}`, path: rel, entry, kind, words, ours: cut(ours), theirs: cut(theirs), merged: null, resolved: false, take: null };
  }

  return { entryOf, fileOf, tryMerge, describe };
}
