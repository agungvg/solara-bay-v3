// Solara Bay — city builder (round-3 rewrite).
//
// Everything in the playable city is generated from code: streets, towers,
// beach, pier, park, props. No downloaded models, no image files — every
// surface pattern is painted onto an offscreen canvas at load time and
// turned into a CanvasTexture.
//
// What buildCity hands back:
//   colliders    — THREE.Box3 list, used by the hero/car collision pass
//   roads        — { from, to } segments the traffic AI drives along
//   playerSpawn  — where the hero appears
//   carSpawns    — curbside parking spots for parked cars
//   npcSpawns    — sidewalk spots for pedestrians
//   update(dt)   — per-frame life: waves, flickering lamps, fountain, foam
//
// The layout is a fixed grid so traffic, police and missions all agree on
// where the streets are: roads every 30 units, plaza at the centre, the
// beach and the ocean along the south edge (positive z).
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// buildCity — the whole city in one call.
// ---------------------------------------------------------------------------
export function buildCity(scene) {
  const rng = makeRng(20261119);
  const colliders = [];
  const roads = [];
  const carSpawns = [];
  const npcSpawns = [];
  const playerSpawn = new THREE.Vector3(0, 0, 10);

  const tex = makeTextures(rng);
  const kit = makeKit(tex);

  // A unit cube stretched to size — the workhorse for boxes of every kind.
  const box = (w, h, d, mat, x, y, z, parent = scene) => {
    const m = new THREE.Mesh(kit.geo.box, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // --- ground slabs ---------------------------------------------------------
  // Dry land stops at the shoreline (z = 118); beyond it is seabed.
  const land = new THREE.Mesh(flatPlane(400, 300), kit.mat.ground);
  land.position.set(0, 0, -32);
  land.receiveShadow = true;
  scene.add(land);

  const seabed = new THREE.Mesh(flatPlane(380, 170), kit.mat.seabed);
  seabed.position.set(0, -1.6, 203);
  scene.add(seabed);

  // --- street grid ----------------------------------------------------------
  // One descriptor per street: which axis it runs on and where it sits.
  // Vertical streets run z -120..90, horizontal ones x -120..120.
  const streets = [];
  for (const v of [-90, -60, -30, 0, 30, 60, 90]) {
    streets.push({ vertical: true, at: v });
    streets.push({ vertical: false, at: v });
  }
  const roadGeoV = flatPlane(10, 210);
  const roadGeoH = flatPlane(10, 240).rotateY(Math.PI / 2);
  const walkGeoV = flatPlane(2.6, 210);
  const walkGeoH = flatPlane(2.6, 240).rotateY(Math.PI / 2);

  for (const st of streets) {
    if (st.vertical) {
      const road = new THREE.Mesh(roadGeoV, kit.mat.asphalt);
      road.position.set(st.at, 0.02, -15);
      road.receiveShadow = true;
      scene.add(road);
      roads.push({ from: new THREE.Vector3(st.at, 0, -120), to: new THREE.Vector3(st.at, 0, 90) });
      for (const off of [-6.4, 6.4]) {
        const walk = new THREE.Mesh(walkGeoV, kit.mat.sidewalk);
        walk.position.set(st.at + off, 0.03, -15);
        scene.add(walk);
      }
    } else {
      const road = new THREE.Mesh(roadGeoH, kit.mat.asphalt);
      road.position.set(0, 0.02, st.at);
      road.receiveShadow = true;
      scene.add(road);
      roads.push({ from: new THREE.Vector3(-120, 0, st.at), to: new THREE.Vector3(120, 0, st.at) });
      for (const off of [-6.4, 6.4]) {
        const walk = new THREE.Mesh(walkGeoH, kit.mat.sidewalk);
        walk.position.set(0, 0.03, st.at + off);
        scene.add(walk);
      }
    }
  }

  // Striped crossings at every intersection except the plaza centre.
  const crossGeo = flatPlane(10, 10);
  for (const x of [-90, -60, -30, 0, 30, 60, 90]) {
    for (const z of [-90, -60, -30, 0, 30, 60, 90]) {
      if (x === 0 && z === 0) continue;
      const c = new THREE.Mesh(crossGeo, kit.mat.crosswalk);
      c.position.set(x, 0.045, z);
      scene.add(c);
    }
  }

  // --- central plaza + fountain ---------------------------------------------
  const plaza = new THREE.Mesh(flatPlane(46, 46), kit.mat.plaza);
  plaza.position.set(0, 0.05, 0);
  plaza.receiveShadow = true;
  scene.add(plaza);

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.4, 1.1, 24), kit.mat.stone);
  basin.position.set(0, 0.55, -6);
  basin.castShadow = true;
  scene.add(basin);
  const fountainWater = new THREE.Mesh(
    new THREE.CylinderGeometry(6.3, 6.3, 0.25, 24), kit.mat.water);
  fountainWater.position.set(0, 0.95, -6);
  scene.add(fountainWater);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1, 2.6, 12), kit.mat.stone);
  column.position.set(0, 2.2, -6);
  scene.add(column);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.35, 16), kit.mat.stone);
  cap.position.set(0, 3.6, -6);
  scene.add(cap);
  colliders.push(new THREE.Box3(
    new THREE.Vector3(-7.4, 0, -13.4), new THREE.Vector3(7.4, 1.2, 1.4)));

  // --- park: lawn, gravel paths, trees, benches ------------------------------
  const park = new THREE.Mesh(flatPlane(30, 30), kit.mat.grass);
  park.position.set(-75, 0.04, 45);
  park.receiveShadow = true;
  scene.add(park);
  box(30, 0.06, 2.2, kit.mat.sidewalk, -75, 0.05, 45);
  box(2.2, 0.06, 30, kit.mat.sidewalk, -75, 0.05, 45);

  const treeSpots = [
    [-86, 36], [-64, 36], [-86, 54], [-64, 54],
    [-75, 33], [-75, 57], [-84, 45], [-66, 45],
  ];
  for (const [tx, tz] of treeSpots) plantTree(tx, tz, 0.9 + rng() * 0.5);

  const benchSpots = [
    [-81, 43, 0.4], [-69, 43, -0.4],
    [-81, 47, Math.PI - 0.4], [-69, 47, Math.PI + 0.4],
    [-14, 16, Math.PI / 2], [14, 16, -Math.PI / 2],
    [-14, -16, Math.PI / 2], [14, -16, -Math.PI / 2],
  ];
  for (const [bx, bz, rot] of benchSpots) placeBench(bx, bz, rot);

  // --- towers ----------------------------------------------------------------
  // Blocks sit between the roads. Three are kept clear: the plaza blocks,
  // the park block and the pier approach, so nothing overlaps the set pieces.
  const blockXs = [-105, -75, -45, -15, 15, 45, 75, 105];
  const blockZs = [-105, -75, -45, -15, 15, 45, 75];
  const blocks = [];
  for (const bx of blockXs) {
    for (const bz of blockZs) {
      if (Math.abs(bx) < 25 && Math.abs(bz) < 25) continue;
      if (bx === -75 && bz === 45) continue;
      if (bx === 45 && bz === 75) continue;
      blocks.push([bx, bz]);
    }
  }
  shuffle(blocks, rng);
  const picked = blocks.slice(0, 28);
  const annexKeys = new Set(picked.slice(0, 5).map(([x, z]) => `${x},${z}`));

  for (const [bx, bz] of picked) {
    const nearCentre = 1 - (Math.abs(bx) + Math.abs(bz)) / 360;
    const h = Math.min(45, 8 + rng() * 22 + nearCentre * 15);
    raiseTower(bx, bz, 12 + rng() * 6, 12 + rng() * 6, h);
    if (annexKeys.has(`${bx},${bz}`)) {
      raiseTower(bx + (rng() < 0.5 ? 7 : -7), bz + 6, 7, 6, 6 + rng() * 6);
    }
  }

  // --- beach, ocean, pier ------------------------------------------------------
  const sand = new THREE.Mesh(flatPlane(340, 26), kit.mat.sand);
  sand.position.set(0, 0.06, 105);
  sand.receiveShadow = true;
  scene.add(sand);

  const seaGeo = new THREE.PlaneGeometry(380, 170, 48, 20).rotateX(-Math.PI / 2);
  const seaPos = seaGeo.attributes.position;
  // Snapshot the flat vertex layout once; the wave only rewrites Y.
  const seaRest = seaPos.array.slice();
  const ocean = new THREE.Mesh(seaGeo, kit.mat.ocean);
  ocean.position.set(0, -0.15, 203);
  scene.add(ocean);

  const foam = new THREE.Mesh(flatPlane(340, 3), kit.mat.foam);
  foam.position.set(0, 0.08, 117.5);
  scene.add(foam);

  // Pier: deck + rails + end platform on stout posts, jutting into the bay.
  const pierX = 40;
  box(8, 0.6, 52, kit.mat.wood, pierX, 1.1, 132);
  box(0.25, 0.9, 52, kit.mat.wood, pierX - 3.8, 1.9, 132);
  box(0.25, 0.9, 52, kit.mat.wood, pierX + 3.8, 1.9, 132);
  box(10, 0.5, 8, kit.mat.wood, pierX, 1.1, 158);
  for (const pz of [110, 130, 150]) {
    for (const px of [pierX - 3.4, pierX + 3.4]) {
      const post = new THREE.Mesh(kit.geo.post, kit.mat.wood);
      post.position.set(px, 0.2, pz);
      scene.add(post);
      colliders.push(new THREE.Box3(
        new THREE.Vector3(px - 0.35, 0, pz - 0.35),
        new THREE.Vector3(px + 0.35, 2.4, pz + 0.35)));
    }
  }

  // Beach umbrellas: bright cones on slim poles, dotted along the sand.
  const umbrellaPaint = [0xe85d5d, 0x4d9de0, 0xf2b544, 0x7bc47f];
  for (let i = 0; i < 4; i++) {
    const ux = -90 + i * 52 + rng() * 8;
    const uz = 100 + rng() * 8;
    const pole = new THREE.Mesh(kit.geo.pole, kit.mat.poleWhite);
    pole.scale.set(0.5, 0.55, 0.5);
    pole.position.set(ux, 1.5, uz);
    scene.add(pole);
    const top = new THREE.Mesh(kit.geo.cone, new THREE.MeshStandardMaterial({
      color: umbrellaPaint[i % umbrellaPaint.length], roughness: 0.7,
    }));
    top.position.set(ux, 3.2, uz);
    top.castShadow = true;
    scene.add(top);
  }

  // Palms down the beach road and two flanking the plaza.
  for (let x = -110; x <= 110; x += 20) plantPalm(x, 84);
  plantPalm(-20, 20);
  plantPalm(20, 20);

  // --- streetlights ------------------------------------------------------------
  // Lamp heads carry userData.lamp so effects.js can hang its glow sprites
  // on them (it owns the glow; this module only builds the hardware).
  const lampHeads = [];
  const flickerMats = [];
  const lampSpots = [
    [-96, -84], [-54, -84], [54, -84], [96, -84],
    [-96, -24], [-54, -24], [54, -24], [96, -24],
    [-96, 36], [96, 36], [-54, 84], [54, 84],
    [-20, 24], [20, 24],
  ];
  for (const [lx, lz] of lampSpots) lampHeads.push(plantLamp(lx, lz));
  for (let i = 0; i < 3; i++) {
    const head = lampHeads[i * 5];
    head.material = kit.mat.lamp.clone();
    flickerMats.push(head.material);
  }
  plantLamp(pierX - 3, 156);
  plantLamp(pierX + 3, 156);

  // --- billboards ----------------------------------------------------------------
  putBillboard(-108, -15, Math.PI / 2, 'SOLARA BAY', 'SUN • SURF • STREETS', '#ff9a3d', '#c94b6d', '#fff3d6');
  putBillboard(108, 15, -Math.PI / 2, 'VIPERS', 'RIDE WITH THE CREW', '#2b2b3a', '#7a1f2b', '#ffd23d');
  putBillboard(-15, 84, Math.PI, 'BEACH 200m', 'PIER 7 — OPEN ALL DAY', '#1d8fb8', '#0d5e7a', '#ffffff');

  // --- spawn points ---------------------------------------------------------------
  const curbRoads = [-90, -60, -30, 30, 60, 90];
  for (let i = 0; i < 14; i++) {
    const rx = curbRoads[i % curbRoads.length];
    const rz = -100 + ((i * 37) % 180);
    carSpawns.push(new THREE.Vector3(rx + (i % 2 === 0 ? 3.6 : -3.6), 0, rz));
  }
  carSpawns.push(new THREE.Vector3(-40, 0, 84.5));
  carSpawns.push(new THREE.Vector3(62, 0, 84.5));

  const roadXs = [-90, -60, -30, 0, 30, 60, 90];
  const roadZs = [-90, -60, -30, 0, 30, 60, 90];
  for (let i = 0; i < 45; i++) {
    if (i % 2 === 0) {
      const rx = roadXs[(rng() * roadXs.length) | 0];
      npcSpawns.push(new THREE.Vector3(rx + (rng() < 0.5 ? 6.4 : -6.4), 0, -112 + rng() * 196));
    } else {
      const rz = roadZs[(rng() * roadZs.length) | 0];
      npcSpawns.push(new THREE.Vector3(-115 + rng() * 230, 0, Math.min(88, rz + (rng() < 0.5 ? 6.4 : -6.4))));
    }
  }

  // --- per-frame life ---------------------------------------------------------------
  let clock = 0;
  let normalClock = 0;
  // One swell sample: three travelling sines summed into the wave height.
  const swell = (x, z, t) =>
    Math.sin(x * 0.08 + t * 1.2) * 0.22 +
    Math.cos(z * 0.06 + t * 0.9) * 0.22 +
    Math.sin((x + z) * 0.03 + t * 0.6) * 0.1;
  const update = (dt) => {
    clock += dt;
    // Ocean swell: only the Y channel moves; base X/Z are cached so
    // nothing is allocated per frame.
    const arr = seaPos.array;
    for (let i = 0; i < seaPos.count; i++) {
      arr[i * 3 + 1] = swell(seaRest[i * 3], seaRest[i * 3 + 2], clock);
    }
    seaPos.needsUpdate = true;
    // Normals cost more than the displacement, so refresh them 4x a second.
    normalClock += dt;
    if (normalClock > 0.25) {
      normalClock = 0;
      seaGeo.computeVertexNormals();
    }
    // A few ageing ballasts flicker faintly.
    for (let i = 0; i < flickerMats.length; i++) {
      const m = flickerMats[i];
      m.emissiveIntensity = 1.7 + Math.sin(clock * 11 + i * 2.4) * 0.18 + Math.sin(clock * 23 + i) * 0.08;
    }
    // Fountain shimmer: a tiny scale pulse on the water disc.
    const pulse = 1 + Math.sin(clock * 2.2) * 0.012;
    fountainWater.scale.set(pulse, 1, pulse);
    // The shoreline foam breathes with the swell.
    foam.material.opacity = 0.35 + Math.sin(clock * 1.4) * 0.12;
  };

  return { colliders, roads, playerSpawn, carSpawns, npcSpawns, update };

  // ===========================================================================
  // Local builders. They close over scene / rng / kit / colliders above.
  // ===========================================================================

  function plantTree(x, z, s = 1) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(kit.geo.trunk, kit.mat.trunk);
    trunk.position.y = 1.5 * s;
    trunk.scale.setScalar(s);
    trunk.castShadow = true;
    g.add(trunk);
    const puffs = [
      [0, 3.6, 0, 1.7], [-1.1, 3.0, 0.4, 1.2],
      [1.1, 3.1, -0.4, 1.2], [0.2, 4.4, -0.2, 1.1],
    ];
    for (const [px, py, pz, pr] of puffs) {
      const leaf = new THREE.Mesh(kit.geo.leaf, kit.mat.leaf);
      leaf.position.set(px * s, py * s, pz * s);
      leaf.scale.set(pr * s, pr * 0.85 * s, pr * s);
      leaf.castShadow = true;
      g.add(leaf);
    }
    g.position.set(x, 0, z);
    scene.add(g);
  }

  function plantPalm(x, z) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(kit.geo.palmTrunk, kit.mat.palmTrunk);
    trunk.position.y = 3.2;
    trunk.rotation.z = (rng() - 0.5) * 0.16;
    trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const frond = new THREE.Mesh(kit.geo.leaf, kit.mat.palmLeaf);
      frond.position.set(Math.cos(a) * 1.5, 6.5, Math.sin(a) * 1.5);
      frond.scale.set(1.9, 0.45, 0.7);
      frond.rotation.y = -a;
      frond.castShadow = true;
      g.add(frond);
    }
    const crown = new THREE.Mesh(kit.geo.leaf, kit.mat.palmLeaf);
    crown.position.y = 6.6;
    crown.scale.set(1.1, 0.7, 1.1);
    g.add(crown);
    g.position.set(x, 0, z);
    scene.add(g);
  }

  function placeBench(x, z, rotY = 0) {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(kit.geo.box, kit.mat.bench);
    seat.scale.set(2.2, 0.14, 0.6);
    seat.position.y = 0.5;
    const back = new THREE.Mesh(kit.geo.box, kit.mat.bench);
    back.scale.set(2.2, 0.7, 0.12);
    back.position.set(0, 0.95, -0.28);
    back.rotation.x = -0.18;
    g.add(seat, back);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    scene.add(g);
  }

  function plantLamp(x, z) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(kit.geo.pole, kit.mat.poleDark);
    pole.position.y = 2.8;
    pole.castShadow = true;
    g.add(pole);
    const arm = new THREE.Mesh(kit.geo.box, kit.mat.poleDark);
    arm.scale.set(1.9, 0.12, 0.12);
    arm.position.set(0.85, 5.5, 0);
    g.add(arm);
    const head = new THREE.Mesh(kit.geo.lampHead, kit.mat.lamp);
    head.position.set(1.8, 5.4, 0);
    head.userData.lamp = true;
    g.add(head);
    g.position.set(x, 0, z);
    scene.add(g);
    return head;
  }

  function raiseTower(cx, cz, w, d, h) {
    const v = kit.facades[(rng() * kit.facades.length) | 0];
    // Clone the facade maps so the window grid keeps a constant world
    // density whatever the tower size (no stretched windows).
    const map = v.map.clone();
    map.needsUpdate = true;
    map.repeat.set(Math.max(1, w / 12), Math.max(1, h / 24));
    const glow = v.emissive.clone();
    glow.needsUpdate = true;
    glow.repeat.copy(map.repeat);
    const face = new THREE.MeshStandardMaterial({
      map, emissiveMap: glow, emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.55, roughness: 0.85, metalness: 0.05,
    });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      [face, face, kit.mat.roof, kit.mat.dark, face, face]);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(cx - w / 2, 0, cz - d / 2),
      new THREE.Vector3(cx + w / 2, h, cz + d / 2)));
    // Roof clutter: an AC box on about half the roofs, a tank on a third.
    if (rng() < 0.55) box(2.2, 1, 1.6, kit.mat.metal, cx + w * 0.2, h + 0.5, cz - d * 0.15);
    if (rng() < 0.35) {
      const tank = new THREE.Mesh(kit.geo.tank, kit.mat.metal);
      tank.position.set(cx - w * 0.22, h + 0.8, cz + d * 0.18);
      tank.castShadow = true;
      scene.add(tank);
    }
    // Slim parapet lips so the roof reads flat from the street.
    box(w + 0.3, 0.35, 0.3, kit.mat.roof, cx, h + 0.17, cz - d / 2);
    box(w + 0.3, 0.35, 0.3, kit.mat.roof, cx, h + 0.17, cz + d / 2);
  }

  function putBillboard(x, z, rotY, title, sub, bg1, bg2, fg) {
    const g = new THREE.Group();
    const tex2 = paintCanvas(512, 256, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, bg1);
      grad.addColorStop(1, bg2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 10;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.font = 'bold 64px Arial, sans-serif';
      ctx.fillText(title, w / 2, h / 2 - 6);
      ctx.font = 'bold 30px Arial, sans-serif';
      ctx.fillText(sub, w / 2, h / 2 + 52);
    });
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 6.5),
      new THREE.MeshStandardMaterial({
        map: tex2, roughness: 0.6,
        emissive: 0xffffff, emissiveMap: tex2, emissiveIntensity: 0.25,
      }));
    board.position.y = 8;
    board.castShadow = true;
    g.add(board);
    for (const lx of [-4.5, 4.5]) {
      const leg = new THREE.Mesh(kit.geo.pole, kit.mat.poleDark);
      leg.scale.set(1.4, 1.5, 1.4);
      leg.position.set(lx, 3.4, 0);
      g.add(leg);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    scene.add(g);
  }
}

