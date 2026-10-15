// Generic shot scenes built from PLAN.shots (photos and clip frame sequences). The end card is endcard.js.
(function () {
  const { p, E, clamp, lerp } = M;
  const shots = M.PLAN.shots;
  shots.forEach((sh, i) => {
    if (sh.type === 'endcard') return;
    const T = M.TRANS[sh.in || 'cut'] || M.TRANS.cut, next = shots[i + 1];
    const Tn = next ? (M.TRANS[next.in || 'cut'] || M.TRANS.cut) : M.TRANS.cut;
    if (!M.TRANS[sh.in || 'cut']) console.warn('unknown transition', sh.in);
    const S = M.scene({ name: 'shot-' + sh.id, t0: sh.vis0, t1: sh.vis1, z: 10 + i });
    let img;
    S.init = root => {
      img = M.el('img', '', M.el('div', 'crop', root));
      img.src = sh.src; img.decoding = 'sync';
      img.dataset.bleed = 1; root.dataset.bleed = 1;
      if (sh.type === 'video') img.dataset.src = sh.src;
      if (T.flash && i > 0) M.flash(sh.t0, T.flash, .08, .35);
      if (sh.flash) M.flash(sh.t0 + sh.flash[0], sh.flash[1], .12, .45);
    };
    const k0 = sh.keys[0];
    S.update = t => {
      const lt = t - sh.t0;
      const win = M.winAt(sh.keys, lt, sh.w, sh.h);
      const k = M.view(img, win, sh.w, sh.h);
      let frame = null;
      if (sh.type === 'video') frame = M.setClipFrame(img, sh.clip, sh.clipIn + lt * (sh.speed || 1));
      img.style.filter = sh.grade || M.PLAN.grade;
      const parts = [];
      if (i > 0 && t < sh.t0 + sh.tin / 2 + .5) parts.push(T.enter(t, sh.t0));
      if (next && t > sh.t1 - sh.tout / 2 - .5) parts.push(Tn.leave(t, sh.t1));
      if (sh.punch && t >= sh.t0) parts.push({ s: 1 + .035 * (1 - p(t, sh.t0, sh.t0 + .25, E.outCubic)) });
      const st = M.applyTrans(S.el, parts);
      // sparkle accent, projected from source pixels through the current window
      if (sh.sparkle) {
        const b = M.project(sh.sparkle.box, win);
        M.FX.sparkles(t, sh.t0 + sh.sparkle.t, b, sh.sparkle.n || 10, 7 + i);
      }
      // state for the QA scans
      let focal = sh.focal;
      if (sh.focal_end) {
        const k1 = sh.keys[1], f = (E[k1[4] || 'linear'])(clamp((lt - k0[0]) / (k1[0] - k0[0])));
        focal = sh.focal.map((v, j) => lerp(v, sh.focal_end[j], f));
      }
      const inTrans = (i > 0 && t < sh.t0 + sh.tin / 2) || (next && t >= sh.t1 - sh.tout / 2);
      (M.state.shots = M.state.shots || []).push({ id: sh.id, asset: sh.asset, win, k, srcK: sh.type === 'video' ? k * sh.w / M.ING_W(sh) : k,
        focal: focal && M.project(focal, win), must_keep: (sh.must_keep || []).map(b => M.project(b, win)), inTrans, frame, opacity: st.o, scale: st.s });
      M.state.label = sh.id + ' ' + (sh.asset || '');
    };
  });
  // native width of the asset behind a shot (clip frames are upscaled copies of 478 px wide video)
  M.ING_W = sh => (sh.type === 'video' ? sh.nativeW : sh.w);
})();
