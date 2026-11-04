// What the page editor's canvas shows while the framed page has not reported in. A production preview starts the
// site's dev server on its first page after a restart (up to a minute); a frame left blank that long looks broken.
// The states, as a pure function so they can be tested without a browser: `waiting` (a quiet notice with a spinner),
// `ready` (the page's agent said 'ready': the notice goes), `long` (still nothing after WAIT_MS, once a retry with a
// fresh preview URL has been tried: "Try again"). The preview's own expired page tells the editor at once
// ('preview-expired', docs/API-PREVIEW.md), which counts as a timeout: one automatic retry, then "Try again".
export const WAIT_MS = 60_000;

export type WaitPhase = 'waiting' | 'ready' | 'long';
export interface WaitState {
  phase: WaitPhase;
  /** a fresh preview URL was already tried once for this load */
  retried: boolean;
}
export type WaitEvent = 'open' | 'ready' | 'timeout' | 'expired' | 'try-again';
export interface WaitStep {
  state: WaitState;
  /** open the frame again with a fresh preview URL */
  reload: boolean;
}

export const WAIT_START: WaitState = { phase: 'waiting', retried: false };

export function waitStep(s: WaitState, e: WaitEvent): WaitStep {
  switch (e) {
    case 'open':
      return { state: { phase: 'waiting', retried: s.retried }, reload: false };
    case 'ready':
      return { state: { phase: 'ready', retried: false }, reload: false };
    case 'timeout':
      // a timer that fires once the page is in, or while Try again shows: nothing
      if (s.phase !== 'waiting') return { state: s, reload: false };
      if (!s.retried) return { state: { phase: 'waiting', retried: true }, reload: true };
      return { state: { phase: 'long', retried: true }, reload: false };
    case 'expired':
      // the frame holds the preview's dead page, even after the page was in (a redraw after a save): once more
      if (s.phase === 'long') return { state: s, reload: false };
      if (!s.retried) return { state: { phase: 'waiting', retried: true }, reload: true };
      return { state: { phase: 'long', retried: true }, reload: false };
    case 'try-again':
      if (s.phase !== 'long') return { state: s, reload: false };
      return { state: { phase: 'waiting', retried: true }, reload: true };
  }
}

/** The notice's words for a state (null: none). */
export function waitWords(s: WaitState): { text: string; button: string | null } | null {
  if (s.phase === 'waiting') return { text: 'Preparing the preview… the first page after a restart can take up to a minute.', button: null };
  if (s.phase === 'long') return { text: 'The preview is taking long.', button: 'Try again' };
  return null;
}
