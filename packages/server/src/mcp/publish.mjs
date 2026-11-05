// The MCP server's one publish tool (docs/API-MCP.md "Publishing"): `publish_release`, for a token that holds the
// mcp:publish scope, which only an owner or an administrator can make (env/tokens.mjs). An agent asks; the site
// decides, exactly as for the token's person pressing Publish now on the release's page:
//
//   1. the person: still an owner or administrator, or the token publishes nothing (403);
//   2. the site's checks run on what the release holds now; one that stops a publish refuses it (422 checks-failed),
//      the same "stops the publish" the release page shows: an agent never publishes past a failed check;
//   3. then the editor's own route, POST /releases/:rid/publish, as that person: the version, the promotion rules
//      (publish-release: who, hours, freezes, approvals, a reason, checks), the publish rules (alt text, links,
//      duplicates), files changed on the site since. Nothing here goes round any of them.
//
// Every publish and every refusal is audited as the person "via mcp" with the token's name, and the release's
// commit and its notice name the agent and the person. At most 5 publishes an hour per token (index.mjs).
import { HttpError } from '../util.mjs';
import { atLeast } from '../roles.mjs';

const str = (description) => ({ type: 'string', description });

export const PUBLISH_TOOL = {
  name: 'publish_release',
  title: 'Publish a release',
  scope: 'publish',
  description:
    'Ask to publish a release now, as the person whose token you hold. The site’s checks run first on what it holds; then the site’s publish rules, roles, approvals and freezes decide, as they do for that person. A failed check or a rule that says no refuses it, in words; nothing goes round them. Send the version get_release gave. The build and deploy then run as a job: get_release shows when it is live.',
  input: { properties: { release: str('The release id (list_releases).'), version: str('The version get_release gave (r…): a release changed since is refused.'), reason: str('Why it goes live now, when a rule asks for a reason.') }, required: ['release', 'version'] },
  async run(t, a) {
    const { app, ctx } = t;
    if (!atLeast(t.user, 'administrator')) throw new HttpError(403, 'forbidden', `This token publishes for an owner or administrator, and ${t.user.name ?? 'its person'} is ${t.user.role ? `now ${/^[aeiou]/.test(t.user.role) ? 'an' : 'a'} ${t.user.role}` : 'no longer on this site'}. A person publishes the release.`);
    // the release as this person sees it (404 when there is none), and the checks on what it holds now
    const before = await t.call('GET', `/releases/${encodeURIComponent(a.release)}`);
    if (!['open', 'scheduled'].includes(before.status)) throw new HttpError(409, 'not-open', `The release “${before.name}” is ${before.status}: there is nothing to publish.`);
    if (!before.counts?.items) throw new HttpError(422, 'empty', `The release “${before.name}” has nothing in it yet.`);
    const checks = await app.releases.checkNow(before.id);
    const failed = checks.results.filter((x) => !x.ok && x.blocking);
    if (failed.length) {
      const named = failed.map((x) => ({ entry: x.entry, check: x.label }));
      app.releases.refused(ctx, before.id, { checks: named, words: 'a check failed' });
      throw new HttpError(422, 'checks-failed', `The release “${before.name}” cannot go live: ${failed.map((x) => `${x.label} failed on ${x.entry}`).join('; ')}. Fix ${failed.length === 1 ? 'it' : 'them'} first; an AI agent never publishes past a failed check.`, { checks: named });
    }
    // the editor's own route, as this person: the rules, the publish rules and the version decide
    const r = await t.call('POST', `/releases/${encodeURIComponent(before.id)}/publish`, { body: { version: a.version, ...(a.reason ? { reason: a.reason } : {}) } });
    return {
      publishing: true,
      job: r.job,
      release: { id: r.release.id, name: r.release.name, status: r.release.status, version: r.release.version },
      checks: { passed: checks.passed, warnings: checks.results.filter((x) => !x.ok && !x.blocking).map((x) => ({ entry: x.entry, check: x.label })) },
      note: 'It is being built and put live now. get_release shows when it is live, or why it did not go live (then the live site stays as it was).',
    };
  },
};
