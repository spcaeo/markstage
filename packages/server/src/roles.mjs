// Roles (WordPress names) and every permission decision in one place. Routes call these; nothing else decides.
// docs/API-PERMISSIONS.md is the human-readable copy of this file.

export const ROLES = ['owner', 'administrator', 'editor', 'author', 'contributor'];
const RANK = { owner: 5, administrator: 4, editor: 3, author: 2, contributor: 1 };

export const isRole = (role) => ROLES.includes(role);
export const atLeast = (user, role) => Boolean(user) && (RANK[user.role] ?? 0) >= RANK[role];

/** "Own" = the entry's author field is the user's authorSlug (a user without one owns nothing). */
export const owns = (user, entry) => Boolean(user?.authorSlug) && entry?.author === user.authorSlug;

/** May the user create entries in this collection? */
export function canCreate(user, collection) {
  const d = user?.custom?.decide('entry.create', { collection });
  if (d) return d.effect === 'allow';
  return collection.hasStatus ? atLeast(user, 'contributor') : atLeast(user, 'editor');
}

/** May the user save raw HTML (blocks the converter could not map)? Contributors may not. */
export const canRawHtml = (user) => {
  const d = user?.custom?.decide('entry.rawHtml', {});
  return d ? d.effect === 'allow' : atLeast(user, 'author');
};

/** What the user may do with one entry. `entry` = { id, author, status } as read from the file. */
export function entryCan(user, collection, entry) {
  const base = baseEntryCan(user, collection, entry);
  if (!user?.custom) return base;
  const out = { ...base };
  for (const k of Object.keys(out)) {
    const d = user.custom.decide(`entry.${k}`, { collection, entry, user });
    if (d) out[k] = d.effect === 'allow';
  }
  return out;
}

function baseEntryCan(user, collection, entry) {
  if (atLeast(user, 'editor')) return { edit: true, publish: true, delete: true, rawHtml: true };
  if (!collection.hasStatus || !owns(user, entry)) return { edit: false, publish: false, delete: false, rawHtml: false };
  if (user.role === 'author') return { edit: true, publish: true, delete: true, rawHtml: true };
  // contributor: own drafts only, never publish, never add raw HTML
  const draft = entry.status === 'draft';
  return { edit: draft, publish: false, delete: draft, rawHtml: false };
}

/** Site-wide abilities that are not about one entry. */
const ABILITIES = {
  'users.manage': 'administrator',
  'audit.read': 'administrator',
  // the site health screen and the site-wide exports
  'site.health': 'administrator',
  // the site's lock rules for every page (Settings → Locks); locking one block is an editor's (a save)
  'site.locks': 'administrator',
  // who hears about what (Settings → Alerts); each person's own choices (My alerts) are theirs
  'site.alerts': 'administrator',
  'site.rollback': 'administrator',
  // the Inbox (form messages): editors read and mark them; owner/administrator delete, export, see visitor addresses
  'inbox.read': 'editor',
  'inbox.manage': 'administrator',
  'site.backup': 'administrator',
  'trash.purge': 'administrator',
  'trash.restore.any': 'editor',
  'site.publish': 'editor',
  'templates.manage': 'editor',
  // the site's authors (authors/): add, change, archive, rename, delete; anyone may change their own profile
  'authors.manage': 'editor',
  // the site's topics (links/): add, change and delete them, put pages in them; everyone may look and see suggestions
  'topics.manage': 'editor',
  // the Library's sections, templates and synced items (a snippet is also its creator's)
  'library.manage': 'editor',
  'snippets.manage.any': 'editor',
  'media.delete.any': 'editor',
  'media.delete.own': 'author',
  'media.upload': 'contributor',
  // many files at once, fetched by the server from the web or unpacked from a zip
  'media.import': 'author',
  // the site's existing files under the media folder registered in place (media/index-files.mjs)
  'media.index': 'administrator',
  // entries and media from another system's JSON (import/)
  'content.import': 'editor',
  // an integration's list of options fetched again now (integrations/)
  'integration.refresh': 'editor',
  // webhooks: the addresses told of events, and their signing secrets (webhooks/)
  'site.webhooks': 'administrator',
  // Design & Code: everyone may look; stylesheets, scripts and injected code are written by owner/administrator only
  'design.read': 'contributor',
  'design.write': 'administrator',
  'code.inject': 'administrator',
};

/** Every ability with the least role that has it (the custom roles' list of what a rule may name). */
export const abilities = () => Object.entries(ABILITIES).map(([name, min]) => ({ name, min }));

// A custom role (custom-roles/) rides on the user as `custom`, built on its base role (`user.role`): a rule of it that
// denies takes a right away; one that allows gives a right the base lacks, but never one that is an administrator's.
const ruled = (user, action, about) => user?.custom?.decide(action, about) ?? null;

export function can(user, ability) {
  const min = ABILITIES[ability];
  if (!min) throw new Error(`Unknown ability: ${ability}`);
  const d = ruled(user, ability, {});
  if (d?.effect === 'deny') return false;
  if (d?.effect === 'allow' && RANK[min] <= RANK.editor) return true;
  return atLeast(user, min);
}

/**
 * May `actor` give `target` the role `role` (or change/remove the target at all when role is undefined)?
 * Only the owner manages owners and administrators; nobody changes their own role.
 */
export function canManageUser(actor, target, role) {
  if (!can(actor, 'users.manage')) return false;
  if (target && target.id === actor.id && role !== undefined && role !== target.role) return false;
  if (actor.role === 'owner') return true;
  if (target && ['owner', 'administrator'].includes(target.role)) return false;
  if (role && ['owner', 'administrator'].includes(role)) return false;
  return true;
}
