---
title: Writing in Markdown, without seeing Markdown
description: Headings, lists, links, tables and code, the way the editor keeps them.
date: 2026-10-28
tags:
  - writing
---

Writers type on the page; the file underneath stays tidy Markdown. Here is what the starter's styles cover.

## Text and lists

Paragraphs with **bold**, *italic*, `inline code` and [a link](https://www.example.com/).

- A bullet
- Another bullet, with a second line that wraps onto the next row on a narrow screen

1. First step
2. Second step

## A table

| What | Where it lives |
| :--- | :--- |
| Posts | `src/content/posts/` |
| Pictures | `public/uploads/` |
| Styles | `src/styles/site.css` |

## Code

```js
// a code block keeps its language and its spacing
export const hello = (name) => `Hello, ${name}`;
```

---

A rule, like the one above, separates parts of a post.
