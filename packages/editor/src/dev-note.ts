// Dev mode says where a save goes: into the file on this computer, not onto the live site. A calm "Not live yet"
// next to the save status explains it on click, and the first save of a session says it once, with one line on how
// a change goes live. With the Markstage server there is none of this: Publish says what is live.
import { ic } from './icons';
import { config } from './runtime';
import type { Banner } from './shell';

const SEEN = 'markstage-dev-note-seen';
const LINE = 'Saved on this computer, not live yet.';
/** how a change goes live: the site's editor.goLive (core has the general sentence) */
const how = () => config().goLive ?? 'It goes live when the site is published.';

export class DevNote {
  readonly el = document.createElement('button');

  constructor(
    status: HTMLElement,
    private banner: Banner,
  ) {
    this.el.type = 'button';
    this.el.className = 'ms-devtag';
    this.el.innerHTML = `${ic('info', 13)}<span>Not live yet</span>`;
    this.el.title = `${LINE} ${how()}`;
    this.el.setAttribute('aria-label', `${LINE} How it goes live`);
    this.el.addEventListener('click', () => this.say());
    status.after(this.el);
  }

  private say(): void {
    this.banner.show('info', [{ strong: LINE }, ` ${how()}`], [['Got it', () => this.banner.hide()]]);
  }

  /** A save went through: the first one of the session says where it went. */
  saved(): void {
    try {
      if (sessionStorage.getItem(SEEN)) return;
      sessionStorage.setItem(SEEN, '1');
    } catch {
      // no storage: say it every time is too much; say it this once
      if (this.el.dataset.said) return;
      this.el.dataset.said = '1';
    }
    this.say();
  }
}
