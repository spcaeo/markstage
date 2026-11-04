// Who else has the open entry (docs/API.md "Presence and the soft lock"): a heartbeat every 20 s while an entry is
// open, and a line under the header when someone else is editing it ("Olive Owner is editing this"), when this
// person has it open in another tab too, or when someone took it over. The lock is advice: saves still go through
// the version check. Only with the Markstage server (astro dev has no presence).
import { ApiError, request, type Entry } from './api';
import { Banner, bannerWords, type BannerText } from './shell';
import { fmtTime } from './dates';
import { viewerRole } from './runtime';

const BEAT_MS = 20_000;

interface Lock {
  userId: string;
  name: string;
  since: string;
  you: boolean;
  sameUser: boolean;
}
interface Beat {
  mode: 'viewing' | 'editing';
  canEdit: boolean;
  lock: Lock | null;
  takenOver: { by: string; at: string } | null;
  /** the entry's version on the server now, and its last save (QA pass 2, N9) */
  version?: string;
  saved?: { by: string; at: string } | null;
  /** the viewer's role now (QA pass 2, N10) */
  role?: string;
}

/** What the editor lends the presence banner: the open entry's state, a reload, a save, and the role change. */
export interface PresenceDeps {
  dirty(): boolean;
  reload(): void;
  save(): void;
  roleChanged(role: string, canEdit: boolean): void;
}

const time = (iso: string) => fmtTime(iso);

export class Presence {
  /** on with the server, off in astro dev */
  on = false;
  // getRandomValues (not randomUUID): a server on plain http is not a secure context
  private tab = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  private at: { collection: string; id: string; edit: boolean } | null = null;
  private timer = 0;
  private banner: Banner;
  /** a take-over seen and put away with OK: not shown again until the next one */
  private dismissed: string | null = null;
  private takenOver: { by: string; at: string } | null = null;
  /** the open entry (its version moves on with every save here) and the role this person opened it with */
  private entry: Entry | null = null;
  private role: string | null = null;
  private deps: PresenceDeps | null = null;

  constructor(private el: HTMLElement) {
    this.banner = new Banner(el);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.at) void this.beat();
    });
    // closing the tab frees the lock at once (otherwise after 60 s)
    window.addEventListener('pagehide', () => this.leave(true));
  }

  /** The editor's hooks for the banner's buttons (index.ts). */
  wire(deps: PresenceDeps): void {
    this.deps = deps;
  }

  /** The entry open now (null: none). Called whenever the header is drawn; acts only on a change. */
  follow(e: Entry | null): void {
    if (!this.on) return;
    this.entry = e;
    const next = e ? { collection: e.collection, id: e.id, edit: e.can?.edit !== false } : null;
    if (next?.collection === this.at?.collection && next?.id === this.at?.id) return;
    this.leave(false);
    this.at = next;
    this.role = viewerRole();
    this.takenOver = this.dismissed = null;
    if (next) void this.beat();
  }

  /** Signed in again: the heartbeat goes on. */
  resume(): void {
    if (this.at) void this.beat();
  }

  private url(): string {
    return `collections/${encodeURIComponent(this.at!.collection)}/entries/${encodeURIComponent(this.at!.id)}/presence`;
  }

  private leave(closing: boolean): void {
    window.clearTimeout(this.timer);
    this.banner.hide();
    if (!this.at) return;
    void request(`${this.url()}?tab=${this.tab}`, { method: 'DELETE', keepalive: closing }).catch(() => undefined);
    if (!closing) this.at = null;
  }

  private async beat(take = false): Promise<void> {
    window.clearTimeout(this.timer);
    const at = this.at;
    if (!at) return;
    let r: Beat;
    try {
      r = await request<Beat>(this.url(), { method: 'POST', body: JSON.stringify({ tab: this.tab, mode: at.edit ? 'editing' : 'viewing', ...(take ? { take: true } : {}) }) });
    } catch (err) {
      // gone or not available: nothing to say; signed out: quiet until resume(); anything else (offline, a restart)
      // tries again at the next beat
      const stop = err instanceof ApiError && [401, 403, 404].includes(err.status);
      if (!stop && this.at === at) this.timer = window.setTimeout(() => void this.beat(), BEAT_MS);
      return;
    }
    if (this.at !== at) return;
    if (r.takenOver) this.takenOver = r.takenOver;
    if (r.lock?.you) this.takenOver = null;
    this.draw(r);
    this.timer = window.setTimeout(() => void this.beat(), BEAT_MS);
  }

  private draw(r: Beat): void {
    // the person's role changed while this was open (QA N10): said once, and the editor's Save asks first
    if (r.role && this.role && r.role !== this.role) {
      this.role = r.role;
      this.deps?.roleChanged(r.role, r.canEdit);
      return this.show('conflict', ['Your role is now ', { strong: r.role }, `. ${r.canEdit ? 'You can still change this page; Save asks you first.' : 'You can no longer change this page. What you typed is still here: copy it out before you leave.'}`], [['OK', () => this.banner.hide(), 'ms-btn ms-btn--sm ms-btn--quiet']]);
    }
    // someone saved a newer version meanwhile (QA N9): reload it, or merge what is typed here into it
    if (r.version && this.entry && r.version !== this.entry.version) {
      const who = r.saved?.by ?? 'Someone';
      const when = r.saved?.at ? ` at ${time(r.saved.at)}` : '';
      const dirty = this.deps?.dirty() ?? false;
      return this.show('info', [{ strong: who }, ` saved this page${when}${/\.$/.test(when) ? '' : '.'} ${dirty ? 'Your changes are not in that version yet: saving merges them into it.' : 'You are reading an older version.'}`], [
        dirty ? ['Merge now', () => this.deps?.save()] : ['Reload', () => this.deps?.reload()],
      ]);
    }
    const lock = r.lock;
    const t = this.takenOver;
    if (!r.canEdit || !lock || lock.you) return this.banner.hide();
    if (t && this.dismissed !== t.at) {
      this.show('conflict', [{ strong: t.by }, ` took over editing this at ${time(t.at)}. What you have not saved is still here, but saving it now can clash with their changes.`], [
        ['Take it back', () => void this.beat(true)],
        ['OK', () => ((this.dismissed = t.at), this.banner.hide()), 'ms-btn ms-btn--sm ms-btn--quiet'],
      ]);
    } else if (t) this.banner.hide();
    else if (lock.sameUser)
      this.show('info', 'You have this open in another tab as well. Edit it in one of them, so one does not save over the other.', [['Edit here', () => void this.beat(true)]]);
    else
      this.show('info', [{ strong: lock.name }, ` is editing this (since ${time(lock.since)}). Changes you both make can clash: agree who goes first, or take over.`], [
        ['Take over', () => void this.beat(true)],
      ]);
  }

  private show(kind: 'conflict' | 'info', text: BannerText, actions: [string, () => void, string?][]): void {
    // drawn again only when it says something new, so a button is not swapped under the pointer every 20 s
    const words = bannerWords(text);
    if (!this.el.hidden && this.el.dataset.text === words) return;
    this.banner.show(kind, text, actions);
    this.el.dataset.text = words;
  }
}
