// The release line in the footer of every screen: "v0.2.0 · build 256 · Nov 2, 2026 8:49 AM EST". The virtual
// module virtual:markstage/release (the Astro package's client.mjs, from core's release.mjs) stamps it at build time,
// in dev and in `markstage build-editor` alike, so the editor shows what it was built from; the server reports the
// same line (GET /markstage/api/release) and the site's smoke test compares the two.
import release from 'virtual:markstage/release';

export const RELEASE: { version: string; commit: string | null; build: number | null; builtAt: string | null; line: string } = release;

/**
 * The footer: small, muted, the line only. Each part ("v0.4.0", "build 510", the time) is its own unbroken span, so
 * in the narrow drawer the line wraps between parts instead of being cut ("10:17 PM MS", seen at build 510).
 */
export function releaseFooter(): HTMLElement {
  const f = document.createElement('footer');
  f.className = 'ms-release';
  RELEASE.line.split(' · ').forEach((part, i) => {
    if (i) f.append(' · ');
    const s = document.createElement('span');
    s.textContent = part;
    f.append(s);
  });
  f.title = RELEASE.commit ? `Markstage ${RELEASE.line} (${RELEASE.commit})` : `Markstage ${RELEASE.line}`;
  return f;
}
