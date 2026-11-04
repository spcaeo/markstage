// Topic files in the content repo (docs/API-LINKS.md): the folder the site config names (topics.dir), one
// <topic id>.json per topic, read and written like author files are (a strict id, directly in the folder, never through
// a link, written atomically). The topic's shape comes from core's topics.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigError, isInside, realish } from '../config.mjs';
import { notFound, sha1 } from '../util.mjs';

/** The site's topics config with core's modules, checked by core and then by the server's path rules; null when off. */
export async function topicsConfig(config) {
  if (!config.topics) return null;
  let core;
  try {
    core = {
      topics: await import('@markstage/core/topics'),
      map: await import('@markstage/core/link-map'),
      suggest: await import('@markstage/core/link-suggest'),
      pageTypes: await import('@markstage/core/page-types'),
    };
  } catch {
    throw new ConfigError('topics needs @markstage/core, which is not installed.');
  }
  const fail = (m) => {
    throw new ConfigError(m);
  };
  const { absDir: _given, ...raw } = config.topics;
  const cfg = core.topics.topicsConfigOf(raw, { collections: config.collections.map((c) => ({ id: c.id, hasUrl: true })), pageTypes: config.pageTypes, fail });
  const absDir = realish(path.resolve(config.contentRoot, cfg.dir));
  if (!isInside(config.contentRoot, absDir) || absDir === realish(config.contentRoot) || isInside(path.join(config.contentRoot, '.git'), absDir)) fail('topics.dir must be a folder inside the content repo.');
  if (config.collections.some((c) => c.absDir === absDir)) fail('topics.dir is the folder of a collection; topics need a folder of their own.');
  return { core, cfg: { ...cfg, absDir } };
}

export function createTopicFiles(config, { core, cfg }) {
  const rel = (abs) => path.relative(config.contentRoot, abs).split(path.sep).join('/');
  const T = core.topics;

  /** The file of a topic (a 404 for a bad id, a link, or one outside the folder). */
  function fileOf(id, { mustExist = true } = {}) {
    if (!T.TOPIC_ID.test(String(id ?? ''))) throw notFound('No such topic.');
    const abs = path.join(cfg.absDir, `${id}.json`);
    if (fs.existsSync(cfg.absDir) && !isInside(config.contentRoot, fs.realpathSync(cfg.absDir))) throw notFound('No such topic.');
    let st = null;
    try {
      st = fs.lstatSync(abs);
    } catch {
      // not there
    }
    if (st && !st.isFile()) throw notFound('No such topic.');
    if (mustExist && !st) throw notFound(`There is no topic “${id}”.`);
    return abs;
  }

  /** {id, abs, rel, text, version, topic} of one topic (an unreadable file reads as an empty topic). */
  function read(id) {
    const abs = fileOf(id);
    const text = fs.readFileSync(abs, 'utf8');
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
    return { id, abs, rel: rel(abs), text, version: sha1(text), topic: T.topicOf(id, data) };
  }

  const exists = (id) => {
    try {
      fileOf(id);
      return true;
    } catch {
      return false;
    }
  };

  /** Every topic file, by title. */
  function all() {
    if (!fs.existsSync(cfg.absDir)) return [];
    return fs
      .readdirSync(cfg.absDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.json') && T.TOPIC_ID.test(d.name.slice(0, -5)))
      .map((d) => {
        try {
          return read(d.name.slice(0, -5));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.topic.title.localeCompare(b.topic.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  }

  /** The topic written in its stable shape (temp file in the folder, then rename); the folder is made the first time. */
  function write(t) {
    const abs = fileOf(t.id, { mustExist: false });
    const text = `${JSON.stringify(T.topicData(t), null, 2)}\n`;
    fs.mkdirSync(cfg.absDir, { recursive: true });
    const tmp = path.join(cfg.absDir, `.markstage-${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, abs);
    return { rel: rel(abs), version: sha1(text) };
  }

  function remove(id) {
    const abs = fileOf(id);
    fs.unlinkSync(abs);
    return { rel: rel(abs) };
  }

  /** A topic's whole text as it was (for putting it back when a commit fails). */
  function restore(id, text) {
    const abs = fileOf(id, { mustExist: false });
    if (text === null) {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
      return;
    }
    fs.mkdirSync(cfg.absDir, { recursive: true });
    fs.writeFileSync(abs, text);
  }

  return { fileOf, read, exists, all, write, remove, restore, relOf: (id) => rel(path.join(cfg.absDir, `${id}.json`)) };
}