// ---------------------------------------------------------------------------
// Deterministic RNG (xorshift32) — the same seed lays out the same city.
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Fisher–Yates, in place, driven by the seeded RNG.
function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

// A ground plane already lying flat (rotateX baked into the geometry).
function flatPlane(w, d) {
  return new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
}

// ---------------------------------------------------------------------------
// Canvas textures: paint into a 2d context, wrap the result as a texture.
// ---------------------------------------------------------------------------
function paintCanvas(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Random grain: n tiny translucent squares in the given colours.
function dust(ctx, w, h, rng, n, colours, maxSize = 2) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colours[(rng() * colours.length) | 0];
    ctx.globalAlpha = 0.12 + rng() * 0.25;
    const s = 1 + rng() * maxSize;
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

function roadPaint(rng) {
  return paintCanvas(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#33373d';
    ctx.fillRect(0, 0, w, h);
    dust(ctx, w, h, rng, 900, ['#3d4148', '#2b2e33', '#454a52', '#4a4f57']);
    ctx.fillStyle = 'rgba(230,230,220,0.55)';
    ctx.fillRect(4, 0, 3, h);
    ctx.fillRect(w - 7, 0, 3, h);
    ctx.fillStyle = '#e8c84a';
    for (let y = 0; y < h; y += 42) ctx.fillRect(w / 2 - 2, y + 6, 4, 24);
  }, 1, 10);
}

