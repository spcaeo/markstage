---
title: "taskrhino.ca: WordPress to Astro, Edited with Markstage"
description: "How taskrhino.ca moved from WordPress to a static Astro site that writers edit with Markstage: before and after screenshots and Lighthouse numbers."
h1: "taskrhino.ca: from WordPress to Astro, edited with Markstage"
site: https://www.taskrhino.ca/
siteName: taskrhino.ca
owner: Space-O Technologies
updated: 2026-11-04
lead: "taskrhino.ca is the services site and blog of Space-O Technologies, and the first site Markstage was built for. It moved off WordPress to a static Astro site in October 2026, and its writers now edit it with Markstage, on the real page."
shots:
  - { media: showcase-before, label: "Before: WordPress", alt: "The old taskrhino.ca home page on WordPress at 1440 pixels wide: the heading monday.com Consulting Services, two buttons and a collage of monday.com board pictures" }
  - { media: showcase-after, label: "After: Astro, edited with Markstage", alt: "The new taskrhino.ca home page on Astro at 1440 pixels wide: a side rail with the menu, theme switch and the page's contents, the same heading and text, two buttons and a cover picture" }
phones:
  - { media: showcase-before-phone, label: "Before, on a phone", alt: "The old WordPress home page on a phone, 390 pixels wide" }
  - { media: showcase-after-phone, label: "After, on a phone", alt: "The new Astro home page on a phone, 390 pixels wide" }
  - { media: showcase-after-dark, label: "After, dark theme", alt: "The new home page in its dark theme at 1440 pixels wide" }
stats:
  - { what: "Speed score, home page on a phone", before: "71", after: "99" }
  - { what: "Main content shown (LCP), on a phone", before: "6.8 s", after: "2.2 s" }
  - { what: "Home page weight, on a phone", before: "902 KB", after: "206 KB" }
  - { what: "Files loaded, home page on a phone", before: "45", after: "19" }
home:
  title: "Built with Markstage: taskrhino.ca"
  text: "Our own site is the first one written with Markstage. It moved from WordPress to a static Astro site: 158 posts, 20 pages and 2,414 images and files, every address kept. On a phone, its home page now scores 99 for speed instead of 71."
  link: See the before and after
  note: "Lighthouse, median of three runs, 28 and 29 October 2026: the old site live, the new one from its own build before launch, so its load times are not those of a real host."
---

## What moved

- **158 posts, 20 pages and 2,414 images and files** came across from WordPress, with every address kept and the
  search titles and descriptions carried over. After the move, all 179 addresses of the old site answered.
- **Posts are Markdown files and pages are JSON files** in the site's git repo. There is no content database.
- **The live site is static.** Markstage is only there while someone edits; the pages visitors get are plain HTML,
  CSS and pictures.

## How the writers work now

Writers open a page in Markstage and change it where it appears, on the site's own design. Each save is a commit in
their name, and changes go live through releases, with roles for who may publish what, and staging next to
production. The services pages, which are JSON, are edited on the rendered page too, with each section's fields in
a side panel.

## The numbers

Lighthouse, median of three runs, measured on 28 and 29 October 2026. The old site was measured live; the new site
was measured from its build served on our own computer, so its load times are not those of a real host.

| Page | Form | Before: speed | After: speed | Before: weight | After: weight | Before: files | After: files |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Home | phone | 71 | 99 | 902 KB | 206 KB | 45 | 19 |
| Home | desktop | 98 | 100 | 1067 KB | 173 KB | 53 | 19 |
| Contact | phone | 72 | 100 | 798 KB | 140 KB | 44 | 16 |
| A services page | phone | 70 | 99 | 877 KB | 192 KB | 46 | 20 |
| A blog post | phone | 66 | 99 | 781 KB | 149 KB | 33 | 18 |

Accessibility scored 100 on every page measured after the move, against 87 to 96 before.

## What the screenshots are

All screenshots on this page were taken on 28 and 29 October 2026, before the new site went live: the old one from
the live WordPress site, read only, and the new one from its own build. The live site has changed since, as sites
do.
