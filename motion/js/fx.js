// Procedural light effects on #fx (screen blend) and #ov (normal blend): bokeh, sparkles, light leaks.
(function () {
  const { clamp, lerp, p, E, rng, hash, noise1 } = M;
  const FX = (M.FX = {});
  const COLS = { champagne: [233, 216, 180], blush: [243, 220, 216], white: [255, 250, 244], peach: [255, 217, 184], gold: [201, 169, 110] };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;

  // ---------- bokeh: soft discs drifting mostly along the edges ----------
  const BOKEH = (() => {
    const r = rng(2024), list = [], names = ['champagne', 'blush', 'white', 'champagne', 'peach'];
    while (list.length < 40) {
      const x = r() * 1080, y = r() * 1920;
      const central = x > 230 && x < 850 && y > 330 && y < 1450;
      if (central && r() > .12) continue; // keep the subject area clear
      list.push({ x, y, rad: 10 + r() ** 1.6 * 50, a: .08 + r() * .17, col: COLS[names[Math.floor(r() * names.length)]],
                  vx: (r() - .5) * 10, vy: -6 - r() * 16, ph: r() * 6.28, sp: .5 + r() * .9, rank: r() });
    }
    return list;
  })();
  FX.bokeh = (t, density) => {
    if (density <= .01) return;
    const g = M.ctx;
    for (const b of BOKEH) {
      if (b.rank > density) continue;
      const fadeIn = clamp((density - b.rank) / .12);
      const x = ((b.x + b.vx * t + 14 * Math.sin(t * .4 * b.sp + b.ph)) % 1180 + 1180) % 1180 - 50;
      const y = ((b.y + b.vy * t) % 2020 + 2020) % 2020 - 50;
      const breathe = .75 + .25 * Math.sin(t * b.sp + b.ph);
      const rad = b.rad * (.9 + .1 * breathe), a = b.a * breathe * fadeIn;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, rgba(b.col, a)); gr.addColorStop(.62, rgba(b.col, a * .82)); gr.addColorStop(1, rgba(b.col, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
  };

  // ---------- sparkles: 4-point glints + tiny dust inside an output-pixel box ----------
  function glint(g, x, y, size, a, rot) {
    g.save(); g.translate(x, y); g.rotate(rot);
    const halo = g.createRadialGradient(0, 0, 0, 0, 0, size * .9);
    halo.addColorStop(0, rgba(COLS.white, .9 * a)); halo.addColorStop(.25, rgba(COLS.champagne, .45 * a)); halo.addColorStop(1, rgba(COLS.gold, 0));
    g.fillStyle = halo; g.beginPath(); g.arc(0, 0, size * .9, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgba(COLS.white, a);
    for (let k = 0; k < 2; k++) {
      g.beginPath(); const L = k ? size * .62 : size * 1.25, Wd = size * .09;
      g.moveTo(-L, 0); g.quadraticCurveTo(0, -Wd, L, 0); g.quadraticCurveTo(0, Wd, -L, 0);
      g.moveTo(0, -L); g.quadraticCurveTo(Wd, 0, 0, L); g.quadraticCurveTo(-Wd, 0, 0, -L);
      g.fill(); g.rotate(Math.PI / 4);
    }
    g.restore();
  }
  FX.sparkles = (t, t0, box, n = 10, seed = 1, dur = 1.1) => {
    if (t < t0 - .05 || t > t0 + dur + .6) return;
    const r = rng(seed), g = M.ctx;
    for (let i = 0; i < n; i++) {
      const st = t0 + r() * dur * .55, life = .55 + r() * .45, x = box[0] + r() * box[2], y = box[1] + r() * box[3];
      const size = 18 + r() * 26, rot = r() * .6, u = (t - st) / life;
      if (u <= 0 || u >= 1) continue;
      const a = u < .35 ? E.outSine(u / .35) : 1 - E.inSine((u - .35) / .65);
      glint(g, x, y - u * 10, size * (.55 + .45 * a), a, rot + u * .5);
    }
    for (let i = 0; i < n * 3; i++) { // dust
      const st = t0 + r() * dur * .8, life = .7 + r() * .6, x = box[0] - 40 + r() * (box[2] + 80), y = box[1] - 30 + r() * (box[3] + 60);
      const u = (t - st) / life; if (u <= 0 || u >= 1) continue;
      const a = Math.sin(u * Math.PI) * (.35 + r() * .4), rad = 1.5 + r() * 2.5;
      g.fillStyle = rgba(r() > .5 ? COLS.white : COLS.champagne, a);
      g.beginPath(); g.arc(x + Math.sin(u * 3 + i) * 6, y - u * 26, rad, 0, Math.PI * 2); g.fill();
    }
  };

  // ---------- light leaks ----------
  function blob(g, x, y, rad, col, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, rgba(col, a)); gr.addColorStop(.45, rgba(col, a * .55)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // transition leak: a warm sweep, brightest at T (the swap point hides under it)
  FX.leakSweep = (t, T, D, peak = .72) => {
    const u = (t - (T - D / 2)) / D; if (u <= 0 || u >= 1) return;
    const a = peak * Math.sin(u * Math.PI) ** 1.4, g = M.ctx;
    const x = lerp(-260, 1340, E.inOutSine(u)), y = lerp(520, 1250, u);
    blob(g, x, y, 1150, COLS.peach, a);
    blob(g, x + 240, y - 420, 820, COLS.champagne, a * .9);
    blob(g, x - 300, y + 520, 760, COLS.blush, a * .8);
  };
  // ambient leak: slow drift of a faint warm glow in a corner
  FX.ambientLeak = (t, s, seed = 0) => {
    if (s <= .01) return;
    const g = M.ctx, n = noise1(t * .25 + seed * 7);
    blob(g, lerp(-80, 260, .5 + .5 * Math.sin(t * .35 + seed)), lerp(120, 380, .5 + .5 * n), 760, COLS.champagne, .22 * s);
    blob(g, lerp(1160, 860, .5 + .5 * Math.sin(t * .28 + seed * 2)), lerp(1650, 1380, .5 + .5 * n), 640, COLS.peach, .16 * s);
  };

  // ---------- arch shape (for the arch_reveal transition) ----------
  FX.archPath = (cx, bottom, w, h) => { // rounded-top arch: straight sides, semicircle top, flat bottom
    const r = w / 2, x0 = cx - r, x1 = cx + r, top = bottom - h;
    return `M ${x0.toFixed(1)} ${bottom.toFixed(1)} L ${x0.toFixed(1)} ${(top + r).toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${(top + r).toFixed(1)} L ${x1.toFixed(1)} ${bottom.toFixed(1)} Z`;
  };
  FX.archStroke = (cx, bottom, w, h, a) => {
    if (a <= .01) return;
    const g = M.ov; g.save(); g.strokeStyle = rgba(COLS.gold, a); g.lineWidth = 3;
    g.shadowColor = rgba(COLS.champagne, a * .8); g.shadowBlur = 14;
    g.stroke(new Path2D(FX.archPath(cx, bottom, w, h))); g.restore();
  };

  // ---------- timeline-wide ambience ----------
  const shots = M.PLAN.shots;
  const reveal = shots.find(s => s.role === 'reveal'), end = shots.find(s => s.type === 'endcard');
  FX.density = t => {
    let d = .28;
    if (reveal) d = Math.max(d, .28 + .3 * M.pin(t, reveal.t0 - .2, reveal.t0 + .6, reveal.t1 - .3, reveal.t1 + .2));
    if (end) d = Math.max(d, .28 + .52 * p(t, end.vis0, end.t0 + 1.0, E.inOutSine));
    return d;
  };
  M.hooks.push(t => {
    FX.bokeh(t, FX.density(t));
    FX.ambientLeak(t, .55 + .45 * Math.sin(t * .5), 1);
    for (const s of shots) if (s.in === 'light_leak') FX.leakSweep(t, s.t0, M.PLAN.transitions.light_leak);
  });
})();
