(() => {
  const canvas = document.getElementById('snow');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const DENSITY = { 0: 0, 1: 9000, 2: 5200, 3: 3000 };
  let w = 0;
  let h = 0;
  let amount = 2;
  let glow = '#a78bfa';
  let flakes = [];
  let running = false;

  const make = (anyY) => {
    const z = Math.random();
    return {
      x: Math.random() * w,
      y: anyY ? Math.random() * h : -6,
      r: 0.4 + z * 1.3,
      vy: 0.12 + z * 0.4,
      phase: Math.random() * 6.28,
      a: 0.25 + z * 0.55,
      crystal: z > 0.9,
      rot: Math.random() * 6.28,
    };
  };

  const fit = () => {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = DENSITY[amount] ? Math.round((w * h) / DENSITY[amount]) : 0;
    while (flakes.length < n) flakes.push(make(true));
    flakes.length = n;
  };

  const crystal = (f, alpha) => {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    ctx.strokeStyle = `rgba(240,236,255,${alpha})`;
    ctx.lineWidth = 0.7;
    const l = 2.6 + f.r * 1.6;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const cx = Math.cos(a);
      const sy = Math.sin(a);
      ctx.moveTo(0, 0);
      ctx.lineTo(cx * l, sy * l);
    }
    ctx.stroke();
    ctx.restore();
  };

  const frame = (t) => {
    if (!flakes.length) { running = false; ctx.clearRect(0, 0, w, h); return; }
    ctx.clearRect(0, 0, w, h);
    ctx.shadowColor = glow;
    for (const f of flakes) {
      f.y += f.vy;
      f.x += Math.sin(t / 2400 + f.phase) * 0.18;
      f.rot += 0.003;
      if (f.y > h + 6) Object.assign(f, make(false));
      const alpha = f.a * (0.75 + 0.25 * Math.sin(t / 1400 + f.phase * 4));
      ctx.shadowBlur = 2 + f.r * 3;
      if (f.crystal) crystal(f, alpha);
      else {
        ctx.fillStyle = `rgba(240,236,255,${alpha})`;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, 6.283);
        ctx.fill();
      }
    }
    requestAnimationFrame(frame);
  };

  const start = () => {
    if (running || !flakes.length) return;
    running = true;
    requestAnimationFrame(frame);
  };

  window.snow = {
    set(level, color) {
      amount = level;
      glow = color || glow;
      flakes = [];
      fit();
      start();
    },
  };

  new ResizeObserver(() => { fit(); start(); }).observe(canvas);
  fit();
  start();
})();
