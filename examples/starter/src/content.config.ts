import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// what posts and guides share; Markstage's status: a draft, or an entry scheduled for later, is listed in the
// editor but not built (src/lib/live.ts)
const fields = {
  title: z.string(),
  description: z.string().optional(),
  date: z.coerce.date(),
  draft: z.boolean().default(false),
  publishAt: z.coerce.date().optional(),
};

const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/posts' }),
  schema: z.object({ ...fields, tags: z.array(z.string()).optional() }),
});

// guides are MDX: Markdown with the site's components (src/components/), docs/MDX.md. One collection holds one
// format, so the .md posts and the .mdx guides are two collections.
const guides = defineCollection({
  loader: glob({ pattern: '*.mdx', base: './src/content/guides' }),
  schema: z.object(fields),
});

export const collections = { posts, guides };
