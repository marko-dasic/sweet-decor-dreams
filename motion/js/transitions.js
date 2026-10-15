// Transition library. Each entry returns style contributions for the entering / leaving shot at time t.
// T = the cut point (incoming shot's nominal start), D = duration; the midpoint sits on the beat.
(function () {
  const { p, E, lerp, clamp } = M;
  const D = M.PLAN.transitions;
  const none = () => ({});
  M.TRANS = {
    cut: { enter: none, leave: none },

    zoom_through: {
      enter: (t, T) => { const d = D.zoom_through, u = p(t, T - d / 2, T + d / 2, E.outCubic);
        return { s: 1.25 - .25 * u, blur: 14 * (1 - u), o: p(t, T - .15, T + .06, E.linear) }; },
      leave: (t, T) => { const d = D.zoom_through, u = p(t, T - d / 2, T + d / 2, E.inCubic);
        return { s: 1 + .6 * u, blur: 14 * u }; },
      flash: .16,
    },

    light_leak: { // the warm sweep itself is drawn by fx.js; the swap happens under its brightest point
      enter: (t, T) => ({ o: p(t, T - .1, T + .1, E.inOutSine), s: 1.025 - .025 * p(t, T - .1, T + .3, E.outCubic) }),
      leave: none,
      flash: .2,
    },

    arch_reveal: {
      enter: (t, T) => {
        const d = D.arch_reveal, u = p(t, T - d / 2, T + d / 2, E.inOutCubic);
        if (u >= 1) return { s: 1.06 - .06 * p(t, T - d / 2, T + d / 2 + .4, E.outCubic) };
        const w = lerp(30, 2700, u), h = w * 1.5, cy = M.SAFE.cy + 40;
        M.FX.archStroke(540, cy + h / 2, w, h, .95 * (1 - E.inQuad(u)) * p(t, T - d / 2, T - d / 2 + .08, E.linear));
        return { clip: `path('${M.FX.archPath(540, cy + h / 2, w, h)}')`, s: 1.06 - .06 * p(t, T - d / 2, T + d / 2 + .4, E.outCubic) };
      },
      leave: (t, T) => { const d = D.arch_reveal, u = p(t, T - d / 2, T + d / 2, E.inOutSine); return { s: 1 + .05 * u, bright: 1 - .1 * u }; },
      flash: .12,
    },

    soft_dissolve: {
      enter: (t, T) => { const d = D.soft_dissolve, u = p(t, T - d / 2, T + d / 2, E.inOutSine); return { o: u, s: 1.03 - .03 * u }; },
      leave: none,
    },
  };

  // apply combined contributions to a shot element
  M.applyTrans = (el, parts) => {
    let s = 1, o = 1, blur = 0, clip = 'none', bright = 1;
    for (const c of parts) {
      if (c.s != null) s *= c.s; if (c.o != null) o *= c.o; if (c.blur) blur += c.blur;
      if (c.clip) clip = c.clip; if (c.bright != null) bright *= c.bright;
    }
    el.style.transform = Math.abs(s - 1) > 1e-4 ? `scale(${s.toFixed(4)})` : 'none';
    el.style.opacity = clamp(o).toFixed(3);
    const f = (blur > .05 ? `blur(${blur.toFixed(2)}px) ` : '') + (Math.abs(bright - 1) > 1e-3 ? `brightness(${bright.toFixed(3)})` : '');
    el.style.filter = f || 'none';
    el.style.clipPath = clip;
    return { s, o, blur };
  };
})();
