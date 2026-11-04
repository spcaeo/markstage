// The header's links for the open entry. Where "Preview page" and the address's open icon go (QA F6): the live address for a live entry; for a draft or a
// scheduled one, the preview origin, which shows it as the site will (the live site does not have it yet).
import { previewUrl, type Entry } from './api';
import { siteUrl } from './copy';
import { fmtDateTime } from './dates';

/** A scheduled entry says so in the header, with when (the publish sheet and More have "Cancel the schedule", QA F9). */
export function scheduledPill(urlRow: HTMLElement, entry: Entry): void {
  if (entry.status !== 'scheduled' || !entry.publishAt) return;
  const pill = Object.assign(document.createElement('span'), { className: 'ms-head__state', textContent: 'Scheduled', title: `Goes live ${fmtDateTime(entry.publishAt)}. Cancel it from Publish or the More menu.` });
  // the time is for a wide screen (a phone keeps the word alone, chrome.css)
  pill.append(Object.assign(document.createElement('span'), { className: 'ms-head__state__when', textContent: ` · goes live ${fmtDateTime(entry.publishAt)}` }));
  urlRow.prepend(pill);
}

export function pointPreview(preview: HTMLAnchorElement, urlRow: HTMLElement, entry: Entry, server: boolean, still: () => Entry | null): void {
  preview.href = siteUrl(entry.url!);
  preview.title = '';
  if (!server || !entry.status || entry.status === 'published') return;
  void previewUrl(entry.collection, entry.id, entry.url!).then((p) => {
    if (still() !== entry) return;
    preview.href = p.url;
    preview.title = 'Opens the preview: this page is not on the live site yet';
    const open = urlRow.querySelector<HTMLAnchorElement>('a[target="_blank"]');
    if (open) {
      open.href = p.url;
      open.title = 'Open the preview in a new window (not live yet)';
    }
  }).catch(() => {});
}