function walkPaint(rng) {
  return paintCanvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b9b2a4';
    ctx.fillRect(0, 0, w, h);
    dust(ctx, w, h, rng, 500, ['#c6bfb0', '#a89f8c', '#cfc8b8']);
    ctx.strokeStyle = 'rgba(90,84,72,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(0, (i * h) / 4); ctx.lineTo(w, (i * h) / 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo((i * w) / 4, 0); ctx.lineTo((i * w) / 4, h); ctx.stroke();
    }
  }, 1, 6);
}

function sandPaint(rng) {
  return paintCanvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e9d29b';
    ctx.fillRect(0, 0, w, h);
    dust(ctx, w, h, rng, 1600, ['#f2e2b6', '#d9bd7f', '#cdb27a', '#fff3cf'], 2.4);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = ['#ffffff', '#e8a87c', '#c9b8a0'][(rng() * 3) | 0];
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, 1.5 + rng() * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, 10, 1);
}

function seaPaint(rng) {
  return paintCanvas(128, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2fa8c9');
    g.addColorStop(0.5, '#1d8fb8');
    g.addColorStop(1, '#187a9e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const y = rng() * h;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.09 + i) * 3);
      ctx.stroke();
    }
  }, 6, 3);
}

function plazaPaint(rng) {
  return paintCanvas(256, 256, (ctx, w, h) => {
    const cols = ['#e8dcc3', '#d9a05b', '#c97b5a', '#efe6cf'];
    const n = 4;
    const s = w / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        ctx.fillStyle = cols[(x + y * 2) % cols.length];
        ctx.fillRect(x * s, y * s, s, s);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        for (let k = 0; k < 10; k++) {
          ctx.fillRect(x * s + rng() * s, y * s + rng() * s, 2, 2);
        }
      }
    }
    ctx.strokeStyle = 'rgba(120,90,60,0.6)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(w, i * s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, h); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(180,60,50,0.85)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 16, 0, Math.PI * 2);
    ctx.fill();
  }, 5, 5);
}

