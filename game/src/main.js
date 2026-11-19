// Solara Bay — boot, game loop, input, camera, driving, wanted, save.
// Wires the modules in src/ together: city, effects, characters, combat,
// vehicles, traffic, police, missions, hud, save, audio.

import * as THREE from 'three';
import { buildCity } from './city.js';
import { createEffects } from './effects.js';
import { createCharacters } from './characters.js';
import { createCombat } from './combat.js';
import { buildCarMesh, createParked } from './vehicles.js';
import { createTraffic } from './traffic.js';
import { createPolice } from './police.js';
import { createMissions } from './missions.js';
import { createHUD } from './hud.js';
import { createSave } from './save.js';
import { createAudio } from './audio.js';

const mount = document.getElementById('game-container');
const loadingEl = document.getElementById('sb-loading');

// ---------------------------------------------------------------- boot
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
mount.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);

const effects = createEffects(renderer, scene, camera);
const city = buildCity(scene);
const characters = createCharacters(scene);
const combat = createCombat(scene, characters);
const parked = createParked(scene, city);
const traffic = createTraffic(scene, city);
const police = createPolice(scene, city);
const hud = createHUD();
const save = createSave();
const audio = createAudio();

// ---------------------------------------------------------------- state
const game = {
  running: false,
  paused: false,
  money: 250,
  wanted: 0,
  health: 100,
  missionIndex: 0,
  inCar: null, // the driven car { group, speed, heading } or null
  carSpeed: 0,
  carHeading: 0,
  camYaw: 0,
  camPitch: 0.32,
  camOverride: null, // { pos, lookAt } — set by the capture script for a close-up
  time: 0,
  lastSave: 0,
  wantedTimer: 0,
  shotsFired: 0,
};

const hero = characters.hero;
hero.group.position.copy(city.playerSpawn);
hero.pos.copy(city.playerSpawn);

// Restore a previous save, if one exists.
const prior = save.load();
if (prior) {
  game.money = prior.money ?? game.money;
  game.missionIndex = prior.missionIndex ?? 0;
  game.health = prior.health ?? 100;
  if (prior.playerPos) hero.group.position.set(prior.playerPos.x, 0, prior.playerPos.z);
  hero.pos.copy(hero.group.position);
}

const missions = createMissions({
  scene,
  characters,
  combat,
  police,
  hud,
  audio,
  getPlayerPos: () => hero.pos,
  getPlayerInCar: () => !!game.inCar,
  onMoney: (amount) => { game.money += amount; hud.setMoney(game.money); },
  getMoney: () => game.money,
});

// ---------------------------------------------------------------- input
const held = Object.create(null);
let dragging = false;
let dragX = 0;
let dragY = 0;

window.addEventListener('keydown', (e) => {
  held[e.key.toLowerCase()] = true;
  if (e.key === 'Escape') flipPause();
  if (e.key.toLowerCase() === 'e' && game.running && !game.paused) flipCar();
  if (e.key.toLowerCase() === 'f' && game.running && !game.paused && !game.inCar) firePistol();
  if (e.key.toLowerCase() === 'm' && game.running && !game.paused) missions.start(game.missionIndex);
});
window.addEventListener('keyup', (e) => { held[e.key.toLowerCase()] = false; });
renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; dragX = e.clientX; dragY = e.clientY; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  game.camYaw -= (e.clientX - dragX) * 0.004;
  game.camPitch = THREE.MathUtils.clamp(game.camPitch + (e.clientY - dragY) * 0.003, 0.08, 0.9);
  dragX = e.clientX;
  dragY = e.clientY;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- actions
function closestParked(maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of parked.cars) {
    const d = car.group.position.distanceTo(hero.pos);
    if (d < bestD) { best = car; bestD = d; }
  }
  return best;
}

function flipCar() {
  if (game.inCar) {
    // Step out: place the hero beside the car and hand it back to the street.
    const out = game.inCar.group.position.clone();
    out.x += Math.cos(game.carHeading) * 2.2;
    out.z -= Math.sin(game.carHeading) * 2.2;
    out.y = 0;
    hero.group.position.copy(out);
    hero.pos.copy(out);
    hero.group.visible = true;
    game.inCar = null;
    game.carSpeed = 0;
    audio.engine(false);
    hud.showBanner('On foot', 'Car parked — find your next ride');
    return;
  }
  const car = closestParked(5);
  if (!car) return;
  game.inCar = car;
  game.carHeading = car.group.rotation.y;
  game.carSpeed = 0;
  hero.group.visible = false;
  audio.engine(true);
  addWanted(1);
  hud.showBanner('Car stolen', 'The police noticed — drive!');
}

