// Where a picture fetched from a web address came from (docs/API.md "Media": `credit`). A picture an AI agent's
// add_image or the media import fetched keeps that address in its `credit`, as a stock photo keeps its photo page,
// so a person can later open where it came from and check its licence. Nothing is fetched here.
import { invalid } from '../util.mjs';

/** The credit of a picture fetched from `url`: {provider: 'web', label, sourceUrl}; refused unless http(s). */
export function webCredit(url) {
  let u;
  try {
    u = new URL(String(url ?? ''));
  } catch {
    throw invalid({ source: 'The address the picture came from is not a web address.' });
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.href.length > 2000) throw invalid({ source: 'The address the picture came from must be an http or https address, up to 2,000 characters.' });
  u.username = '';
  u.password = '';
  return { provider: 'web', label: u.host, sourceUrl: u.href };
}
