/*
 * Spatialgineers Experience Visualiser – next generation
 *
 * This script implements a highly configurable particle visualiser.  It
 * extends the previous prototype with a host of new behaviours and
 * parameters, microphone‑driven responsiveness, pointer wind, glow
 * effects, spiral and galaxy modes, left/right emitters, an audio
 * bar visualiser, and a simple embed generator.  Users may toggle
 * drawing mode by clicking the canvas when the “Drawn Path” emitter
 * is selected and can repeatedly start/stop drawing until the
 * desired path is achieved.  A microphone can be enabled to drive
 * colour gradients, speed and bar height.  Additional sliders allow
 * control over particle size, glow intensity, speed and pointer wind
 * strength.  A branded label appears in the lower left of the
 * control panel.
 */

(() => {
  // Grab DOM elements
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const countInput = document.getElementById('particleCount');
  const shapeSelect = document.getElementById('shapeSelect');
  const behaviourSelect = document.getElementById('behaviorSelect');
  const colourPicker = document.getElementById('colourPicker');
  const sizeRange = document.getElementById('sizeRange');
  const glowRange = document.getElementById('glowRange');
  const speedRange = document.getElementById('speedRange');
  const pointerRange = document.getElementById('pointerRange');
  const micCheckbox = document.getElementById('micCheckbox');
  const embedButton = document.getElementById('embedButton');
  const particleImagesInput = document.getElementById('particleImages');
  const backgroundImageInput = document.getElementById('backgroundImage');
  const clearPathButton = document.getElementById('clearPath');
  const resetParticlesButton = document.getElementById('resetParticles');

  // State
  let particles = [];
  let particleTextures = [];
  let backgroundTexture = null;
  let pathPoints = [];
  let pathLengths = [];
  let totalPathLength = 0;
  let drawingPath = false;
  let behaviour = behaviourSelect.value;
  let emitterShape = shapeSelect.value;
  let particleColour = colourPicker.value;
  let invertedColour = invertHex(particleColour);
  // Audio and pointer
  let micEnabled = false;
  let audioCtx = null;
  let analyser = null;
  let micData = null;
  let freqData = null;
  let micAmplitude = 0;
  let pointerPos = { x: 0, y: 0, active: false };

  // Configuration defaults
  const CONFIG = {
    maxParticles: 2000,
    particleBaseSize: 6,
    glow: 0,
    baseSpeed: 1,
    pointerStrength: 0,
    barCount: 32
  };

  /**
   * Invert a hex colour string and return its complement.  Supports
   * 3‑ or 6‑character hex codes.
   *
   * @param {string} hex
   * @returns {string}
   */
  function invertHex(hex) {
    let c = hex.replace('#', '');
    if (c.length === 3) {
      c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    }
    const r = 255 - parseInt(c.substr(0, 2), 16);
    const g = 255 - parseInt(c.substr(2, 2), 16);
    const b = 255 - parseInt(c.substr(4, 2), 16);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /**
   * Resize the canvas to fill its container.  This should be called
   * on initialisation and whenever the window size changes.
   */
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
  }

  /**
   * Clear the current path and reset associated lengths.  Path mode
   * will revert to normal behaviours until a new path is drawn.
   */
  function clearPath() {
    pathPoints = [];
    pathLengths = [];
    totalPathLength = 0;
  }

  /**
   * Compute cumulative segment lengths of the current path.  Called
   * whenever pathPoints is updated.  Enables constant speed traversal.
   */
  function computePathLengths() {
    pathLengths = [];
    totalPathLength = 0;
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const p0 = pathPoints[i];
      const p1 = pathPoints[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      totalPathLength += segLen;
      pathLengths.push(totalPathLength);
    }
  }

  /**
   * Given a distance along the path return the corresponding coordinate.
   * Uses linear interpolation between path points.
   *
   * @param {number} dist
   */
  function getPointOnPath(dist) {
    if (pathPoints.length < 2) return { x: canvas.width / 2, y: canvas.height / 2 };
    let d = dist % totalPathLength;
    let index = 0;
    while (index < pathLengths.length && d > pathLengths[index]) {
      index++;
    }
    const segStart = index === 0 ? 0 : pathLengths[index - 1];
    const p0 = pathPoints[index];
    const p1 = pathPoints[index + 1];
    const segLength = pathLengths[index] - segStart;
    const t = segLength === 0 ? 0 : (d - segStart) / segLength;
    return {
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t
    };
  }

  /**
   * Initialise the particles array based on the selected count and behaviours.
   */
  function initParticles() {
    particles = [];
    const count = Math.min(parseInt(countInput.value, 10) || 0, CONFIG.maxParticles);
    for (let i = 0; i < count; i++) {
      const p = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        colour: particleColour,
        size: CONFIG.particleBaseSize + Math.random() * 2,
        texture: null,
        dist: Math.random() * (totalPathLength || 1),
        rotation: 0,
        radius: 0,
        angle: 0,
        angularVelocity: 0,
        barIndex: 0
      };
      if (particleTextures.length > 0) {
        const idx = Math.floor(Math.random() * particleTextures.length);
        p.texture = particleTextures[idx];
      }
      spawnParticle(p);
      particles.push(p);
    }
  }

  /**
   * Spawn a particle according to current emitter shape and behaviour.  For
   * galaxy and spiral modes additional polar coordinates are assigned.
   *
   * @param {object} p
   */
  function spawnParticle(p) {
    const cw = canvas.width;
    const ch = canvas.height;
    const shape = emitterShape;
    // default base position
    let baseX = cw / 2;
    let baseY = ch / 2;
    // Determine emitter shape base positions
    if (shape === 'circle') {
      const radius = Math.min(cw, ch) * 0.3;
      const ang = Math.random() * Math.PI * 2;
      baseX = cw / 2 + Math.cos(ang) * radius;
      baseY = ch / 2 + Math.sin(ang) * radius;
    } else if (shape === 'line') {
      baseX = Math.random() * cw;
      baseY = ch / 2;
    } else if (shape === 'square') {
      const size = Math.min(cw, ch) * 0.5;
      const half = size / 2;
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) {
        baseX = cw / 2 - half + Math.random() * size;
        baseY = ch / 2 - half;
      } else if (edge === 1) {
        baseX = cw / 2 + half;
        baseY = ch / 2 - half + Math.random() * size;
      } else if (edge === 2) {
        baseX = cw / 2 - half + Math.random() * size;
        baseY = ch / 2 + half;
      } else {
        baseX = cw / 2 - half;
        baseY = ch / 2 - half + Math.random() * size;
      }
    } else if (shape === 'draw') {
      // position is determined by path distance in animate
    }
    // Determine behaviour velocities or polar coords
    behaviour = behaviourSelect.value;
    if (pathPoints.length >= 2 && shape === 'draw') {
      // path mode: velocities zero
      p.vx = p.vy = 0;
    } else if (behaviour === 'center') {
      p.x = cw / 2;
      p.y = ch / 2;
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.5 + Math.random() * 1.5;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
    } else if (behaviour === 'bottom') {
      p.x = Math.random() * cw;
      p.y = ch;
      p.vx = (Math.random() - 0.5) * 1;
      p.vy = -(1 + Math.random());
    } else if (behaviour === 'top') {
      p.x = Math.random() * cw;
      p.y = 0;
      p.vx = (Math.random() - 0.5) * 1;
      p.vy = (1 + Math.random());
    } else if (behaviour === 'random') {
      p.x = Math.random() * cw;
      p.y = Math.random() * ch;
      p.vx = (Math.random() - 0.5) * 2;
      p.vy = (Math.random() - 0.5) * 2;
    } else if (behaviour === 'left') {
      p.x = 0;
      p.y = Math.random() * ch;
      p.vx = 1 + Math.random();
      p.vy = (Math.random() - 0.5) * 0.5;
    } else if (behaviour === 'right') {
      p.x = cw;
      p.y = Math.random() * ch;
      p.vx = -(1 + Math.random());
      p.vy = (Math.random() - 0.5) * 0.5;
    } else if (behaviour === 'bars') {
      const index = Math.floor(Math.random() * CONFIG.barCount);
      const barW = cw / CONFIG.barCount;
      p.x = index * barW + barW / 2;
      p.y = ch;
      p.vx = 0;
      p.vy = 0;
      p.barIndex = index;
    } else if (behaviour === 'spiral') {
      const radius = Math.random() * Math.min(cw, ch) * 0.45;
      const ang = Math.random() * Math.PI * 2;
      p.radius = radius;
      p.angle = ang;
      p.angularVelocity = (Math.random() - 0.5) * 0.02;
      p.x = cw / 2 + Math.cos(ang) * radius;
      p.y = ch / 2 + Math.sin(ang) * radius;
      p.vx = p.vy = 0;
      p.rotation = Math.random() * Math.PI * 2;
    } else if (behaviour === 'galaxy') {
      const radius = Math.sqrt(Math.random()) * Math.min(cw, ch) * 0.45;
      const ang = Math.random() * Math.PI * 2;
      p.radius = radius;
      p.angle = ang;
      p.angularVelocity = 0.005 + Math.random() * 0.005;
      p.x = cw / 2 + Math.cos(ang) * radius;
      p.y = ch / 2 + Math.sin(ang) * radius;
      p.vx = p.vy = 0;
      p.rotation = Math.random() * Math.PI * 2;
    } else {
      // default: spawn at base position with random velocity
      p.x = baseX;
      p.y = baseY;
      p.vx = (Math.random() - 0.5) * 2;
      p.vy = (Math.random() - 0.5) * 2;
    }
  }

  /**
   * Draw a particle.  Applies glow, rotation and shape rendering.
   *
   * @param {object} p
   */
  function drawParticle(p) {
    const size = p.size;
    // set shadow (glow) per particle
    ctx.shadowColor = p.colour;
    ctx.shadowBlur = CONFIG.glow;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.rotation) ctx.rotate(p.rotation);
    if (p.texture) {
      ctx.drawImage(p.texture, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = p.colour;
      switch (emitterShape) {
        case 'line': {
          ctx.beginPath();
          ctx.moveTo(-size / 2, 0);
          ctx.lineTo(size / 2, 0);
          ctx.lineWidth = 2;
          ctx.strokeStyle = p.colour;
          ctx.stroke();
          break;
        }
        case 'square': {
          ctx.fillRect(-size / 2, -size / 2, size, size);
          break;
        }
        default: {
          ctx.beginPath();
          ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /**
   * Load textures for particles from input files.  Resets the array
   * and reinitialises particles once all images are loaded.
   */
  function loadParticleTextures(files) {
    particleTextures = [];
    if (!files || files.length === 0) {
      initParticles();
      return;
    }
    let loaded = 0;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          particleTextures.push(img);
          loaded++;
          if (loaded === files.length) {
            initParticles();
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  }

  /**
   * Load a background image from a file input.
   */
  function loadBackground(file) {
    if (!file) {
      backgroundTexture = null;
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        backgroundTexture = img;
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /**
   * Generate built‑in paths for circle, line and square shapes.
   */
  function generatePresetShape(name) {
    const cw = canvas.width;
    const ch = canvas.height;
    pathPoints = [];
    if (name === 'circle') {
      const radius = Math.min(cw, ch) * 0.3;
      const segments = 200;
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pathPoints.push({ x: cw / 2 + Math.cos(a) * radius, y: ch / 2 + Math.sin(a) * radius });
      }
    } else if (name === 'line') {
      const segments = 200;
      for (let i = 0; i <= segments; i++) {
        pathPoints.push({ x: (i / segments) * cw, y: ch / 2 });
      }
    } else if (name === 'square') {
      const size = Math.min(cw, ch) * 0.6;
      const half = size / 2;
      const cx = cw / 2;
      const cy = ch / 2;
      const pts = [
        { x: cx - half, y: cy - half },
        { x: cx + half, y: cy - half },
        { x: cx + half, y: cy + half },
        { x: cx - half, y: cy + half },
        { x: cx - half, y: cy - half }
      ];
      const segs = 100;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        for (let j = 0; j <= segs; j++) {
          const t = j / segs;
          pathPoints.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
        }
      }
    }
    if (pathPoints.length > 1) {
      computePathLengths();
    } else {
      totalPathLength = 0;
    }
  }

  /**
   * Main render and update loop.  Handles audio analysis, pointer
   * interactions, particle updates and rendering.
   */
  function animate() {
    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw background
    if (backgroundTexture) {
      ctx.drawImage(backgroundTexture, 0, 0, canvas.width, canvas.height);
    }
    // Update audio
    if (micEnabled && analyser) {
      analyser.getByteTimeDomainData(micData);
      let sum = 0;
      for (let i = 0; i < micData.length; i++) {
        sum += Math.abs(micData[i] - 128);
      }
      micAmplitude = (sum / micData.length) / 128;
      analyser.getByteFrequencyData(freqData);
    } else {
      micAmplitude = 0;
    }
    // Determine current interpolated colour
    const base = particleColour;
    const inv = invertedColour;
    const lerpColour = (a, b, t) => {
      const ar = parseInt(a.substr(1, 2), 16);
      const ag = parseInt(a.substr(3, 2), 16);
      const ab = parseInt(a.substr(5, 2), 16);
      const br = parseInt(b.substr(1, 2), 16);
      const bg = parseInt(b.substr(3, 2), 16);
      const bb = parseInt(b.substr(5, 2), 16);
      const r = Math.round(ar + (br - ar) * t);
      const g = Math.round(ag + (bg - ag) * t);
      const bcol = Math.round(ab + (bb - ab) * t);
      return '#' + ((1 << 24) + (r << 16) + (g << 8) + bcol).toString(16).slice(1);
    };
    const currentColour = lerpColour(base, inv, micAmplitude);
    // Update config from sliders
    CONFIG.particleBaseSize = parseFloat(sizeRange.value);
    CONFIG.glow = parseFloat(glowRange.value);
    CONFIG.pointerStrength = parseFloat(pointerRange.value);
    const speedMultiplier = parseFloat(speedRange.value) / 10;
    CONFIG.baseSpeed = speedMultiplier * (1 + micAmplitude);
    // Update and draw particles
    particles.forEach(p => {
      // update colour and size
      p.colour = currentColour;
      p.size = CONFIG.particleBaseSize + Math.random() * 2;
      if (pathPoints.length >= 2 && emitterShape === 'draw') {
        p.dist += CONFIG.baseSpeed;
        if (p.dist > totalPathLength) p.dist -= totalPathLength;
        const pos = getPointOnPath(p.dist);
        p.x = pos.x;
        p.y = pos.y;
      } else if (behaviour === 'spiral' || behaviour === 'galaxy') {
        p.angle += p.angularVelocity * CONFIG.baseSpeed;
        if (behaviour === 'galaxy') p.radius *= 0.9995;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        p.x = cx + Math.cos(p.angle) * p.radius;
        p.y = cy + Math.sin(p.angle) * p.radius;
        p.rotation = (p.rotation || 0) + 0.05 * CONFIG.baseSpeed;
      } else if (behaviour === 'bars') {
        const index = p.barIndex || 0;
        const val = freqData && freqData.length > index ? freqData[index] / 255 : 0;
        p.vy = - (0.5 + val * 5) * CONFIG.baseSpeed;
        p.vx = 0;
        p.y += p.vy;
        if (p.y < -20) {
          const barW = canvas.width / CONFIG.barCount;
          const newIndex = Math.floor(Math.random() * CONFIG.barCount);
          p.barIndex = newIndex;
          p.x = newIndex * barW + barW / 2;
          p.y = canvas.height + 10;
        }
      } else {
        p.x += p.vx * CONFIG.baseSpeed;
        p.y += p.vy * CONFIG.baseSpeed;
      }
      // Pointer wind
      if (pointerPos.active && CONFIG.pointerStrength > 0) {
        const dx = p.x - pointerPos.x;
        const dy = p.y - pointerPos.y;
        const distSq = dx * dx + dy * dy + 0.01;
        const dist = Math.sqrt(distSq);
        const force = CONFIG.pointerStrength / distSq;
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
      }
      // Respawn conditions for non-path/spiral/galaxy/bars
      if (behaviour !== 'bars' && behaviour !== 'spiral' && behaviour !== 'galaxy' && emitterShape !== 'draw') {
        if (p.x < -20 || p.x > canvas.width + 20 || p.y < -20 || p.y > canvas.height + 20) {
          spawnParticle(p);
        }
      }
      drawParticle(p);
    });
    // Draw bar visualiser overlay
    if (behaviour === 'bars' && freqData) {
      const barW = canvas.width / CONFIG.barCount;
      ctx.save();
      for (let i = 0; i < CONFIG.barCount; i++) {
        const val = freqData[i] / 255;
        const h = val * canvas.height * 0.5;
        ctx.fillStyle = currentColour;
        ctx.fillRect(i * barW, canvas.height - h, barW - 2, h);
      }
      ctx.restore();
    }
    requestAnimationFrame(animate);
  }

  /**
   * Initialise all event listeners.
   */
  function initListeners() {
    window.addEventListener('resize', () => {
      resizeCanvas();
      if (emitterShape !== 'draw') {
        generatePresetShape(emitterShape);
        initParticles();
      }
    });
    countInput.addEventListener('input', () => initParticles());
    shapeSelect.addEventListener('change', e => {
      emitterShape = e.target.value;
      if (emitterShape === 'draw') {
        clearPath();
      } else {
        generatePresetShape(emitterShape);
      }
      initParticles();
    });
    // Extend behaviour options to include left, right, spiral, galaxy
    behaviourSelect.addEventListener('change', e => {
      behaviour = e.target.value;
      initParticles();
    });
    colourPicker.addEventListener('input', e => {
      particleColour = e.target.value;
      invertedColour = invertHex(particleColour);
    });
    particleImagesInput.addEventListener('change', e => loadParticleTextures(e.target.files));
    backgroundImageInput.addEventListener('change', e => loadBackground(e.target.files[0]));
    clearPathButton.addEventListener('click', () => {
      clearPath();
      emitterShape = shapeSelect.value;
    });
    resetParticlesButton.addEventListener('click', () => initParticles());
    // Toggle drawing mode on click when Drawn Path is selected
    canvas.addEventListener('click', e => {
      if (shapeSelect.value === 'draw') {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (!drawingPath) {
          drawingPath = true;
          pathPoints.push({ x, y });
        } else {
          drawingPath = false;
          if (pathPoints.length > 1) {
            computePathLengths();
            initParticles();
          }
        }
      }
    });
    // Pointer move for wind and path drawing
    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      pointerPos.x = e.clientX - rect.left;
      pointerPos.y = e.clientY - rect.top;
      pointerPos.active = true;
      if (drawingPath) {
        const last = pathPoints[pathPoints.length - 1];
        if (!last || Math.hypot(pointerPos.x - last.x, pointerPos.y - last.y) > 2) {
          pathPoints.push({ x: pointerPos.x, y: pointerPos.y });
        }
      }
    });
    canvas.addEventListener('mouseleave', () => { pointerPos.active = false; });
    canvas.addEventListener('mouseenter', () => { pointerPos.active = true; });
    micCheckbox.addEventListener('change', e => {
      micEnabled = e.target.checked;
      if (micEnabled) {
        initAudio();
      }
    });
    embedButton.addEventListener('click', () => {
      const params = new URLSearchParams();
      params.set('count', countInput.value);
      params.set('shape', shapeSelect.value);
      params.set('behaviour', behaviourSelect.value);
      params.set('colour', particleColour.replace('#', ''));
      params.set('size', sizeRange.value);
      params.set('glow', glowRange.value);
      params.set('speed', speedRange.value);
      params.set('pointer', pointerRange.value);
      params.set('mic', micCheckbox.checked ? '1' : '0');
      const url = window.location.pathname.replace(/^\/.*\//, '') + '?' + params.toString();
      const embed = `<iframe src="${url}" width="800" height="600" frameborder="0"></iframe>`;
      window.prompt('Copia el siguiente embed para usar en otra página:', embed);
    });
  }

  /**
   * Apply settings passed in via URL parameters.  Supports the same
   * keys as the embed generator.
   */
  function applyQueryParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('count')) countInput.value = params.get('count');
    if (params.has('shape')) {
      shapeSelect.value = params.get('shape');
      emitterShape = params.get('shape');
      if (emitterShape !== 'draw') generatePresetShape(emitterShape);
    }
    if (params.has('behaviour')) {
      behaviourSelect.value = params.get('behaviour');
      behaviour = params.get('behaviour');
    }
    if (params.has('colour')) {
      const col = '#' + params.get('colour');
      colourPicker.value = col;
      particleColour = col;
      invertedColour = invertHex(col);
    }
    if (params.has('size')) sizeRange.value = params.get('size');
    if (params.has('glow')) glowRange.value = params.get('glow');
    if (params.has('speed')) speedRange.value = params.get('speed');
    if (params.has('pointer')) pointerRange.value = params.get('pointer');
    if (params.has('mic')) {
      micCheckbox.checked = params.get('mic') === '1';
      micEnabled = micCheckbox.checked;
      if (micEnabled) initAudio();
    }
    initParticles();
  }

  /**
   * Initialise audio capturing and analysis.  Creates an analyser node
   * and buffers for both time and frequency domain data.
   */
  function initAudio() {
    if (audioCtx) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      micData = new Uint8Array(analyser.fftSize);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser);
    }).catch(err => {
      console.error('Audio init error', err);
      micEnabled = false;
      micCheckbox.checked = false;
    });
  }

  /**
   * Start everything.  Resize canvas, apply URL parameters, generate
   * preset paths and initialise particles, then hook up listeners and
   * kick off the animation loop.
   */
  function init() {
    resizeCanvas();
    // ensure behaviour options include our added values
    if (!Array.from(behaviourSelect.options).some(opt => opt.value === 'left')) {
      const opts = [
        { value: 'left', text: 'From Left' },
        { value: 'right', text: 'From Right' },
        { value: 'spiral', text: 'Spiral' },
        { value: 'galaxy', text: 'Galaxy' }
      ];
      opts.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.text;
        behaviourSelect.appendChild(o);
      });
    }
    applyQueryParams();
    if (emitterShape !== 'draw') generatePresetShape(emitterShape);
    initParticles();
    initListeners();
    requestAnimationFrame(animate);
  }

  // Kick off when ready
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();