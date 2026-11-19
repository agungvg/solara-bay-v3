// police.js — Solara Bay v3
// Wanted system, 0–5 stars. One patrol cruiser always ambles the streets;
// each wanted level wakes another interceptor that hunts the player, and at
// 3+ stars a pair of cruisers throws a roadblock across the road ahead.
// Light bars flash red/blue while wanted. Sirens are visual only.

import * as THREE from 'three';
import { buildCarMesh } from './vehicles.js';

// --- Road parsing (tolerant of the shapes city.js might hand us) -----------
function toPoint(p) {
  if (!p || typeof p !== 'object') return null;
  if (Array.isArray(p)) return { x: p[0] ?? 0, z: p[2] ?? p[1] ?? 0 };
  if (typeof p.x === 'number' && typeof p.z === 'number') return { x: p.x, z: p.z };
  return null;
}

function toSegments(raw) {
  const segs = [];
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      if (Array.isArray(r.points)) {
        for (let i = 0; i + 1 < r.points.length; i++) {
          const a = toPoint(r.points[i]);
          const b = toPoint(r.points[i + 1]);
          if (a && b) segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
        }
        continue;
      }
      const a = toPoint(r.start ?? r.a ?? r.from ?? r.p1);
      const b = toPoint(r.end ?? r.b ?? r.to ?? r.p2);
      if (a && b) segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
      else if (typeof r.x1 === 'number' && typeof r.x2 === 'number') {
        segs.push({ ax: r.x1, az: r.z1 ?? 0, bx: r.x2, bz: r.z2 ?? 0 });
      }
    }
  }
  if (segs.length === 0) {
    segs.push(
      { ax: -60, az: -40, bx: 60, bz: -40 },
      { ax: 60, az: -40, bx: 60, bz: 40 },
      { ax: 60, az: 40, bx: -60, bz: 40 },
      { ax: -60, az: 40, bx: -60, bz: -40 },
    );
  }
  return segs;
}

// Nearest point on any road segment to (x, z), plus that road's heading.
function snapToRoad(segs, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const seg of segs) {
    const dx = seg.bx - seg.ax;
    const dz = seg.bz - seg.az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - seg.ax) * dx + (z - seg.az) * dz) / len2));
    const px = seg.ax + dx * t;
    const pz = seg.az + dz * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < bestD) {
      bestD = d;
      best = { x: px, z: pz, heading: Math.atan2(dx, dz) };
    }
  }
  return best;
}

// Steer `cur` toward `want` by at most `maxTurn` radians, shortest way round.
function steerToward(cur, want, maxTurn) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxTurn) return want;
  return cur + Math.sign(d) * maxTurn;
}

function pickSegment(segs) {
  return segs[(Math.random() * segs.length) | 0];
}

function spinWheels(group, speed, step) {
  const spin = (speed * step) / 0.34;
  for (const wheel of group.userData.wheels) wheel.rotation.x += spin;
}

// ---------------------------------------------------------------------------
// createPolice(scene, city)
// Returns { setWanted(level), update(dt, playerPos, playerInCar), cops, wanted }.
//   cops: [{ group, pos, role, active }] — patrol first, then 5 interceptors,
//         then 2 roadblock cruisers. `pos` is the group's live position.
//   wanted: current level 0–5 (getter, always up to date).
// ---------------------------------------------------------------------------

