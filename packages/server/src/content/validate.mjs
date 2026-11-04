// The site's own entry check (config `validate`): one command that reads an entry's text on stdin and exits non-zero
// when the site could not build it (frontmatter its schema refuses, a missing required field). It runs before every
// write of an entry, so one bad entry can no longer break every later build, and the preview, for everyone.
import path from 'node:path';
import { runCommand } from '../jobs.mjs';
import { HttpError } from '../util.mjs';

/** Issues printed by a check or validator as `{"issues": [{severity, message, line}]}`; [] for plain output. */
export function parseIssues(output) {
  try {
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed?.issues)) return [];
    return parsed.issues.slice(0, 500).map((i) => ({ severity: i.severity === 'warning' ? 'warning' : 'error', message: String(i.message ?? ''), ...(Number.isInteger(i.line) ? { line: i.line } : {}) }));
  } catch {
    return [];
  }
}

/** The environment every site command about one entry gets (checks and validate). */
export const entryEnv = (config, c, id) => ({ ...config.commands.env, MARKSTAGE_COLLECTION: c.id, MARKSTAGE_ENTRY: id, MARKSTAGE_FILE: path.join(c.dir, `${id}${c.ext}`) });

/** `validate(c, id, text)` resolves when the site accepts the text; else 422 with the issues. null when not configured. */
export function createValidator(config) {
  const v = config.validate;
  if (!v) return null;
  return async function validate(c, id, text) {
    let output = '';
    const { code, timedOut } = await runCommand(v.command, {
      cwd: config.contentRoot,
      env: entryEnv(config, c, id),
      timeoutSeconds: v.timeoutSeconds,
      stdin: text,
      onOutput: (s) => {
        if (output.length < 200_000) output += s;
      },
    });
    if (code === 0 && !timedOut) return;
    // the checker itself broke: not the writer's fault, and nothing is saved
    if (timedOut || code === -1) throw new HttpError(503, 'validate-unavailable', `The site's entry check did not finish${timedOut ? ` within ${v.timeoutSeconds} s` : ''}. Nothing was saved; try again.`);
    let issues = parseIssues(output);
    if (!issues.length) issues = [{ severity: 'error', message: output.trim().split('\n').slice(0, 20).join('\n').slice(0, 2000) || `The check exited with code ${code}.` }];
    const first = issues.find((i) => i.severity === 'error') ?? issues[0];
    throw new HttpError(422, 'invalid-entry', `The site cannot use this entry: ${first.message}`, { issues });
  };
}