function lawnPaint(rng) {
  return paintCanvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#6fa055';
    ctx.fillRect(0, 0, w, h);
    dust(ctx, w, h, rng, 1100, ['#7fb069', '#5d8a48', '#8cb96f', '#4f7d3e']);
  }, 6, 6);
}

// One facade variant: a colour map with lit windows plus a matching
// emissive map (black except the warm lit windows) so glass glows at dusk.
function facadePaint(rng, base) {
  const cols = 5;
  const rows = 10;
  const lit = [];
  for (let r = 0; r < rows; r++) {
    lit[r] = [];
    for (let c = 0; c < cols; c++) lit[r][c] = rng() < 0.28;
  }
  const draw = (ctx, w, h, emissiveOnly) => {
    if (!emissiveOnly) {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(40,30,25,0.85)';
      ctx.fillRect(0, h - 18, w, 18);
    } else {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
    }
    const mx = 12;
    const my = 12;
    const ww = (w - mx * 2 - (cols - 1) * 7) / cols;
    const wh = (h - my * 2 - (rows - 1) * 7 - 18) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = mx + c * (ww + 7);
        const y = my + r * (wh + 7);
        if (emissiveOnly) {
          if (!lit[r][c]) continue;
          ctx.fillStyle = '#ffc46b';
          ctx.fillRect(x, y, ww, wh);
        } else if (lit[r][c]) {
          ctx.fillStyle = '#ffd27a';
          ctx.fillRect(x, y, ww, wh);
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillRect(x, y, ww, 3);
        } else {
          ctx.fillStyle = '#26313d';
          ctx.fillRect(x, y, ww, wh);
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.fillRect(x, y, ww, 3);
        }
      }
    }
  };
  return {
    map: paintCanvas(128, 256, (ctx, w, h) => draw(ctx, w, h, false)),
    emissive: paintCanvas(128, 256, (ctx, w, h) => draw(ctx, w, h, true)),
  };
}

