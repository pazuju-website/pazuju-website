// Small self-contained fireworks burst, shown once a puzzle is fully solved.
// Draws to a temporary full-viewport canvas that removes itself when done.
function launchFireworks(durationMs = 2400) {
  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const colors = ["#e8935a", "#c1502e", "#f2b53a", "#fff8ec", "#4a90d9", "#5cb87a"];
  const gravity = 0.05;
  const particles = [];

  function spawnBurst(x, y) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    const count = 40 + Math.floor(Math.random() * 20);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const speed = 2 + Math.random() * 3.5;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.008 + Math.random() * 0.012,
        color,
        size: 2 + Math.random() * 2,
      });
    }
  }

  let elapsed = 0;
  let burstTimer = 0;
  const burstInterval = 380;
  let lastTime = performance.now();
  let stopSpawning = false;

  function frame(now) {
    const dt = now - lastTime;
    lastTime = now;
    elapsed += dt;
    burstTimer += dt;

    if (!stopSpawning && burstTimer > burstInterval) {
      burstTimer = 0;
      spawnBurst(
        window.innerWidth * (0.2 + Math.random() * 0.6),
        window.innerHeight * (0.2 + Math.random() * 0.35)
      );
    }
    if (elapsed > durationMs) stopSpawning = true;

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (stopSpawning && particles.length === 0) {
      window.removeEventListener("resize", resize);
      canvas.remove();
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
