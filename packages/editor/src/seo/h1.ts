// Whether the page shows the title as its main heading (H1). The site's layout decides that, not the editor, so the
// built page is the judge: its H1s are the layout's (the title) and the text's own (# headings). Before the page has
// been read, the canvas says what it draws; when that is not known either, nothing is claimed.

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * `built`: the H1s of the built page (null: not read yet); `body`: the text's own H1s; `title`: the entry's title;
 * `canvas`: the canvas draws the title as an H1. True or false when known, null when not.
 */
export function titleIsH1(built: string[] | null, body: string[], title: string, canvas: boolean): boolean | null {
  if (built) {
    if (built.some((h) => squash(h) === squash(title))) return true;
    // the title was changed and not saved yet: the layout's H1 is the one the text does not account for
    const own = body.map(squash);
    return built.filter((h) => !own.includes(squash(h))).length > 0;
  }
  return canvas ? true : null;
}
