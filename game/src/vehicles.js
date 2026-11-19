// vehicles.js — Solara Bay v3
// Hand-built procedural street cars: no imported models, no textures.
// Every car is a small assembly of a smooth extruded hull, a glasshouse,
// four spinning wheels and clip-on trim. Cars face +Z; the road is y = 0.
// buildCarMesh returns a THREE.Group whose userData.wheels are pivot groups
// that spin around the axle (rotation.x) as the car rolls.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Material library. Paint is per-car (created on demand); everything else is
// shared so a street full of cars stays cheap.
// ---------------------------------------------------------------------------

const MAT = {
  glass: new THREE.MeshStandardMaterial({ color: 0x0e1822, metalness: 0.85, roughness: 0.15 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x131313, metalness: 0.0, roughness: 0.95 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xc3c9d1, metalness: 0.9, roughness: 0.28 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1a1d20, metalness: 0.45, roughness: 0.55 }),
  beam: new THREE.MeshStandardMaterial({
    color: 0xfff6d8, emissive: 0xffe9a8, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.2,
  }),
  brake: new THREE.MeshStandardMaterial({
    color: 0x7a0d0d, emissive: 0xd21f1f, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.3,
  }),
  amber: new THREE.MeshStandardMaterial({
    color: 0x7a4a00, emissive: 0xff9d00, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.3,
  }),
  bed: new THREE.MeshStandardMaterial({ color: 0x23272a, metalness: 0.3, roughness: 0.85 }),
};

function paintFor(hex) {
  return new THREE.MeshStandardMaterial({ color: hex, metalness: 0.55, roughness: 0.35 });
}

// ---------------------------------------------------------------------------
// Shape helpers. Profiles are drawn in a flat (longitudinal, up) plane and
// extruded across the car's width, then swung so the extrusion runs along X.
// ---------------------------------------------------------------------------

// Smooth closed outline through a list of [along, up] points.
function outlineThrough(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  shape.splineThru(points.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
  shape.closePath();
  return shape;
}

// Straight-edged polygon through [along, up] points (glasshouse profiles).
function polygonThrough(points) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
}

function extrudeSide(shape, width, material, bevel = 0.05) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}

// Hull outline: [along, up] with +along = front of the car.
const HULL_POINTS = [
  [-2.00, 0.30], [-2.24, 0.40], [-2.24, 0.64], [-2.10, 0.86],
  [1.88, 0.88], [2.20, 0.80], [2.24, 0.52], [2.06, 0.30],
];

// Glasshouse profiles per body style, as [frontBase, frontTop, rearTop, rearBase]
// corners plus roof height and beltline height.
const GLASSHOUSE = {
  sedan: { nose: 1.06, brow: 0.46, tail: -0.56, deck: -1.18, roof: 1.32, belt: 0.86 },
  hatch: { nose: 1.02, brow: 0.46, tail: -0.92, deck: -1.28, roof: 1.32, belt: 0.86 },
  pickup: { nose: 1.02, brow: 0.48, tail: -0.30, deck: -0.62, roof: 1.30, belt: 0.86 },
};

function glasshouseShape(p) {
  return polygonThrough([
    [p.nose, p.belt], [p.brow, p.roof], [p.tail, p.roof], [p.deck, p.belt],
  ]);
}

// A thin glass slab hugging a sloped glasshouse face (windscreen / backlight).
// (z0, y0) is the lower edge, (z1, y1) the upper edge; the slab is tilted to
// the slope and nudged outward along the slope normal to avoid z-fighting.
function slopeGlass(car, z0, y0, z1, y1, width) {
  const run = z1 - z0;
  const rise = y1 - y0;
  const slope = Math.hypot(run, rise);
  if (slope < 0.05) return;
  let nz = rise / slope;
  let ny = -run / slope;
  if (ny < 0) { nz = -nz; ny = -ny; }
  const pane = new THREE.Mesh(new THREE.BoxGeometry(width, slope * 0.92, 0.03), MAT.glass);
  pane.position.set(0, (y0 + y1) / 2 + ny * 0.03, (z0 + z1) / 2 + nz * 0.03);
  pane.rotation.x = Math.atan2(run, rise);
  car.add(pane);
}

