// The Markstage site's only script (the pages work without it): the shared copy action (a green tick for 1.5 s),
// a copy icon on each code block, the star count on the GitHub button, and the menu button on narrow windows.
(function () {
  var TICK = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function copy(button) {
    var value = button.getAttribute('data-copy');
    var done = function () {
      var icon = button.innerHTML;
      button.classList.add('copied');
      button.innerHTML = TICK;
      setTimeout(function () {
        button.classList.remove('copied');
        button.innerHTML = icon;
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(done, function () {});
  }

  /** The one copy button, as layout.mjs copyable() draws it, for a value made here (a code block). */
  function copyButton(value, what) {
    var tpl = document.querySelector('.copy-btn');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn copy-btn';
    b.setAttribute('data-copy', value);
    b.setAttribute('aria-label', 'Copy ' + what);
    b.title = 'Copy';
    b.innerHTML = tpl ? tpl.innerHTML : 'Copy';
    return b;
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.copy-btn');
    if (b) copy(b);
  });

  document.querySelectorAll('.prose pre').forEach(function (pre) {
    var wrap = document.createElement('div');
    wrap.className = 'copyable code-block';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    wrap.appendChild(copyButton(pre.textContent.replace(/\n$/, ''), 'code'));
  });

  // the star count on the GitHub button, from GitHub's public API, kept for an hour; nothing shows when it fails
  var count = document.querySelector('.gh-count[data-repo]');
  if (count && window.fetch) {
    var key = 'markstage-stars';
    var show = function (n) {
      if (typeof n !== 'number' || n < 1) return;
      count.textContent = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
      count.parentNode.setAttribute('aria-label', 'Star Markstage on GitHub (' + n + ' stars)');
    };
    var kept = null;
    try {
      kept = JSON.parse(sessionStorage.getItem(key) || 'null');
    } catch (e) {}
    if (kept && Date.now() - kept.at < 3600000) show(kept.n);
    else
      fetch('https://api.github.com/repos/' + count.getAttribute('data-repo'))
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (repo) {
          if (!repo) return;
          show(repo.stargazers_count);
          try {
            sessionStorage.setItem(key, JSON.stringify({ n: repo.stargazers_count, at: Date.now() }));
          } catch (e) {}
        })
        .catch(function () {});
  }

  var menu = document.querySelector('.menu-btn');
  var nav = document.getElementById('main-nav');
  if (menu && nav)
    menu.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
})();
