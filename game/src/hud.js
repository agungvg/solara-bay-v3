// Solara Bay — hud.js (v3 rewrite)
// Self-contained HUD: builds its own DOM, injects its own stylesheet, and
// paints a 2D canvas minimap. All element ids are prefixed "sb-".
// The game loop only ever touches the returned methods — setHealth,
// setMoney, setWanted, setObjective, setMinimap, showBanner, the
// start/pause overlays — so nothing else in the game needs to know how
// the HUD is laid out.

export function createHUD() {
  const MAP_WORLD = 110;   // half-extent of the world shown on the minimap
  const MAP_PX = 180;      // minimap canvas size in pixels
  const MAP_C = MAP_PX / 2;
  const STAR_COUNT = 5;    // wanted level runs 0..5

  // ---------------------------------------------------------- stylesheet
  const css = `
#sb-hud { position: fixed; inset: 0; pointer-events: none; z-index: 40;
  font-family: Arial, Helvetica, sans-serif; color: #fff; }
#sb-hud .sb-corner { position: absolute; top: 14px; left: 14px;
  display: flex; flex-direction: column; gap: 8px; }
#sb-health-shell { width: 220px; height: 18px; background: rgba(0,0,0,0.55);
  border: 1px solid rgba(255,255,255,0.35); border-radius: 9px; overflow: hidden; }
#sb-health-fill { height: 100%; width: 100%;
  background: linear-gradient(90deg,#2fbf71,#7ee787); transition: width 0.2s ease; }
#sb-health-caption { font-size: 12px; letter-spacing: 1px; text-shadow: 0 1px 2px #000; }
#sb-cash { font-size: 20px; font-weight: bold; color: #7ee787;
  text-shadow: 0 1px 3px #000; }
#sb-stars { position: absolute; top: 14px; right: 16px; font-size: 26px;
  letter-spacing: 4px; text-shadow: 0 2px 4px #000; }
#sb-stars .sb-star { color: rgba(255,255,255,0.25); }
#sb-stars .sb-star.on { color: #ffd60a; }
#sb-task { position: absolute; bottom: 118px; left: 50%; transform: translateX(-50%);
  max-width: 70vw; text-align: center; font-size: 15px; padding: 8px 16px;
  background: rgba(0,0,0,0.55); border-radius: 8px; text-shadow: 0 1px 2px #000; }
#sb-keys { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
  font-size: 12px; color: rgba(255,255,255,0.75); text-shadow: 0 1px 2px #000;
  background: rgba(0,0,0,0.4); padding: 6px 12px; border-radius: 6px; white-space: nowrap; }
#sb-map-box { position: absolute; bottom: 14px; left: 14px; }
#sb-minimap { display: block; border: 2px solid rgba(255,255,255,0.4);
  border-radius: 50%; background: #0d2733; box-shadow: 0 2px 10px rgba(0,0,0,0.6); }
#sb-banner { position: absolute; top: 26%; left: 50%; transform: translateX(-50%);
  text-align: center; opacity: 0; transition: opacity 0.4s ease; }
#sb-banner.on { opacity: 1; }
#sb-banner-head { font-size: 42px; font-weight: bold; letter-spacing: 6px;
  text-shadow: 0 3px 10px #000; }
#sb-banner-body { font-size: 16px; margin-top: 6px; text-shadow: 0 2px 6px #000; }
.sb-screen { position: fixed; inset: 0; z-index: 60; display: flex;
  flex-direction: column; align-items: center; justify-content: center;
  background: linear-gradient(160deg, rgba(8,30,45,0.92), rgba(20,8,32,0.92));
  color: #fff; font-family: Arial, Helvetica, sans-serif; text-align: center; }
.sb-screen h1 { font-size: 56px; letter-spacing: 10px; margin: 0 0 8px; }
.sb-screen p { font-size: 17px; opacity: 0.85; margin: 6px 0 22px; max-width: 520px; }
.sb-screen button { pointer-events: auto; font-size: 20px; font-weight: bold;
  padding: 14px 44px; border: none; border-radius: 10px; cursor: pointer;
  background: #f76b15; color: #fff; box-shadow: 0 4px 18px rgba(0,0,0,0.5); }
.sb-screen button:hover { background: #ff8a3d; }
.sb-kicker { font-size: 13px; letter-spacing: 4px; color: #ffd60a; }
#sb-pause { display: none; }
#sb-pause.open { display: flex; }
`;
  const styleTag = document.createElement('style');
  styleTag.id = 'sb-style';
  styleTag.textContent = css;
  document.head.appendChild(styleTag);

  // ---------------------------------------------------------- DOM helpers
  // Small builder: mk('div', { id, className }, 'inner html') — keeps the
  // tree readable without one giant innerHTML string.
  function mk(tag, attrs, html) {
    const el = document.createElement(tag);
    if (attrs) {
      if (attrs.id) el.id = attrs.id;
      if (attrs.className) el.className = attrs.className;
      if (attrs.style) el.setAttribute('style', attrs.style);
      if (attrs.type) el.type = attrs.type;
    }
    if (html !== undefined && html !== null) el.innerHTML = html;
    return el;
  }

  function starRow() {
    let out = '';
    for (let i = 1; i <= STAR_COUNT; i++) {
      out += '<span class="sb-star" data-star="' + i + '">&#9733;</span>';
    }
    return out;
  }

  // ---------------------------------------------------------- HUD tree
  const root = mk('div', { id: 'sb-hud' });
  const corner = mk('div', { className: 'sb-corner' });
  corner.appendChild(mk('div', { id: 'sb-health-shell' }, '<div id="sb-health-fill"></div>'));
  corner.appendChild(mk('div', { id: 'sb-health-caption' }, 'HEALTH'));
  corner.appendChild(mk('div', { id: 'sb-cash' }, '$0'));
  root.appendChild(corner);

  root.appendChild(mk('div', { id: 'sb-stars' }, starRow()));

  const mapBox = mk('div', { id: 'sb-map-box' });
  const mapCanvas = mk('canvas', { id: 'sb-minimap' });
  mapCanvas.width = MAP_PX;
  mapCanvas.height = MAP_PX;
  mapBox.appendChild(mapCanvas);
  root.appendChild(mapBox);

  root.appendChild(mk('div', { id: 'sb-task' }, 'Press M to start the story'));
  root.appendChild(mk('div', { id: 'sb-banner' },
    '<div id="sb-banner-head"></div><div id="sb-banner-body"></div>'));
  root.appendChild(mk('div', { id: 'sb-keys' },
    'WASD move &nbsp;·&nbsp; Shift run &nbsp;·&nbsp; E enter / exit car &nbsp;·&nbsp; F shoot &nbsp;·&nbsp; M mission &nbsp;·&nbsp; Esc pause'));
  document.body.appendChild(root);

  // ---------------------------------------------------------- overlays
  const startScreen = mk('div', { id: 'sb-start', className: 'sb-screen' });
  startScreen.appendChild(mk('div', { className: 'sb-kicker' }, 'A SOLARA BAY STORY'));
  startScreen.appendChild(mk('h1', null, 'SOLARA BAY'));
  startScreen.appendChild(mk('p', null,
    'Take on the Vipers, outrun the patrols, and own the bay — ' +
    'six missions from your first stolen wheels to the sunset chase.'));
  const playBtn = mk('button', { id: 'sb-play-btn', type: 'button' }, 'PLAY');
  startScreen.appendChild(playBtn);
  startScreen.appendChild(mk('p', { id: 'sb-continue-note', style: 'font-size:13px;opacity:0.7' }));
  document.body.appendChild(startScreen);

  const pauseScreen = mk('div', { id: 'sb-pause', className: 'sb-screen' });
  pauseScreen.appendChild(mk('h1', { style: 'font-size:40px' }, 'PAUSED'));
  pauseScreen.appendChild(mk('p', null, 'Take a breath. The Vipers will wait.'));
  const resumeBtn = mk('button', { id: 'sb-resume-btn', type: 'button' }, 'RESUME');
  pauseScreen.appendChild(resumeBtn);
  document.body.appendChild(pauseScreen);

  // ---------------------------------------------------------- element refs
  const $ = (id) => document.getElementById(id);
  const healthFill = $('sb-health-fill');
  const cashEl = $('sb-cash');
  const starsEl = $('sb-stars');
  const taskEl = $('sb-task');
  const bannerEl = $('sb-banner');
  const bannerHead = $('sb-banner-head');
  const bannerBody = $('sb-banner-body');
  let mapCtx = null;
  try {
    mapCtx = mapCanvas ? mapCanvas.getContext('2d') : null;
  } catch (err) {
    mapCtx = null; // canvas unsupported — the HUD still works without a map
  }

  let bannerClock = null;
  let targetMark = null; // {x, z} — drawn as a yellow diamond
  let pausedFlag = false;
  let resumeCb = null;

  // Street grid drawn under the dots (world-space segments).
  let streets = [
    { x1: -100, z1: 0, x2: 100, z2: 0 },
    { x1: 0, z1: -100, x2: 0, z2: 100 },
    { x1: -60, z1: -100, x2: -60, z2: 100 },
    { x1: 60, z1: -100, x2: 60, z2: 100 },
    { x1: -100, z1: -50, x2: 100, z2: -50 },
    { x1: -100, z1: 50, x2: 100, z2: 50 },
  ];

  // ---------------------------------------------------------- value setters
  function clampUnit(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  function healthColor(pct) {
    if (pct > 50) return 'linear-gradient(90deg,#2fbf71,#7ee787)';
    if (pct > 25) return 'linear-gradient(90deg,#e5484d,#f76b15)';
    return 'linear-gradient(90deg,#b91c1c,#e5484d)';
  }

  function setHealth(v) {
    if (!healthFill) return;
    // Accept 0..1 or 0..100 — the game passes 0..100.
    const pct = clampUnit(v > 1 ? v / 100 : v) * 100;
    healthFill.style.width = pct.toFixed(1) + '%';
    healthFill.style.background = healthColor(pct);
  }

  function setMoney(v) {
    if (!cashEl) return;
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
    cashEl.textContent = '$' + n.toLocaleString('en-US');
  }

  function setWanted(n) {
    if (!starsEl) return;
    const level = typeof n === 'number' ? Math.max(0, Math.min(STAR_COUNT, Math.floor(n))) : 0;
    const stars = starsEl.querySelectorAll('.sb-star');
    stars.forEach((star, i) => star.classList.toggle('on', i < level));
  }

  function setObjective(text) {
    if (!taskEl) return;
    taskEl.textContent = typeof text === 'string' && text ? text : '';
  }

  function showBanner(title, sub) {
    if (!bannerEl || !bannerHead) return;
    bannerHead.textContent = title || '';
    if (bannerBody) bannerBody.textContent = sub || '';
    bannerEl.classList.add('on');
    if (bannerClock) clearTimeout(bannerClock);
    bannerClock = setTimeout(() => {
      bannerEl.classList.remove('on');
      bannerClock = null;
    }, 3200);
  }

  // ---------------------------------------------------------- minimap
  function toMap(x, z) {
    const s = MAP_PX / (MAP_WORLD * 2);
    return { x: MAP_C + x * s, y: MAP_C + z * s };
  }

  function plot(x, z, r, color) {
    if (!mapCtx) return;
    const p = toMap(x, z);
    mapCtx.beginPath();
    mapCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
    mapCtx.fillStyle = color;
    mapCtx.fill();
  }

  // Normalise the many shapes a position can arrive in: a Vector3, a
  // plain {x,z}, or an object with a .position on it.
  function readPos(p) {
    if (!p) return null;
    if (typeof p.x === 'number' && typeof p.z === 'number') return p;
    if (p.position && typeof p.position.x === 'number') return p.position;
    return null;
  }

  function paintGround() {
    mapCtx.fillStyle = '#274b5f';
    mapCtx.fillRect(0, 0, MAP_PX, MAP_PX);
    // Sand strip along the bottom edge — the beach.
    mapCtx.fillStyle = '#c9a86a';
    mapCtx.fillRect(0, MAP_PX - 22, MAP_PX, 22);
    // Compass mark.
    mapCtx.fillStyle = 'rgba(255,255,255,0.75)';
    mapCtx.font = 'bold 11px Arial, sans-serif';
    mapCtx.textAlign = 'center';
    mapCtx.fillText('N', MAP_C, 12);
  }

  function paintStreets() {
    mapCtx.strokeStyle = 'rgba(220,220,220,0.55)';
    mapCtx.lineWidth = 3;
    for (const s of streets) {
      const a = toMap(s.x1, s.z1);
      const b = toMap(s.x2, s.z2);
      mapCtx.beginPath();
      mapCtx.moveTo(a.x, a.y);
      mapCtx.lineTo(b.x, b.y);
      mapCtx.stroke();
    }
  }

  function paintTarget() {
    if (!targetMark) return;
    const p = toMap(targetMark.x, targetMark.z);
    mapCtx.fillStyle = '#ffd60a';
    mapCtx.beginPath();
    mapCtx.moveTo(p.x, p.y - 7);
    mapCtx.lineTo(p.x + 6, p.y);
    mapCtx.lineTo(p.x, p.y + 7);
    mapCtx.lineTo(p.x - 6, p.y);
    mapCtx.closePath();
    mapCtx.fill();
  }

  function paintDots(list, radius, colorOf) {
    (list || []).forEach((item) => {
      const p = readPos(item);
      if (!p) return;
      plot(p.x, p.z, radius, typeof colorOf === 'function' ? colorOf(item) : colorOf);
    });
  }

  function paintPlayer(playerPos) {
    const p = readPos(playerPos);
    if (!p) return;
    const q = toMap(p.x, p.z);
    mapCtx.beginPath();
    mapCtx.arc(q.x, q.y, 5, 0, Math.PI * 2);
    mapCtx.fillStyle = '#ffffff';
    mapCtx.fill();
    mapCtx.strokeStyle = '#111827';
    mapCtx.lineWidth = 1.5;
    mapCtx.stroke();
  }

  function setMinimap(playerPos, npcs, cars, cops) {
    if (!mapCtx) return;
    mapCtx.clearRect(0, 0, MAP_PX, MAP_PX);
    paintGround();
    paintStreets();
    paintTarget();
    paintDots(npcs, 2, '#9aa5b1');
    paintDots(cars, 3, (c) => (c && typeof c.color === 'string') ? c.color
      : (c && typeof c.colour === 'string') ? c.colour : '#f76b15');
    paintDots(cops, 3, '#3b82f6');
    paintPlayer(playerPos); // player last, on top
  }

  function setMissionTarget(pos) {
    targetMark = readPos(pos);
  }

  function setMinimapRoads(list) {
    if (Array.isArray(list)) streets = list;
  }

  // ---------------------------------------------------------- start / pause
  function showStart(onStart) {
    if (!startScreen) return;
    startScreen.style.display = 'flex';
    if (playBtn) {
      playBtn.onclick = () => {
        hideStart();
        if (typeof onStart === 'function') onStart();
      };
    }
  }

  function hideStart() {
    if (startScreen) startScreen.style.display = 'none';
  }

  function showPause(onResumeFn) {
    if (typeof onResumeFn === 'function') resumeCb = onResumeFn;
    pausedFlag = true;
    if (pauseScreen) pauseScreen.classList.add('open');
  }

  function hidePause() {
    pausedFlag = false;
    if (pauseScreen) pauseScreen.classList.remove('open');
    if (typeof resumeCb === 'function') {
      const fn = resumeCb;
      resumeCb = null;
      fn();
    }
  }

  if (resumeBtn) {
    resumeBtn.onclick = () => hidePause();
  }

  function setContinueNote(text) {
    const note = $('sb-continue-note');
    if (note) note.textContent = text || '';
  }

  function update(dt) {
    // No per-frame HUD state yet (the banner runs on a timeout). Kept so
    // the game loop can call hud.update(dt) without a guard.
    void dt;
  }

  return {
    setHealth,
    setMoney,
    setWanted,
    setObjective,
    setMinimap,
    showBanner,
    showStart,
    hideStart,
    update,
    // Extras for the integrator (not required by the spec):
    showPause,
    hidePause,
    setMissionTarget,
    setMinimapRoads,
    setContinueNote,
    get isPaused() { return pausedFlag; },
  };
}
