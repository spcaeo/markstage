// Old WordPress contact messages into the Inbox (forms/import-wp.mjs), from a mysqldump made here in the exact shape
// of the WordPress table (its CREATE TABLE and one multi-row INSERT with mysqldump's escapes). The rows are made up.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { as, makeFixture, startServer } from './helpers.mjs';
import { CONTACT_CONFIG } from './forms-support.mjs';
import { importWordpress, isoOf, parseValues, readDump } from '../src/forms/import-wp.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/markstage-server.mjs');
const DUMP = `-- MySQL dump 10.13  Distrib 8.0.46, for Linux (x86_64)
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
DROP TABLE IF EXISTS \`wp_contact\`;
CREATE TABLE \`wp_contact\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`name\` varchar(100) NOT NULL,
  \`email\` varchar(100) NOT NULL,
  \`phone\` varchar(50) NOT NULL,
  \`comment\` text NOT NULL,
  \`budget\` varchar(50) NOT NULL,
  \`how_soon\` varchar(50) NOT NULL,
  \`service_type\` varchar(50) DEFAULT NULL,
  \`city\` varchar(50) NOT NULL,
  \`state\` varchar(50) NOT NULL,
  \`country\` varchar(50) NOT NULL,
  \`referrer\` varchar(39) DEFAULT NULL,
  \`url\` text NOT NULL,
  \`referral_url\` text NOT NULL,
  \`u_source\` varchar(50) DEFAULT NULL,
  \`session_url\` text,
  \`u_referring_domain\` text,
  \`u_medium\` varchar(50) DEFAULT NULL,
  \`createdtime\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB AUTO_INCREMENT=149 DEFAULT CHARSET=latin1;
LOCK TABLES \`wp_contact\` WRITE;
INSERT INTO \`wp_contact\` VALUES (1,'Ann O\\'Neil','ann@one.example','+1 416 555 0101','We&#039;d like a \\"quote\\" for 3 boards;\\r\\nand a call.','5000','Within a month','Data migration','Toronto','Ontario','Canada','203.0.113.7','https://www.example.test/contact-us/','https://www.google.com/','google / organic',NULL,'google.com','','2024-03-11 11:33:13'),(2,'Bo','bo@two.example','555 0102','A path C:\\\\data, then (a) list, and \\'quotes\\'.','','','','','','','198.51.100.9','https://www.example.test/','','',NULL,NULL,NULL,'2026-10-26 17:48:07'),(3,'Cy','cy@three.example','555 0103','No date on this one, it should be skipped.','','',NULL,'','','',NULL,'','','',NULL,NULL,NULL,'0000-00-00 00:00:00');
UNLOCK TABLES;
INSERT INTO \`wp_contactx\` VALUES (9,'Not','this','one');
`;

