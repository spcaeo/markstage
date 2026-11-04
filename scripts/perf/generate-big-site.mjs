// The big test site of the performance review (2 Nov 2026, section 1;
// its notes are not in this repo): examples/blog copied to <out> with 800 posts in 5 languages, 3000 pictures, links, topics and authors,
// from a fixed seed, so a "before" and an "after" are measured on the same site.
//
//   node scripts/perf/generate-big-site.mjs <out> [--posts 800] [--images 3000] [--seed 7]
//
// <out> must not exist. node_modules is a link to this checkout's (the workspace's, where examples/blog finds astro
// and @markstage/*), so the site builds with whichever branch is checked out. The result is one git commit.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const blog = path.join(root, 'examples/blog');
const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? Number(args[i + 1]) : d;
};
if (!out) {
  console.error('usage: node scripts/perf/generate-big-site.mjs <out> [--posts 800] [--images 3000] [--seed 7]');
  process.exit(2);
}
if (fs.existsSync(out)) {
  console.error(`${out} exists: pick a new folder`);
  process.exit(2);
}
const POSTS = opt('posts', 800);
const IMAGES = opt('images', 3000);

// a small seeded generator (mulberry32): the same seed gives the same site
let seed = opt('seed', 7) >>> 0;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (list) => list[Math.floor(rnd() * list.length)];
const some = (list, n) => {
  const copy = [...list];
  const got = [];
  while (got.length < n && copy.length) got.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
  return got;
};

const WORDS = (
  'warehouse board item column status owner project task client invoice order shipment route driver schedule ' +
  'report dashboard automation trigger action field value label update record import export sync team member ' +
  'account contact lead deal pipeline stage forecast quote budget cost hour week month quarter review plan goal ' +
  'risk issue fix release test check rule policy access role permission user group folder file document image ' +
  'link page post guide article topic section heading list table code block quote note summary detail example ' +
  'step method process system tool platform service support customer partner vendor product price plan feature ' +
  'limit option setting change history version backup restore migration data source target mapping field type ' +
  'number date text email phone address city region country language currency unit total average count share ' +
  'simple quick careful clear useful common rare large small early late daily weekly monthly safe exact steady'
).split(' ');
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const sentence = (min = 8, max = 22) => cap(Array.from({ length: int(min, max) }, () => pick(WORDS)).join(' ')) + '.';
const phrase = (n) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
const yamlStr = (s) => JSON.stringify(s);

const LOCALES = [
  { code: 'en-CA', prefix: '', default: true, label: 'Canada' },
  { code: 'fr-CA', prefix: '/fr', label: 'Français' },
  { code: 'de', prefix: '/de', label: 'Deutsch' },
  { code: 'es', prefix: '/es', label: 'Español' },
  { code: 'pt-BR', prefix: '/pt', label: 'Português' },
];
const TOPICS = Array.from({ length: 20 }, (_, i) => `topic-${String(i + 1).padStart(2, '0')}`);
const AUTHORS = Array.from({ length: 8 }, (_, i) => `author-${i + 1}`);
const TAGS = Array.from({ length: 40 }, (_, i) => `tag-${i + 1}`);
const CATEGORIES = Array.from({ length: 12 }, (_, i) => `category-${i + 1}`);
const img = (n) => `/uploads/img-${String(n).padStart(4, '0')}.jpg`;

// 1. the site, without its posts, pictures, build output or node_modules
const skip = new Set(['node_modules', 'dist', '.astro', 'src/content/posts', 'src/content/authors', 'public/uploads', 'markstage/topics']);
fs.cpSync(blog, out, { recursive: true, filter: (src) => !skip.has(path.relative(blog, src)) });
for (const d of ['src/content/posts', 'src/content/authors', 'public/uploads', 'markstage/topics']) fs.mkdirSync(path.join(out, d), { recursive: true });
fs.symlinkSync(path.join(root, 'node_modules'), path.join(out, 'node_modules'));

// 2. five locales, each with its own title and description
const cfgPath = path.join(out, 'markstage.config.mjs');
const cfg = fs.readFileSync(cfgPath, 'utf8');
const locales = `  locales: [\n${LOCALES.map((l) => `    { code: '${l.code}', prefix: '${l.prefix}',${l.default ? ' default: true,' : ''} label: '${l.label}', overrides: ['title', 'description'] },`).join('\n')}\n  ],\n  xDefault: 'en-CA',\n`;
if (!cfg.includes("siteName: 'Example blog',\n")) throw new Error('examples/blog/markstage.config.mjs changed: update the generator');
fs.writeFileSync(cfgPath, cfg.replace("siteName: 'Example blog',\n", `siteName: 'Example blog',\n${locales}`));

// 3. authors
for (const [i, id] of AUTHORS.entries()) {
  fs.writeFileSync(path.join(out, 'src/content/authors', `${id}.json`), JSON.stringify({ id, name: `Author ${i + 1}`, designation: 'Writer', bio: sentence() }, null, 2) + '\n');
}

