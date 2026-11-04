// The SEO check's small parts: a section with its title and count, a finding's row (a click goes to the block it
// is about), a meter for a width against Google's limit.
import { copyable } from '../copy';
import { ic } from '../icons';
import { h } from '../panel-form';
import type { Finding, Level } from './text';

const ICON: Record<Level, string> = { error: 'alert', warn: 'info', ok: 'check' };

export function section(id: string, title: string): { el: HTMLElement; body: HTMLElement; count: HTMLElement } {
  const el = h('section', 'ms-seo-sec');
  el.id = `ms-seo-${id}`;
  const head = h('h3', 'ms-seo-sec__title');
  const count = h('span', 'ms-seo-sec__count');
  head.append(Object.assign(h('span'), { textContent: title }), count);
  const body = h('div', 'ms-seo-sec__body');
  el.append(head, body);
  return { el, body, count };
}

/** The section's count: its problems, or a tick when there are none. */
export function setCount(count: HTMLElement, findings: Finding[]): void {
  const errors = findings.filter((f) => f.level === 'error').length;
  const warns = findings.filter((f) => f.level === 'warn').length;
  count.className = `ms-seo-sec__count${errors ? ' is-error' : warns ? ' is-warn' : ' is-ok'}`;
  count.innerHTML = errors + warns ? String(errors + warns) : ic('check', 12);
  count.setAttribute('aria-label', errors + warns ? `${errors + warns} to look at` : 'Nothing to fix');
}

/** A finding; `go` shows its block on the canvas. */
export function row(f: Finding, go?: (block: number) => void): HTMLElement {
  const el = h('div', `ms-seo-row is-${f.level}`);
  el.append(h('span', 'ms-seo-row__icon', ic(ICON[f.level], 13)));
  el.append(copyable(f.text, { label: 'message', className: 'ms-seo-row__text' }));
  if (f.block !== undefined && go) {
    const b = h('button', 'ms-iconbtn ms-seo-row__go', ic('target', 13));
    b.type = 'button';
    b.title = 'Show it in the text';
    b.setAttribute('aria-label', b.title);
    b.addEventListener('click', () => go(f.block!));
    el.classList.add('is-go');
    el.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('button, a')) go(f.block!);
    });
    el.append(b);
  }
  return el;
}

export function rows(into: HTMLElement, findings: Finding[], go?: (block: number) => void): void {
  // the problems first, then what is right
  const order: Level[] = ['error', 'warn', 'ok'];
  for (const f of [...findings].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level))) into.append(row(f, go));
}

/** "512 of 600 px" with a bar; over the limit it turns red. */
export function meter(label: string, px: number, max: number, short: number): { el: HTMLElement; level: Level } {
  const level: Level = px > max ? 'error' : px < short ? 'warn' : 'ok';
  const el = h('div', `ms-seo-meter is-${level}`);
  const top = h('div', 'ms-seo-meter__top');
  top.append(Object.assign(h('span'), { textContent: label }), Object.assign(h('span', 'ms-seo-meter__px'), { textContent: `${px} of ${max} px` }));
  const bar = h('div', 'ms-seo-meter__bar');
  const fill = h('span');
  fill.style.width = `${Math.min(100, (px / max) * 100)}%`;
  bar.append(fill);
  el.append(top, bar);
  return { el, level };
}

export const note = (text: string, cls = '') => Object.assign(h('p', `ms-seo-note ${cls}`.trim()), { textContent: text });
