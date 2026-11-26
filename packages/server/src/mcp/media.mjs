// The MCP server's picture tool (docs/API-MCP.md "Pictures"): `add_image`, for a token with mcp:draft. An agent adds
// one picture, from a web address or as its bytes in base64, with its alt text, and gets back what to write in an
// entry (a cover or image field, or the Markdown). Nothing here stores a picture itself: the bytes go to the editor's
// own upload routes, as the token's person, so every rule of a person's upload holds (the role's right to upload,
// the size limit, the type told from the bytes and never SVG, an iPhone photo read, the re-encode that strips
// metadata, the name in the media folder, the media library's row, the commit and the audit):
//
//   - without `release`: POST /media, the editor's upload. The picture is committed to the media folder as a
//     person's upload is (its commit names the agent), and shows on the site only once a page that uses it goes live.
//     Not on a site whose media folder is under public/: the build serves every file there as it is, so the picture
//     would be on the site at the next build, used or not, and nothing an agent does goes live by itself (409);
//   - with `release`: POST /releases/:rid/media, a release's picture. Nothing is written to the repo: the picture
//     waits in that release (not a scheduled one) and is stored, committed and listed in the media library when the
//     release goes live, in the release's one commit, with the entry that uses it. Cancelled, it never reaches the site.
//
// A web address is fetched by the server through the same guard as the media import (library/fetch.mjs: http and
// https on the usual ports, public addresses only, every redirect checked again, a time and a size limit), and only
// for a role that may import media (author and up), as in the editor; a contributor's agent sends the bytes.
import path from 'node:path';
import { atLeast, can } from '../roles.mjs';
import { HttpError, badRequest, forbidden, slugify } from '../util.mjs';
import { checkUrl } from '../library/fetch.mjs';
import { nameOfUrl } from '../media/import.mjs';
import { notScheduled } from '../releases/items.mjs';
import { tooLarge } from '../media/routes.mjs';
import { TYPES, sniff } from '../media/sniff.mjs';

const ALT_MAX = 500;
const str = (description) => ({ type: 'string', description });