// 4. the posts: one guide per topic, 26 legal pages, the rest articles; drafts, scheduled and published
const ids = Array.from({ length: POSTS }, (_, i) => `post-${String(i + 1).padStart(4, '0')}-${phrase(3).replace(/ /g, '-')}`);
const guides = new Map(TOPICS.map((t, i) => [t, ids[i]]));
const legal = new Set(ids.slice(TOPICS.length, TOPICS.length + 26));
const order = some(ids.slice(TOPICS.length + 26), ids.length);
const drafts = new Set(order.slice(0, 90));
const scheduled = new Set(order.slice(90, 133));
const topicOf = new Map(ids.map((id, i) => [id, i < TOPICS.length ? TOPICS[i] : legal.has(id) ? null : pick(TOPICS)]));
let words = 0;
for (const [i, id] of ids.entries()) {
  const type = i < TOPICS.length ? 'guide' : legal.has(id) ? 'legal' : 'article';
  const topic = topicOf.get(id);
  const title = cap(phrase(int(4, 9)));
  const fm = [`title: ${yamlStr(title)}`, `description: ${yamlStr(sentence(12, 24))}`, `date: 2026-${String(int(1, 10)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`, `author: ${pick(AUTHORS)}`, `pageType: ${type}`];
  if (topic) fm.push(`topic: ${topic}`);
  fm.push(`category: ${pick(CATEGORIES)}`, `tags: [${some(TAGS, int(1, 4)).join(', ')}]`);
  const cover = int(1, IMAGES);
  fm.push('cover:', `  src: ${img(cover)}`, `  alt: ${yamlStr(rnd() < 1 / 6 ? '' : cap(phrase(4)))}`);
  if (drafts.has(id)) fm.push('draft: true');
  if (scheduled.has(id)) fm.push(`publishAt: 2027-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}T09:00:00Z`);
  fm.push('locales:');
  for (const l of LOCALES.slice(1)) {
    if (rnd() < 1 / 5) continue; // not translated yet
    fm.push(`  ${l.code}:`, `    title: ${yamlStr(`${title} (${l.code})`)}`, `    description: ${yamlStr(sentence(12, 24))}`);
  }
  // the text: 800-3000 words in sections, with lists, quotes, tables, code, pictures and links
  const target = int(800, 3000);
  const links = some(ids.filter((x) => x !== id), int(3, 8));
  if (type === 'article' && topic) links.push(guides.get(topic));
  const pics = Array.from({ length: int(3, 6) }, () => int(1, IMAGES));
  const body = [];
  let n = 0;
  while (n < target) {
    body.push(`## ${cap(phrase(int(2, 6)))}`);
    for (let p = int(2, 4); p > 0 && n < target; p--) {
      const para = Array.from({ length: int(3, 6) }, () => sentence()).join(' ');
      n += para.split(' ').length;
      body.push(links.length && rnd() < 0.35 ? `${para} See [${phrase(3)}](/posts/${links.pop()}/).` : para);
    }
    const r = rnd();
    if (r < 0.2) body.push(Array.from({ length: int(3, 6) }, () => `- ${sentence(4, 10)}`).join('\n'));
    else if (r < 0.3) body.push(`> ${sentence()}`);
    else if (r < 0.4) body.push(`| ${phrase(1)} | ${phrase(1)} | ${phrase(1)} |\n| --- | --- | --- |\n${Array.from({ length: int(2, 5) }, () => `| ${phrase(2)} | ${int(1, 999)} | ${phrase(2)} |`).join('\n')}`);
    else if (r < 0.48) body.push('```js\n' + `const ${pick(WORDS)} = ${int(1, 99)};\nconsole.log(${yamlStr(phrase(3))});\n` + '```');
    else if (r < 0.58) body.push(`### ${cap(phrase(int(2, 5)))}`);
    if (pics.length && rnd() < 0.5) body.push(`![${rnd() < 1 / 6 ? '' : cap(phrase(4))}](${img(pics.pop())})`);
  }
  for (const p of pics) body.push(`![${cap(phrase(4))}](${img(p)})`);
  for (const l of links) body.push(`More in [${phrase(3)}](/posts/${l}/).`);
  words += n;
  fs.writeFileSync(path.join(out, 'src/content/posts', `${id}.md`), `---\n${fm.join('\n')}\n---\n\n${body.join('\n\n')}\n`);
}

// 5. topics: the guide is the main page; the articles in groups of up to 10, each led by its first
for (const t of TOPICS) {
  const members = ids.filter((id) => topicOf.get(id) === t && id !== guides.get(t)).map((id) => `posts/${id}`);
  const groups = [];
  for (let g = 0; g * 10 < members.length; g++) {
    const part = members.slice(g * 10, g * 10 + 10);
    groups.push({ id: `${t}-g${g + 1}`, name: cap(phrase(2)), lead: part[0], members: part.slice(1) });
  }
  const file = { title: cap(t.replace('-', ' ')), description: sentence(), pillar: `posts/${guides.get(t)}`, money: null, anchors: [phrase(2)], keywords: [phrase(1)], members: [], groups };
  fs.writeFileSync(path.join(out, 'markstage/topics', `${t}.json`), JSON.stringify(file, null, 2) + '\n');
}

// 6. pictures: 480x480 JPEGs of noise (about 60 KB each)
const sharp = (await import('sharp')).default;
const px = Buffer.alloc(480 * 480 * 3);
for (let i = 1; i <= IMAGES; i++) {
  for (let j = 0; j < px.length; j += 3) {
    const v = (j / 3) % 480;
    px[j] = (v + i) & 255;
    px[j + 1] = (rnd() * 255) | 0;
    px[j + 2] = ((j / 1440) + i * 7) & 255;
  }
  await sharp(px, { raw: { width: 480, height: 480, channels: 3 } }).jpeg({ quality: 60 }).toFile(path.join(out, 'public', img(i)));
}

// 7. one commit
const git = (...a) => execFileSync('git', a, { cwd: out, stdio: ['ignore', 'pipe', 'pipe'] });
git('init', '-q', '-b', 'main');
fs.appendFileSync(path.join(out, '.gitignore'), '\nnode_modules\ndist\n.astro\n');
git('add', '-A');
git('-c', 'user.name=perf', '-c', 'user.email=perf@example.invalid', 'commit', '-q', '-m', 'The big test site');
console.log(`${out}: ${POSTS} posts (${drafts.size} drafts, ${scheduled.size} scheduled), ${words} words, ${IMAGES} pictures, ${TOPICS.length} topics`);
