// The filter of the comparison pages (the pages work without it: every card and cell is in the HTML). A segment
// shows the products of one kind, Markstage always; "only rows where they differ" hides the rows where every
// product shown has the same mark. The state lives in the address (?show=git&diff=1), so the back button and a
// shared link give the same view.
(function () {
  var bars = document.querySelectorAll('.cmp-filter');
  if (!bars.length || !window.URLSearchParams || !history.pushState) return;

  function state() {
    var q = new URLSearchParams(location.search);
    return { show: q.get('show') || 'all', diff: q.get('diff') === '1' };
  }

  function shows(el, show) {
    var k = (el.getAttribute('data-k') || '').split(' ');
    return show === 'all' || k.indexOf('ms') >= 0 || k.indexOf(show) >= 0;
  }

  // a cell's mark, or its words when it has none ("Free", "None"), to tell rows apart
  function sig(td) {
    var m = td.getAttribute('data-m');
    if (m !== 'val') return m;
    var v = td.querySelector('.val');
    return 'val:' + (v ? v.textContent.trim() : '');
  }

  function applyTable(table, show, diff) {
    var visible = {};
    var products = 0;
    table.querySelectorAll('thead th[data-p]').forEach(function (th) {
      var on = shows(th, show);
      th.hidden = !on;
      visible[th.getAttribute('data-p')] = on;
      if (on && th.classList.contains('pc')) products++;
    });
    var hidden = 0;
    table.querySelectorAll('tbody').forEach(function (body) {
      var left = 0;
      body.querySelectorAll('tr[data-row]').forEach(function (tr) {
        var first = null;
        var same = true;
        tr.querySelectorAll('td[data-p]').forEach(function (td) {
          td.hidden = !visible[td.getAttribute('data-p')];
          if (td.hidden) return;
          var s = sig(td);
          if (first === null) first = s;
          else if (s !== first) same = false;
        });
        tr.hidden = diff && same && products > 0;
        if (tr.hidden) hidden++;
        else left++;
      });
      var head = body.querySelector('tr.grp');
      if (head) head.hidden = left === 0;
    });
    var wrap = table.closest('.cmp-wrap');
    var empty = wrap && wrap.nextElementSibling;
    if (wrap) wrap.hidden = products === 0;
    if (empty && empty.classList.contains('cmp-empty')) empty.hidden = products > 0;
    return hidden;
  }

  function apply() {
    var s = state();
    bars.forEach(function (bar) {
      var scope = bar.closest('[data-filter-scope]') || document;
      var show = bar.querySelector('[data-show="' + s.show + '"]') ? s.show : 'all';
      bar.querySelectorAll('[data-show]').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-show') === show ? 'true' : 'false');
      });
      var box = bar.querySelector('[data-diff]');
      var diff = Boolean(box) && s.diff;
      if (box) box.checked = diff;
      var cards = scope.querySelectorAll('.pcard[data-k]');
      var shown = 0;
      var others = 0;
      cards.forEach(function (c) {
        var on = shows(c, show);
        c.hidden = !on;
        if (!c.classList.contains('ms')) {
          others++;
          if (on) shown++;
        }
      });
      scope.querySelectorAll('.kind-group').forEach(function (g) {
        g.hidden = !g.querySelector('.pcard:not([hidden])');
      });
      var rows = 0;
      scope.querySelectorAll('table.cmp').forEach(function (t) {
        rows += applyTable(t, show, diff);
      });
      var count = bar.querySelector('.cmp-filter-count');
      if (count) count.textContent = cards.length ? 'Showing ' + shown + ' of ' + others + ' products' : diff ? rows + ' rows where all agree are hidden' : '';
    });
  }

  function go(show, diff) {
    var q = new URLSearchParams(location.search);
    if (show === 'all') q.delete('show');
    else q.set('show', show);
    if (diff) q.set('diff', '1');
    else q.delete('diff');
    var query = q.toString();
    history.pushState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
    apply();
  }

  bars.forEach(function (bar) {
    bar.hidden = false;
    bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-show]');
      if (b) go(b.getAttribute('data-show'), state().diff);
    });
    var box = bar.querySelector('[data-diff]');
    if (box)
      box.addEventListener('change', function () {
        go(state().show, box.checked);
      });
  });
  window.addEventListener('popstate', apply);
  apply();
})();
