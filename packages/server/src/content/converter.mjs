// The one place the server talks to packages/core (the Markdown <-> document converter and the JSON engine).
// Tests use a flat stub module, and core may be missing on a server, so everything goes through
// `createConverter(mod)`; the optional parts have small fallbacks here that are safe but less surgical than core.
//
// @markstage/core: createConverter({packs}) -> {mdToDoc, docToMd (surgical), changedBlocks, rawHtmlOf};
//                  markdownUrls(text) -> every URL a CommonMark renderer builds from it;
//                  readFrontmatter(text) -> object; setFrontmatter(text, {key: value|null}) (surgical YAML).
//                  @markstage/core/json: JsonEntry (surgical JSON edits).
// A flat module (the test stub) may instead export mdToDoc, docToMd, parseFrontmatter, setFrontmatter, ... directly.
import { HttpError } from '../util.mjs';

// core's names: block `rawHtml {html}`, inline `rawInline {html}`; the others are tolerated spellings
const RAW_TYPES = new Set(['rawHtml', 'rawInline', 'html', 'htmlBlock', 'rawHTML']);
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const FM = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/;

/** Load @markstage/core (and its JSON engine) if installed; null when it is not (Markdown routes then answer 503). */
export async function loadCore() {
  const tryImport = async (specifier) => {
    try {
      return await import(specifier);
    } catch (e) {
      if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return null;
      throw e;
    }
  };
  const core = await tryImport('@markstage/core');
  return core && { core, json: await tryImport('@markstage/core/json') };
}

/** Every raw-HTML fragment in a document: nodes the converter could not map to a known node or block pack. */
function defaultRawHtmlOf(doc) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (RAW_TYPES.has(node.type)) out.push(String(node.attrs?.html ?? node.attrs?.source ?? node.text ?? JSON.stringify(node.content ?? '')));
    for (const mark of node.marks ?? []) if (RAW_TYPES.has(mark.type)) out.push(String(mark.attrs?.html ?? ''));
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  return out;
}

/**
 * Without core's CommonMark reader: the URLs a renderer could build from autolinks (`<scheme:…>`) and reference
 * definitions (`[x]: url`), read loosely so it errs toward finding too many (they are only checked, never changed).
 */
export function markdownUrlsFallback(text) {
  const body = String(text ?? '').replace(FM, '');
  const out = [];
  for (const m of body.matchAll(/<([a-z][a-z0-9+.\-]*:[^\s<>]*)>/gi)) out.push(m[1]);
  for (const m of body.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*\n?[ \t]*<?([^\s>]+)/gm)) out.push(m[1]);
  for (const m of body.matchAll(/\]\(\s*<?([^\s)>]+)/g)) out.push(m[1]);
  return out;
}

/** Read a dotted path's segments, refusing prototype keys. */
export function pathSegments(path) {
  const parts = String(path ?? '').split('.');
  if (!path || parts.some((p) => p === '' || BAD_KEYS.has(p))) throw new HttpError(422, 'invalid', `Bad field path: ${path}`);
  return parts;
}

const indentOf = (text) => /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? '  ';

/** Fallback JSON engine: parse, apply set/remove/insert/move/duplicate, print with the file's indent and final newline. */
export function applyJsonChangesFallback(text, changes) {
  const data = JSON.parse(text);
  const nodeAt = (parts, path) => {
    let node = data;
    for (const p of parts) {
      if (node === null || typeof node !== 'object' || !Object.hasOwn(node, p)) throw new HttpError(422, 'invalid', `No field at ${path}`);
      node = node[p];
    }
    return node;
  };
  for (const ch of changes) {
    const op = ch.op ?? (ch.delete ? 'remove' : 'set');
    const parts = pathSegments(ch.path);
    if (op === 'set' || op === 'remove') {
      const holder = nodeAt(parts.slice(0, -1), ch.path);
      const last = parts[parts.length - 1];
      if (holder === null || typeof holder !== 'object') throw new HttpError(422, 'invalid', `No field at ${ch.path}`);
      if (op === 'remove') {
        if (Array.isArray(holder)) holder.splice(Number(last), 1);
        else delete holder[last];
      } else holder[last] = ch.value;
      continue;
    }
    const list = nodeAt(parts, ch.path);
    if (!Array.isArray(list)) throw new HttpError(422, 'invalid', `${ch.path} is not a list`);
    const inRange = (i, max) => Number.isInteger(i) && i >= 0 && i < max;
    if (op === 'insert' && inRange(ch.index, list.length + 1)) list.splice(ch.index, 0, ch.value);
    else if (op === 'move' && inRange(ch.from, list.length) && inRange(ch.to, list.length)) list.splice(ch.to, 0, ...list.splice(ch.from, 1));
    else if (op === 'duplicate' && inRange(ch.index, list.length)) list.splice(ch.index + 1, 0, structuredClone(list[ch.index]));
    else throw new HttpError(422, 'invalid', `Bad ${op} at ${ch.path}`);
  }
  return JSON.stringify(data, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : '');
}

