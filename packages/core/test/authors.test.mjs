// Author files (@markstage/core/authors): the config with its defaults and mistakes, a profile read through the
// site's own keys (a common shape), surgical changes, the entry's authors, problems, reassigning, Person JSON-LD;
// and the site config: the author setting becomes a picker, the client config says so.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JsonEntry } from '@markstage/core/json';
import {
  authorProblems,
  authorUrl,
  authorsConfigOf,
  cleanProfile,
  entryAuthors,
  newAuthorData,
  personJsonLd,
  profileChanges,
  profileOf,
  profileProblems,
  publicProfile,
  reassignChanges,
  slugOfName,
} from '@markstage/core/authors';
import { clientConfig, normalizeConfig } from '@markstage/core/site-config';

const COLLECTIONS = [
  { id: 'posts', hasStatus: true },
  { id: 'pages', hasStatus: false },
];
const cfg = (raw) => authorsConfigOf(raw, { collections: COLLECTIONS });
const ACFG = cfg({ coAuthors: 'coAuthors', organization: 'https://example.com/#organization' });
// an author file as a site often keeps it (src/content/authors/<id>.json)
const SAM = `{
  "id": "sam",
  "name": "Sam Example",
  "designation": "Founder",
  "bio": "Builds things.\\n\\nWrites about them.",
  "avatar": "2024/02/sam.png",
  "seo": {
    "title": "Sam Example, Founder",
    "description": "Notes from the founder.",
    "robots": ["index"]
  }
}
`;

test('config: off by default, true for the defaults, and the defaults themselves', () => {
  assert.equal(cfg(undefined), null);
  assert.equal(cfg(false), null);
  const d = cfg(true);
  assert.equal(d.dir, 'src/content/authors');
  assert.equal(d.url, '/author/{slug}/');
  assert.equal(d.coAuthors, null);
  assert.deepEqual(d.collections, ['posts'], 'every collection with a status');
  assert.equal(d.fields.role, 'designation');
  assert.equal(d.fields.seoTitle, 'seo.title');
  // the normalized config goes through again unchanged (the server runs it a second time)
  assert.deepEqual(cfg(d), d);
});

test('config: mistakes are refused in plain words', () => {
  assert.throws(() => cfg({ dir: '../outside' }), /authors.dir must be a folder inside the project/);
  assert.throws(() => cfg({ url: '/author/' }), /authors.url must be a site path with \{slug\}/);
  assert.throws(() => cfg({ coAuthors: 'co authors' }), /authors.coAuthors must be a frontmatter key/);
  assert.throws(() => cfg({ organization: 'Example Inc' }), /authors.organization must be the Organization @id/);
  assert.throws(() => cfg({ collections: ['nope'] }), /authors.collections must list collections of this site \(posts, pages\)/);
  assert.throws(() => cfg({ fields: { colour: 'c' } }), /authors.fields.colour: the fields are/);
  assert.throws(() => cfg({ fields: { name: null } }), /authors.fields.name must be a key/);
  assert.equal(cfg({ url: null, fields: { email: null, role: 'jobTitle' } }).fields.email, null);
});

test('a profile through the site keys: empties, social as a list, archived, the email private', () => {
  const p = profileOf(ACFG, 'sam', JSON.parse(SAM));
  assert.deepEqual(p, {
    slug: 'sam',
    name: 'Sam Example',
    role: 'Founder',
    bio: 'Builds things.\n\nWrites about them.',
    photo: '2024/02/sam.png',
    email: '',
    website: '',
    social: [],
    seoTitle: 'Sam Example, Founder',
    seoDescription: 'Notes from the founder.',
    archived: false,
  });
  // a file with no name shows its slug; one with an email keeps it out of the public profile
  const q = profileOf(ACFG, 'site-team', { email: 'team@example.com', archived: true, social: ['https://x.example/team', 7, ''] });
  assert.equal(q.name, 'site-team');
  assert.equal(q.archived, true);
  assert.deepEqual(q.social, ['https://x.example/team']);
  assert.equal('email' in publicProfile(q), false);
});

