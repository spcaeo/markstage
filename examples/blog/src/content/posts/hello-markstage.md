---
title: Hello, Markstage
description: What the editor does with a plain Markdown post.
date: 2026-10-20
author: alex-rivera
pageType: guide
topic: editing
---

Markstage edits this post **on the page** as the blog draws it, and saves it back to this file. Only the blocks
you change are rewritten; everything else stays byte for byte.

## Text and lists

- A bullet with *emphasis* and a [link](https://astro.build/).
- A second bullet with `inline code`.

1. First step
2. Second step

> A quotation, kept as written.

## A table

| Tool | Free plan | Notes |
| :--- | :---: | ---: |
| Astro | Yes | Static |
| Markstage | Yes | Source-available (ELv2), free to self-host |

```js
console.log('code blocks keep their language');
```

---

<div class="aside">HTML the editor has no block for stays exactly as written.</div>