/** Apply `changes` with core's JsonEntry: only the changed values' characters move. */
function jsonEntryChanges(JsonEntry) {
  // with the collection's schema (site config `schema`), inserted values get the site's key order and defaults
  return (text, changes, c = null) => {
    const e = JsonEntry.parse(text, c?.schema ? { schema: c.schema, policy: c.policy ?? undefined } : undefined);
    try {
      for (const ch of changes) {
        const op = ch.op ?? (ch.delete ? 'remove' : 'set');
        pathSegments(ch.path);
        if (op === 'set') e.set(ch.path, ch.value);
        else if (op === 'remove') {
          if (e.has(ch.path)) e.remove(ch.path);
        } else if (op === 'insert') e.insert(ch.path, ch.index, ch.value);
        else if (op === 'move') e.move(ch.path, ch.from, ch.to);
        else if (op === 'duplicate') e.duplicate(ch.path, ch.index);
        else throw new Error(`unknown op "${op}"`);
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(422, 'invalid', `This change cannot be applied: ${err.message}`);
    }
    return e.text;
  };
}

/** Without core's JSON engine: whole-object rewrite, refused for a schema collection (it would not match Keystatic). */
function fallbackJson(text, changes, c = null) {
  if (c?.schema) throw new HttpError(503, 'unavailable', "This collection has a schema; saving it needs @markstage/core's JSON engine, which is not installed.");
  return applyJsonChangesFallback(text, changes);
}

/** The server's view of the converter. `mod` = {core, json} from loadCore(), a flat module (tests), or null. */
export function createConverter(mod, { packs = [] } = {}) {
  const missing = () => {
    throw new HttpError(503, 'unavailable', 'The Markdown converter (@markstage/core) is not installed on this server.');
  };
  if (!mod) {
    return { available: false, mdToDoc: missing, docToMd: missing, parseFrontmatter: missing, setFrontmatter: missing, rawHtmlOf: defaultRawHtmlOf, markdownUrls: markdownUrlsFallback, changedBlocks: () => null, applyJsonChanges: fallbackJson };
  }
  const core = mod.core ?? mod;
  const inst = typeof core.createConverter === 'function' ? core.createConverter({ packs }) : core;
  const readFm = core.readFrontmatter ?? core.parseFrontmatter;
  const JsonEntry = mod.json?.JsonEntry;
  return {
    available: true,
    mdToDoc: (text) => inst.mdToDoc(text),
    docToMd: (doc, original) => {
      const out = inst.docToMd(doc, original);
      if (typeof out !== 'string') throw new Error('The converter returned no text.');
      return out;
    },
    parseFrontmatter: (text) => (readFm ? readFm(text) ?? {} : {}),
    setFrontmatter: typeof core.setFrontmatter === 'function' ? (text, changes) => core.setFrontmatter(text, changes) : missing,
    rawHtmlOf: (doc) => (typeof inst.rawHtmlOf === 'function' ? inst.rawHtmlOf(doc) : defaultRawHtmlOf(doc)),
    // the URLs the site's CommonMark renderer builds from the text (S1): core's reader, or a loose fallback
    markdownUrls: typeof core.markdownUrls === 'function' ? (text) => core.markdownUrls(text) : markdownUrlsFallback,
    changedBlocks: (doc, original) => (typeof inst.changedBlocks === 'function' ? Number(inst.changedBlocks(doc, original)) : null),
    applyJsonChanges: JsonEntry ? jsonEntryChanges(JsonEntry) : fallbackJson,
  };
}

/** Blocks of a Markdown body (split on blank lines), to count what a save changed when core does not say. */
export function countChangedBlocks(before, after) {
  const body = (t) => t.replace(FM, '');
  const blocks = (t) => body(t).split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const pool = new Map();
  for (const b of blocks(before)) pool.set(b, (pool.get(b) ?? 0) + 1);
  let added = 0;
  for (const b of blocks(after)) {
    const n = pool.get(b) ?? 0;
    if (n) pool.set(b, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of pool.values()) removed += n;
  // a frontmatter-only change still counts as one changed block
  const fmChanged = (FM.exec(before)?.[0] ?? '') !== (FM.exec(after)?.[0] ?? '');
  return Math.max(added, removed) + (fmChanged ? 1 : 0);
}

/** Raw-HTML fragments in `next` that were not already in `prev` (multiset): what a contributor may not add. */
export function addedRawHtml(prevFragments, nextFragments) {
  const pool = new Map();
  for (const f of prevFragments) pool.set(f, (pool.get(f) ?? 0) + 1);
  const added = [];
  for (const f of nextFragments) {
    const n = pool.get(f) ?? 0;
    if (n) pool.set(f, n - 1);
    else added.push(f);
  }
  return added;
}