function firePistol() {
  const origin = hero.pos.clone();
  origin.y += 1.45;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  combat.shoot(origin, dir, true);
  audio.gunshot();
  game.shotsFired += 1;
  addWanted(1);
}

function addWanted(n) {
  game.wanted = THREE.MathUtils.clamp(game.wanted + n, 0, 5);
  police.setWanted(game.wanted);
  hud.setWanted(game.wanted);
  if (game.wanted >= 1) audio.siren(true);
}

function flipPause() {
  if (!game.running) return;
  game.paused = !game.paused;
  if (game.paused) {
    hud.showPause(() => {
      game.paused = false;
      hud.hidePause();
    });
  } else {
    hud.hidePause();
  }
}

function writeSave() {
  save.save({
    money: game.money,
    missionIndex: game.missionIndex,
    playerPos: { x: hero.pos.x, y: hero.pos.y, z: hero.pos.z },
    wanted: game.wanted,
    health: game.health,
  });
}

// ---------------------------------------------------------------- movement
const vMove = new THREE.Vector3();
const vFwd = new THREE.Vector3();
const vRight = new THREE.Vector3();

function walkHero(dt) {
  const run = held['shift'] ? 1.7 : 1;
  const speed = 6 * run;
  vFwd.set(-Math.sin(game.camYaw), 0, -Math.cos(game.camYaw));
  vRight.set(Math.cos(game.camYaw), 0, -Math.sin(game.camYaw));
  vMove.set(0, 0, 0);
  if (held['w']) vMove.add(vFwd);
  if (held['s']) vMove.sub(vFwd);
  if (held['d']) vMove.add(vRight);
  if (held['a']) vMove.sub(vRight);
  const moving = vMove.lengthSq() > 0;
  hero.moving = moving;
  if (!moving) return;
  vMove.normalize().multiplyScalar(speed * dt);
  hero.pos.add(vMove);
  hero.group.position.copy(hero.pos);
  hero.group.rotation.y = Math.atan2(vMove.x, vMove.z);
  pushOutOfBuildings(hero.pos, 0.6);
  hero.group.position.copy(hero.pos);
}

function drive(dt) {
  const car = game.inCar;
  if (!car) return;
  const accel = held['w'] ? 14 : held['s'] ? -10 : 0;
  game.carSpeed = THREE.MathUtils.clamp(game.carSpeed + accel * dt, -8, 26);
  if (!held['w'] && !held['s']) game.carSpeed *= Math.max(0, 1 - 1.4 * dt);
  if (Math.abs(game.carSpeed) > 0.5) {
    const steer = (held['a'] ? 1 : 0) - (held['d'] ? 1 : 0);
    game.carHeading += steer * 1.6 * dt * Math.sign(game.carSpeed);
  }
  car.group.rotation.y = game.carHeading;
  car.group.position.x += Math.sin(game.carHeading) * game.carSpeed * dt;
  car.group.position.z += Math.cos(game.carHeading) * game.carSpeed * dt;
  pushOutOfBuildings(car.group.position, 1.4);
  hero.pos.copy(car.group.position);
  // Spin the wheels with speed.
  const wheels = car.group.userData.wheels || [];
  for (const w of wheels) w.rotation.x += game.carSpeed * dt * 0.9;
  audio.engine(true);
}

function pushOutOfBuildings(pos, radius) {
  // Keep inside the city and out of buildings (Box3 colliders).
  pos.x = THREE.MathUtils.clamp(pos.x, -118, 118);
  pos.z = THREE.MathUtils.clamp(pos.z, -118, 118);
  for (const box of city.colliders) {
    if (pos.x > box.min.x - radius && pos.x < box.max.x + radius &&
        pos.z > box.min.z - radius && pos.z < box.max.z + radius) {
      const dxl = pos.x - (box.min.x - radius);
      const dxr = (box.max.x + radius) - pos.x;
      const dzl = pos.z - (box.min.z - radius);
      const dzr = (box.max.z + radius) - pos.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) pos.x = box.min.x - radius;
      else if (m === dxr) pos.x = box.max.x + radius;
      else if (m === dzl) pos.z = box.min.z - radius;
      else pos.z = box.max.z + radius;
    }
  }
}

