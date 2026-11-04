// Bring the old WordPress contact messages into the Inbox (docs/DEPLOY.md "Forms"), from a mysqldump file (.sql or
// .sql.gz), read only:
//   markstage-server forms import-wordpress <dump.sql.gz> [--form contact] [--table wp_contact] [--dry-run]
// Each row becomes one message of the form, marked handled (they were answered from WordPress), keyed on its WordPress
// id so a second run adds only rows it has not seen. Nobody is mailed or notified. The visitor's IP address is not
// brought over (the Inbox clears addresses after 30 days anyway); city, state and country, which the old page sent
// itself, are kept as the location.
import fs from 'node:fs';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { cleanText } from './submit.mjs';
import { newId } from '../util.mjs';

// old column -> the form's field (when the form has it; otherwise kept under the column's name)
const FIELDS = { name: 'name', email: 'email', phone: 'number', comment: 'comment', service_type: 'service_type', how_soon: 'how_soon', budget: 'approx_budget' };
const META = { url: 'page', referral_url: 'referrer', session_url: 'landing', u_referring_domain: 'referringDomain', u_source: 'utmSource', u_medium: 'utmMedium' };
const ESCAPES = { 0: '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };
// WordPress stored the message through esc_html()
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#039': "'", '#39': "'", apos: "'" };
const unescapeHtml = (s) => s.replace(/&(amp|lt|gt|quot|#039|#39|apos);/g, (_, e) => ENTITIES[e]);

/**
 * The tuples of one INSERT statement's VALUES list, from `i` (just after VALUES): [[value, …], …]. Strings with
 * mysqldump's backslash escapes, NULL as null, numbers as text.
 */
export function parseValues(sql, i = 0) {
  const rows = [];
  const n = sql.length;
  const skip = () => {
    while (i < n && /\s/.test(sql[i])) i++;
  };
  for (;;) {
    skip();
    if (sql[i] !== '(') throw new Error(`Unexpected "${sql.slice(i, i + 20)}" in the dump (a row should start with "(").`);
    i++;
    const row = [];
    for (;;) {
      skip();
      if (sql[i] === "'") {
        let s = '';
        i++;
        for (;;) {
          if (i >= n) throw new Error('A text value in the dump does not end.');
          if (sql[i] === '\\') {
            const c = sql[i + 1];
            s += ESCAPES[c] ?? c;
            i += 2;
          } else if (sql[i] === "'" && sql[i + 1] === "'") {
            s += "'";
            i += 2;
          } else if (sql[i] === "'") {
            i++;
            break;
          } else s += sql[i++];
        }
        row.push(s);
      } else {
        const m = /^(NULL|0x[0-9a-fA-F]*|-?[0-9.eE+-]+)/.exec(sql.slice(i, i + 64));
        if (!m) throw new Error(`Unexpected "${sql.slice(i, i + 20)}" in the dump.`);
        row.push(m[1] === 'NULL' ? null : m[1]);
        i += m[1].length;
      }
      skip();
      if (sql[i] === ',') {
        i++;
        continue;
      }
      if (sql[i] === ')') {
        i++;
        break;
      }
      throw new Error(`Unexpected "${sql.slice(i, i + 20)}" in the dump (after a value).`);
    }
    rows.push(row);
    skip();
    if (sql[i] === ',') {
      i++;
      continue;
    }
    if (sql[i] === ';' || i >= n) break;
    throw new Error(`Unexpected "${sql.slice(i, i + 20)}" in the dump (after a row).`);
  }
  return rows;
}

/** Read one table out of a dump: {columns, rows: [{column: value}], timeZone}. */
export async function readDump(file, table) {
  const input = fs.createReadStream(file);
  const stream = /\.gz$/i.test(file) ? input.pipe(zlib.createGunzip()) : input;
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const q = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const create = new RegExp(`^CREATE TABLE \`${q}\` \\(`);
  const insert = new RegExp(`^INSERT INTO \`${q}\`\\s*(\\(([^)]*)\\))?\\s*VALUES\\s*`);
  let columns = null;
  let inCreate = false;
  let timeZone = null;
  const rows = [];
  for await (const line of lines) {
    if (timeZone === null) {
      const tz = /SET TIME_ZONE='([^']+)'/.exec(line);
      if (tz) timeZone = tz[1];
    }
    if (create.test(line)) {
      inCreate = true;
      columns = [];
      continue;
    }
    if (inCreate) {
      const col = /^\s*`([^`]+)`\s/.exec(line);
      if (col) columns.push(col[1]);
      else if (/^\)/.test(line)) inCreate = false;
      continue;
    }
    const m = insert.exec(line);
    if (!m) continue;
    const cols = m[2] ? m[2].split(',').map((c) => c.trim().replace(/^`|`$/g, '')) : columns;
    if (!cols) throw new Error(`The dump inserts into ${table} before it creates it.`);
    for (const r of parseValues(line, m[0].length)) {
      if (r.length !== cols.length) throw new Error(`A ${table} row has ${r.length} values for ${cols.length} columns.`);
      rows.push(Object.fromEntries(cols.map((c, k) => [c, r[k]])));
    }
  }
  if (!columns && !rows.length) throw new Error(`The dump has no table ${table}.`);
  return { columns, rows, timeZone };
}

/** "2024-03-11 11:33:13" in the dump's time zone (+00:00 or ±hh:mm) as an ISO time. */
export function isoOf(stamp, timeZone = '+00:00') {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(String(stamp ?? ''));
  if (!m) return null;
  const tz = /^[+-]\d{2}:\d{2}$/.test(timeZone ?? '') ? timeZone : '+00:00';
  const d = new Date(`${m[1]}T${m[2]}${tz === '+00:00' ? 'Z' : tz}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A wp_contact row as a message: {sourceId, at, name, email, fields, meta}. */
export function messageOf(row, form, timeZone) {
  const has = (k) => form.fields.some((f) => f.key === k);
  const fields = {};
  for (const [col, key] of Object.entries(FIELDS)) {
    if (!(col in row)) continue;
    const v = cleanText(unescapeHtml(String(row[col] ?? '')), col === 'comment');
    if (v) fields[has(key) ? key : col] = v;
  }
  const meta = {};
  for (const [col, key] of Object.entries(META)) {
    const v = cleanText(row[col]).slice(0, 2000);
    if (v) meta[key] = v;
  }
  const location = ['city', 'state', 'country'].map((c) => cleanText(row[c])).filter(Boolean).join(', ');
  if (location) meta.location = location;
  const nameKey = form.name && fields[form.name] !== undefined ? form.name : 'name';
  const emailKey = form.email && fields[form.email] !== undefined ? form.email : 'email';
  const serviceKey = form.service && fields[form.service] !== undefined ? form.service : 'service_type';
  return { sourceId: String(row.id), at: isoOf(row.createdtime, timeZone), name: fields[nameKey] ?? null, email: fields[emailKey] ?? null, service: fields[serviceKey] ?? null, fields, meta };
}

/** Import into the data dir's database: {found, added, already, skipped: [{id, reason}]}. */
export async function importWordpress(app, file, { form: formId = 'contact', table = 'wp_contact', dryRun = false } = {}) {
  const form = app.config.forms?.[formId];
  if (!form) throw new Error(`There is no form "${formId}" in the site's forms (markstage.config forms, or config.json forms).`);
  if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`);
  const { rows, timeZone } = await readDump(file, table);
  const out = { found: rows.length, added: 0, already: 0, skipped: [], timeZone: timeZone ?? '+00:00 (assumed)' };
  const insert = app.db.prepare("INSERT OR IGNORE INTO form_messages (id, form, at, status, name, email, service, fields, meta, source, source_id, status_by, status_at) VALUES (?, ?, ?, 'handled', ?, ?, ?, ?, ?, 'wordpress', ?, 'WordPress import', ?)");
  const event = app.db.prepare("INSERT INTO form_events (message_id, at, change) VALUES (?, ?, 'imported from WordPress (marked handled)')");
  const known = app.db.prepare("SELECT 1 FROM form_messages WHERE source = 'wordpress' AND source_id = ?");
  for (const row of rows) {
    const m = messageOf(row, form, timeZone);
    if (!m.at) {
      out.skipped.push({ id: m.sourceId, reason: 'no date' });
      continue;
    }
    if (known.get(m.sourceId)) {
      out.already++;
      continue;
    }
    if (!dryRun) {
      const id = newId('fm');
      insert.run(id, form.id, m.at, m.name, m.email, m.service, JSON.stringify(m.fields), JSON.stringify(m.meta), m.sourceId, m.at);
      event.run(id, m.at);
    }
    out.added++;
  }
  if (!dryRun) app.audit.log({ actorName: 'markstage-server CLI' }, 'inbox.import', { target: form.id, detail: { from: 'wordpress', table, found: out.found, added: out.added, already: out.already, skipped: out.skipped.length } });
  return out;
}
