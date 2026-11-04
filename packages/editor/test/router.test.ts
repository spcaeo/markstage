// A screen's search is in its URL (q=), so a pasted link shows the same search; k=1 opens the editor's search, and
// q is then what is typed in it (src/router.ts).
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// the editor's sources import each other without the extension (Vite resolves them): so does this test
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});
const { closeOverlays, format, parse, placeOf } = await import('../src/router.ts');

test("a screen's q is its own search, kept through a round trip", () => {
  const r = parse('#/library?kind=snippet&q=opening');
  assert.deepEqual(r.screenParams, { kind: 'snippet', q: 'opening' });
  assert.equal(r.k, false);
  assert.equal(format(r), '#/library?kind=snippet&q=opening');
  assert.deepEqual(parse('#/users?q=edna').screenParams, { q: 'edna' });
});

test("with the editor's search open, q is what is typed in it", () => {
  const r = parse('#/users?role=editor&k=1&q=hello');
  assert.deepEqual(r.screenParams, { role: 'editor' });
  assert.equal(r.k, true);
  assert.equal(r.q, 'hello');
  assert.equal(format(r), '#/users?role=editor&k=1&q=hello');
});

test('an AI suggestion is in the URL while what it sits in is open, and round-trips', () => {
  const at = (h: string) => format(parse(h));
  assert.deepEqual(parse('#/e/posts/hello?suggest=alt&img=2').suggest, { kind: 'alt', img: 2 });
  assert.equal(at('#/e/posts/hello?suggest=alt&img=2'), '#/e/posts/hello?suggest=alt&img=2');
  // the same image's card in its settings panel is another place, so another URL
  assert.deepEqual(parse('#/e/posts/hello?b=3&suggest=alt&img=2&at=panel').suggest, { kind: 'alt', img: 2, at: 'panel' });
  assert.equal(at('#/e/posts/hello?b=3&suggest=alt&img=2&at=panel'), '#/e/posts/hello?b=3&suggest=alt&img=2&at=panel');
  assert.deepEqual(parse('#/e/posts/hello?suggest=alt&img=2&at=side').suggest, { kind: 'alt', img: 2 });
  // an image setting and a region need Post settings open; the SEO check's needs the SEO check
  assert.deepEqual(parse('#/e/posts/hello?s=1&suggest=alt&field=cover').suggest, { kind: 'alt', field: 'cover' });
  assert.equal(parse('#/e/posts/hello?suggest=alt&field=cover').suggest, null);
  assert.deepEqual(parse('#/e/posts/hello?s=1&suggest=translate&loc=fr-CA').suggest, { kind: 'translate', loc: 'fr-CA' });
  assert.equal(at('#/e/posts/hello?s=1&suggest=translate&loc=fr-CA'), '#/e/posts/hello?s=1&suggest=translate&loc=fr-CA');
  assert.deepEqual(parse('#/e/posts/hello?side=seo&suggest=seo').suggest, { kind: 'seo' });
  assert.equal(parse('#/e/posts/hello?suggest=seo').suggest, null);
  // not in the source view, not with a bad number or key, and never on a screen
  assert.equal(parse('#/e/posts/hello?view=source&suggest=alt&img=2').suggest, null);
  assert.equal(parse('#/e/posts/hello?suggest=alt&img=0').suggest, null);
  assert.equal(parse('#/e/posts/hello?s=1&suggest=alt&field=a%20b').suggest, null);
  assert.equal(parse('#/environments/plans/p1?suggest=seo&side=seo').suggest, null);
  assert.deepEqual(parse('#/environments/plans/p1?suggest=summary').screenParams, { suggest: 'summary' });
  // a page in the pages editor keeps them as its own
  assert.deepEqual(parse('#/p/pages/about?suggest=alt&field=hero').extra, { suggest: 'alt', field: 'hero' });
  assert.equal(at('#/p/pages/about?sec=0&suggest=alt&field=sections.0.value.picture'), '#/p/pages/about?sec=0&suggest=alt&field=sections.0.value.picture');
});

test('"What readers see" is in the URL (readers=1) on the canvas, not in Source mode', () => {
  const r = parse('#/e/posts/hello?readers=1');
  assert.equal(r.readers, true);
  assert.equal(format(r), '#/e/posts/hello?readers=1');
  assert.equal(parse('#/e/posts/hello?view=source&readers=1').readers, false);
  assert.equal(parse('#/p/pages/home?readers=1').readers, false);
});

test('a dialog or menu belongs to its screen: closed when the place changes, kept while only its params change (QA F3)', () => {
  // the place: the screen and its arguments, or the open entry; not the params, the view or the settings panel
  assert.equal(placeOf(parse('#/redirects?q=old')), placeOf(parse('#/redirects?q=new&do=remove')));
  assert.notEqual(placeOf(parse('#/redirects')), placeOf(parse('#/taxonomy')));
  assert.notEqual(placeOf(parse('#/e/posts/one')), placeOf(parse('#/e/posts/two')));
  assert.equal(placeOf(parse('#/e/posts/one')), placeOf(parse('#/e/posts/one?settings=1&view=side')));
  // what closes: open dialogs and pop-up menus; not the editor's search or the sign-in box
  const closed: string[] = [];
  const dialog = (cls: string) => ({ className: cls, close: () => closed.push(`dialog ${cls}`) });
  const root = { querySelectorAll: (sel: string) => (sel.startsWith('dialog[open]:not(.ms-pal):not(.ms-signin)') ? [dialog('ms-dialog'), dialog('ms-dialog ms-moveto')] : []) as unknown as ArrayLike<Element> };
  const menus = new Set([{ close: () => closed.push('menu') }]);
  assert.equal(closeOverlays(root, menus), 3);
  assert.deepEqual(closed, ['dialog ms-dialog', 'dialog ms-dialog ms-moveto', 'menu']);
  assert.equal(menus.size, 0);
});
