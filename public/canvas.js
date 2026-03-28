/* ==========================================================================
   Ambient Canvas — Floating geometry, particles, and bloom
   Draws on a transparent canvas above the HTML/CSS background composition.
   ========================================================================== */

(function () {
  'use strict';

  // ==== TOOL COLOR MAP (shared with app.js) ====
  const TOOL_COLORS = {
    Read:           '#D4A017',
    Edit:           '#C86840',
    Write:          '#B85535',
    Bash:           '#6B8E5A',
    Glob:           '#C8A850',
    Grep:           '#B89040',
    Agent:          '#D4B030',
    WebFetch:       '#4A8A7A',
    WebSearch:      '#3A7A6A',
    TodoWrite:      '#A06858',
    Skill:          '#B87040',
    Plan:           '#8A6070',
    EnterPlanMode:  '#8A6070',
    ExitPlanMode:   '#8A6070',
    _default:       '#7A7060',
  };

  // Bloom size categories
  const BLOOM_SMALL = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];
  const BLOOM_LARGE = ['Agent', 'SubagentStart', 'Plan', 'EnterPlanMode'];

  // ==== CANVAS SETUP ====
  const canvas = document.getElementById('ambient-canvas');
  const ctx = canvas.getContext('2d');
  let W, H;

  // Reactivity: brief glow when tool events fire
  let reactivity = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Reinitialize position-dependent elements
    initGeoShapes();
    initDiagLines();
    resetIdleParticles();
  }

  window.addEventListener('resize', resize);

  // ==== IDLE PARTICLES (ambient dust motes) ====
  const IDLE_COUNT = 80;
  const IDLE_COLORS = [
    '#E8DCC8',  // warm cream
    '#D4A017',  // amber
    '#C86840',  // burnt sienna
    '#B89040',  // dusty amber
    '#ffc479',  // golden (from artwork)
    '#ff866d',  // primary coral (from artwork)
    '#7A7060',  // warm gray
  ];
  let idleParticles = [];

  function createIdleParticle(fullRandom) {
    return {
      x: fullRandom ? Math.random() * (W || 800) : Math.random() * (W || 800),
      y: fullRandom ? Math.random() * (H || 600) : Math.random() * (H || 600),
      vx: (Math.random() - 0.5) * 0.1,
      vy: (Math.random() - 0.5) * 0.06,
      radius: 0.8 + Math.random() * 2.2,
      opacity: 0.08 + Math.random() * 0.22,
      color: IDLE_COLORS[Math.floor(Math.random() * IDLE_COLORS.length)],
      seedX: Math.random() * Math.PI * 2,
      seedY: Math.random() * Math.PI * 2,
    };
  }

  function resetIdleParticles() {
    if (idleParticles.length === 0) {
      for (let i = 0; i < IDLE_COUNT; i++) {
        idleParticles.push(createIdleParticle(true));
      }
    } else {
      // Just update positions to fit new dimensions
      for (const p of idleParticles) {
        if (p.x > W) p.x = Math.random() * W;
        if (p.y > H) p.y = Math.random() * H;
      }
    }
  }

  function updateIdleParticles(time) {
    for (const p of idleParticles) {
      p.x += Math.sin(time * 0.00018 + p.seedX) * 0.1 + p.vx;
      p.y += Math.cos(time * 0.00013 + p.seedY) * 0.07 + p.vy;

      // Wrap around edges
      if (p.x < -10) p.x = W + 10;
      if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10;
      if (p.y > H + 10) p.y = -10;
    }
  }

  function drawIdleParticles() {
    const boost = 1 + reactivity * 1.5;
    for (const p of idleParticles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.min(p.opacity * boost, 0.5);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ==== BLOOM PARTICLES (triggered by tool events) ====
  const bloomParticles = [];

  function triggerBloom(toolName) {
    const color = TOOL_COLORS[toolName] || TOOL_COLORS._default;

    let count;
    if (BLOOM_SMALL.includes(toolName)) {
      count = 8 + Math.floor(Math.random() * 5);
    } else if (BLOOM_LARGE.includes(toolName)) {
      count = 30 + Math.floor(Math.random() * 16);
    } else {
      count = 15 + Math.floor(Math.random() * 11);
    }

    // Spawn near the sun area (center, slightly below middle)
    const cx = W * 0.5 + (Math.random() - 0.5) * W * 0.25;
    const cy = H * 0.55 + (Math.random() - 0.5) * H * 0.2;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.4 + Math.random() * 2.8;

      bloomParticles.push({
        x: cx + (Math.random() - 0.5) * 30,
        y: cy + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1.5 + Math.random() * 5,
        opacity: 0.5 + Math.random() * 0.35,
        color: color,
        life: 1.0,
      });
    }

    // Cap particle count to prevent frame drops during rapid tool bursts
    while (bloomParticles.length > 500) {
      bloomParticles.shift();
    }

    // Boost reactivity (affects all elements)
    reactivity = Math.min(reactivity + 0.4, 1.0);
  }

  function updateBloomParticles() {
    for (let i = bloomParticles.length - 1; i >= 0; i--) {
      const p = bloomParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.opacity *= 0.985;
      p.radius *= 0.996;
      p.life -= 0.007;

      if (p.opacity < 0.01 || p.life <= 0) {
        bloomParticles.splice(i, 1);
      }
    }
  }

  function drawBloomParticles() {
    for (const p of bloomParticles) {
      // Outer glow (larger, softer)
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * 3.5, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.opacity * 0.1;
      ctx.fill();

      // Core particle
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.opacity;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ==== FLOATING GEOMETRIC SHAPES ====
  // Inspired by: triangle accent (sunset_horizon), rotated diamond
  // (home_visualizer), circle outlines (geometric_depth), small squares
  let geoShapes = [];

  function initGeoShapes() {
    geoShapes = [
      // Triangle outline — upper left area
      {
        type: 'triangle',
        rx: 0.15, ry: 0.28,
        size: Math.min(W, H) * 0.05,
        rotation: 0,
        rotSpeed: 0.00008,
        driftAmpX: 35,
        driftAmpY: 20,
        seedX: 1.3, seedY: 2.7,
        color: '#ff866d',
        baseOpacity: 0.07,
      },
      // Diamond outline — upper right
      {
        type: 'diamond',
        rx: 0.82, ry: 0.22,
        size: Math.min(W, H) * 0.035,
        rotation: 0,
        rotSpeed: -0.00012,
        driftAmpX: 25,
        driftAmpY: 30,
        seedX: 0.5, seedY: 3.8,
        color: '#aaccd8',
        baseOpacity: 0.06,
      },
      // Circle outline — right side, near sun level
      {
        type: 'circle',
        rx: 0.76, ry: 0.55,
        size: Math.min(W, H) * 0.06,
        rotation: 0,
        rotSpeed: 0,
        driftAmpX: 20,
        driftAmpY: 15,
        seedX: 2.1, seedY: 0.9,
        color: '#ff866d',
        baseOpacity: 0.06,
        pulsate: true,
      },
      // Small square — lower left
      {
        type: 'square',
        rx: 0.22, ry: 0.68,
        size: Math.min(W, H) * 0.02,
        rotation: 0.4,
        rotSpeed: 0.00006,
        driftAmpX: 40,
        driftAmpY: 15,
        seedX: 4.2, seedY: 1.1,
        color: '#ffc479',
        baseOpacity: 0.09,
      },
      // Second circle — left side, higher
      {
        type: 'circle',
        rx: 0.12, ry: 0.48,
        size: Math.min(W, H) * 0.04,
        rotation: 0,
        rotSpeed: 0,
        driftAmpX: 15,
        driftAmpY: 25,
        seedX: 3.6, seedY: 5.1,
        color: '#eea439',
        baseOpacity: 0.04,
        pulsate: true,
      },
      // Small triangle — right side lower
      {
        type: 'triangle',
        rx: 0.88, ry: 0.42,
        size: Math.min(W, H) * 0.025,
        rotation: 1.2,
        rotSpeed: 0.0001,
        driftAmpX: 18,
        driftAmpY: 22,
        seedX: 0.8, seedY: 4.4,
        color: '#b4a9a3',
        baseOpacity: 0.05,
      },
    ];
  }

  function drawGeoShapes(time) {
    const opacityBoost = 1 + reactivity * 2.5;

    for (const s of geoShapes) {
      const x = s.rx * W + Math.sin(time * 0.00015 + s.seedX) * s.driftAmpX;
      const y = s.ry * H + Math.cos(time * 0.00012 + s.seedY) * s.driftAmpY;
      const rot = s.rotation + time * s.rotSpeed;
      const opacity = Math.min(s.baseOpacity * opacityBoost, 0.25);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1;

      if (s.type === 'triangle') {
        const sz = s.size;
        ctx.beginPath();
        ctx.moveTo(0, -sz);
        ctx.lineTo(-sz * 0.866, sz * 0.5);
        ctx.lineTo(sz * 0.866, sz * 0.5);
        ctx.closePath();
        ctx.stroke();
      } else if (s.type === 'diamond') {
        const sz = s.size;
        ctx.beginPath();
        ctx.moveTo(0, -sz);
        ctx.lineTo(sz, 0);
        ctx.lineTo(0, sz);
        ctx.lineTo(-sz, 0);
        ctx.closePath();
        ctx.stroke();
      } else if (s.type === 'circle') {
        let sz = s.size;
        if (s.pulsate) {
          sz += Math.sin(time * 0.0008) * sz * 0.08;
        }
        ctx.beginPath();
        ctx.arc(0, 0, sz, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.type === 'square') {
        const sz = s.size;
        ctx.strokeRect(-sz, -sz, sz * 2, sz * 2);
      }

      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ==== DIAGONAL ATMOSPHERIC LINES ====
  // Inspired by the thin rotated lines in atmospheric_lines and sunset_horizon
  let diagLines = [];

  function initDiagLines() {
    diagLines = [
      {
        angle: -10,
        baseY: 0.42,
        driftAmp: 12,
        driftSeed: 1.5,
        color: '#7d736f',
        baseOpacity: 0.05,
      },
      {
        angle: 5,
        baseY: 0.34,
        driftAmp: 15,
        driftSeed: 3.2,
        color: '#4f4642',
        baseOpacity: 0.04,
      },
      {
        angle: -2.5,
        baseY: 0.58,
        driftAmp: 8,
        driftSeed: 5.7,
        color: '#b4a9a3',
        baseOpacity: 0.03,
      },
    ];
  }

  function drawDiagLines(time) {
    const opacityBoost = 1 + reactivity * 1.5;

    for (const line of diagLines) {
      const y = H * line.baseY + Math.sin(time * 0.00025 + line.driftSeed) * line.driftAmp;
      const angleRad = (line.angle * Math.PI) / 180;

      ctx.save();
      ctx.translate(W / 2, y);
      ctx.rotate(angleRad);
      ctx.globalAlpha = Math.min(line.baseOpacity * opacityBoost, 0.12);
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-W * 0.7, 0);
      ctx.lineTo(W * 0.7, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ==== FILM GRAIN (canvas-based, animated) ====
  // Note: CSS grain overlay (#grain-overlay) handles static texture.
  // This canvas grain adds subtle animation (regenerates every few frames).
  const grainCanvas = document.createElement('canvas');
  const grainCtx = grainCanvas.getContext('2d');
  grainCanvas.width = 128;
  grainCanvas.height = 128;
  let grainFrame = 0;
  let grainPattern = null;

  function regenerateGrain() {
    const data = grainCtx.createImageData(128, 128);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.random() * 255;
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
      px[i + 3] = 255;
    }
    grainCtx.putImageData(data, 0, 0);
    // Cache the pattern — only recreate when grain image changes
    grainPattern = ctx.createPattern(grainCanvas, 'repeat');
  }

  function drawFilmGrain() {
    grainFrame++;
    if (grainFrame % 5 === 0) regenerateGrain();
    if (!grainPattern) return;

    ctx.globalAlpha = 0.018;
    ctx.fillStyle = grainPattern;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // ==== MAIN ANIMATION LOOP ====
  function animate(time) {
    ctx.clearRect(0, 0, W, H);

    // Decay reactivity smoothly
    reactivity *= 0.975;

    // Draw layers back to front
    drawDiagLines(time);
    drawGeoShapes(time);
    updateIdleParticles(time);
    drawIdleParticles();
    updateBloomParticles();
    drawBloomParticles();
    drawFilmGrain();

    requestAnimationFrame(animate);
  }

  // ==== INITIALIZE ====
  resize();
  regenerateGrain();
  requestAnimationFrame(animate);

  // ==== PUBLIC API ====
  window.AmbientCanvas = {
    triggerBloom: triggerBloom,
    TOOL_COLORS: TOOL_COLORS,
  };
})();