// Builds every texture once and hands them back as one object.
function makeTextures(rng) {
  const crosswalk = paintCanvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#33373d';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(245,245,235,0.9)';
    for (let i = 0; i < 5; i++) ctx.fillRect(8 + i * 24, 6, 12, h - 12);
  });
  const bases = ['#e8a87c', '#d9a05b', '#c97b5a', '#e0c090', '#b87a6a', '#d99a6c'];
  return {
    asphalt: roadPaint(rng),
    sidewalk: walkPaint(rng),
    sand: sandPaint(rng),
    sea: seaPaint(rng),
    plaza: plazaPaint(rng),
    grass: lawnPaint(rng),
    crosswalk,
    facades: bases.map((b) => facadePaint(rng, b)),
  };
}

// Shared geometries + materials, built once and reused by every mesh.
function makeKit(tex) {
  const std = (opts) => new THREE.MeshStandardMaterial(opts);
  return {
    geo: {
      box: new THREE.BoxGeometry(1, 1, 1),
      trunk: new THREE.CylinderGeometry(0.16, 0.3, 3, 7),
      palmTrunk: new THREE.CylinderGeometry(0.14, 0.26, 6.4, 7),
      leaf: new THREE.SphereGeometry(1, 10, 8),
      pole: new THREE.CylinderGeometry(0.09, 0.13, 5.6, 8),
      lampHead: new THREE.SphereGeometry(0.24, 10, 8),
      post: new THREE.CylinderGeometry(0.22, 0.22, 4.2, 8),
      tank: new THREE.CylinderGeometry(0.9, 0.9, 1.6, 12),
      cone: new THREE.ConeGeometry(2.2, 1.4, 10),
    },
    mat: {
      ground: std({ color: 0xa89f8d, roughness: 1 }),
      seabed: std({ color: 0xcbb27e, roughness: 1 }),
      asphalt: std({ map: tex.asphalt, roughness: 0.95 }),
      sidewalk: std({ map: tex.sidewalk, roughness: 0.95 }),
      grass: std({ map: tex.grass, roughness: 1 }),
      plaza: std({ map: tex.plaza, roughness: 0.9 }),
      sand: std({ map: tex.sand, roughness: 1 }),
      crosswalk: std({ map: tex.crosswalk, roughness: 0.95 }),
      ocean: std({
        map: tex.sea, color: 0x59b8d8, roughness: 0.2, metalness: 0.1,
        transparent: true, opacity: 0.93,
      }),
      foam: std({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0.4 }),
      water: std({ color: 0x2a9ec4, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 }),
      roof: std({ color: 0x6b6560, roughness: 1 }),
      dark: std({ color: 0x3a352f, roughness: 1 }),
      trunk: std({ color: 0x7a5230, roughness: 1 }),
      palmTrunk: std({ color: 0x8a6a44, roughness: 1 }),
      leaf: std({ color: 0x4d8a3f, roughness: 0.9 }),
      palmLeaf: std({ color: 0x3f9e4d, roughness: 0.9 }),
      poleDark: std({ color: 0x2e3136, roughness: 0.6, metalness: 0.5 }),
      poleWhite: std({ color: 0xeeeeee, roughness: 0.6 }),
      lamp: std({ color: 0x444444, emissive: 0xffe6a0, emissiveIntensity: 1.8, roughness: 0.4 }),
      wood: std({ color: 0x9a6b42, roughness: 0.95 }),
      bench: std({ color: 0x8a5a34, roughness: 0.9 }),
      metal: std({ color: 0x9aa0a6, roughness: 0.45, metalness: 0.6 }),
      stone: std({ color: 0xcfc4ae, roughness: 0.9 }),
    },
    facades: tex.facades,
  };
}

// Integrator notes:
// - Call once: const city = buildCity(scene); then city.update(dt) each frame.
// - city.colliders is a THREE.Box3[] (towers + fountain + pier posts).
// - city.roads is { from: Vector3, to: Vector3 }[] — 14 grid segments the
//   traffic AI drives along; cars stay on them, never across blocks.
// - Lamp heads carry userData.lamp = true; effects.js finds them and hangs
//   the additive glow sprites on them (see effects.js).