function part(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

// One wheel: a pivot group (spins on rotation.x) holding a tyre, a rim and
// five spokes. The cylinder geometries are pre-rotated so their axis is X.
function buildWheel() {
  const pivot = new THREE.Group();
  const tyreGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 20);
  tyreGeo.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(tyreGeo, MAT.rubber);
  tyre.castShadow = true;
  const rimGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.26, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, MAT.rim);
  pivot.add(tyre, rim);
  for (let s = 0; s < 5; s++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.05, 0.05), MAT.rim);
    const a = (s / 5) * Math.PI * 2;
    spoke.position.set(0, Math.sin(a) * 0.10, Math.cos(a) * 0.10);
    spoke.rotation.x = -a;
    pivot.add(spoke);
  }
  return pivot;
}

// ---------------------------------------------------------------------------
// buildCarMesh(color, kind)
// kind: 'sedan' | 'hatch' | 'pickup' | 'police'  (default 'sedan').
// Also accepts buildCarMesh(color, isPoliceBoolean, styleString) for callers
// that pass the police flag separately.
// Returns a THREE.Group facing +Z. userData: { wheels, lights, kind, color }
//   wheels: pivot groups (spin via pivot.rotation.x)
//   lights: null, or { red, blue } light-bar materials on police cars
// ---------------------------------------------------------------------------

