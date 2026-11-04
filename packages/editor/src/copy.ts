// Owner rule: every value shown on screen that someone may paste elsewhere gets a copy button, and every URL or
// path also an "open in a new tab" button. Hidden until hover or focus (always shown on touch screens); a copy
// turns the icon into a green tick for 1.5 s, then the icons hide again; opening hides them too.
import { ic } from './icons';
import { config, onServer } from './runtime';
import { resolveSiteUrl } from './site-url';

/** Absolute URL of a site path, where it can be opened: the live site from the Markstage server, else this origin. */
export const siteUrl = (path: string) => resolveSiteUrl(path, onServer() ? config().siteUrl : null, location.origin);

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/**
 * `text` shown with its copy (and, for a URL or path, open) buttons. `copy` is what goes to the clipboard
 * (default `text`); `open` is the URL a new tab opens.
 */
export function copyable(
  text: string,
  opts: { label: string; copy?: string; open?: string; className?: string; iconsOnly?: boolean },
): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = `ms-copyable ${opts.className ?? ''}`.trim();
  const value = document.createElement('span');
  value.className = 'ms-copyable__text';
  value.textContent = text;
  value.title = text;
  const tools = document.createElement('span');
  tools.className = 'ms-copyable__tools';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'ms-copyable__btn';
  copyBtn.setAttribute('aria-label', `Copy ${opts.label}`);
  copyBtn.title = `Copy ${opts.label}`;
  copyBtn.innerHTML = ic('copy', 14);
  tools.append(copyBtn);
  const rest = () => {
    wrap.classList.add('is-rest');
    const wake = () => wrap.classList.remove('is-rest');
    wrap.addEventListener('mouseleave', wake, { once: true });
    wrap.addEventListener('focusout', wake, { once: true });
  };
  let timer = 0;
  copyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await copyText(opts.copy ?? text);
    copyBtn.innerHTML = ic('check', 14);
    wrap.classList.add('is-done');
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      copyBtn.innerHTML = ic('copy', 14);
      wrap.classList.remove('is-done');
      rest();
    }, 1500);
  });
  if (opts.open) {
    const openBtn = document.createElement('a');
    openBtn.className = 'ms-copyable__btn';
    openBtn.href = opts.open;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener';
    openBtn.setAttribute('aria-label', `Open ${opts.label} in a new tab`);
    openBtn.title = `Open ${opts.label} in a new tab`;
    openBtn.innerHTML = ic('open', 14);
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      rest();
    });
    tools.append(openBtn);
  }
  if (opts.iconsOnly) wrap.append(tools);
  else wrap.append(value, tools);
  return wrap;
}
