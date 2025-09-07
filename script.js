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

  // Additional UI elements
  const colourPicker2 = document.getElementById('colourPicker2');
  const colourPicker3 = document.getElementById('colourPicker3');
  const bgColorPicker = document.getElementById('bgColorPicker');
  const alphaRange = document.getElementById('alphaRange');
  const rotationRange = document.getElementById('rotationRange');
  const resolutionRange = document.getElementById('resolutionRange');
  const micSensitivityRange = document.getElementById('micSensitivityRange');
  const randomizeButton = document.getElementById('randomizeButton');
  const advancedToggle = document.getElementById('advancedToggle');
  const advancedPanel = document.getElementById('advancedPanel');
  const brandingOverlay = document.getElementById('brandingOverlay');
  const controlsDiv = document.getElementById('controls');
  // Base configuration inputs for overriding CONFIG values
  const maxParticlesInput = document.getElementById('maxParticlesInput');
  const baseSizeInput = document.getElementById('baseSizeInput');
  const baseGlowInput = document.getElementById('baseGlowInput');
  const baseSpeedInput = document.getElementById('baseSpeedInput');
  const pointerStrengthInput = document.getElementById('pointerStrengthInput');
  const barCountInput = document.getElementById('barCountInput');
  const applyConfigButton = document.getElementById('applyConfigButton');

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
  // Additional state
  let particleColours = [colourPicker.value, colourPicker2 ? colourPicker2.value : colourPicker.value, colourPicker3 ? colourPicker3.value : colourPicker.value];
  let backgroundColour = bgColorPicker ? bgColorPicker.value : '#000000';
  let particleAlpha = alphaRange ? alphaRange.value / 100 : 1;
  let rotationSpeed = rotationRange ? rotationRange.value / 100 : 0;
  let resolutionFactor = resolutionRange ? resolutionRange.value / 100 : 1;
  let micSensitivity = micSensitivityRange ? micSensitivityRange.value / 100 : 1;
  let controlsHidden = false;
  // Flag for embed mode (no controls)
  let embedMode = false;
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
    const dprBase = window.devicePixelRatio || 1;
    const dpr = dprBase * resolutionFactor;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
        // assign a base colour randomly from available colours
        baseColour: particleColours[Math.floor(Math.random() * particleColours.length)],
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
    ctx.save();
    // global alpha for transparency
    ctx.globalAlpha = particleAlpha;
    // set shadow (glow) per particle
    ctx.shadowColor = p.colour;
    ctx.shadowBlur = CONFIG.glow;
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
    // Clear and draw background colour or texture
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (backgroundTexture) {
      ctx.drawImage(backgroundTexture, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = backgroundColour;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
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
    // Lerp between base colour and its inverse based on microphone amplitude and sensitivity
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
    // Amplify microphone effect: multiply and clamp to [0,1].  Increase factor to 5
    // to make mic influence more noticeable on colour, speed and size.
    let micAmp = micAmplitude * micSensitivity * 5;
    if (micAmp > 1) micAmp = 1;
    // Update config from sliders
    CONFIG.particleBaseSize = parseFloat(sizeRange.value);
    CONFIG.glow = parseFloat(glowRange.value);
    CONFIG.pointerStrength = parseFloat(pointerRange.value);
    const speedMultiplier = parseFloat(speedRange.value) / 10;
    // baseSpeed increases with mic amplitude
    CONFIG.baseSpeed = speedMultiplier * (1 + micAmp);
    // Update and draw particles
    particles.forEach(p => {
      // update colour and size based on mic amplitude
      const invCol = invertHex(p.baseColour);
      p.colour = lerpColour(p.baseColour, invCol, micAmp);
      // base size plus mic influence
      p.size = CONFIG.particleBaseSize + Math.random() * 2 + micAmp * CONFIG.particleBaseSize;
      // update rotation for textures
      if (rotationSpeed > 0) {
        p.rotation = (p.rotation || 0) + rotationSpeed * CONFIG.baseSpeed;
      }
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
      // ensure full opacity for bars
      ctx.globalAlpha = 1;
      for (let i = 0; i < CONFIG.barCount; i++) {
        const val = freqData[i] / 255;
        const h = val * canvas.height * 0.5;
        // colour per bar based on first base colour
        const barCol = lerpColour(particleColours[0], invertHex(particleColours[0]), val);
        ctx.fillStyle = barCol;
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
      // encode multiple colours joined by commas
      const cols = particleColours.map(c => c.replace('#', '')).join(',');
      params.set('colours', cols);
      params.set('size', sizeRange.value);
      params.set('glow', glowRange.value);
      params.set('speed', speedRange.value);
      params.set('pointer', pointerRange.value);
      params.set('mic', micCheckbox.checked ? '1' : '0');
      params.set('alpha', alphaRange ? alphaRange.value : '100');
      params.set('rotation', rotationRange ? rotationRange.value : '0');
      params.set('resolution', resolutionRange ? resolutionRange.value : '100');
      params.set('micsens', micSensitivityRange ? micSensitivityRange.value : '50');
      params.set('bg', bgColorPicker ? bgColorPicker.value.replace('#', '') : '000000');
      params.set('embed', '1');
      // Include uploaded particle textures and background in the embed.  We avoid
      // calling encodeURIComponent here so that URLSearchParams will perform
      // the correct encoding once when building the query string.  Each
      // texture is stored as a data: URL generated from the FileReader.
      if (particleTextures && particleTextures.length > 0) {
        const imgs = particleTextures.map(img => img.src);
        // join with semicolon so we can split later; URLSearchParams will
        // escape semicolons appropriately.
        params.set('imgs', imgs.join(';'));
      }
      if (backgroundTexture) {
        params.set('bgimg', backgroundTexture.src);
      }
      const base = window.location.origin + window.location.pathname;
      const url = `${base}?${params.toString()}`;
      // For the embed we want the iframe to fill its container rather than
      // using a fixed pixel size.  Width and height are set to 100% so
      // that the embed adapts to the size of the parent element (iframe
      // or browser window).  This mirrors the behaviour of the old
      // Eternal Flame visualiser which scaled to its frame.
      const embed = `<iframe src="${url}" width="100%" height="100%" style="border:0; display:block;" allowfullscreen></iframe>`;
      window.prompt('Copia el siguiente embed para usar en otra página:', embed);
    });

    // Additional listeners for advanced controls
    if (colourPicker2) {
      colourPicker2.addEventListener('input', () => {
        particleColours[1] = colourPicker2.value;
        initParticles();
      });
    }
    if (colourPicker3) {
      colourPicker3.addEventListener('input', () => {
        particleColours[2] = colourPicker3.value;
        initParticles();
      });
    }
    if (bgColorPicker) {
      bgColorPicker.addEventListener('input', () => {
        backgroundColour = bgColorPicker.value;
        document.body.style.backgroundColor = backgroundColour;
      });
    }
    if (alphaRange) {
      alphaRange.addEventListener('input', () => {
        particleAlpha = parseFloat(alphaRange.value) / 100;
      });
    }
    if (rotationRange) {
      rotationRange.addEventListener('input', () => {
        rotationSpeed = parseFloat(rotationRange.value) / 100;
      });
    }
    if (resolutionRange) {
      resolutionRange.addEventListener('input', () => {
        resolutionFactor = parseFloat(resolutionRange.value) / 100;
        resizeCanvas();
        // reposition path and particles
        if (emitterShape !== 'draw') generatePresetShape(emitterShape);
        initParticles();
      });
    }
    if (micSensitivityRange) {
      micSensitivityRange.addEventListener('input', () => {
        micSensitivity = parseFloat(micSensitivityRange.value) / 100;
      });
    }
    if (randomizeButton) {
      randomizeButton.addEventListener('click', () => {
        randomizeSettings();
      });
    }
    if (advancedToggle) {
      advancedToggle.addEventListener('click', () => {
        if (advancedPanel.style.display === 'none' || advancedPanel.style.display === '') {
          advancedPanel.style.display = 'block';
        } else {
          advancedPanel.style.display = 'none';
        }
      });
    }
    // Apply base configuration values from number inputs
    if (applyConfigButton) {
      applyConfigButton.addEventListener('click', () => {
        // Update CONFIG values from inputs if provided
        if (maxParticlesInput) {
          const val = parseInt(maxParticlesInput.value);
          if (!isNaN(val) && val > 0) {
            CONFIG.maxParticles = val;
            // update UI max for particle count and clamp current value
            if (countInput && countInput.max) {
              countInput.max = val;
              const current = parseInt(countInput.value);
              if (current > val) countInput.value = val;
            }
          }
        }
        if (baseSizeInput) {
          const val = parseFloat(baseSizeInput.value);
          if (!isNaN(val) && val > 0) CONFIG.particleBaseSize = val;
        }
        if (baseGlowInput) {
          const val = parseFloat(baseGlowInput.value);
          if (!isNaN(val) && val >= 0) CONFIG.glow = val;
        }
        if (baseSpeedInput) {
          const val = parseFloat(baseSpeedInput.value);
          if (!isNaN(val) && val >= 0) CONFIG.baseSpeed = val;
        }
        if (pointerStrengthInput) {
          const val = parseFloat(pointerStrengthInput.value);
          if (!isNaN(val) && val >= 0) CONFIG.pointerStrength = val;
        }
        if (barCountInput) {
          const val = parseInt(barCountInput.value);
          if (!isNaN(val) && val > 0) CONFIG.barCount = val;
        }
        // Recreate particles to reflect configuration changes
        initParticles();
      });
    }
    // Keyboard shortcut to hide/show controls
    window.addEventListener('keydown', e => {
      // Toggle controls only if not in embed mode
      if (!embedMode && (e.key === 'h' || e.key === 'H')) {
        controlsHidden = !controlsHidden;
        if (controlsHidden) {
          controlsDiv.classList.add('hidden');
        } else {
          controlsDiv.classList.remove('hidden');
        }
      }
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
    // Support multiple colours encoded by comma separated hex strings
    if (params.has('colours')) {
      const cols = params.get('colours').split(',');
      if (cols.length >= 1) colourPicker.value = '#' + cols[0];
      if (colourPicker2 && cols.length >= 2) colourPicker2.value = '#' + cols[1];
      if (colourPicker3 && cols.length >= 3) colourPicker3.value = '#' + cols[2];
      particleColours = cols.map(c => '#' + c);
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
    if (params.has('alpha') && alphaRange) {
      alphaRange.value = params.get('alpha');
      particleAlpha = parseFloat(alphaRange.value) / 100;
    }
    if (params.has('rotation') && rotationRange) {
      rotationRange.value = params.get('rotation');
      rotationSpeed = parseFloat(rotationRange.value) / 100;
    }
    if (params.has('resolution') && resolutionRange) {
      resolutionRange.value = params.get('resolution');
      resolutionFactor = parseFloat(resolutionRange.value) / 100;
    }
    if (params.has('micsens') && micSensitivityRange) {
      micSensitivityRange.value = params.get('micsens');
      micSensitivity = parseFloat(micSensitivityRange.value) / 100;
    }
    if (params.has('bg') && bgColorPicker) {
      const bgCol = '#' + params.get('bg');
      bgColorPicker.value = bgCol;
      backgroundColour = bgCol;
      document.body.style.backgroundColor = bgCol;
    }
    // Load particle textures passed via embed (semicolon‑separated list of data URLs)
    if (params.has('imgs')) {
      // URLSearchParams automatically decodes percent encoding, so we
      // can split the value directly on semicolons.  Each entry is a
      // data URL.  When loaded they will populate particleTextures.
      const list = params.get('imgs').split(';');
      particleTextures = [];
      let loadedCount = 0;
      list.forEach(url => {
        if (!url) return;
        const img = new Image();
        img.onload = () => {
          particleTextures.push(img);
          loadedCount++;
          if (loadedCount === list.length) {
            // once all textures are loaded, reinitialise particles
            initParticles();
          }
        };
        img.src = url;
      });
    }
    // Load background image passed via embed
    if (params.has('bgimg')) {
      // Similar to imgs above, the value is already decoded.
      const url = params.get('bgimg');
      const img = new Image();
      img.onload = () => {
        backgroundTexture = img;
      };
      img.src = url;
    }
    if (params.has('embed')) {
      // Hide controls for embed mode
      controlsHidden = true;
      controlsDiv.classList.add('hidden');
      // Hide advanced panel
      if (advancedPanel) advancedPanel.style.display = 'none';
      // Mark embed mode so controls cannot be toggled back
      embedMode = true;
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
   * Randomly choose settings for a unique visual.  All UI inputs are
   * assigned random values within their ranges and then particles are
   * reinitialised.  Colours are randomised across all three pickers,
   * behaviours and shapes selected randomly, and optional features
   * toggled.
   */
  function randomizeSettings() {
    // Particle count
    countInput.value = Math.floor(Math.random() * CONFIG.maxParticles) + 1;
    // Shape
    const shapes = Array.from(shapeSelect.options).map(o => o.value);
    shapeSelect.value = shapes[Math.floor(Math.random() * shapes.length)];
    emitterShape = shapeSelect.value;
    // Behaviour
    const behaviours = Array.from(behaviourSelect.options).map(o => o.value);
    behaviourSelect.value = behaviours[Math.floor(Math.random() * behaviours.length)];
    behaviour = behaviourSelect.value;
    // Colours (generate random hex colours)
    const randHex = () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    colourPicker.value = randHex();
    if (colourPicker2) colourPicker2.value = randHex();
    if (colourPicker3) colourPicker3.value = randHex();
    particleColours = [colourPicker.value, colourPicker2 ? colourPicker2.value : colourPicker.value, colourPicker3 ? colourPicker3.value : colourPicker.value];
    particleColour = colourPicker.value;
    invertedColour = invertHex(particleColour);
    // Sliders
    sizeRange.value = Math.floor(Math.random() * (parseInt(sizeRange.max) - parseInt(sizeRange.min) + 1)) + parseInt(sizeRange.min);
    glowRange.value = Math.floor(Math.random() * (parseInt(glowRange.max) - parseInt(glowRange.min) + 1)) + parseInt(glowRange.min);
    speedRange.value = Math.floor(Math.random() * (parseInt(speedRange.max) - parseInt(speedRange.min) + 1)) + parseInt(speedRange.min);
    pointerRange.value = Math.floor(Math.random() * (parseInt(pointerRange.max) - parseInt(pointerRange.min) + 1)) + parseInt(pointerRange.min);
    // Mic
    micCheckbox.checked = Math.random() < 0.5;
    micEnabled = micCheckbox.checked;
    if (micEnabled) initAudio();
    // Advanced controls
    if (alphaRange) alphaRange.value = Math.floor(Math.random() * 101);
    if (rotationRange) rotationRange.value = Math.floor(Math.random() * 21);
    if (resolutionRange) resolutionRange.value = Math.floor(Math.random() * 151) + 50;
    if (micSensitivityRange) micSensitivityRange.value = Math.floor(Math.random() * 101);
    particleAlpha = alphaRange ? alphaRange.value / 100 : 1;
    rotationSpeed = rotationRange ? rotationRange.value / 100 : 0;
    resolutionFactor = resolutionRange ? resolutionRange.value / 100 : 1;
    micSensitivity = micSensitivityRange ? micSensitivityRange.value / 100 : 1;
    // Background colour
    if (bgColorPicker) {
      bgColorPicker.value = randHex();
      backgroundColour = bgColorPicker.value;
      document.body.style.backgroundColor = backgroundColour;
    }
    // Regenerate preset shapes
    if (emitterShape !== 'draw') generatePresetShape(emitterShape);
    initParticles();
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