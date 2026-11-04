// Custom roles (docs/API-ROLES.md): a named role built on a base role, with rules in the promotion rules' shape
// (env/rules.mjs: action, what, when, effect) and three more keys for content: `collections`, `own` and `fields`.
// A pure checker and evaluator: deny wins; an allow gives what the base lacks, never what is an administrator's;
// when no rule applies, the base role answers.
//
//   role: {id, name, base: administrator|editor|author|contributor, rules: [rule]}
//   rule: {id, name, action: [entry.create|entry.edit|entry.publish|entry.delete|entry.rawHtml|<ability>],
//          collections?: [id], own?: true, what?: {only?, not?, any?}, fields?: [dotted glob],
//          when?: {windows?, freezes?}, effect: allow | deny}
import { ROLES, abilities, owns } from '../roles.mjs';
import { KINDS, applies, checkRules, globRe, kindsOf } from '../env/rules.mjs';

export const ENTRY_ACTIONS = ['entry.create', 'entry.edit', 'entry.publish', 'entry.delete', 'entry.rawHtml'];
export const BASES = ['administrator', 'editor', 'author', 'contributor'];
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const FIELD = /^[A-Za-z0-9_$*?-]+(\.[A-Za-z0-9_$*?-]+)*$/;
export const MAX_ROLES = 30;
export const MAX_RULES = 50;

/** A role from a request, checked in plain words (`fail(words, field)` throws). `collections`: the site's ids. */
export function checkRole(b, { collections = [], fail }) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail('A role is {id, name, base, rules}.');
  if (typeof b.id !== 'string' || !ID.test(b.id) || ROLES.includes(b.id)) fail('id is a short lowercase name such as "translator-fr", not a built-in role’s.', 'id');
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) fail('Give it a name (at most 60 characters), e.g. "French translator".', 'name');
  if (!BASES.includes(b.base)) fail(`base is the role it is built on: ${BASES.join(', ')}.`, 'base');
  if (!Array.isArray(b.rules) || b.rules.length > MAX_RULES) fail(`rules is a list of at most ${MAX_RULES}.`, 'rules');
  const names = new Map(abilities().map((a) => [a.name, a.min]));
  const known = new Set([...ENTRY_ACTIONS, ...names.keys()]);
  const cols = new Set(collections);
  const rules = b.rules.map((r, i) => {
    const at = `Rule ${i + 1}${r?.name ? ` (“${r.name}”)` : ''}`;
    const no = (words) => fail(`${at}: ${words}`, 'rules');
    if (!r || typeof r !== 'object' || Array.isArray(r)) no('it must be an object.');
    const odd = Object.keys(r).filter((k) => !['id', 'name', 'action', 'collections', 'own', 'what', 'fields', 'when', 'effect'].includes(k));
    if (odd.length) no(`it has keys it does not know: ${odd.join(', ')}.`);
    if (!['allow', 'deny'].includes(r.effect)) no('effect is allow or deny.');
    if (!Array.isArray(r.action) || !r.action.length || r.action.some((a) => !known.has(a))) no(`action is a list of ${ENTRY_ACTIONS.join(', ')} or abilities (${[...names.keys()].join(', ')}).`);
    const entryOnly = r.action.every((a) => ENTRY_ACTIONS.includes(a));
    if (r.effect === 'allow') {
      const admin = r.action.filter((a) => names.get(a) === 'administrator');
      if (admin.length) no(`${admin.join(', ')} stays with the owner and administrators: a custom role may take it away (deny), not give it.`);
    }
    if ((r.collections !== undefined || r.own !== undefined || r.what !== undefined) && !entryOnly) no('collections, own and what are about entries: use them with entry actions only.');
    if (r.collections !== undefined && (!Array.isArray(r.collections) || !r.collections.length || r.collections.some((c) => !cols.has(c)))) no(`collections is a list of this site’s collections (${collections.join(', ')}).`);
    if (r.own !== undefined && r.own !== true) no('own is true (only the person’s own entries) or left out.');
    if (r.fields !== undefined) {
      if (r.effect !== 'allow' || r.action.length !== 1 || r.action[0] !== 'entry.edit') no('fields is for one allow rule on entry.edit: the fields its edit may change.');
      if (!Array.isArray(r.fields) || !r.fields.length || r.fields.some((f) => typeof f !== 'string' || f.length > 200 || !FIELD.test(f))) no('fields is a list of keys or dotted globs such as "locales.fr-ca.**" or "body".');
    }
    return r;
  });
  // the rest (ids, names, what, when) by the promotion rules' own check, so the two read the same
  const engine = rules.map((r) => ({ id: r.id, name: r.name, action: ['promote'], what: r.what, when: r.when, effect: r.effect }));
  checkRules({ rules: engine }, { fail: (words) => fail(words, 'rules') });
  return { id: b.id, name: b.name.trim(), base: b.base, rules: structuredClone(rules) };
}

