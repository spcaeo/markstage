// What stops a save before it starts (index.ts save()): a title past the server's limit, said with the count (QA
// pass 2, N11), and a role changed while editing, where the person is asked first (N10).
import { ask } from './shell';
import { TITLE_MAX } from './title';

/**
 * `error`: the words for the status line, the save does not run; `declined`: the person chose not to save after
 * their role changed; neither: go on (a role change, once agreed to, is not asked about again).
 */
export async function beforeSave(titleLength: number, roleNow: string | null): Promise<{ error?: string; declined?: boolean }> {
  const over = titleLength - TITLE_MAX;
  if (over > 0) return { error: `Titles are at most ${TITLE_MAX} characters (${over} over): shorten it to save.` };
  if (roleNow && (await ask('Your role changed', `Your role is now ${roleNow}. Try to save anyway?`, [['cancel', 'Cancel'], ['save', 'Save anyway', 'ms-btn ms-btn--primary']])) !== 'save') return { declined: true };
  return {};
}
