// The Markstage site's only script (the pages work without it): the shared copy action (a green tick for 1.5 s),
// a copy icon on each code block, and the menu button on narrow windows.
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

  var menu = document.querySelector('.menu-btn');
  var nav = document.getElementById('main-nav');
  if (menu && nav)
    menu.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
})();
