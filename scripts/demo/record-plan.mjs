// What scripts/demo/record.mjs opens, and how it cleans an answer before it is kept (tests: record-plan.test.mjs).

export const OWNER_NAME = 'Jordan Example';
export const OWNER_EMAIL = 'jordan@example.com';
/** The address recorded answers name in place of the recording server's. */
export const DEMO_ORIGIN = 'https://cms.example.com';
/** In place of the loopback address (RFC 5737, documentation only). */
export const DEMO_IP = '192.0.2.10';

/** The screens opened while recording; PER_POST below is opened for each post too. */
export const SCREENS = [
  '#/',
  '#/entries/posts',
  '#/library',
  '#/snippets',
  '#/releases',
  '#/environments',
  '#/inbox',
  '#/media',
  '#/authors',
  '#/topic-map',
  '#/links',
  '#/health',
  '#/tree',
  '#/menus',
  '#/redirects',
  '#/trash',
  '#/users',
  '#/settings',
  '#/settings/alerts',
  '#/settings/environments',
  '#/settings/roles',
  '#/settings/tokens',
  '#/account',
  '#/audit',
  '#/jobs',
  '#/my-alerts',
  '#/translations',
  '#/taxonomy',
];

/** Each post's own screens: the canvas, its search check, its outline, its publish sheet and its history. */
export const PER_POST = ['#/e/posts/{id}', '#/e/posts/{id}?side=seo', '#/e/posts/{id}?side=outline', '#/publish/posts/{id}', '#/revisions/posts/{id}'];

const SECRET_KEY = /token|secret|password|hash|cookie|otp|recovery/i;

/**
 * A recorded answer with nothing of this machine in it: the given folders (longest first) become /srv/example-blog,
 * the server's origin DEMO_ORIGIN, the loopback address DEMO_IP, and any string under a secret-sounding key "demo".
 * Throws when a home folder path is still there.
 */
export function scrub(value, { roots = [], origin = null } = {}) {
  const sorted = [...roots].filter(Boolean).sort((a, b) => b.length - a.length);
  const text = (s) => {
    let out = s;
    for (const r of sorted) out = out.split(r).join('/srv/example-blog');
    if (origin) out = out.split(origin).join(DEMO_ORIGIN);
    out = out.replace(/\b127\.0\.0\.1\b/g, DEMO_IP).replace(/(^|[^:\w])::1\b/g, `$1${DEMO_IP}`);
    if (/\/(Users|home)\/[A-Za-z]/.test(out)) throw new Error(`A home folder path is left in a recorded answer: ${out.slice(0, 120)}`);
    return out;
  };
  const walk = (v, key = '') => {
    if (typeof v === 'string') return SECRET_KEY.test(key) && v ? 'demo' : text(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [text(k), walk(x, k)]));
    return v;
  };
  return walk(value);
}

/**
 * The recorded answers as the demo replays them: no previews (the demo answers those with its own blog's pages),
 * and no notices (a fresh owner's "signed in from a new device" is about the recording, not the visitor).
 */
export function curate(routes) {
  const out = new Map();
  for (const [key, value] of routes) {
    if (key.startsWith('preview/')) continue;
    if (key === 'notices') out.set(key, { status: 200, body: { ...value.body, items: [] } });
    else out.set(key, value);
  }
  return out;
}

/** The recorded answers as the file keeps them: one route per line, sorted, so a review reads each one. */
export function recordedText(routes) {
  const lines = [...routes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}