test('clean and check a profile', () => {
  const p = cleanProfile({ name: '  Ana  ', social: 'https://a.example/x, https://b.example/y\nhttps://a.example/x', website: 'ftp://a', email: 'no', extra: 1, archived: 'yes' });
  assert.deepEqual(p, { name: 'Ana', website: 'ftp://a', email: 'no', social: ['https://a.example/x', 'https://b.example/y'], archived: false });
  const bad = profileProblems(p);
  assert.match(bad.website, /https:\/\//);
  assert.match(bad.email, /not an email/);
  assert.deepEqual(profileProblems({ name: 'Ana', email: 'ana@example.com', website: 'https://ana.example' }), {});
  assert.match(profileProblems({}, { whole: true }).name, /Give the author a name/);
  assert.match(profileProblems({ social: ['https://ok.example', 'javascript:alert(1)'] }).social, /javascript:alert/);
  assert.match(profileProblems({ photo: 'javascript:x' }).photo, /media library/);
  assert.equal(slugOfName('Ana María  Ruiz!'), 'ana-maria-ruiz');
});

test('surgical changes: only what changed moves; an emptied value leaves the file; open and save is byte-identical', () => {
  const data = JSON.parse(SAM);
  assert.deepEqual(profileChanges(ACFG, data, profileOf(ACFG, 'sam', data)), [], 'nothing changed: no change');
  const ch = profileChanges(ACFG, data, { role: 'Founder and CEO', seoDescription: '', social: ['https://x.example/sam'], email: 'r@example.com' });
  assert.deepEqual(ch, [
    { path: 'designation', value: 'Founder and CEO' },
    { path: 'email', value: 'r@example.com' },
    { path: 'social', value: ['https://x.example/sam'] },
    { path: 'seo.description', delete: true },
  ]);
  const e = JsonEntry.parse(SAM);
  for (const c of ch) c.delete ? e.remove(c.path) : e.set(c.path, c.value);
  assert.match(e.text, /"designation": "Founder and CEO"/);
  assert.match(e.text, /"robots": \["index"\]/, 'the rest of the file is as it was');
  assert.doesNotMatch(e.text, /"description"/);
  // a field the site turned off is never written
  const off = cfg({ fields: { email: null } });
  assert.deepEqual(profileChanges(off, {}, { email: 'x@example.com', name: 'X' }), [{ path: 'name', value: 'X' }]);
});

test('a new author file: the slug key first, nested keys, empties left out', () => {
  assert.deepEqual(newAuthorData(ACFG, 'ana', { name: 'Ana', role: '', seoTitle: 'Ana at Example', social: [] }), { id: 'ana', name: 'Ana', seo: { title: 'Ana at Example' } });
  assert.deepEqual(newAuthorData(cfg({ fields: { slug: null } }), 'ana', { name: 'Ana' }), { name: 'Ana' });
});

test("an entry's authors: the primary first, then co-authors, once each; a list in the author field", () => {
  assert.deepEqual(entryAuthors(ACFG, 'author', { author: 'ana', coAuthors: ['bo', 'ana', ''] }), ['ana', 'bo']);
  assert.deepEqual(entryAuthors(ACFG, 'author', { author: ['ana', 'cy'] }), ['ana', 'cy']);
  assert.deepEqual(entryAuthors(ACFG, 'author', {}), []);
  assert.deepEqual(entryAuthors(cfg(true), 'author', { author: 'ana', coAuthors: ['bo'] }), ['ana'], 'no co-authors key: none read');
});

test('problems: unknown and archived authors, only the ones asked', () => {
  const known = new Map([
    ['ana', { slug: 'ana', name: 'Ana', archived: false }],
    ['old', { slug: 'old', name: 'Old Hand', archived: true }],
  ]);
  const out = authorProblems(['ana', 'ghost', 'old'], known);
  assert.deepEqual(out.map((p) => [p.slug, p.problem]), [['ghost', 'unknown'], ['old', 'archived']]);
  assert.match(out[0].message, /“ghost” is not one of the site's authors/);
  assert.deepEqual(authorProblems(['ana', 'ghost', 'old'], known, { only: ['old'] }).map((p) => p.slug), ['old']);
});

test('reassign: the primary, a co-author, and one that would be named twice', () => {
  assert.deepEqual(reassignChanges(ACFG, 'author', { author: 'old', coAuthors: ['bo'] }, 'old', 'ana'), { author: 'ana' });
  assert.deepEqual(reassignChanges(ACFG, 'author', { author: 'bo', coAuthors: ['old', 'cy'] }, 'old', 'ana'), { coAuthors: ['ana', 'cy'] });
  assert.deepEqual(reassignChanges(ACFG, 'author', { author: 'old', coAuthors: ['ana'] }, 'old', 'ana'), { author: 'ana', coAuthors: null });
  assert.deepEqual(reassignChanges(ACFG, 'author', { author: 'ana', coAuthors: ['old'] }, 'old', 'ana'), { coAuthors: null });
  assert.equal(reassignChanges(ACFG, 'author', { author: 'bo' }, 'old', 'ana'), null);
  assert.deepEqual(reassignChanges(ACFG, 'author', { author: ['old', 'bo'] }, 'old', 'ana'), { author: ['ana', 'bo'] });
});

test('Person JSON-LD: the page, picture, job, sameAs, worksFor; never the email', () => {
  const p = { ...profileOf(ACFG, 'ana', { name: 'Ana', designation: 'Editor', website: 'https://ana.example', social: ['https://x.example/ana'], email: 'ana@example.com' }), photo: '/uploads/ana.png' };
  const ld = personJsonLd(p, { acfg: ACFG, siteUrl: 'https://example.com/' });
  assert.deepEqual(ld, {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': 'https://example.com/author/ana/',
    url: 'https://example.com/author/ana/',
    name: 'Ana',
    image: 'https://example.com/uploads/ana.png',
    jobTitle: 'Editor',
    sameAs: ['https://ana.example', 'https://x.example/ana'],
    worksFor: { '@id': 'https://example.com/#organization' },
  });
  assert.doesNotMatch(JSON.stringify(ld), /ana@example\.com/);
  // a photo the build resolves (src/assets) is given by the site; none: no image
  assert.equal(personJsonLd({ ...p, photo: '2024/ana.png' }, { acfg: ACFG, siteUrl: 'https://example.com' }).image, undefined);
  assert.equal(personJsonLd(p, { acfg: ACFG, image: '/_astro/ana.hash.webp', siteUrl: 'https://example.com' }).image, 'https://example.com/_astro/ana.hash.webp');
  assert.equal(authorUrl(cfg({ url: null }), 'ana'), null);
});

test('site config: the author setting becomes a picker with co-authors; the client config says where authors live', () => {
  const site = normalizeConfig(
    {
      authors: { coAuthors: 'coAuthors' },
      collections: [
        { id: 'posts', format: 'md', dir: 'src/content/posts', hasStatus: true, settings: [{ type: 'text', key: 'author', label: 'Written by' }, { type: 'text', key: 'subtitle', label: 'Subtitle' }] },
        { id: 'notes', format: 'md', dir: 'src/content/notes' },
      ],
    },
    '/tmp/site',
  );
  assert.deepEqual(site.collections[0].settings[0], { type: 'author', key: 'author', label: 'Written by', coAuthors: 'coAuthors' });
  assert.equal(site.collections[0].settings[1].type, 'text');
  // a collection the authors are not for keeps its text field
  assert.equal(site.collections[1].settings.find((f) => f.key === 'author').type, 'text');
  assert.equal(site.authors.absDir, '/tmp/site/src/content/authors');
  assert.deepEqual(clientConfig(site).authors, { url: '/author/{slug}/', coAuthors: 'coAuthors', collections: ['posts'], profile: ['name', 'role', 'bio', 'photo', 'email', 'website', 'social', 'seoTitle', 'seoDescription', 'archived'] });
  // a profile field the site turned off is not offered
  const lean = normalizeConfig({ authors: { fields: { email: null, social: null } }, collections: [] }, '/tmp/site');
  assert.deepEqual(clientConfig(lean).authors.profile, ['name', 'role', 'bio', 'photo', 'website', 'seoTitle', 'seoDescription', 'archived']);
  assert.equal(clientConfig(normalizeConfig({ collections: [] }, '/tmp/site')).authors, null);
  assert.throws(() => normalizeConfig({ collections: [{ id: 'notes', format: 'md', dir: 'n', settings: [{ type: 'author', key: 'author' }] }] }, '/tmp/site'), /an author field needs authors/);
});
