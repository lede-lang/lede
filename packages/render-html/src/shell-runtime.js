/* Lede shell runtime (spec 4.18 and 7, D63). One fixed script, pinned by hash in the page's policy.
   It reads the page's controls, writes the answers as an export and copies it out. */
(function () {
  'use strict';
  var d = document;
  var m = d.querySelector('main');
  var s = d.querySelector('script#lede-shell');
  var c;
  if (!m || !s) return;
  try {
    c = JSON.parse(s.textContent);
  } catch {
    return;
  }
  if (!c || c.v !== 1 || !Array.isArray(c.fields) || !Array.isArray(c.formats)) return;
  var F = c.fields;
  for (var i = 0; i < F.length; i++) {
    if (!F[i] || !/^[A-Za-z][\w-]*$/.test(F[i].n) || !/^(ask|choose|confirm)$/.test(F[i].k)) return;
  }
  var each = function (list, fn) {
    Array.prototype.forEach.call(list, fn);
  };
  var flat = function (t) {
    return t.replace(/[\n\r\u0085\u2028\u2029]/g, ' ');
  };
  var read = function (f) {
    var q;
    if (f.k === 'ask') {
      q = m.querySelector('[name="' + f.n + '"]');
      return q ? q.value.replace(/\r\n?/g, '\n').trim() : '';
    }
    q = m.querySelector('input[name="' + f.n + '"]:checked');
    return q ? q.value : f.k === 'confirm' ? 'open' : null;
  };
  var item = function (n, x) {
    if (x === '') return ['- ' + n + ': (empty)'];
    if (x !== '(empty)' && x !== '(not chosen)' && !/[\n\u0085\u2028\u2029`]/.test(x)) return ['- ' + n + ': ' + x];
    var run = Math.max.apply(null, [0].concat((x.match(/`+/g) || []).map(function (r) { return r.length; })));
    var fence = '`'.repeat(Math.max(3, run + 1));
    var out = ['- ' + n + ':', '', '  ' + fence];
    each(x.split('\n'), function (l) {
      out.push(l === '' ? '' : '  ' + l);
    });
    out.push('  ' + fence);
    return out;
  };
  var write = function (fmt) {
    var v = F.map(read);
    var open = [];
    F.forEach(function (f, j) {
      if ((f.k === 'confirm' && v[j] === 'open') || (f.k === 'choose' && v[j] === null)) open.push(f.n);
    });
    if (fmt === 'json') {
      var answers = Object.fromEntries(F.map(function (f, j) { return [f.n, v[j]]; }));
      return JSON.stringify(c.page ? { page: c.page, open: open, answers: answers } : { open: open, answers: answers }, null, 2);
    }
    var items = [];
    F.forEach(function (f, j) {
      if (f.k === 'choose') items.push('- ' + f.n + ': ' + (v[j] === null ? '(not chosen)' : flat(v[j])));
      else if (f.k === 'confirm') items.push('- ' + f.n + ': ' + v[j]);
      else items = items.concat(item(f.n, v[j]));
    });
    var top = c.page ? ['# ' + flat(c.page), ''] : [];
    top.push('Open: ' + (open.length ? open.join(', ') : 'none'));
    return top.concat(items.length ? [''].concat(items) : []).join('\n');
  };
  var figs = Array.prototype.filter.call(m.querySelectorAll('figure[data-x]'), function (x) {
    return c.formats.indexOf(x.getAttribute('data-x')) >= 0;
  });
  var say = function (x, t) {
    var st = x.querySelector('.q-st');
    if (st) st.textContent = t;
  };
  var upd = function () {
    figs.forEach(function (x) {
      x.querySelector('code').textContent = write(x.getAttribute('data-x'));
      say(x, '');
    });
  };
  each(m.querySelectorAll('figure[data-x] .q-bar, fieldset.q > button.q-clear'), function (e) {
    e.removeAttribute('hidden');
  });
  each(m.querySelectorAll('figure[data-x] .q-xn'), function (e) {
    e.setAttribute('hidden', '');
  });
  m.addEventListener('input', upd);
  m.addEventListener('change', upd);
  addEventListener('pageshow', upd);
  m.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    if (b.matches('fieldset.q > button.q-clear')) {
      each(b.parentNode.querySelectorAll('input[type=radio]'), function (r) {
        r.checked = false;
      });
      upd();
    } else if (b.matches('figure[data-x] .q-copy')) {
      var x = b.closest('figure[data-x]');
      var text = write(x.getAttribute('data-x'));
      var by = function () {
        getSelection().selectAllChildren(x.querySelector('pre'));
        say(x, 'Copy was blocked. The text is selected: press Ctrl+C (Cmd+C on a Mac), or choose Copy from the selection menu.');
      };
      try {
        navigator.clipboard.writeText(text).then(function () {
          return say(x, 'Copied');
        }, by);
      } catch {
        by();
      }
    }
  });
  upd();
})();
