/** What a post or a guide carries for its status (src/content.config.ts). */
interface Dated {
  data: { date: Date; draft?: boolean; publishAt?: Date };
}

/**
 * Live: not a draft, and its publish time (if any) has come. A Markstage server builds with MARKSTAGE_BUILD_TIME,
 * so an entry scheduled for later goes live on its own (docs/API.md "Site-side contract").
 */
export const isLive = (entry: Dated) =>
  entry.data.draft !== true && (!entry.data.publishAt || entry.data.publishAt <= new Date(process.env.MARKSTAGE_BUILD_TIME ?? Date.now()));

/** Newest first. */
export const byDate = (a: Dated, b: Dated) => b.data.date.valueOf() - a.data.date.valueOf();

/** "4 November 2026" */
export const longDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