describe('WordPress contact messages into the Inbox', () => {
  let fx, srv, file;
  const rows = () => srv.app.db.prepare("SELECT * FROM form_messages WHERE source = 'wordpress' ORDER BY source_id").all();

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONTACT_CONFIG);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A site with a contact form');
    // the site lists the collections; config.json no longer does
    const cfg = JSON.parse(fs.readFileSync(path.join(fx.data, 'config.json'), 'utf8'));
    fs.writeFileSync(path.join(fx.data, 'config.json'), JSON.stringify({ ...cfg, collections: [] }));
    file = path.join(fx.run, '01-database.sql.gz');
    fs.writeFileSync(file, zlib.gzipSync(DUMP));
    srv = await startServer(fx);
  });
  after(() => srv.close());

  test('the dump is read as mysqldump writes it: escapes, NULL, the time zone, only the named table', async () => {
    const d = await readDump(file, 'wp_contact');
    assert.equal(d.timeZone, '+00:00');
    assert.equal(d.columns.length, 19);
    assert.deepEqual(d.rows.map((r) => r.id), ['1', '2', '3']);
    assert.equal(d.rows[0].name, "Ann O'Neil");
    assert.equal(d.rows[0].comment, 'We&#039;d like a "quote" for 3 boards;\r\nand a call.');
    assert.equal(d.rows[1].comment, "A path C:\\data, then (a) list, and 'quotes'.");
    assert.equal(d.rows[0].session_url, null);
    assert.deepEqual(parseValues("(1,'a''b',NULL,-2.5),(2,'',0x00,3);"), [['1', "a'b", null, '-2.5'], ['2', '', '0x00', '3']]);
    assert.throws(() => parseValues("(1,'never ends"), /does not end/);
    assert.equal(isoOf('2024-03-11 11:33:13', '+00:00'), '2024-03-11T11:33:13.000Z');
    assert.equal(isoOf('2024-03-11 11:33:13', '-05:00'), '2024-03-11T16:33:13.000Z');
    assert.equal(isoOf('0000-00-00 00:00:00'), null);
    await assert.rejects(readDump(file, 'wp_nothing'), /has no table wp_nothing/);
  });

  test('a dry run counts and writes nothing; the import keeps the fields, marks them handled, mails nobody; again adds nothing', async () => {
    const dry = await importWordpress(srv.app, file, { dryRun: true });
    assert.deepEqual([dry.found, dry.added, dry.already, dry.skipped], [3, 2, 0, [{ id: '3', reason: 'no date' }]]);
    assert.equal(rows().length, 0);

    const r = await importWordpress(srv.app, file);
    assert.deepEqual([r.found, r.added, r.already, r.skipped.length], [3, 2, 0, 1]);
    const [ann, bo] = rows();
    assert.deepEqual([ann.status, ann.at, ann.name, ann.email, ann.service, ann.source_id, ann.status_by], ['handled', '2024-03-11T11:33:13.000Z', "Ann O'Neil", 'ann@one.example', 'Data migration', '1', 'WordPress import']);
    assert.deepEqual(JSON.parse(ann.fields), { name: "Ann O'Neil", email: 'ann@one.example', number: '+1 416 555 0101', comment: 'We\'d like a "quote" for 3 boards;\nand a call.', service_type: 'Data migration', how_soon: 'Within a month', approx_budget: '5000' });
    assert.deepEqual(JSON.parse(ann.meta), { page: 'https://www.example.test/contact-us/', referrer: 'https://www.google.com/', referringDomain: 'google.com', utmSource: 'google / organic', location: 'Toronto, Ontario, Canada' });
    assert.equal(ann.ip, null, 'the old IP address is not brought over');
    assert.equal(JSON.parse(bo.meta).location, undefined);
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM notices').get().n, 0, 'nobody is told');
    const audit = JSON.parse(srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'inbox.import'").get().detail);
    assert.deepEqual(audit, { from: 'wordpress', table: 'wp_contact', found: 3, added: 2, already: 0, skipped: 1 });

    const again = await importWordpress(srv.app, file);
    assert.deepEqual([again.added, again.already], [0, 2]);
    assert.equal(rows().length, 2);
    await assert.rejects(importWordpress(srv.app, file, { form: 'quote' }), /no form "quote"/);

    // in the Inbox as any message, with where it came from
    const ed = await as(srv, 'editor');
    const list = (await ed.get('/inbox?status=handled&kind=message')).json;
    assert.deepEqual(list.items.map((i) => [i.from.name, i.imported]), [['Bo', { from: 'wordpress', id: '2' }], ["Ann O'Neil", { from: 'wordpress', id: '1' }]]);
    assert.deepEqual(list.facets.services, [{ value: 'Data migration', count: 1 }]);
    const one = (await ed.get(`/inbox/${ann.id}`)).json;
    assert.deepEqual(one.fields.map((f) => f.label), ['Name', 'Email', 'Phone', 'Message', 'Service type', 'How soon', 'Budget']);
    assert.deepEqual(one.history.map((h) => [h.at, h.by, h.change]), [['2024-03-11T11:33:13.000Z', null, 'imported from WordPress (marked handled)']]);
  });

  test('from the command line, against the data dir (a dry run)', async () => {
    const r = await promisify(execFile)(process.execPath, [BIN, 'forms', 'import-wordpress', file, '--dry-run'], { env: { ...process.env, MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' } });
    assert.equal(r.stdout.trim().split('\n')[0], 'Dry run, nothing written. 3 rows in the dump (times in +00:00): 0 would be added, 2 already in the Inbox, 1 skipped.');
    assert.match(r.stdout, /skipped WordPress id 3: no date/);
  });
});