// ---------------------------------------------------------------- camera
const camFocus = new THREE.Vector3();
function updateCamera(dt) {
  // A capture override pins the camera for a close-up shot.
  if (game.camOverride) {
    camera.position.copy(game.camOverride.pos);
    camera.lookAt(game.camOverride.lookAt);
    return;
  }
  const focus = game.inCar ? game.inCar.group.position : hero.pos;
  const dist = game.inCar ? 11 : 8.5;
  const height = game.inCar ? 4.2 : 3.4;
  const yaw = game.inCar ? game.carHeading + Math.PI : game.camYaw;
  const desired = new THREE.Vector3(
    focus.x + Math.sin(yaw) * dist,
    focus.y + height,
    focus.z + Math.cos(yaw) * dist,
  );
  camera.position.lerp(desired, Math.min(1, dt * 5));
  camFocus.lerp(focus, Math.min(1, dt * 8));
  camera.lookAt(camFocus.x, camFocus.y + 1.4, camFocus.z + 0);
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!game.running || game.paused) {
    renderer.render(scene, camera);
    return;
  }
  game.time += dt;
  if (game.inCar) drive(dt); else walkHero(dt);
  characters.update(dt);
  combat.update(dt);
  traffic.update(dt);
  parked.update(dt);
  police.update(dt, hero.pos, !!game.inCar);
  missions.update(dt);
  city.update(dt);
  effects.update(dt);
  updateCamera(dt);

  // Wanted cools down when the player lies low.
  game.wantedTimer += dt;
  if (game.wanted > 0 && game.wantedTimer > 22) {
    game.wantedTimer = 0;
    game.wanted -= 1;
    police.setWanted(game.wanted);
    hud.setWanted(game.wanted);
    if (game.wanted === 0) audio.siren(false);
  }

// HUD + autosave: keep the HUD in sync every frame.
function refreshHud() {
  hud.setHealth(game.health);
  hud.setMoney(game.money);
  hud.setObjective(missions.getObjective());
  hud.setMinimap(
    hero.pos,
    characters.npcs.map((n) => n.pos),
    [...traffic.cars, ...parked.cars].map((c) => c.pos),
    police.cops.filter((c) => c.active).map((c) => c.pos),
  );
}

  // HUD + autosave.
  refreshHud();
  if (game.time - game.lastSave > 10) {
    game.lastSave = game.time;
    writeSave();
  }
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- start
hud.setHealth(game.health);
hud.setMoney(game.money);
hud.setWanted(game.wanted);
hud.setObjective(prior ? 'Welcome back — press M for the next mission' : 'Press M to start your first mission');
if (loadingEl) loadingEl.remove();
updateCamera(1);
renderer.render(scene, camera);

hud.showStart(() => {
  audio.init();
  game.running = true;
  if (prior) hud.showBanner('Welcome back', 'Progress restored from your save');
});

// Test hook: the E2E test reads this to assert boot, missions, driving,
// wanted and save without driving the UI.
window.__solaraBay = {
  state: game,
  hero,
  characters,
  combat,
  missions,
  police,
  traffic,
  parked,
  city,
  start: () => {
    hud.hideStart();
    audio.init();
    game.running = true;
  },
  teleport: (x, z) => { hero.pos.set(x, 0, z); hero.group.position.copy(hero.pos); },
  enterNearestCar: () => { const c = closestParked(60); if (c) { game.inCar = c; game.carHeading = c.group.rotation.y; hero.group.visible = false; return true; } return false; },
  pressKey: (k, down) => { held[k] = down; },
  setWanted: (n) => {
    game.wanted = THREE.MathUtils.clamp(n, 0, 5);
    police.setWanted(game.wanted);
    hud.setWanted(game.wanted);
    audio.siren(game.wanted >= 1);
  },
  setCamOverride: (pos, lookAt) => {
    game.camOverride = {
      pos: new THREE.Vector3(pos.x, pos.y, pos.z),
      lookAt: new THREE.Vector3(lookAt.x, lookAt.y, lookAt.z),
    };
  },
  clearCamOverride: () => { game.camOverride = null; },
  saveNow: () => { writeSave(); },
};

frame();
