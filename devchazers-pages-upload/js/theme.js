/* DevChazers theme helpers: hero particle network + mobile menu. Purely visual. */
(function () {
  /* mobile menu */
  var b = document.getElementById('burger'), n = document.querySelector('#hd nav');
  if (b && n) {
    var close = function () { n.classList.remove('open'); b.textContent = '☰'; b.setAttribute('aria-expanded', 'false'); };
    b.addEventListener('click', function () {
      var o = n.classList.toggle('open'); b.textContent = o ? '✕' : '☰'; b.setAttribute('aria-expanded', String(o));
    });
    n.addEventListener('click', function (e) { if (e.target.closest('a')) close(); });
    addEventListener('hashchange', close);
  }

  /* particles */
  var cv = document.getElementById('particles'); if (!cv) return;
  var cx = cv.getContext('2d'), W = 0, H = 0, P = [], N = innerWidth < 700 ? 40 : 70,
      reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size() {
    var w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return false;
    var sx = W ? w / W : 1, sy = H ? h / H : 1; W = cv.width = w; H = cv.height = h;
    P.forEach(function (p) { p.x *= sx; p.y *= sy; }); return true;
  }
  size();
  for (var i = 0; i < N; i++) P.push({ x: Math.random() * (W || 1200), y: Math.random() * (H || 700), vx: (Math.random() - .5) * .5, vy: (Math.random() - .5) * .5, r: Math.random() * 2 + 1 });
  function draw() {
    cx.clearRect(0, 0, W, H);
    for (var i = 0; i < P.length; i++) {
      var p = P[i]; if (!reduce) { p.x += p.vx; p.y += p.vy; }
      if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
      cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fillStyle = 'rgba(0,229,255,.7)'; cx.fill();
      for (var j = i + 1; j < P.length; j++) {
        var q = P[j], d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 120) { cx.strokeStyle = 'rgba(124,77,255,' + (1 - d / 120) + ')'; cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(q.x, q.y); cx.stroke(); }
      }
    }
  }
  addEventListener('resize', size);
  if (reduce) { draw(); return; }
  (function loop() {
    var r = cv.getBoundingClientRect();
    if (!document.hidden && r.bottom > 0 && r.top < innerHeight && (cv.clientWidth === W || size())) draw();
    requestAnimationFrame(loop);
  })();
})();