export function buildCarMesh(color, kind = 'sedan', style) {
  let bodyKind = 'sedan';
  let cop = false;
  if (typeof kind === 'boolean') {
    cop = kind;
    bodyKind = style || 'sedan';
  } else if (typeof kind === 'string') {
    bodyKind = kind;
    cop = kind === 'police';
  }
  if (!GLASSHOUSE[bodyKind]) bodyKind = 'sedan';
  const profile = GLASSHOUSE[bodyKind];

  const paint = paintFor(cop ? 0xffffff : color);
  const car = new THREE.Group();

  // Smooth hull + glasshouse (bevelled extrusions, never plain boxes).
  car.add(extrudeSide(outlineThrough(HULL_POINTS), 1.80, paint, 0.05));
  car.add(extrudeSide(glasshouseShape(profile), 1.66, paint, 0.05));

  // Side glass: a dark band across the glasshouse at mid-height, sized from
  // the windscreen / backlight slopes so it fits every body style.
  const midY = profile.belt + (profile.roof - profile.belt) * 0.52;
  const k = (midY - profile.belt) / (profile.roof - profile.belt);
  const zNose = profile.nose + (profile.brow - profile.nose) * k;
  const zTail = profile.deck + (profile.tail - profile.deck) * k;
  const paneLen = Math.max(0.4, (zNose - zTail) * 0.92);
  const paneZ = (zNose + zTail) / 2;
  for (const side of [-1, 1]) {
    const pane = part(0.04, 0.30, paneLen, MAT.glass, side * 0.875, midY, paneZ);
    pane.castShadow = false;
    car.add(pane);
  }

  // Windscreen + backlight, sloped to match the glasshouse.
  slopeGlass(car, profile.nose, profile.belt, profile.brow, profile.roof, 1.45);
  slopeGlass(car, profile.deck, profile.belt, profile.tail, profile.roof, 1.45);

  // Wheels at the four corners.
  const wheels = [];
  for (const [wx, wz] of [[-0.82, 1.42], [0.82, 1.42], [-0.82, -1.42], [0.82, -1.42]]) {
    const wheel = buildWheel();
    wheel.position.set(wx, 0.34, wz);
    car.add(wheel);
    wheels.push(wheel);
  }

  // Front + rear lamps, indicators, grille, bumpers, mirrors, side skirt.
  car.add(part(0.34, 0.12, 0.10, MAT.beam, -0.62, 0.70, 2.24));
  car.add(part(0.34, 0.12, 0.10, MAT.beam, 0.62, 0.70, 2.24));
  car.add(part(0.34, 0.12, 0.10, MAT.brake, -0.62, 0.70, -2.24));
  car.add(part(0.34, 0.12, 0.10, MAT.brake, 0.62, 0.70, -2.24));
  for (const sx of [-1, 1]) {
    car.add(part(0.12, 0.10, 0.08, MAT.amber, sx * 0.95, 0.70, 2.24));
    car.add(part(0.12, 0.10, 0.08, MAT.amber, sx * 0.95, 0.70, -2.24));
    car.add(part(0.18, 0.10, 0.10, paint, sx * 0.99, 1.02, 0.80));
  }
  car.add(part(0.95, 0.16, 0.06, MAT.dark, 0, 0.60, 2.26));
  car.add(part(1.94, 0.18, 0.16, MAT.dark, 0, 0.38, 2.18));
  car.add(part(1.94, 0.18, 0.16, MAT.dark, 0, 0.38, -2.18));
  car.add(part(1.70, 0.10, 2.20, MAT.dark, 0, 0.32, 0));
  // Number plates, front and rear.
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xf2f2e8, metalness: 0.3, roughness: 0.5 });
  car.add(part(0.55, 0.14, 0.02, plateMat, 0, 0.44, 2.28));
  car.add(part(0.55, 0.14, 0.02, plateMat, 0, 0.44, -2.28));

  if (bodyKind === 'pickup') {
    // Open load bed behind the short cab: floor, side walls, tailgate.
    car.add(part(1.70, 0.06, 1.40, MAT.bed, 0, 0.90, -1.40));
    car.add(part(0.06, 0.40, 1.40, paint, -0.85, 1.10, -1.40));
    car.add(part(0.06, 0.40, 1.40, paint, 0.85, 1.10, -1.40));
    car.add(part(1.76, 0.40, 0.06, paint, 0, 1.10, -2.08));
    car.add(part(1.76, 0.40, 0.06, paint, 0, 1.10, -0.72));
  } else {
    // Roof antenna on closed-body cars.
    const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 6), MAT.dark);
    aerial.position.set(0.35, profile.roof + 0.11, -0.45);
    car.add(aerial);
    if (bodyKind === 'hatch') {
      // Small roof spoiler over the tailgate, tilted a touch for style.
      const wing = part(1.50, 0.05, 0.30, paint, 0, profile.roof + 0.03, -1.28);
      wing.rotation.x = -0.08;
      car.add(wing);
    }
  }

  // Police livery: black bonnet / boot / roof panels and a red-blue bar.
  let lights = null;
  if (cop) {
    car.add(part(1.72, 0.04, 1.05, MAT.dark, 0, 0.93, 1.55));  // black bonnet
    car.add(part(1.72, 0.04, 0.85, MAT.dark, 0, 0.93, -1.72)); // black boot
    car.add(part(1.60, 0.04, 1.15, MAT.dark, 0, 1.37, -0.05)); // black roof
    car.add(part(1.15, 0.05, 0.34, MAT.dark, 0, 1.42, -0.05)); // bar plinth
    const redLens = new THREE.MeshStandardMaterial({
      color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.1,
    });
    const blueLens = new THREE.MeshStandardMaterial({
      color: 0x000055, emissive: 0x2244ff, emissiveIntensity: 0.1,
    });
    car.add(part(0.52, 0.10, 0.30, redLens, -0.28, 1.48, -0.05));
    car.add(part(0.52, 0.10, 0.30, blueLens, 0.28, 1.48, -0.05));
    lights = { red: redLens, blue: blueLens };
  }

  car.userData.wheels = wheels;
  car.userData.lights = lights;
  car.userData.kind = cop ? 'police' : bodyKind;
  car.userData.color = cop ? 0xffffff : color;
  return car;
}

// ---------------------------------------------------------------------------
// City parsing. The city object belongs to another module, so accept every
// plausible shape and degrade gracefully instead of throwing.
//   carSpawns: {x, z} | {x, z, angle|heading} | {pos|position, angle}
//              | [x, z] | [x, z, angle]
//   roads: {start|a|from, end|b|to} | {x1, z1, x2, z2} | {points: [[x, z]]}
// ---------------------------------------------------------------------------

function asVec(p) {
  if (!p || typeof p !== 'object') return null;
  if (Array.isArray(p)) return { x: p[0] ?? 0, z: p[2] ?? p[1] ?? 0 };
  if (typeof p.x === 'number' && typeof p.z === 'number') return { x: p.x, z: p.z };
  return null;
}

