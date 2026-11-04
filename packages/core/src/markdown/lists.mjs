// Two lists of the same kind and marker with only blank lines between them are one list in Markdown. Whatever puts
// blocks next to each other (the printer, the surgical save, a delete or a move) runs the pieces through
// keepListsApart, which gives the later list another marker: - * + for bullets, . ) for numbers. Only the markers of
// its top-level items change (column 0; nested items are indented), so numbers and spacing stay as written.

const BULLET = /^([-*+])(?=[ \t]|$)/;
const NUMBER = /^(\d{1,9})([.)])(?=[ \t]|$)/;

/** The top-level marker of a list piece: '-', '*', '+', '.' or ')' (null when it does not start with one). */
export function markerOf(type, piece) {
  const m = (type === 'bulletList' ? BULLET : NUMBER).exec(piece);
  return m ? m[type === 'bulletList' ? 1 : 2] : null;
}

/** The piece with its top-level markers changed to `to`. */
function remark(type, piece, to) {
  return piece
    .split('\n')
    .map((l) => (type === 'bulletList' ? l.replace(BULLET, to) : l.replace(NUMBER, (_m, n) => n + to)))
    .join('\n');
}

const isList = (t) => t === 'bulletList' || t === 'orderedList';

/** [{ type, text }] in document order -> the texts, with a list that would merge into the one before re-marked. */
export function keepListsApart(pieces) {
  let prev = null;
  return pieces.map(({ type, text }) => {
    let out = text;
    if (isList(type) && prev && prev.type === type) {
      const before = markerOf(type, prev.text);
      const mine = markerOf(type, out);
      if (before && mine === before) {
        const to = type === 'bulletList' ? (before === '-' ? '*' : '-') : before === '.' ? ')' : '.';
        out = remark(type, out, to);
      }
    }
    prev = { type, text: out };
    return out;
  });
}
