// What the person may change in the open entry. A custom role can allow an edit of some fields only (a translator's
// region): the entry's `can.fields` lists them as dotted globs ("locales.fr-CA.**"; "body" is the Markdown text), the
// way the server checks a save (packages/server/src/custom-roles/rules.mjs fieldMatches, env/rules.mjs globRe). The
// editor greys out the rest, so nobody types into a field a save would refuse.

export interface Can {
  edit: boolean;
  fields?: string[];
}

/** A glob as a RegExp on "/"-joined paths: `**` any depth, `*` one part, `?` one character (env/rules.mjs globRe). */
export function globRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** True when the dotted glob covers the dotted path ("locales.fr-CA.**" covers "locales.fr-CA.title"). */
export const fieldMatches = (glob: string, path: string) => globRe(glob.split('.').join('/')).test(path.split('.').join('/'));

/** May the person change `path` (a frontmatter key, dotted, or "body")? No `can` (a new entry, a site without sign-in): yes. */
export function mayChange(can: Can | undefined | null, path: string): boolean {
  if (!can) return true;
  if (can.edit === false) return false;
  return !can.fields || can.fields.some((g) => fieldMatches(g, path));
}

/** May the person change the whole file (the Markdown source, an import)? Not with a field-limited role. */
export const mayChangeAll = (can: Can | undefined | null) => !can || (can.edit !== false && !can.fields);

/** Every key an image setting writes: picking another picture clears its alt text, focal point and `clears`. */
export const imageKeys = (f: { key: string; alt?: string; focal?: string; clears?: string[] }) => [f.key, ...(f.alt ? [f.alt] : []), ...(f.focal ? [f.focal] : []), ...(f.clears ?? [])];

/** The banner for a field-limited role, or null. */
export function limitNote(can: Can | undefined | null): string | null {
  if (!can?.edit || !can.fields) return null;
  const keys = can.fields.filter((f) => f !== 'body');
  const parts = [...(keys.length ? [keys.join(', ')] : []), ...(mayChange(can, 'body') ? ['the text'] : [])];
  return parts.length ? `Your role changes only ${parts.join(' and ')} here. The rest is greyed out.` : 'Your role changes none of this entry. It is greyed out.';
}

/** The note a greyed-out field shows. */
export const LOCKED_HINT = 'Your role can’t change this.';

const TEXT = new Set(['text', 'search', 'url', 'email', 'tel', 'number', 'date', 'datetime-local', 'time']);

const guarded = new WeakSet<HTMLElement>();

/** The controls inside `el` made read-only or disabled (copy and open icons stay). */
function lockControls(el: HTMLElement): void {
  for (const c of el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('input, textarea, select, button')) {
    if (c.closest('.ms-copyable')) continue;
    if (c instanceof HTMLTextAreaElement || (c instanceof HTMLInputElement && TEXT.has(c.type))) c.readOnly = true;
    else c.disabled = true;
  }
  for (const c of el.querySelectorAll<HTMLElement>('[contenteditable="true"], [contenteditable="plaintext-only"]')) c.contentEditable = 'false';
}

/**
 * Greys out a drawn field (or a panel drawn again for another block: it can be called again on the same element): its
 * text boxes read-only (the words can still be selected and copied), its selects, ticks and buttons disabled (copy and
 * open icons stay; rows drawn into it later too), a note says why, and `is-locked` is for the styles. Taking the class
 * off ends the guard.
 */
export function lockField(el: HTMLElement, hint = LOCKED_HINT): void {
  el.classList.add('is-locked');
  lockControls(el);
  if (!guarded.has(el)) {
    guarded.add(el);
    // nor does a picture dropped or pasted on it go anywhere
    const stop = (e: Event) => {
      if (!el.classList.contains('is-locked')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e instanceof DragEvent && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    for (const type of ['dragover', 'drop', 'paste']) el.addEventListener(type, stop, true);
    // a list's rows drawn again, a picker's parts: locked as they come
    new MutationObserver(() => el.classList.contains('is-locked') && lockControls(el)).observe(el, { childList: true, subtree: true });
  }
  const at = el.querySelector<HTMLElement>(':scope > .ms-field__after') ?? el;
  if (at.querySelector(':scope > .ms-field__locked')) return;
  const note = document.createElement('span');
  note.className = 'ms-field__hint ms-field__locked';
  note.textContent = hint;
  at.append(note);
}
