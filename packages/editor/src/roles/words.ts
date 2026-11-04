// Custom roles in words (Settings → Roles): what each action is, and a role's rule as a sentence with the lines
// under it (what may change and when come from the promotion rules' own words, environments/words.ts).
import type { RoleRule, Role } from '../admin/api';
import { list, ROLE_PLURAL, ruleWords } from '../environments/words';

export const ENTRY_WORDS: Record<string, string> = {
  'entry.create': 'create entries',
  'entry.edit': 'edit entries',
  'entry.publish': 'publish, schedule or unpublish',
  'entry.delete': 'delete entries',
  'entry.rawHtml': 'save raw HTML',
};

export const ABILITY_WORDS: Record<string, string> = {
  'users.manage': 'manage people',
  'audit.read': 'read the audit log',
  'site.health': 'see site health and the exports',
  'site.locks': 'change the site’s lock rules',
  'site.alerts': 'set who hears about what',
  'site.rollback': 'roll the site back',
  'inbox.read': 'read and mark Inbox messages',
  'inbox.manage': 'delete and export Inbox messages',
  'site.backup': 'back up now',
  'trash.purge': 'delete from the trash for good',
  'trash.restore.any': 'restore anyone’s entries from the trash',
  'site.publish': 'rebuild the whole site',
  'templates.manage': 'manage templates',
  'library.manage': 'manage the Library',
  'snippets.manage.any': 'change anyone’s snippets',
  'media.delete.any': 'delete any media',
  'media.delete.own': 'delete their own media',
  'media.upload': 'upload media',
  'media.import': 'import media from the web or a zip',
  'content.import': 'import entries from JSON',
  'integration.refresh': 'fetch an integration’s list now',
  'site.webhooks': 'manage webhooks',
  'design.read': 'read Design & Code',
  'design.write': 'change Design & Code',
  'code.inject': 'add code to the site',
};

export const BASE_WORDS: Record<string, string> = { administrator: 'Administrator', editor: 'Editor', author: 'Author', contributor: 'Contributor' };

export const actionWord = (a: string) => ENTRY_WORDS[a] ?? ABILITY_WORDS[a] ?? a;
export const isEntryAction = (a: string) => a.startsWith('entry.');

/** Who has an ability without a custom role: "editors and up". */
export const fromWords = (min: Role) => (min === 'administrator' ? 'administrators' : `${ROLE_PLURAL[min] ?? min} and up`);

/** A role's rule as people read it: "May edit entries in Posts (their own only)." and its lines. */
export function roleRuleWords(r: RoleRule, collectionLabel: (id: string) => string): { sentence: string; lines: string[] } {
  const deny = r.effect === 'deny';
  const scope = `${r.collections?.length ? ` in ${list(r.collections.map(collectionLabel))}` : ''}${r.own ? ' (their own only)' : ''}`;
  const sentence = `${deny ? 'May not' : 'May'} ${list(r.action.map(actionWord), deny ? 'or' : 'and')}${scope}.`;
  const lines: string[] = [];
  if (r.fields?.length) lines.push(`Only these fields: ${r.fields.join(', ')}.`);
  // what may change and when read as in a promotion rule
  lines.push(...ruleWords({ id: r.id, name: r.name, action: [], effect: r.effect, what: r.what, when: r.when }, (id) => id).lines);
  return { sentence, lines };
}
