// What the head screens decide without a server or a browser (so a test can run it): whether an ID has its tool's
// shape, and what a refused save says. No imports.

export interface Tracker {
  id: string;
  label: string;
  hint: string;
  example: string;
  /** the shape of its ID, as source of a regular expression (the same one the server and the build use) */
  pattern: string;
}

/** A tracker's ID is fine when it is empty (the tool is off) or has the tool's shape. */
export const trackerOk = (t: Tracker, value: string) => !value.trim() || new RegExp(t.pattern).test(value.trim());

/** A failed call as the editor's ApiError carries it: `status`, and the whole answer in `data`. */
interface Failure {
  status?: number;
  data?: { issues?: { path: string; message: string }[] };
}

/** A refusal's messages by the path of the setting they are about ("feeds.0.path"). */
export const issuesOf = (err: unknown): Map<string, string> => new Map(((err as Failure)?.data?.issues ?? []).map((i) => [i.path, i.message]));

/** The settings file changed since this page loaded it. */
export const isStale = (err: unknown) => (err as Failure)?.status === 409;