/** The keys a save changed between two parsed values, dotted (lists and values whole). */
export function changedPaths(a, b, prefix = '', out = []) {
  const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  // a key new on one side is read as an empty object there: a new locales.fr-ca.title is that path, not `locales`
  if ((plain(a) || a == null) && (plain(b) || b == null) && (plain(a) || plain(b))) {
    const x = a ?? {};
    const y = b ?? {};
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) changedPaths(x[k], y[k], prefix ? `${prefix}.${k}` : k, out);
  } else if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push(prefix || '(all)');
  return out;
}

const fieldMatches = (glob, p) => globRe(glob.split('.').join('/')).test(p.split('.').join('/'));

/**
 * A role made ready to answer: `decide(action, {collection, entry, user})` -> {effect, rule, fields} or null (no rule
 * applies: the base role answers). `site`: what kindsOf needs (collections, mediaDir, libraryDir).
 */
export function compileRole(role, { site = {}, clock = () => Date.now() } = {}) {
  const extOf = (c) => (c.format === 'json' ? 'json' : 'md');
  const pathOf = (c, entry) => `${String(c.dir).replace(/\/+$/, '')}/${entry?.id ?? 'new-entry'}.${extOf(c)}`;
  function explain(action, { collection = null, entry = null, user = null } = {}) {
    const files = collection ? [{ path: pathOf(collection, entry), kinds: kindsOf(pathOf(collection, entry), site) }] : undefined;
    const hits = [];
    const trace = [];
    for (const r of role.rules) {
      let why = null;
      if (!r.action.includes(action)) why = `not for ${action}`;
      else if (r.collections && !(collection && r.collections.includes(collection.id))) why = collection ? `not for ${collection.id}` : 'about entries of some collections';
      else if (r.own && !(entry && user && owns(user, entry))) why = 'only for the person’s own entries';
      else {
        const a = applies({ action: [action], what: r.what, when: r.when, effect: r.effect }, { user: { id: user?.id ?? null, role: role.id }, action, files, at: clock() });
        if (!a.ok) why = a.why;
      }
      trace.push({ rule: r.id, matched: !why, why: why ?? 'applies' });
      if (!why) hits.push(r);
    }
    const deny = hits.find((r) => r.effect === 'deny');
    if (deny) return { decision: { effect: 'deny', rule: { id: deny.id, name: deny.name }, fields: null }, trace };
    const allows = hits.filter((r) => r.effect === 'allow');
    if (!allows.length) return { decision: null, trace };
    // an edit limited to some fields only when every rule that allows it limits it
    const fields = allows.every((r) => r.fields) ? [...new Set(allows.flatMap((r) => r.fields))] : null;
    return { decision: { effect: 'allow', rule: { id: allows[0].id, name: allows[0].name }, fields }, trace };
  }
  const decide = (action, about) => explain(action, about).decision;
  /** The changed paths this role may not make in an edit it allows only for some fields: [] when all may. */
  function outside(d, paths) {
    if (d?.effect !== 'allow' || !d.fields) return [];
    return paths.filter((p) => !d.fields.some((g) => fieldMatches(g, p)));
  }
  return Object.freeze({ id: role.id, name: role.name, base: role.base, rules: role.rules, decide, explain, outside });
}

export { KINDS };