function asSegments(raw) {
  const segs = [];
  if (!Array.isArray(raw)) return segs;
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    if (Array.isArray(r.points)) {
      for (let i = 0; i + 1 < r.points.length; i++) {
        const a = asVec(r.points[i]);
        const b = asVec(r.points[i + 1]);
        if (a && b) segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
      }
      continue;
    }
    const a = asVec(r.start ?? r.a ?? r.from ?? r.p1);
    const b = asVec(r.end ?? r.b ?? r.to ?? r.p2);
    if (a && b) {
      segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
      continue;
    }
    if (typeof r.x1 === 'number' && typeof r.x2 === 'number') {
      segs.push({ ax: r.x1, az: r.z1 ?? 0, bx: r.x2, bz: r.z2 ?? 0 });
    }
  }
  return segs;
}

function asSpawns(raw) {
  const spots = [];
  if (!Array.isArray(raw)) return spots;
  for (const e of raw) {
    if (e == null) continue;
    if (Array.isArray(e)) {
      spots.push({ x: e[0] ?? 0, z: e[2] ?? e[1] ?? 0, angle: e[3] ?? e[2] ?? null });
      continue;
    }
    if (typeof e !== 'object') continue;
    const p = asVec(e.pos ?? e.position ?? e);
    if (!p) continue;
    const angle = e.angle ?? e.heading ?? e.rotY ?? e.rotationY ?? null;
    spots.push({ x: p.x, z: p.z, angle: typeof angle === 'number' ? angle : null });
  }
  return spots;
}

// Heading of the road segment nearest (x, z), so a car without an explicit
// angle still parks parallel to the street.
function roadHeadingAt(segs, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const r of segs) {
    const dx = r.bx - r.ax;
    const dz = r.bz - r.az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - r.ax) * dx + (z - r.az) * dz) / len2));
    const px = r.ax + dx * t;
    const pz = r.az + dz * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best ? Math.atan2(best.bx - best.ax, best.bz - best.az) : 0;
}

// Tiny deterministic PRNG so the kerbside layout is the same every load.
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARKED_PAINT = [
  0x2980b9, 0xc0392b, 0xf39c12, 0x27ae60, 0xdfe6e9,
  0x8e44ad, 0x2c3e50, 0x16a085, 0xe74c3c, 0x00b894,
  0xd35400, 0x6c5ce7, 0x7f8c8d, 0xffeaa7,
];
const PARKED_BODY = ['hatch', 'sedan', 'pickup', 'sedan', 'hatch', 'pickup', 'sedan'];

// ---------------------------------------------------------------------------
// createParked(scene, city) — 14 parked cars, engines off.
// Prefers city.carSpawns; fills the rest along road kerbs (about 2.8 out from
// the centreline, alternating sides); last resort is a plain grid row.
// Returns { cars, update(dt) } with cars as { group, pos, kind }.
// update is a no-op — parked cars never move — kept for a uniform interface.
// ---------------------------------------------------------------------------

export function createParked(scene, city = {}) {
  const spots = asSpawns(city.carSpawns);
  const segs = asSegments(city.roads);
  const rnd = mulberry32(20261119);
  const cars = [];

  for (let i = 0; i < 14; i++) {
    let x;
    let z;
    let angle;
    if (i < spots.length) {
      ({ x, z, angle } = spots[i]);
      if (angle == null) angle = roadHeadingAt(segs, x, z);
    } else if (segs.length > 0) {
      const r = segs[i % segs.length];
      const t = 0.12 + 0.76 * rnd();
      const side = i % 2 === 0 ? 1 : -1;
      const px = r.ax + (r.bx - r.ax) * t;
      const pz = r.az + (r.bz - r.az) * t;
      const len = Math.hypot(r.bx - r.ax, r.bz - r.az) || 1;
      const nx = -(r.bz - r.az) / len;
      const nz = (r.bx - r.ax) / len;
      x = px + nx * 2.8 * side;
      z = pz + nz * 2.8 * side;
      angle = Math.atan2(r.bx - r.ax, r.bz - r.az);
    } else {
      x = -36 + (i % 7) * 12;
      z = 10 + Math.floor(i / 7) * 8;
      angle = 0;
    }

    const kind = PARKED_BODY[i % PARKED_BODY.length];
    const color = PARKED_PAINT[i % PARKED_PAINT.length];
    const group = buildCarMesh(color, kind);
    group.position.set(x, 0, z);
    group.rotation.y = angle ?? 0;
    scene.add(group);
    cars.push({ group, pos: group.position, kind });
  }

  return {
    cars,
    update(_dt) {},
  };
}
