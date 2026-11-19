// traffic.js — Solara Bay v3
// 12 AI cars cruising the streets: each one owns a road segment and a
// progress value along it, drives to the end, then picks a fresh segment.
// Cars keep to a lane, face their travel direction, spin their wheels, and
// brake when another car is close ahead. No physics engine — just roads,
// headings and a little patience.

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
        r.points.slice(0, -1).forEach((p, i) => {
          const a = toPoint(p);
          const b = toPoint(r.points[i + 1]);
          if (a && b) segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
        });
        continue;
      }
      const a = toPoint(r.start ?? r.a ?? r.from ?? r.p1);
      const b = toPoint(r.end ?? r.b ?? r.to ?? r.p2);
      if (a && b) {
        segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
      } else if (typeof r.x1 === 'number' && typeof r.x2 === 'number') {
        segs.push({ ax: r.x1, az: r.z1 ?? 0, bx: r.x2, bz: r.z2 ?? 0 });
      }
    }
  }
  // No roads at all: fall back to a rectangular loop so traffic still runs.
  // (Roads are clear of buildings by construction.)
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

const TRAFFIC_PAINT = [
  0x27ae60, 0xc0392b, 0x2980b9, 0xdfe6e9, 0xf39c12,
  0x8e44ad, 0x2c3e50, 0x00b894, 0xe74c3c, 0x16a085,
  0xd35400, 0x7f8c8d,
];
const TRAFFIC_BODY = ['hatch', 'sedan', 'sedan', 'pickup', 'sedan', 'hatch'];

function pickOne(list) {
  return list[(Math.random() * list.length) | 0];
}

function cruiseSpeed() {
  return 8 + Math.random() * 6; // 8–14 units/s
}

function laneOffset() {
  // Drive on one side of the road, like real traffic: 1.2–2.0 out.
  return (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 0.8);
}

// Drop a driver onto its segment at its current progress, lane offset, and
// facing its direction of travel.
function seatDriver(car) {
  const seg = car.seg;
  const len = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) || 1;
  const t = THREE.MathUtils.clamp(car.prog, 0, 1);
  const cx = seg.ax + (seg.bx - seg.ax) * t;
  const cz = seg.az + (seg.bz - seg.az) * t;
  const ux = (seg.bx - seg.ax) / len;
  const uz = (seg.bz - seg.az) / len;
  // Lane is a sideways (perpendicular) offset from the centreline.
  car.pos.set(cx - uz * car.lane, 0, cz + ux * car.lane);
  car.group.rotation.y = Math.atan2(ux * car.dir, uz * car.dir);
}

function makeDriver(index, segs, scene) {
  const body = TRAFFIC_BODY[index % TRAFFIC_BODY.length];
  const paint = TRAFFIC_PAINT[index % TRAFFIC_PAINT.length];
  const group = buildCarMesh(paint, body);
  scene.add(group);
  const car = {
    group,
    pos: group.position,
    kind: body,
    seg: pickOne(segs),
    prog: 0.05 + Math.random() * 0.9,
    dir: Math.random() < 0.5 ? 1 : -1,
    lane: laneOffset(),
    cruise: cruiseSpeed(),
    speed: 0,
    jamTimer: 0, // seconds spent stopped behind another car
    wobble: Math.random() * Math.PI * 2, // phase for the gentle speed sway
  };
  car.speed = car.cruise;
  seatDriver(car);
  return car;
}

// Is another car close ahead of `car`? Uses the car's forward vector and a
// squared-distance check; only cars roughly in front count.
function blockedAhead(car, fleet) {
  const fx = Math.sin(car.group.rotation.y);
  const fz = Math.cos(car.group.rotation.y);
  for (const other of fleet) {
    if (other === car) continue;
    const dx = other.pos.x - car.pos.x;
    const dz = other.pos.z - car.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 36 && d2 > 0.000001) {
      if ((dx * fx + dz * fz) / Math.sqrt(d2) > 0.6) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// createTraffic(scene, city) — returns { cars, update(dt) }.
// Each car: { group, pos, kind, speed, cruise, seg, prog, dir, lane }.
// ---------------------------------------------------------------------------

export function createTraffic(scene, city = {}) {
  const segs = toSegments(city.roads);
  const fleet = [];
  for (let i = 0; i < 12; i++) fleet.push(makeDriver(i, segs, scene));

  function update(dt) {
    const step = Math.min(dt, 0.1); // clamp huge frame gaps
    for (const car of fleet) {
      // --- Brake for the car ahead, easing speed instead of snapping. ---
      // Each driver also sways a touch around their cruise speed so the
      // flow looks human instead of metronomic.
      const sway = 1 + 0.06 * Math.sin(car.wobble + car.prog * 6);
      const want = blockedAhead(car, fleet) ? 0 : car.cruise * sway;
      car.speed += (want - car.speed) * Math.min(1, step * 2.5);

      // Jam recovery: stopped for >5s (e.g. a permanent knot at a junction)
      // means relocate to a fresh random segment instead of sitting forever.
      if (want === 0) {
        car.jamTimer += step;
        if (car.jamTimer > 5) {
          car.seg = pickOne(segs);
          car.dir = Math.random() < 0.5 ? 1 : -1;
          car.prog = 0.05 + Math.random() * 0.9;
          car.cruise = cruiseSpeed();
          car.lane = laneOffset();
          car.jamTimer = 0;
          seatDriver(car);
          continue;
        }
      } else {
        car.jamTimer = 0;
      }

      // --- Roll along the current segment. ---
      const seg = car.seg;
      const len = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) || 1;
      car.prog += (car.dir * car.speed * step) / len;
      if (car.prog >= 1 || car.prog <= 0) {
        // End of the road: pick another segment and start at its near end.
        car.seg = pickOne(segs);
        car.dir = Math.random() < 0.5 ? 1 : -1;
        car.prog = car.dir > 0 ? 0 : 1;
        car.cruise = cruiseSpeed();
        car.lane = laneOffset();
      }
      seatDriver(car);

      // --- Spin the wheels to match road speed. ---
      const spin = (car.speed * step) / 0.34;
      for (const wheel of car.group.userData.wheels) wheel.rotation.x += spin;
    }
  }

  return { cars: fleet, update };
}