export function createPolice(scene, city = {}) {
  const segs = toSegments(city.roads);
  const state = {
    level: 0,
    clock: 0,
    blockTimer: 0,
    player: new THREE.Vector3(0, 0, 0),
  };
  const units = [];

  function makeUnit(role) {
    const group = buildCarMesh(0xffffff, 'police');
    scene.add(group);
    const unit = {
      group,
      pos: group.position,
      role,
      active: false,
      heading: 0,
      // Stagger each unit's light-bar flash so the pack doesn't blink as one.
      flashPhase: units.length * 0.35,
    };
    units.push(unit);
    return unit;
  }

  // --- The patrol cruiser: always out, slow road-following. ----------------
  const cruiser = makeUnit('patrol');
  cruiser.active = true;
  cruiser.seg = pickSegment(segs);
  cruiser.prog = Math.random();
  cruiser.dir = 1;
  cruiser.lane = 1.5;
  cruiser.speed = 5;

  // --- Interceptor pool: 5 cars, parked out of sight until woken. -----------
  const interceptors = [];
  for (let i = 0; i < 5; i++) {
    const unit = makeUnit('pursuit');
    unit.group.visible = false;
    unit.pos.set(0, -100, 0);
    // Ring offset: each interceptor aims at its own point around the player
    // so the pack fans out instead of piling onto one spot.
    const a = (i / 5) * Math.PI * 2;
    unit.ring = { x: Math.sin(a) * 7, z: Math.cos(a) * 7 };
    interceptors.push(unit);
  }

  // --- Roadblock pair: hidden until 3+ stars. ------------------------------
  const blockers = [];
  for (let i = 0; i < 2; i++) {
    const unit = makeUnit('roadblock');
    unit.group.visible = false;
    unit.pos.set(0, -100, 0);
    blockers.push(unit);
  }

  // Drop an interceptor onto the road near the player, facing the player.
  function dropNear(unit, target) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 35 + Math.random() * 20; // 35–55 away
    const wantX = target.x + Math.sin(angle) * dist;
    const wantZ = target.z + Math.cos(angle) * dist;
    const snap = snapToRoad(segs, wantX, wantZ);
    const px = snap ? snap.x : wantX;
    const pz = snap ? snap.z : wantZ;
    unit.pos.set(px, 0, pz);
    unit.heading = Math.atan2(target.x - px, target.z - pz);
    unit.group.rotation.y = unit.heading;
    unit.group.visible = true;
  }

  // Set the two blockers across the road ~25 ahead of the player.
  function setBlockade() {
    const p = state.player;
    const snap = snapToRoad(segs, p.x, p.z);
    if (!snap) {
      // No road data: block straight ahead of the player on the Z axis.
      blockers[0].pos.set(p.x - 1.4, 0, p.z + 25);
      blockers[1].pos.set(p.x + 1.4, 0, p.z + 25);
      blockers[0].group.rotation.y = Math.PI / 2;
      blockers[1].group.rotation.y = Math.PI / 2;
      return;
    }
    // 25 along the road from the player's projection onto it.
    const ax = snap.x + Math.sin(snap.heading) * 25;
    const az = snap.z + Math.cos(snap.heading) * 25;
    // Sideways offsets so the pair spans the road, noses across it.
    const nx = Math.cos(snap.heading);
    const nz = -Math.sin(snap.heading);
    const across = snap.heading + Math.PI / 2;
    blockers[0].pos.set(ax + nx * 1.4, 0, az + nz * 1.4);
    blockers[1].pos.set(ax - nx * 1.4, 0, az - nz * 1.4);
    blockers[0].group.rotation.y = across;
    blockers[1].group.rotation.y = across;
    blockers[0].heading = across;
    blockers[1].heading = across;
  }

  function setWanted(level) {
    state.level = THREE.MathUtils.clamp(Math.round(level) || 0, 0, 5);
    interceptors.forEach((unit, i) => {
      const on = i < state.level;
      if (on && !unit.active) dropNear(unit, state.player);
      if (!on && unit.active) unit.group.visible = false;
      unit.active = on;
    });
    const block = state.level >= 3;
    blockers.forEach((unit) => {
      unit.active = block;
      unit.group.visible = block;
    });
    if (block) state.blockTimer = 0; // reposition on the next update
    return state.level;
  }

  function driveCruiser(step) {
    const seg = cruiser.seg;
    const len = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) || 1;
    cruiser.prog += (cruiser.dir * cruiser.speed * step) / len;
    if (cruiser.prog >= 1 || cruiser.prog <= 0) {
      cruiser.seg = pickSegment(segs);
      cruiser.dir = Math.random() < 0.5 ? 1 : -1;
      cruiser.prog = cruiser.dir > 0 ? 0 : 1;
      cruiser.lane = (Math.random() < 0.5 ? -1 : 1) * 1.5;
    }
    const t = THREE.MathUtils.clamp(cruiser.prog, 0, 1);
    const cx = seg.ax + (seg.bx - seg.ax) * t;
    const cz = seg.az + (seg.bz - seg.az) * t;
    const ux = (seg.bx - seg.ax) / len;
    const uz = (seg.bz - seg.az) / len;
    cruiser.pos.set(cx - uz * cruiser.lane, 0, cz + ux * cruiser.lane);
    cruiser.group.rotation.y = Math.atan2(ux * cruiser.dir, uz * cruiser.dir);
    cruiser.heading = cruiser.group.rotation.y;
    spinWheels(cruiser.group, cruiser.speed, step);
  }

  function chaseInterceptors(step, playerInCar) {
    const pace = 12 + state.level * 2 + (playerInCar ? 3 : 0);
    for (const unit of interceptors) {
      if (!unit.active) continue;
      // Aim at this unit's ring point around the player, not the player
      // themself, so the pack surrounds instead of stacking.
      const tx = state.player.x + unit.ring.x;
      const tz = state.player.z + unit.ring.z;
      const dx = tx - unit.pos.x;
      const dz = tz - unit.pos.z;
      const gap = Math.hypot(dx, dz);
      const toPlayer = Math.hypot(state.player.x - unit.pos.x, state.player.z - unit.pos.z);
      if (toPlayer > 150) {
        // Fell too far behind: drop back in near the player.
        dropNear(unit, state.player);
        continue;
      }
      if (gap > 0.01) {
        unit.heading = steerToward(unit.heading, Math.atan2(dx, dz), 2.2 * step);
      }
      // Ease off when right on top of the player instead of overlapping.
      const speed = gap < 6 ? pace * 0.3 : pace;
      unit.pos.x += Math.sin(unit.heading) * speed * step;
      unit.pos.z += Math.cos(unit.heading) * speed * step;
      unit.group.rotation.y = unit.heading;
      spinWheels(unit.group, speed, step);
    }
  }

  function flashBars() {
    // Alternating red / blue, each unit offset so the pack strobes unevenly;
    // dim and steady while the heat is off.
    for (const unit of units) {
      const lenses = unit.group.userData.lights;
      if (!lenses) continue;
      if (state.level === 0) {
        lenses.red.emissiveIntensity = 0.08;
        lenses.blue.emissiveIntensity = 0.08;
        continue;
      }
      const redOn = Math.floor((state.clock + unit.flashPhase) * 4.5) % 2 === 0;
      lenses.red.emissiveIntensity = redOn ? 2.5 : 0.15;
      lenses.blue.emissiveIntensity = redOn ? 0.15 : 2.5;
    }
  }

  function update(dt, playerPos, playerInCar) {
    const step = Math.min(dt, 0.1);
    if (playerPos && typeof playerPos.x === 'number' && typeof playerPos.z === 'number') {
      state.player.set(playerPos.x, 0, playerPos.z);
    }
    state.clock += step;

    driveCruiser(step);
    chaseInterceptors(step, playerInCar);

    // Roadblock: hold the line ahead of the player, shifting every few secs.
    if (state.level >= 3) {
      state.blockTimer -= step;
      if (state.blockTimer <= 0) {
        setBlockade();
        state.blockTimer = 3;
      }
    }

    flashBars();
  }

  return {
    setWanted,
    update,
    cops: units,
    get wanted() {
      return state.level;
    },
  };
}