/** A picture's bytes from base64 (standard or URL-safe, whitespace allowed) or a base64 data: URL; else a refusal in words. */
export function fromBase64(s) {
  let t = s.trim();
  const head = /^data:([^,]*),/i.exec(t);
  if (head) {
    if (!/;base64$/i.test(head[1])) throw badRequest('"data" is a data: URL without base64. Send the picture’s bytes in base64.');
    t = t.slice(head[0].length);
  }
  t = t.replace(/\s+/g, '');
  if (!t || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(t) || t.length % 4 === 1) throw badRequest('"data" is not base64. Send the picture’s bytes in base64 (or a data: URL), or its web address in "url".');
  return Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Alt text in Markdown's brackets: a bracket or backslash escaped, on one line. */
const altInMarkdown = (alt) => alt.replace(/\s+/g, ' ').replace(/([\\[\]])/g, '\\$1');

/**
 * What to write in an entry for a picture at repo path `rel`, as the editor writes it (editor/src/assets.ts):
 * in an image field its path inside the media folder (2026/11/x.webp), or the site path of one under public/; in
 * Markdown a path relative to the collection's folder, or that site path.
 */
export function usesOf(app, rel, alt, collections) {
  const mediaDir = `${app.config.media.dir.split(path.sep).join('/')}/`;
  const site = rel.startsWith('public/') ? `/${rel.slice('public/'.length)}` : null;
  const field = site ?? (rel.startsWith(mediaDir) ? rel.slice(mediaDir.length) : `/${rel}`);
  const markdown = {};
  for (const c of collections) {
    if (c.format !== 'md' && c.format !== 'mdx') continue;
    const from = app.store.rel(c.absDir).split('/').filter(Boolean);
    const to = rel.split('/');
    let k = 0;
    while (k < from.length && k < to.length - 1 && from[k] === to[k]) k++;
    const src = site ?? [...from.slice(k).map(() => '..'), ...to.slice(k)].join('/');
    markdown[c.id] = `![${altInMarkdown(alt)}](${src})`;
  }
  return { field, markdown };
}

/** Whether the site's build serves every file in the media folder as it is (a folder under public/). */
const servedAsIs = (app) => /^public(\/|$)/.test(app.config.media.dir.split(path.sep).join('/'));

/** A file name for the media folder: the one sent, the address's, or the alt text's first words. */
function nameFor(a) {
  if (a.filename?.trim()) return a.filename.trim().slice(0, 200);
  if (a.url) return nameOfUrl(a.url).slice(0, 200);
  return `${slugify(a.alt).split('-').slice(0, 8).join('-') || 'image'}.img`;
}

export const MEDIA_TOOL = {
  name: 'add_image',
  title: 'Add a picture',
  scope: 'draft',
  // `data` may be as long as a picture at the media limit in base64 (the request's own limit is raised to fit it)
  long: ['data'],
  description:
    'Add one picture (JPEG, PNG, GIF, WebP, AVIF or an iPhone HEIC; never SVG) to the site’s media, from a web address (url) or its bytes in base64 (data), with alt text that says what it shows. It is checked and re-encoded as a person’s upload is. The answer says what to write in an entry: use.field for a cover or image field, use.markdown for the text. Without release it is committed to the media folder and shows on the site once a page that uses it goes live (a draft: put it in with update_entry); a site whose media folder is served as it is (under public/) needs a release. With release it waits in that release, which is not scheduled, and goes live with it: add the entry that uses it to the same release (add_to_release).',
  input: {
    properties: {
      alt: str('What the picture shows, for people who cannot see it (up to 500 characters). Required.'),
      url: str('A public web address of the picture (http or https). Send this or data.'),
      data: str('The picture’s bytes in base64, or a base64 data: URL, at most the site’s media limit. Send this or url.'),
      filename: str('A file name for it (the media folder keeps a tidy form of it). Default: the address’s, or the alt text’s first words.'),
      release: str('A release id (list_releases), not scheduled: the picture waits in it and goes live with it. Leave out to add it to the media folder now.'),
      collection: str('Only this collection’s Markdown in the answer.'),
    },
    required: ['alt'],
  },
  async run(t, a) {
    const { app, user } = t;
    const media = app.config.media;
    const alt = a.alt.trim();
    if (!alt) throw badRequest('Give the picture alt text: a few words on what it shows, for people who cannot see it.');
    if (alt.length > ALT_MAX) throw badRequest(`Alt text is up to ${ALT_MAX} characters.`);
    if ((a.url === undefined) === (a.data === undefined)) throw badRequest('Send the picture once: its web address in "url", or its bytes in base64 in "data".');
    const only = a.collection === undefined ? null : t.coll(a.collection);
    if (!can(user, 'media.upload')) throw forbidden('Your role cannot upload files.');
    if (a.release === undefined && servedAsIs(app)) throw new HttpError(409, 'served-as-is', 'On this site every file in the media folder is put on the site as it is at the next build, used or not, so a picture an AI agent adds waits in a release instead: send it with release (an open release from list_releases), and put the entry that uses it into the same release.');
    let release = null;
    if (a.release !== undefined) {
      // a release's items go live with it: a contributor puts nothing into a release (a person adds what they write)
      if (!atLeast(user, 'author')) throw forbidden('A picture in a release goes live with it, and a contributor puts nothing into a release. Add it without release and use it in your draft; an editor publishes it.');
      // asked before anything is fetched; the release's route asks again, and once more just before the item is kept
      release = await t.call('GET', `/releases/${encodeURIComponent(a.release)}`);
      notScheduled(release);
    }

    let raw;
    let href = null;
    if (a.url !== undefined) {
      if (!can(user, 'media.import')) throw forbidden('Fetching a picture from a web address is an import, and your role cannot import media. Send the picture’s bytes in base64 in "data" instead.');
      try {
        href = checkUrl(a.url.trim(), app.outbound ?? {}).href;
      } catch (e) {
        throw e instanceof HttpError ? e : badRequest('This is not a web address.');
      }
      raw = await app.mediaImport.fetchImage(href);
    } else {
      raw = fromBase64(a.data);
      if (raw.length > media.maxBytes) throw tooLarge(raw.length, media.maxBytes);
    }
    // a picture tool: a PDF, a page or anything else is said so here (the upload takes PDFs as downloads)
    const kind = sniff(raw);
    if (kind.type && TYPES[kind.type].document) throw new HttpError(415, 'unsupported-type', 'This is a PDF document, not a picture. add_image takes pictures: JPEG, PNG, GIF, WebP, AVIF or an iPhone HEIC.');
    if (!kind.type && !kind.heic && !kind.svg) throw new HttpError(415, 'unsupported-type', `${a.url !== undefined ? 'What this address sends' : 'This'} is not a picture. add_image takes JPEG, PNG, GIF, WebP, AVIF or an iPhone HEIC.`);

    const query = { filename: nameFor(a), alt, ...(href ? { source: href } : {}) };
    const collections = only ? [only] : t.store.collections;
    if (release) {
      const r = await t.call('POST', `/releases/${encodeURIComponent(release.id)}/media`, { query, raw });
      const it = r.item;
      return {
        added: true,
        path: it.path,
        url: it.url,
        type: it.type,
        width: it.width,
        height: it.height,
        bytes: it.bytes,
        alt: it.alt,
        media: null,
        release: { id: r.release.id, name: r.release.name, status: r.release.status, version: r.release.version, item: it.id, counts: r.release.counts },
        use: usesOf(app, it.path, it.alt, collections),
        note: `It waits in the release “${r.release.name}” and is not on the site yet. It goes live with that release, in its one commit: put the entry that uses it into the same release (add_to_release). Taken out of the release, or the release cancelled, it never reaches the site.`,
      };
    }
    const m = await t.call('POST', '/media', { query, raw });
    return {
      added: true,
      path: m.path,
      url: m.url,
      type: m.type,
      width: m.width,
      height: m.height,
      bytes: m.bytes,
      alt: m.alt,
      media: m.id,
      release: null,
      use: usesOf(app, m.path, m.alt, collections),
      note: 'It is in the site’s media folder, committed as a person’s upload is, and shows on the site once a page that uses it goes live. Put use.field in a cover or image field, or use.markdown in the text: update_entry for a draft, add_to_release for a live page.',
    };
  },
};
