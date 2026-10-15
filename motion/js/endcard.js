// End card: the only text in the reel. Wordmark, gold line, Instagram handle, CTA pill.
(function () {
  const { p, E, clamp, lerp } = M;
  const end = M.PLAN.shots.find(s => s.type === 'endcard');
  if (!end) return;
  const T0 = end.t0, TEXT = { l1: 'Sweet Decor', l2: 'Dreams', handle: '@sweet_decor_dreams', cta: 'Zatražite ponudu u DM' };
  const Y = { word: 718, line: 900, handle: 984, cta: 1100 }; // vertical centres; the group is centred on the safe-area centre

  // spring appear / levitate / exit (one element = one driver)
  M.ap = M.ap || ((e, t, o) => {
    const dOut = o.dOut ?? .35;
    if (t < o.t0 - .02 || (o.t1 != null && t > o.t1 + dOut)) { e.style.opacity = 0; e.style.visibility = 'hidden'; return 0; }
    e.style.visibility = 'visible';
    const sp = M.spring(t, o.t0, o.f ?? 1.5, o.z ?? .7), u = clamp(sp);
    const out = o.t1 != null ? p(t, o.t1, o.t1 + dOut, E.inCubic) : 0;
    const fl = o.amp === 0 ? { x: 0, y: 0, r: 0 } : M.float(t, o.seed ?? 0, o.amp ?? .5);
    M.tf(e, { x: o.x + fl.x, y: o.y + fl.y + (o.dy ?? 24) * (1 - u), s: (o.s ?? 1) * lerp(o.s0 ?? .94, 1, sp),
              rz: (o.rz ?? 0) + fl.r, o: clamp(sp * 1.4) * (1 - out), blur: (o.blur0 ?? 8) * (1 - u) });
    return u * (1 - out);
  });

  const S = M.scene({ name: 'endcard', t0: end.vis0, t1: M.total + 1, z: 100, cls: 'end' });
  let bg, blobs = [], word, line, handle, cta, cream, els = {};
  S.init = async root => {
    root.style.display = 'block'; // layout is needed for fitting and measuring
    // background: the hero photo, blurred once into a canvas, washed with cream
    const src = new Image(); src.src = end.bg; await src.decode();
    const c = document.createElement('canvas'); c.width = 660; c.height = 1080;
    const g = c.getContext('2d'); g.filter = 'blur(26px) brightness(1.08) saturate(.9)';
    const sc = Math.max(c.width / src.width, c.height / src.height) * 1.15;
    const fx = 0.62; // centre the blur on the garland / names
    g.drawImage(src, (c.width - src.width * sc) * fx, (c.height - src.height * sc) / 2, src.width * sc, src.height * sc);
    bg = M.el('img', 'bg', root); bg.src = c.toDataURL('image/jpeg', .92);
    M.el('div', 'wash', root);
    const B = [[180, 380, 620, '#F3DCD8', .55], [900, 560, 520, '#E9D8B4', .45], [760, 1500, 700, '#F3DCD8', .45], [120, 1450, 460, '#E9D8B4', .35]];
    for (const [x, y, r, col, a] of B) {
      const d = M.el('div', 'blob', root);
      Object.assign(d.style, { width: r * 2 + 'px', height: r * 2 + 'px', left: x - r + 'px', top: y - r + 'px',
        background: `radial-gradient(circle, ${col} 0%, ${col}00 70%)`, opacity: a });
      blobs.push({ d, x, y, r, a });
    }
    word = M.el('div', 'el wordmark', root, `<span class="l1">${TEXT.l1}</span><span class="l2">${TEXT.l2}</span>`);
    const l1 = word.querySelector('.l1'), l2 = word.querySelector('.l2');
    l1.style.display = l2.style.display = 'inline-block';
    const fs = M.fitText(l1, 880, 148, 90);
    l2.style.fontSize = (fs * 1.04).toFixed(1) + 'px';
    l1.style.display = l2.style.display = 'block';
    line = M.el('div', 'el goldline', root); line.style.width = '230px';
    const svg = await (await fetch('assets/icons/instagram.svg')).text();
    handle = M.el('div', 'el handle', root, svg.replace(/<title>.*?<\/title>/, '') + `<span>${TEXT.handle}</span>`);
    cta = M.el('div', 'el cta', root, TEXT.cta);
    cream = M.el('div', 'wash', root); cream.style.background = '#FBF7F2'; cream.style.opacity = 0;
    // centre every element on x = 540 and its vertical anchor
    for (const [e, y] of [[word, Y.word], [line, Y.line], [handle, Y.handle], [cta, Y.cta]]) {
      e.style.visibility = 'hidden'; e.style.opacity = 0;
      const w = e.offsetWidth, h = e.offsetHeight;
      e.style.left = (540 - w / 2).toFixed(1) + 'px'; e.style.top = (y - h / 2).toFixed(1) + 'px';
    }
    els = { word, line, handle, cta };
    M.endEls = els;
    root.style.display = 'none';
  };

  S.update = t => {
    const lt = t - T0;
    M.applyTrans(S.el, [M.TRANS[end.in || 'cut'].enter(t, T0)]);
    M.tf(bg, { s: 1 + .035 * p(t, end.vis0, M.total, E.linear), y: -12 * p(t, end.vis0, M.total, E.linear) });
    blobs.forEach((b, i) => { const f = M.float(t, i + 3, 2.2); M.tf(b.d, { x: f.x, y: f.y }); });
    M.ap(word, t, { t0: T0 + .05, x: 0, y: 0, f: 1.35, z: .74, s0: .94, blur0: 8, dy: 26, amp: .35, seed: 1 });
    const lu = p(t, T0 + .4, T0 + 1.0, E.outCubic);
    line.style.visibility = lu > 0 ? 'visible' : 'hidden'; line.style.opacity = lu > 0 ? 1 : 0;
    line.style.transform = `scaleX(${lu.toFixed(4)})`;
    M.ap(handle, t, { t0: T0 + .55, x: 0, y: 0, f: 1.5, z: .72, s0: .96, blur0: 6, dy: 20, amp: .25, seed: 2 });
    M.ap(cta, t, { t0: T0 + .95, x: 0, y: 0, f: 1.5, z: .7, s0: .94, blur0: 6, dy: 22, amp: .25, seed: 3 });
    // sparkle accents: one soft burst on the wordmark, one gentle glint on the CTA
    M.FX.sparkles(t, T0 + .25, [180, Y.word - 150, 720, 300], 5, 91, .9);
    M.FX.sparkles(t, T0 + 1.15, [cta.offsetLeft - 10, cta.offsetTop - 20, cta.offsetWidth + 20, 50], 3, 92, .7);
    // last 0.3 s brighten slightly toward cream (the reel loops back to a light hook)
    cream.style.opacity = (.16 * p(t, M.total - .3, M.total, E.inOutSine)).toFixed(3);
    M.state.ui = Object.entries(els).map(([k, e]) => ({ k, inSafe: M.inSafe(e, 16), vis: e.style.visibility !== 'hidden' && +e.style.opacity > .01,
      r: (({ left, top, right, bottom }) => [left, top, right, bottom].map(v => Math.round(v)))(e.getBoundingClientRect()) }));
    if (lt > -1) M.state.label = 'end card';
  };
})();
