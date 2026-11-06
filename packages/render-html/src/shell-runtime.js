/* Lede shell runtime (spec 4.18, 4.19, 7; D63, D65): one fixed script, pinned by hash in the policy. */
(function () {
  'use strict';
  var m = document.querySelector('main');
  var s = document.querySelector('script#lede-shell');
  var A = Array.isArray;
  var c;
  if (!m || !s) return;
  try {
    c = JSON.parse(s.textContent);
  } catch {
    return;
  }
  if (!c || c.v !== 2 || !A(c.fields) || !A(c.formats)) return;
  var F = c.fields;
  var P = c.presets || [];
  var L = (q, r) => [].slice.call((r || m).querySelectorAll(q));
  var nm = (n) => L('[name="' + n + '"]');
  var T = L('figure.q-tpl > pre[role=region] > code');
  var B = L('.q-preset > button.q-pre');
  var N = F.map((f) => f && f.n);
  var ok = F.every(
    (f) =>
      f &&
      /^[A-Za-z][\w-]*$/.test(f.n) &&
      /^(ask|choose|confirm|param|toggle|bucket|template)$/.test(f.k) &&
      (f.k !== 'bucket' || (A(f.b) && A(f.t) && A(f.i) && f.t.length === f.i.length)) &&
      (f.k !== 'template' || A(f.s)),
  );
  if (!ok) return;
  var flat = (t) => t.replace(/[\n\r\u0085\u2028\u2029]/g, ' ');
  var pt = (f, x) => (f.u ? x + ' ' + f.u : '' + x);
  var read = (f) => {
    var k = f.k;
    var q = nm(f.n);
    if (k === 'ask') return q[0].value.replace(/\r\n?/g, '\n').trim();
    if (k === 'toggle') return q[0].checked ? 'on' : 'off';
    if (k === 'param') {
      q = parseFloat(q[1].value);
      return isFinite(q) ? +(f.mn + Math.round((Math.min(f.mx, Math.max(f.mn, q)) - f.mn) / f.st) * f.st).toFixed(9) : f.i;
    }
    if (k === 'bucket')
      return f.t.map((t, j) => f.b[nm(f.n + ':' + j).findIndex((r) => r.checked)] || f.i[j]);
    q = q.find((x) => x.checked);
    return q ? q.value : k === 'confirm' ? 'open' : k === 'choose' ? null : '';
  };
  var calc = () => {
    var v = F.map(read);
    return v.map((x, j) =>
      F[j].k !== 'template'
        ? x
        : F[j].b.replace(/\{([A-Za-z][\w-]*)\}/g, (y, k) => {
            var h = F[j].s.indexOf(k) < 0 ? -1 : N.indexOf(k);
            return h < 0 ? y : F[h].k === 'param' ? pt(F[h], v[h]) : v[h] || y;
          }),
    );
  };
  var lack = (v) => {
    var on = N.filter((n, j) => F[j].k === 'toggle' && v[j] === 'on');
    return F.map((f) => (on.indexOf(f.n) < 0 ? [] : (f.d || []).filter((x) => on.indexOf(x) < 0)));
  };
  var item = (n, x, force, tail) => {
    if (x === '') return ['- ' + n + ': (empty)'];
    if (!force && !/^\((empty|not chosen)\)$|[\n\u0085\u2028\u2029`]/.test(x)) return ['- ' + n + ': ' + x + tail];
    var f = '`'.repeat(Math.max(3, ...(x.match(/`+/g) || []).map((r) => r.length + 1)));
    return ['- ' + n + ':' + tail, '', '  ' + f].concat(
      x.split('\n').map((l) => (l === '' ? '' : '  ' + l)),
      '  ' + f,
    );
  };
  var write = (fmt, v) => {
    var U = lack(v);
    var blocked = N.filter((n, j) => U[j].length);
    var open = N.filter((n, j) => (F[j].k === 'confirm' && v[j] === 'open') || (F[j].k === 'choose' && v[j] === null));
    var tg = F.some((f) => f.k === 'toggle');
    var of = (f, j, b) => f.t.filter((t, k) => v[j][k] === b);
    if (fmt === 'json') {
      return JSON.stringify({ ...(c.page ? { page: c.page } : {}), open, ...(tg ? { blocked } : {}), answers: Object.fromEntries(F.map((f, j) => [f.n, f.k === 'bucket' ? Object.fromEntries(f.b.map((b) => [b, of(f, j, b)])) : v[j]])) }, null, 2);
    }
    var md = [];
    var pl = [];
    var qq = (t) => '"' + t.replace(/"/g, '""') + '"';
    F.forEach((f, j) => {
      var k = f.k;
      var x = v[j];
      var w = k === 'ask' ? '' : k === 'choose' ? null : k === 'confirm' ? 'open' : f.i;
      var sh = (y) => (k === 'param' ? flat(pt(f, y)) : k === 'choose' ? (y === null ? '(not chosen)' : flat(y)) : y);
      var o = '- ' + f.n + ':';
      if (k === 'bucket') {
        md.push(
          o,
          ...f.b.map((b) => {
            var ts = of(f, j, b).map((t) => (/[,;"]/.test((t = flat(t))) || t === '(none)' ? qq(t) : t));
            return '  - ' + flat(b) + ': ' + (ts.join(', ') || '(none)');
          }),
        );
        pl.push(...f.t.map((t, i) => (x[i] === w[i] ? 0 : o + ' ' + qq(flat(t)) + ' moved to ' + flat(x[i]) + ' (was ' + flat(w[i]) + ')')).filter(Boolean));
      } else {
        md.push(...(k === 'ask' || k === 'template' ? item(f.n, x, k === 'template', '') : [o + ' ' + sh(x)]));
        if (k !== 'template' && x !== w)
          pl.push(...(k === 'ask' ? item(f.n, x, 0, ' (was empty)') : [o + ' ' + sh(x) + ' (was ' + (k === 'choose' ? 'not chosen' : sh(w)) + ')']));
      }
    });
    if (fmt === 'prompt') {
      var ch = (n) => pl.some((l) => l.startsWith('- ' + n + ': '));
      var rest = N.filter((n, j) => !(F[j].s || [n]).some(ch) && open.indexOf(n) < 0 && blocked.indexOf(n) < 0);
      var tail = [['Open', open], ['Blocked', blocked], ['Unchanged', rest]].filter((a) => a[1].length).map((a) => a[0] + ': ' + a[1].join(', '));
      return ['Apply these changes' + (c.page ? ' to ' + flat(c.page) : '') + ':', '']
        .concat(pl.length ? pl.concat(tail.length ? [''].concat(tail) : []) : 'No changes.')
        .join('\n');
    }
    return (c.page ? ['# ' + flat(c.page), ''] : [])
      .concat('Open: ' + (open.join(', ') || 'none'), tg ? 'Blocked: ' + (blocked.join(', ') || 'none') : [], md.length ? [''].concat(md) : [])
      .join('\n');
  };
  var figs = L('figure[data-x]').filter((x) => c.formats.indexOf(x.dataset.x) >= 0);
  var say = (x, t) => {
    x.querySelector('.q-st').textContent = t;
  };
  var upd = () => {
    var v = calc();
    var U = lack(v);
    var ti = 0;
    figs.forEach((x) => {
      x.querySelector('code').textContent = write(x.dataset.x, v);
      say(x, '');
    });
    F.forEach((f, j) => {
      var k = f.k;
      var e;
      if (k === 'toggle') {
        e = nm(f.n)[0];
        if (U[j].length) e.setAttribute('aria-invalid', 'true');
        else e.removeAttribute('aria-invalid');
        e.closest('.q-toggle').querySelector('.q-st').textContent = U[j].length ? 'needs ' + U[j][0] + ', which is off' : '';
      } else if (k === 'bucket' && f.t.length) {
        e = L('.q-bk .q-n', nm(f.n + ':0')[0].closest('fieldset.q-bucket'));
        f.b.forEach((b, i) => {
          e[i].textContent = v[j].filter((y) => y === b).length;
        });
      } else if (k === 'template') {
        e = T[ti++];
        e.textContent = v[j];
        e.closest('figure').querySelector('.q-n').textContent = [...v[j]].length;
      }
    });
  };
  try {
    upd();
  } catch {
    return;
  }
  L('figure[data-x] .q-bar, fieldset.q > button.q-clear, .q-preset > button.q-pre').forEach((e) => e.removeAttribute('hidden'));
  L('figure[data-x] .q-xn, .q-preset > button.q-pre + .q-pv').forEach((e) => e.setAttribute('hidden', ''));
  var go = (e) => {
    var t = e.target;
    var p = t.closest ? t.closest('.q-param') : null;
    if (p) L('input', p).forEach((x) => { if (x !== t && t.value) x.value = t.value; });
    upd();
  };
  m.addEventListener('input', go);
  m.addEventListener('change', go);
  addEventListener('pageshow', upd);
  m.addEventListener('click', (e) => {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    if (b.matches('fieldset.q > button.q-clear')) {
      L('input[type=radio]', b.parentNode).forEach((r) => {
        r.checked = false;
      });
      upd();
    } else if (B.indexOf(b) >= 0) {
      P[B.indexOf(b)].v.forEach((kv) =>
        nm(kv[0]).forEach((r) => {
          if (r.type === 'radio') r.checked = r.value === kv[1];
          else if (r.type === 'checkbox') r.checked = kv[1] === 'on';
          else r.value = kv[1];
        }),
      );
      upd();
      say(figs[0], 'Applied ' + b.textContent);
    } else if (b.matches('figure[data-x] .q-copy')) {
      var x = b.closest('figure[data-x]');
      var text = write(x.dataset.x, calc());
      var by = () => {
        getSelection().selectAllChildren(x.querySelector('pre'));
        say(x, 'Copy was blocked. The text is selected: press Ctrl+C (Cmd+C on a Mac), or choose Copy from the selection menu.');
      };
      try {
        navigator.clipboard.writeText(text).then(() => say(x, 'Copied'), by);
      } catch {
        by();
      }
    }
  });
})();
