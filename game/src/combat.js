// ---------------------------------------------------------------------------
// Solara Bay — combat: hitscan pistol shooting
// Each shot is a short-lived burst of procedural effects: a bright muzzle
// flash at the barrel, a glowing tracer streak to the impact point, and a
// spark burst where the round lands. Everything fades within a quarter of
// a second and disposes itself, so sustained fire never leaks objects.
// There is no physics collision here — a round travels MAX_RANGE and
// sparks at its end point. An optional onShot hook lets the caller play
// the gunshot sound; a failing hook can never break the shot itself.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const MAX_RANGE = 60;
const TRACER_TTL = 0.08;
const FLASH_TTL = 0.06;
const SPARK_TTL = 0.22;
const EMBER_COUNT = 10;

let sharedGlow = null;

// A soft radial glow, drawn once on a canvas and reused by every flash and
// impact sprite. Falls back to null (plain additive blobs) when there is
// no DOM, e.g. a Node smoke test importing this module.
function glowTexture() {
  if (sharedGlow) return sharedGlow;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,240,1)');
  gradient.addColorStop(0.3, 'rgba(255,214,110,0.9)');
  gradient.addColorStop(0.65, 'rgba(255,140,40,0.45)');
  gradient.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  sharedGlow = new THREE.CanvasTexture(canvas);
  return sharedGlow;
}

function pickShotHook(maybeHook) {
  if (typeof maybeHook === 'function') return maybeHook;
  if (maybeHook && typeof maybeHook.onShot === 'function') return maybeHook.onShot;
  return null;
}

// Accept the many shapes a target can arrive in (Vector3, {pos}, {position},
// {group}, plain {x,z}) and reduce them to a single Vector3 or null.
function targetToVec(target) {
  if (!target) return null;
  if (target.isVector3) return target;
  if (target.pos?.isVector3) return target.pos;
  if (target.position?.isVector3) return target.position;
  if (target.group?.position) return target.group.position;
  if (typeof target.x === 'number' && typeof target.z === 'number') {
    return new THREE.Vector3(target.x, target.y ?? 0, target.z);
  }
  return null;
}

function toVec3(value) {
  if (!value) return null;
  if (value.isVector3) return value.clone();
  return new THREE.Vector3(value.x, value.y ?? 0, value.z);
}

// --- effect spawners --------------------------------------------------------
// Each spawner builds its objects, adds them to the scene and registers a
// record { ..., life, maxLife } in the matching pool. update() ticks the
// pools down and disposes anything that expired.

function makeTracer(scene, pool, from, to, friendly) {
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({
    color: friendly ? 0xffe08a : 0xff6b5e,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  scene.add(line);
  pool.push({ line, life: TRACER_TTL, maxLife: TRACER_TTL });
}

function makeFlash(scene, pool, texture, at, direction) {
  // Three sprites: a hot white-yellow core, a wider orange halo, and a
  // faint grey smoke wisp that drifts up and outlives the light.
  const anchor = at.clone();
  if (direction) anchor.addScaledVector(direction, 0.28);

  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, color: 0xfff6c8, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  core.material.rotation = Math.random() * Math.PI * 2;
  core.position.copy(anchor);
  const coreSize = 0.34 + Math.random() * 0.14;
  core.scale.set(coreSize, coreSize, 1);
  scene.add(core);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, color: 0xff9a2e, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.material.rotation = Math.random() * Math.PI * 2;
  halo.position.copy(anchor);
  const haloSize = 0.62 + Math.random() * 0.22;
  halo.scale.set(haloSize, haloSize, 1);
  scene.add(halo);

  const smoke = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, color: 0x9a9a9a, transparent: true, opacity: 0.28,
    depthWrite: false,
  }));
  smoke.position.copy(anchor);
  if (direction) smoke.position.addScaledVector(direction, 0.25);
  smoke.position.y += 0.06;
  smoke.scale.set(0.22, 0.22, 1);
  scene.add(smoke);

  pool.push({
    core, halo, smoke,
    coreScale: coreSize, haloScale: haloSize,
    life: FLASH_TTL, maxLife: FLASH_TTL,
  });
}

