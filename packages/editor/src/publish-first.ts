// The top bar's Publish control. The publish sheet publishes the last SAVED version of the entry (it is its own
// screen; the editor's unsaved text never reaches it), so Publish saves first when there is anything unsaved: the
// same path as Save and ⌘S, awaited, with the usual "Saved" state. A save that fails (an error, a conflict) keeps the
// writer on the page with that message; the sheet does not open. Pure, so it is tested without a browser.
export interface PublishFirstDeps {
  /** the open entry has unsaved changes */
  dirty(): boolean;
  /** the editor's own save: false when it failed (it shows the error or the conflict itself); nothing: see dirty() */
  save(): void | Promise<boolean>;
  /** go to the publish sheet */
  open(): void;
}

export type PublishFirstOutcome = 'opened' | 'saved' | 'stayed';

/** 'opened': nothing to save; 'saved': saved, then opened; 'stayed': the save failed, the sheet did not open. */
export async function publishFirst(d: PublishFirstDeps): Promise<PublishFirstOutcome> {
  if (!d.dirty()) {
    d.open();
    return 'opened';
  }
  const ok = await d.save();
  if (ok === false || d.dirty()) return 'stayed';
  d.open();
  return 'saved';
}
