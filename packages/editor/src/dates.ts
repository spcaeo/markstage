// Dates and times in the editor's words (QA F38): Canadian English, never the browser's "11/2/2026, 6:51:00 PM".
// Every screen formats through here, so the owner's locale is one line to change.
export const LOCALE = 'en-CA';

const DATE_TIME = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
const DATE = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' });
const TIME = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
const SHORT = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const ms = (d: string | number | Date) => (d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(d));

/** "Nov 2, 2026, 6:51 p.m." */
export const fmtDateTime = (d: string | number | Date): string => (Number.isFinite(ms(d)) ? DATE_TIME.format(ms(d)) : String(d));
/** "Nov 2, 2026" */
export const fmtDate = (d: string | number | Date): string => (Number.isFinite(ms(d)) ? DATE.format(ms(d)) : String(d));
/** "6:51 p.m." */
export const fmtTime = (d: string | number | Date): string => (Number.isFinite(ms(d)) ? TIME.format(ms(d)) : String(d));
/** "Nov 2, 6:51 p.m." (the year is left out: for a time near today) */
export const fmtShort = (d: string | number | Date): string => (Number.isFinite(ms(d)) ? SHORT.format(ms(d)) : String(d));

const UTC = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/g;

/**
 * Every ISO time in `text` ("2026-11-03T00:48:54Z") in the viewer's own time zone and words (QA N13): the server
 * writes its alerts with ISO times, the screen shows "Nov 2, 2026, 7:48 p.m.".
 */
export const localTimes = (text: string): string => text.replace(ISO_TIME, (m) => fmtDateTime(m)).replace(/\.m\.\./g, '.m.');

/**
 * The words for a native date input's value ("2026-11-02" or "2026-11-02T20:48"): "Nov 2, 2026" or
 * "Nov 2, 2026, 8:48 p.m." in this browser's time (`utc`: the value is a UTC time, said so). '' when empty or not a date.
 */
export function dateWords(value: string, utc = false): string {
  const v = value.trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    const t = new Date(y!, m! - 1, d!);
    return Number.isNaN(t.valueOf()) ? '' : fmtDate(t);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return '';
  if (utc) {
    const t = new Date(`${v.slice(0, 16)}:00Z`);
    return Number.isNaN(t.valueOf()) ? '' : `${UTC.format(t)} UTC`;
  }
  const t = new Date(v);
  return Number.isNaN(t.valueOf()) ? '' : fmtDateTime(t);
}

/**
 * The chosen date in the site's words right after a native date or datetime-local input (QA F38): the browser's
 * own picker keeps its locale ("mm/dd/yyyy"), so the words beside it say what was picked. Kept up to date.
 */
export function echoDate(input: HTMLInputElement, opts: { utc?: boolean } = {}): HTMLElement {
  const out = document.createElement('span');
  out.className = 'ms-date-words';
  out.setAttribute('aria-live', 'polite');
  const draw = () => {
    const words = dateWords(input.value, opts.utc);
    out.textContent = words;
    out.hidden = !words;
  };
  for (const ev of ['input', 'change']) input.addEventListener(ev, draw);
  draw();
  input.insertAdjacentElement('afterend', out);
  return out;
}
