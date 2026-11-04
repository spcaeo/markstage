// The first time the editor opens in this browser: a one-line hint that the page is editable where it shows. It is
// shown once (localStorage, best effort: a private window shows it again) and goes at the first edit or when closed.
import { ic } from './icons';

const KEY = 'markstage.hint.closed';

function seen(): boolean {
  try {
    if (localStorage.getItem(KEY) === '1') return true;
    localStorage.setItem(KEY, '1');
  } catch {
    // the hint comes back next time; nothing else depends on it
  }
  return false;
}

/** Adds the hint to `host` the first time the editor opens in this browser. */
export function showHint(host: HTMLElement): void {
  if (host.querySelector('.ms-hint') || seen()) return;
  const hint = document.createElement('div');
  hint.className = 'ms-hint';
  hint.setAttribute('role', 'note');
  hint.innerHTML = `<span>Click any text to edit <span aria-hidden="true">·</span> <kbd>/</kbd> to add a block</span><button type="button" class="ms-iconbtn ms-hint__x" aria-label="Close the hint" title="Close">${ic('x', 14)}</button>`;
  // the first edit shows the writer has it
  const gone = () => {
    hint.remove();
    document.removeEventListener('beforeinput', gone, true);
  };
  hint.querySelector('button')!.addEventListener('click', gone);
  document.addEventListener('beforeinput', gone, true);
  host.append(hint);
}