function makeImpact(scene, pool, texture, at) {
  const group = new THREE.Group();
  group.position.copy(at);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, color: 0xffb347, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.set(0.42, 0.42, 1);
  group.add(glow);

  // Hot embers scattered in a disc around the impact point, with a little
  // upward spray so the burst reads in three dimensions.
  const positions = new Float32Array(EMBER_COUNT * 3);
  for (let i = 0; i < EMBER_COUNT; i++) {
    const angle = (i / EMBER_COUNT) * Math.PI * 2 + Math.random() * 0.6;
    const radius = 0.07 + Math.random() * 0.16;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = (Math.random() - 0.25) * 0.24;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const emberMat = new THREE.PointsMaterial({
    color: 0xffd28a, size: 0.055, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  group.add(embers);

  scene.add(group);
  pool.push({ group, glow, embers, life: SPARK_TTL, maxLife: SPARK_TTL });
}

// --- pool ticking -----------------------------------------------------------

function tickTracers(scene, pool, dt) {
  for (let i = pool.length - 1; i >= 0; i--) {
    const entry = pool[i];
    entry.life -= dt;
    if (entry.life <= 0) {
      scene.remove(entry.line);
      entry.line.geometry.dispose();
      entry.line.material.dispose();
      pool.splice(i, 1);
    } else {
      entry.line.material.opacity = 0.95 * (entry.life / entry.maxLife);
    }
  }
}

function tickFlashes(scene, pool, dt) {
  for (let i = pool.length - 1; i >= 0; i--) {
    const entry = pool[i];
    entry.life -= dt;
    if (entry.life <= 0) {
      scene.remove(entry.core);
      scene.remove(entry.halo);
      scene.remove(entry.smoke);
      entry.core.material.dispose();
      entry.halo.material.dispose();
      entry.smoke.material.dispose();
      pool.splice(i, 1);
    } else {
      const k = entry.life / entry.maxLife;
      entry.core.material.opacity = k;
      entry.halo.material.opacity = 0.85 * k;
      // Smoke fades slower and swells as the light dies.
      entry.smoke.material.opacity = 0.28 * Math.min(1, k * 1.6);
      const smokeSize = 0.22 + (1 - k) * 0.3;
      entry.smoke.scale.set(smokeSize, smokeSize, 1);
      entry.smoke.position.y += dt * 0.35;
      const coreSize = entry.coreScale * (0.55 + 0.45 * k);
      const haloSize = entry.haloScale * (0.6 + 0.4 * k);
      entry.core.scale.set(coreSize, coreSize, 1);
      entry.halo.scale.set(haloSize, haloSize, 1);
    }
  }
}

function tickImpacts(scene, pool, dt) {
  for (let i = pool.length - 1; i >= 0; i--) {
    const entry = pool[i];
    entry.life -= dt;
    if (entry.life <= 0) {
      scene.remove(entry.group);
      entry.glow.material.dispose();
      entry.embers.geometry.dispose();
      entry.embers.material.dispose();
      pool.splice(i, 1);
    } else {
      const k = entry.life / entry.maxLife;
      entry.glow.material.opacity = k;
      entry.embers.material.opacity = k;
      entry.group.scale.setScalar(1 + (1 - k) * 1.0);
    }
  }
}

// --- factory ----------------------------------------------------------------

export function createCombat(scene, characters, onShotArg) {
  const shotHook = pickShotHook(onShotArg);
  const tracerPool = [];
  const flashPool = [];
  const impactPool = [];
  const texture = glowTexture();

  function shoot(origin, direction, isPlayer = true) {
    const from = toVec3(origin);
    const dir = toVec3(direction);
    if (!from || !dir) return null;
    if (dir.lengthSq() < 0.0001) return null;
    dir.normalize();

    const end = from.clone().addScaledVector(dir, MAX_RANGE);

    makeTracer(scene, tracerPool, from, end, isPlayer);
    makeFlash(scene, flashPool, texture, from, dir);
    makeImpact(scene, impactPool, texture, end);

    if (shotHook) {
      try {
        shotHook({ origin: from, direction: dir, end, isPlayer });
      } catch (err) {
        // A sound hook must never break the shot effect.
        console.warn('[combat] onShot callback failed:', err);
      }
    }

    return { origin: from, direction: dir, end };
  }

  function update(dt) {
    tickTracers(scene, tracerPool, dt);
    tickFlashes(scene, flashPool, dt);
    tickImpacts(scene, impactPool, dt);
  }

  return { shoot, update };
}

// --- aim staging ------------------------------------------------------------
// Pose an NPC as if it is aiming at a target (used to stage mission
// screenshots): turn it to face the target, raise the right arm forward
// into a pistol grip and bring the left arm across in support. The NPC's
// own walk update keeps the pose while `npc.aiming` is true; clear the
// flag (npc.aiming = false) to let the normal arm swing resume.
export function aimPose(npc, target) {
  if (!npc) return;
  const group = npc.group ?? npc;
  if (!group || !group.position) return;

  const targetPos = targetToVec(target);
  if (targetPos) {
    const dx = targetPos.x - group.position.x;
    const dz = targetPos.z - group.position.z;
    if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
      group.rotation.y = Math.atan2(dx, dz);
    }
  }

  npc.aiming = true;

  if (npc.armR?.shoulder) {
    // Right arm forward and level, elbow almost straight — pistol forward.
    npc.armR.shoulder.rotation.set(-Math.PI / 2 + 0.08, 0, 0);
    if (npc.armR.elbow) npc.armR.elbow.rotation.x = -0.12;
  } else if (group) {
    // Fallback for a bare group: find the right-arm pivot by name.
    group.traverse((child) => {
      if (child.userData?.isRightArm) child.rotation.x = -Math.PI / 2 + 0.08;
    });
  }

  if (npc.armL?.shoulder) {
    // Left arm comes across in support, hand under the right forearm.
    npc.armL.shoulder.rotation.set(-1.15, 0, 0.45);
    if (npc.armL.elbow) npc.armL.elbow.rotation.x = -0.7;
  }

  // Head stays level, eyes on the target.
  if (npc.head) npc.head.rotation.x = 0;
}
