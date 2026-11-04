import type { CollectionEntry } from 'astro:content';

/** Published: not a draft, and its publish time (if any) has come (docs/API.md "Site-side contract"). */
export const isLive = (post: CollectionEntry<'posts'>) =>
  post.data.draft !== true && (!post.data.publishAt || post.data.publishAt <= new Date(process.env.MARKSTAGE_BUILD_TIME ?? Date.now()));
