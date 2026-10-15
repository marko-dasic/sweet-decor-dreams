// Deterministic engine: every pixel is a pure function of t (seconds). No timers, no CSS transitions.
(function () {
  const M = (window.M = {});
  M.PLAN = window.PLAN; M.fps = M.PLAN.fps || 60; M.beat = M.PLAN.beat || 0.5; M.b = n => n * M.beat;
  M.total = M.PLAN.total;
  M.W = 1080; M.H = 1920;
  M.SAFE = { l: 54, r: 1026, t: 192, b: 1536, w: 972, h: 1344, cx: 540, cy: 864 };
  M.stageScale = 1;

  // ---------- math & easing ----------
  M.clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  M.lerp = (a, b, t) => a + (b - a) * t;
  const E = (M.E = {
    linear: x => x,
    inQuad: x => x * x, outQuad: x => 1 - (1 - x) * (1 - x),
    inCubic: x => x ** 3, outCubic: x => 1 - (1 - x) ** 3,
    inOutCubic: x => (x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
    inOutQuart: x => (x < .5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
    inOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2, outSine: x => Math.sin(x * Math.PI / 2), inSine: x => 1 - Math.cos(x * Math.PI / 2),
    outExpo: x => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
    outBack: (x, s = 1.2) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2,
  });
  M.p = (t, a, b, e = E.inOutCubic) => e(M.clamp((t - a) / (b - a)));
  M.pin = (t, a, b, c, d, e = E.inOutCubic) => M.p(t, a, b, e) * (1 - M.p(t, c, d, e)); // rise a..b, fall c..d
  M.spring = (t, t0, f = 1.6, z = .68) => {
    if (t <= t0) return 0;
    const x = t - t0, w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + (z * w / wd) * Math.sin(wd * x));
  };

  // ---------- noise ----------
  M.hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); };
  M.rng = seed => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  M.noise1 = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return M.lerp(M.hash(i), M.hash(i + 1), u) * 2 - 1; };
  M.float = (t, seed = 0, amp = 1) => { const s = seed * 13.37; return {
    x: amp * (4 * Math.sin(t * .5 + s) + 2 * Math.sin(t * .9 + s * 2.1)),
    y: amp * (6 * Math.sin(t * .62 + s * 1.3) + 2 * Math.sin(t * 1.1 + s * .7)),
    r: amp * .25 * Math.sin(t * .4 + s * .9) }; };

  // ---------- DOM helpers ----------
  M.el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
  M.tf = (e, o) => {
    let s = '';
    if (o.x || o.y) s += `translate3d(${(o.x || 0).toFixed(2)}px,${(o.y || 0).toFixed(2)}px,0) `;
    if (o.rz) s += `rotate(${o.rz.toFixed(3)}deg) `;
    if ((o.s ?? 1) !== 1) s += `scale(${o.s.toFixed(4)}) `;
    e.style.transform = s || 'none';
    if (o.o != null) e.style.opacity = M.clamp(o.o).toFixed(3);
    if (o.blur != null) e.style.filter = o.blur > .05 ? `blur(${o.blur.toFixed(2)}px)` : 'none';
  };
  M.fitText = (e, maxW, maxPx, minPx = 40) => {
    let lo = minPx, hi = maxPx;
    for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; e.style.fontSize = mid + 'px'; (e.scrollWidth <= maxW ? (lo = mid) : (hi = mid)); }
    e.style.fontSize = lo + 'px'; return lo;
  };
  M.inSafe = (e, pad = 0) => { const r = e.getBoundingClientRect(), k = M.stageScale || 1, S = M.SAFE;
    return r.left / k >= S.l + pad && r.right / k <= S.r - pad && r.top / k >= S.t + pad && r.bottom / k <= S.b - pad; };
  M.guides = new URLSearchParams(location.search).has('guides');

  // ---------- crop windows ----------
  // win = {x, y, w, h} in source px, always 9:16. view() makes it fill the 1080x1920 frame exactly.
  M.view = (img, win, srcW, srcH) => {
    const k = M.W / win.w;
    img.style.width = (srcW * k).toFixed(2) + 'px'; img.style.height = (srcH * k).toFixed(2) + 'px';
    img.style.transform = `translate3d(${(-win.x * k).toFixed(2)}px,${(-win.y * k).toFixed(2)}px,0)`;
    return k;
  };
  M.mkWin = (x, y, w) => ({ x, y, w, h: w * 16 / 9 });
  M.clampWin = (win, sw, sh) => {
    let { x, y, w, h } = win;
    if (w > sw) { w = sw; h = w * 16 / 9; }
    if (h > sh) { h = sh; w = h * 9 / 16; }
    x = M.clamp(x, 0, sw - w); y = M.clamp(y, 0, sh - h);
    return { x, y, w, h };
  };
  // Zoom-correct interpolation: width moves geometrically and the centre follows the width change,
  // so a push/pull towards a point zooms about a fixed point without swing.
  M.lerpWin = (a, b, s) => {
    const w = Math.abs(a.w - b.w) < .01 ? M.lerp(a.w, b.w, s) : Math.exp(M.lerp(Math.log(a.w), Math.log(b.w), s));
    const f = Math.abs(a.w - b.w) < .01 ? s : (w - a.w) / (b.w - a.w);
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    const cx = M.lerp(acx, bcx, f), cy = M.lerp(acy, bcy, f), h = w * 16 / 9;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  };
  // keys: [[t, x, y, w, ease], ...], t relative to the shot's nominal start
  M.winAt = (keys, lt, sw, sh) => {
    if (lt <= keys[0][0]) return M.clampWin(M.mkWin(keys[0][1], keys[0][2], keys[0][3]), sw, sh);
    for (let i = 1; i < keys.length; i++) {
      const k0 = keys[i - 1], k1 = keys[i];
      if (lt <= k1[0]) {
        const s = (E[k1[4] || 'linear'])(M.clamp((lt - k0[0]) / (k1[0] - k0[0])));
        return M.clampWin(M.lerpWin(M.mkWin(k0[1], k0[2], k0[3]), M.mkWin(k1[1], k1[2], k1[3]), s), sw, sh);
      }
    }
    // past the last key: keep drifting at the last segment's speed (never freeze)
    const n = keys.length, k0 = keys[n - 2], k1 = keys[n - 1];
    const s = 1 + (lt - k1[0]) / (k1[0] - k0[0]) * .5;
    return M.clampWin(M.lerpWin(M.mkWin(k0[1], k0[2], k0[3]), M.mkWin(k1[1], k1[2], k1[3]), s), sw, sh);
  };
  M.project = (box, win) => { const k = M.W / win.w; return [(box[0] - win.x) * k, (box[1] - win.y) * k, box[2] * k, box[3] * k]; };

  // ---------- registries ----------
  M.scenes = []; M.scene = def => (M.scenes.push(def), def);
  M.flashes = []; M.flash = (t, peak = .25, up = .06, down = .4) => M.flashes.push({ t, peak, up, down });
  M.hooks = []; M.pending = []; M.state = {};

  M.setClipFrame = (img, clip, sec) => { // clip = {id, fps, frames, start}
    const f = Math.max(1, Math.min(clip.frames, Math.floor((sec - clip.start) * clip.fps + 1e-6) + 1));
    const src = `media/clips/${clip.id}/${String(f).padStart(4, '0')}.jpg`;
    if (img.dataset.src !== src) { img.dataset.src = src; img.src = src; M.pending.push(img.decode().catch(() => console.warn('frame failed', src))); }
    return f;
  };

  // ---------- grain ----------
  function grainTiles() {
    const tiles = [], r = M.rng(77);
    for (let n = 0; n < 8; n++) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d'), d = g.createImageData(256, 256);
      for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (r() + r() + r() - 1.5) * 120; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      g.putImageData(d, 0, 0); tiles.push(`url(${c.toDataURL('image/png')})`);
    }
    return tiles;
  }

  function buildGuides() {
    const g = M.el('div', '', document.getElementById('stage')); g.id = 'guides';
    const S = M.SAFE, sh = 'rgba(255,0,60,.16)';
    g.innerHTML = `
      <div style="position:absolute;left:0;top:0;width:1080px;height:${S.t}px;background:${sh}"></div>
      <div style="position:absolute;left:0;top:${S.b}px;width:1080px;height:${1920 - S.b}px;background:${sh}"></div>
      <div style="position:absolute;left:0;top:${S.t}px;width:${S.l}px;height:${S.h}px;background:${sh}"></div>
      <div style="position:absolute;left:${S.r}px;top:${S.t}px;width:${1080 - S.r}px;height:${S.h}px;background:${sh}"></div>
      <div style="position:absolute;left:${S.l}px;top:${S.t}px;width:${S.w}px;height:${S.h}px;outline:3px solid rgba(255,0,60,.8);box-sizing:border-box"></div>
      <div style="position:absolute;left:960px;top:1050px;width:120px;height:486px;background:rgba(0,90,255,.18);outline:2px dashed rgba(0,90,255,.7)"></div>
      <div style="position:absolute;left:${S.cx - 30}px;top:${S.cy}px;width:60px;height:2px;background:rgba(255,0,60,.9)"></div>
      <div style="position:absolute;left:${S.cx}px;top:${S.cy - 30}px;width:2px;height:60px;background:rgba(255,0,60,.9)"></div>
      <div style="position:absolute;left:0;top:240px;width:1080px;height:1440px;outline:2px dashed rgba(0,160,80,.8)"></div>
      <div id="gtime" style="position:absolute;left:${S.l + 8}px;top:${S.t + 8}px;font:600 34px Inter;color:#fff;background:rgba(0,0,0,.55);padding:4px 10px"></div>`;
    M.hooks.push(t => { const e = document.getElementById('gtime'); if (e) e.textContent = t.toFixed(2) + 's  ' + (M.state.label || ''); });
  }

  // ---------- lifecycle ----------
  M.init = async () => {
    const fams = ['500 40px Cormorant', '600 40px Cormorant', 'italic 500 40px Cormorant', '500 40px Inter', '400 40px Inter', '600 40px Inter'];
    await Promise.all(fams.map(f => document.fonts.load(f, 'Zatražite čćšžđ ČĆŠŽĐ @sweet_decor_dreams')));
    M.grain = grainTiles();
    M.grainEl = document.getElementById('grain');
    M.flashEl = document.getElementById('flash');
    M.fx = document.getElementById('fx'); M.ctx = M.fx.getContext('2d');
    M.ovEl = document.getElementById('ov'); M.ov = M.ovEl.getContext('2d');
    const root = document.getElementById('media'), ui = document.getElementById('ui');
    for (const s of M.scenes) {
      s.el = M.el('div', s.cls || 'shot', s.ui ? ui : root);
      s.el.style.zIndex = s.z || 1; s.el.style.display = 'none'; s._on = false;
      if (s.init) await s.init(s.el);
    }
    // pre-decode every image so no frame is captured before its pixels exist
    await Promise.all([...document.images].map(i => i.decode().catch(() => console.warn('image failed', i.src))));
    if (M.guides) buildGuides();
    M.ready = true;
  };

  M.renderFrame = async t => {
    M.t = t; M.pending = []; M.state = {};
    M.ctx.clearRect(0, 0, M.W, M.H); M.ov.clearRect(0, 0, M.W, M.H);
    for (const s of M.scenes) {
      const on = t >= s.t0 && t < s.t1;
      if (on !== s._on) { s.el.style.display = on ? 'block' : 'none'; s._on = on; }
      if (on) s.update(t);
    }
    for (const h of M.hooks) h(t);
    let fl = 0;
    for (const f of M.flashes) {
      const a = t < f.t ? M.p(t, f.t - f.up, f.t, E.inQuad) : 1 - M.p(t, f.t, f.t + f.down, E.outCubic);
      fl = Math.max(fl, f.peak * a);
    }
    M.flashEl.style.opacity = fl.toFixed(3);
    const fr = Math.round(t * M.fps);
    M.grainEl.style.backgroundImage = M.grain[Math.floor(M.hash(fr) * 8) % 8];
    M.grainEl.style.backgroundPosition = `${Math.floor(M.hash(fr + .5) * 256)}px ${Math.floor(M.hash(fr + .25) * 256)}px`;
    if (M.pending.length) await Promise.all(M.pending);
    return true;
  };
  window.renderFrame = t => M.renderFrame(t);
})();
