import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.coerce.date(),
    // an author file's slug (src/content/authors/<slug>.json, markstage.config `authors`), and co-authors
    author: z.string().optional(),
    coAuthors: z.array(z.string()).optional(),
    draft: z.boolean().default(false),
    publishAt: z.coerce.date().optional(),
    cover: z.object({ src: z.string(), alt: z.string().optional(), focal: z.string().optional() }).optional(),
    // what the post is for and how it is laid out (markstage.config `pageTypes`, `frames`), and the topic a guide
    // is the hub of and an article belongs to
    pageType: z.string().optional(),
    frame: z.string().optional(),
    topic: z.string().optional(),
    // a reading post lists its h2s above the text unless this is false (Post settings "Show contents")
    contents: z.boolean().optional(),
  }),
});

// guides are MDX: Markdown with the blog's components (src/components/Callout.astro, Chart.astro), docs/MDX.md
const guides = defineCollection({
  loader: glob({ pattern: '*.mdx', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.coerce.date(),
    author: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts, guides };
