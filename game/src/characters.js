// ---------------------------------------------------------------------------
// Solara Bay — characters: hero + street crowd
// Every figure is sculpted from smooth primitives (spheres, capsules,
// tapered cylinders) with real human proportions: a rounded head that is
// clearly narrower than the shoulders, a visible neck, a torso that tapers
// at the waist, jointed limbs and hands. No boxes for bodies, no cartoon
// eyes — the face is built from small, correctly placed features so it
// holds up in a close-up.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

// --- palettes ---------------------------------------------------------------

const SKIN_SHADES = [
  0xf3cdaa, 0xeab98d, 0xdba374, 0xc98a5e, 0xac7048, 0x8c5a38, 0x6e442c,
];

const CROWD = [
  {
    label: 'beachgoer', pace: 1.1, height: 1.0, bulk: 0.98, sleeve: 'short', shorts: true,
    tops: [0xff7a59, 0xffd23f, 0x2ec4b6, 0xff9f1c], bottoms: [0x2b7a78, 0xe07a5f, 0x6d9dc5],
    footwear: [0xf5f0e6, 0x8a5a3b], hairTones: [0x1d130c, 0x4a2f1a, 0x8a6b3f], trim: null,
  },
  {
    label: 'business', pace: 1.35, height: 1.03, bulk: 1.02, sleeve: 'long', shorts: false,
    tops: [0x2b2d42, 0x3a3f5c, 0x1f2937, 0x4a3b52], bottoms: [0x23232e, 0x2b2d42, 0x1f2937],
    footwear: [0x1a1512, 0x2a2118], hairTones: [0x14100c, 0x2b1d12, 0x5a5a5a], trim: 'tie',
  },
  {
    label: 'jogger', pace: 2.3, height: 0.99, bulk: 0.94, sleeve: 'short', shorts: true,
    tops: [0xe23b3b, 0x1fa37c, 0x2563eb, 0xf59e0b], bottoms: [0x1f2937, 0x374151, 0x0f766e],
    footwear: [0xf2f2ee, 0xe23b3b, 0x2563eb], hairTones: [0x1d130c, 0x3a2415],
    trim: 'headband', tint: 0xe23b3b,
  },
  {
    label: 'vendor', pace: 0.8, height: 1.0, bulk: 1.08, sleeve: 'short', shorts: false,
    tops: [0xd94f2b, 0x2a9d8f, 0xe9c46a], bottoms: [0x3d405b, 0x5a5a5a, 0x2b3440],
    footwear: [0x3a2e24, 0x1a1512], hairTones: [0x1d130c, 0x4a2f1a, 0x6b6b6b],
    trim: 'cap', tint: 0xd94f2b,
  },
  {
    label: 'tourist', pace: 0.9, height: 0.97, bulk: 1.0, sleeve: 'short', shorts: true,
    tops: [0xffb703, 0xfb8500, 0x8ecae6, 0x90be6d], bottoms: [0x8d99ae, 0x6d6875, 0x2b7a78],
    footwear: [0xf5f0e6, 0xd9d9d9], hairTones: [0x8a6b3f, 0x2b1d12, 0xd9d9d9], trim: 'hat',
  },
  {
    label: 'dockworker', pace: 1.0, height: 1.06, bulk: 1.18, sleeve: 'short', shorts: false,
    tops: [0x3a506b, 0x5c677d, 0x2f3e46], bottoms: [0x2b2d42, 0x343a40, 0x495057],
    footwear: [0x4a3521, 0x2a2118], hairTones: [0x14100c, 0x2b1d12], trim: 'helmet',
  },
  {
    label: 'student', pace: 1.55, height: 0.94, bulk: 0.92, sleeve: 'long', shorts: false,
    tops: [0x7b2cbf, 0x4361ee, 0x06d6a0, 0xef476f], bottoms: [0x2b3440, 0x3d405b, 0x1f2937],
    footwear: [0xf2f2ee, 0x1a1512], hairTones: [0x1d130c, 0x2b1d12, 0x4a2f1a],
    trim: 'backpack', tint: 0x3b6fd4,
  },
];

const CITY_LIMIT = 120;
const CROWD_SIZE = 45;

// --- tiny utilities ---------------------------------------------------------

function rnd(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

function choose(list) {
  return list[(Math.random() * list.length) | 0];
}

function std(color, rough = 0.72) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02 });
}

function put(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function limbCapsule(radius, len, material) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 6, 14), material);
}

// --- face -------------------------------------------------------------------
// Head local space: origin at the centre of the skull, +Z is the face.
// The skull is an upright egg (taller than wide); the jaw is a second,
// smaller sphere tucked low and forward so the chin reads. Eyes sit in
// shallow sockets: small white ellipsoids with dark pupils, brows are thin
// curved bars above them, the nose is a soft rounded wedge, the mouth a
// narrow closed curve. Everything is small relative to the head — that is
// what keeps the face human instead of doll-like.
function sculptFace(head, skinHex, hairHex, browRaise = 0) {
  const skin = std(skinHex, 0.75);
  const hair = std(hairHex, 0.92);

  // Jaw / chin: narrows the lower face so the head is not a plain ball.
  const jaw = put(new THREE.SphereGeometry(0.115, 18, 14), skin, 0, -0.075, 0.028);
  jaw.scale.set(0.86, 0.82, 0.9);
  head.add(jaw);
  // Chin tip.
  const chin = put(new THREE.SphereGeometry(0.045, 12, 10), skin, 0, -0.128, 0.085);
  chin.scale.set(1.1, 0.75, 0.8);
  head.add(chin);

  // Eyes: sclera ellipsoids sunk slightly into the skull, pupils on top.
  const eyeY = 0.018;
  const eyeX = 0.06;
  const eyeZ = 0.132;
  for (const side of [-1, 1]) {
    const white = put(new THREE.SphereGeometry(0.034, 14, 12), std(0xf8f6f0, 0.32), side * eyeX, eyeY, eyeZ);
    white.scale.set(1, 1.3, 0.5);
    head.add(white);
    const pupil = put(new THREE.SphereGeometry(0.016, 10, 8), std(0x17110d, 0.28), side * eyeX, eyeY, eyeZ + 0.018);
    pupil.scale.set(1, 1.3, 0.45);
    head.add(pupil);
    // Upper lid line: a thin dark arc hugging the top of the eye.
    const lid = new THREE.Mesh(
      new THREE.TorusGeometry(0.036, 0.005, 6, 12, Math.PI * 0.9),
      std(0x2a1c12, 0.8),
    );
    lid.position.set(side * eyeX, eyeY + 0.008, eyeZ + 0.006);
    lid.rotation.set(0.2, side * 0.12, side * -0.2);
    head.add(lid);
  }

  // Brows: slim tapered bars, angled a touch for a calm, focused look.
  for (const side of [-1, 1]) {
    const brow = put(new THREE.CapsuleGeometry(0.008, 0.055, 4, 8), std(0x241a12, 0.85), side * eyeX, eyeY + 0.062 + browRaise, eyeZ + 0.012);
    brow.rotation.set(0.3, 0, Math.PI / 2 + side * 0.16);
    brow.castShadow = false;
    head.add(brow);
  }

  // Nose: a rounded bridge wedge plus a soft tip ball — reads as a nose
  // from the front and in profile, without a sharp cone poking out.
  const bridge = put(new THREE.SphereGeometry(0.028, 10, 8), skin, 0, -0.012, 0.15);
  bridge.scale.set(0.7, 1.5, 0.7);
  bridge.castShadow = false;
  head.add(bridge);
  const tip = put(new THREE.SphereGeometry(0.022, 10, 8), skin, 0, -0.052, 0.152);
  tip.scale.set(1.15, 0.8, 0.9);
  tip.castShadow = false;
  head.add(tip);

  // Mouth: a narrow closed-lip curve, slightly darker than the skin.
  const lips = new THREE.Mesh(
    new THREE.TorusGeometry(0.03, 0.0055, 6, 12, Math.PI),
    std(0x7e4034, 0.7),
  );
  lips.position.set(0, -0.082, 0.132);
  lips.rotation.set(0.12, 0, Math.PI);
  lips.castShadow = false;
  head.add(lips);

  // Hair, layered so it frames the face: a back volume, a top sweep that
  // covers the crown, a fringe brushed across the forehead, and short
  // sideburns at the temples.
  const crown = put(new THREE.SphereGeometry(0.168, 18, 14), hair, 0, 0.068, -0.01);
  crown.scale.set(1.03, 0.66, 1.04);
  head.add(crown);
  const fringe = put(new THREE.SphereGeometry(0.148, 16, 12), hair, 0.01, 0.052, 0.062);
  fringe.scale.set(1.02, 0.45, 0.7);
  head.add(fringe);
  const rear = put(new THREE.SphereGeometry(0.158, 16, 12), hair, 0, 0.015, -0.052);
  rear.scale.set(0.99, 0.96, 0.88);
  head.add(rear);
  for (const side of [-1, 1]) {
    const sideburn = put(new THREE.SphereGeometry(0.062, 12, 10), hair, side * 0.148, 0.0, 0.05);
    sideburn.scale.set(0.42, 1.0, 0.78);
    head.add(sideburn);
    const ear = put(new THREE.SphereGeometry(0.03, 10, 8), skin, side * 0.156, -0.012, 0.005);
    ear.scale.set(0.5, 1.05, 0.72);
    ear.castShadow = false;
    head.add(ear);
  }
}

// --- accessories ------------------------------------------------------------
// Each trim is a small builder that decorates a finished figure. Keeping
// them in a table (instead of a long if-chain) makes the archetypes easy
// to extend without touching the body builder.
const TRIMS = {
  cap(inner, spec) {
    const accent = std(spec.tint ?? 0xd94f2b, 0.7);
    inner.add(put(new THREE.CylinderGeometry(0.168, 0.172, 0.07, 16), accent, 0, 1.865, 0));
    inner.add(put(new THREE.BoxGeometry(0.2, 0.014, 0.13), accent, 0, 1.845, 0.2));
  },
  helmet(inner) {
    const shell = put(new THREE.SphereGeometry(0.188, 16, 12), std(0xf2a516, 0.45), 0, 1.785, 0);
    shell.scale.set(1, 0.7, 1);
    inner.add(shell);
  },
  hat(inner) {
    const straw = std(0xe8d9a8, 0.85);
    inner.add(put(new THREE.CylinderGeometry(0.09, 0.13, 0.1, 14), straw, 0, 1.885, 0));
    inner.add(put(new THREE.CylinderGeometry(0.245, 0.245, 0.02, 18), straw, 0, 1.835, 0));
  },
  headband(inner, spec) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.168, 0.017, 8, 20),
      std(spec.tint ?? 0xe23b3b, 0.6),
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.765;
    inner.add(band);
  },
  backpack(inner, spec) {
    inner.add(put(new THREE.BoxGeometry(0.3, 0.38, 0.14), std(spec.tint ?? 0x3b6fd4, 0.8), 0, 1.28, -0.25));
  },
  vest(inner, spec) {
    const shell = put(new THREE.CylinderGeometry(0.228 * spec.bulk, 0.192 * spec.bulk, 0.4, 18), std(0xf07d1a, 0.65), 0, 1.28, 0);
    shell.scale.set(1, 1, 0.92);
    inner.add(shell);
  },
  tie(inner, spec) {
    inner.add(put(new THREE.BoxGeometry(0.055, 0.34, 0.016), std(0x8c1f28, 0.6), 0, 1.3, 0.202 * spec.bulk));
  },
  apron(inner, spec) {
    inner.add(put(new THREE.BoxGeometry(0.34, 0.44, 0.02), std(0xf5efe2, 0.85), 0, 1.18, 0.192 * spec.bulk));
  },
};

// --- one human figure -------------------------------------------------------
// Local space: feet at y = 0, facing +Z, ~1.8 * scale tall. Pivots are
// returned so walk / aim animation can drive them directly.
function assembleFigure(spec) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);

  const skin = std(spec.skin);
  const top = std(spec.shirt);
  const bottoms = std(spec.pants);
  const footwear = std(spec.shoes, 0.5);
  const bulk = spec.bulk ?? 1;

  // Torso first: a tapered cylinder (wide shoulders, narrower waist) with
  // a rounded shoulder cap, a waistband and a faint centre seam.
  inner.add(put(new THREE.CylinderGeometry(0.212 * bulk, 0.168 * bulk, 0.56, 18), top, 0, 1.24, 0));
  const shoulderCap = put(new THREE.SphereGeometry(0.212 * bulk, 18, 12), top, 0, 1.47, 0);
  shoulderCap.scale.set(1.12, 0.55, 0.85);
  inner.add(shoulderCap);
  inner.add(put(new THREE.CylinderGeometry(0.18 * bulk, 0.18 * bulk, 0.05, 18), std(0x2a2118, 0.6), 0, 0.97, 0));
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.5, 0.012),
    new THREE.MeshStandardMaterial({
      color: spec.seam ?? 0x1c1c1c, roughness: 0.8, transparent: true, opacity: 0.55,
    }),
  );
  seam.position.set(0, 1.24, 0.186 * bulk);
  seam.castShadow = false;
  inner.add(seam);

  // Neck + head.
  inner.add(put(new THREE.CylinderGeometry(0.055, 0.066, 0.1, 12), skin, 0, 1.55, 0));
  const head = new THREE.Group();
  head.position.set(0, 1.7, 0);
  inner.add(head);
  const skull = put(new THREE.SphereGeometry(0.16, 22, 18), skin, 0, 0, 0);
  skull.scale.set(0.94, 1.07, 0.98);
  head.add(skull);
  sculptFace(head, spec.skin, spec.hair, spec.browRaise ?? 0);

  // Arms: shoulder pivot -> upper arm -> elbow pivot -> forearm -> hand.
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.26 * bulk, 1.47, 0);
    inner.add(shoulder);
    const upper = limbCapsule(0.055 * bulk, 0.22, spec.sleeve === 'short' ? skin : top);
    upper.position.y = -0.15;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.31;
    shoulder.add(elbow);
    const forearm = limbCapsule(0.047 * bulk, 0.22, skin);
    forearm.position.y = -0.14;
    elbow.add(forearm);
    const hand = put(new THREE.SphereGeometry(0.058, 12, 10), skin, 0, -0.31, 0);
    hand.scale.set(0.85, 1.15, 0.9);
    elbow.add(hand);
    return { shoulder, elbow, hand };
  }

  // Legs: hip pivot -> thigh -> knee pivot -> shin -> shoe + toe cap.
  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.105 * bulk, 0.96, 0);
    inner.add(hip);
    const thigh = limbCapsule(0.072 * bulk, 0.3, bottoms);
    thigh.position.y = -0.2;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.43;
    hip.add(knee);
    const shin = limbCapsule(0.056 * bulk, 0.3, spec.shorts ? skin : bottoms);
    shin.position.y = -0.19;
    knee.add(shin);
    const shoe = put(new THREE.BoxGeometry(0.11, 0.07, 0.26), footwear, 0, -0.4, 0.045);
    knee.add(shoe);
    const toe = put(new THREE.SphereGeometry(0.055, 10, 8), footwear, 0, -0.4, 0.17);
    toe.scale.set(1, 0.62, 0.8);
    knee.add(toe);
    return { hip, knee };
  }

  const armL = makeArm(-1);
  const armR = makeArm(1);
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // Archetype trim, if any.
  if (spec.trim && TRIMS[spec.trim]) TRIMS[spec.trim](inner, spec);

  group.scale.setScalar(spec.scale ?? 1);
  return { group, inner, head, armL, armR, legL, legR };
}

// --- pistol -----------------------------------------------------------------
function makePistol() {
  const gunmetal = std(0x1c1e22, 0.35);
  const pistol = new THREE.Group();
  pistol.add(put(new THREE.BoxGeometry(0.035, 0.09, 0.045), gunmetal, 0, -0.02, 0));
  pistol.add(put(new THREE.BoxGeometry(0.032, 0.035, 0.17), gunmetal, 0, 0.03, 0.045));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.06, 10), gunmetal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, 0.15);
  barrel.castShadow = false;
  pistol.add(barrel);
  // Sit in the palm, barrel forward (+Z), tilted up a touch.
  pistol.position.set(0, -0.31, 0.05);
  pistol.rotation.x = 0.15;
  return pistol;
}

// --- hero -------------------------------------------------------------------
function makeHero() {
  const built = assembleFigure({
    skin: 0xc68863,
    hair: 0x2b1d12,
    shirt: 0x2e6f8e,
    seam: 0x17394a,
    pants: 0x2b3440,
    shoes: 0xf2f2ee,
    scale: 1.0,
    bulk: 1.05,
    sleeve: 'short',
  });

  const pistol = makePistol();
  built.armR.elbow.add(pistol);

  return {
    group: built.group,
    inner: built.inner,
    head: built.head,
    armL: built.armL,
    armR: built.armR,
    legL: built.legL,
    legR: built.legR,
    pistol,
    pos: built.group.position,
    health: 100,
    speed: 4.2,
    moving: false,
    walkPhase: 0,
  };
}

// --- pedestrians ------------------------------------------------------------
function pickTarget() {
  return new THREE.Vector3(rnd(-108, 108), 0, rnd(-108, 108));
}

function spawnPedestrian(index) {
  const arch = CROWD[index % CROWD.length];
  const scale = arch.height * rnd(0.9, 1.1);
  const built = assembleFigure({
    skin: choose(SKIN_SHADES),
    hair: choose(arch.hairTones),
    shirt: choose(arch.tops),
    pants: choose(arch.bottoms),
    shoes: choose(arch.footwear),
    scale,
    bulk: arch.bulk * rnd(0.94, 1.06),
    sleeve: arch.sleeve,
    shorts: arch.shorts,
    trim: arch.trim,
    tint: arch.tint,
    seam: 0x1c1c1c,
    browRaise: rnd(-0.004, 0.004),
  });

  // Vendors loiter near the centre; everyone else starts anywhere.
  const start = arch.label === 'vendor'
    ? new THREE.Vector3(rnd(-30, 30), 0, rnd(-30, 30))
    : new THREE.Vector3(rnd(-110, 110), 0, rnd(-110, 110));
  built.group.position.copy(start);

  const heading = new THREE.Vector3();
  const pedestrian = {
    group: built.group,
    inner: built.inner,
    head: built.head,
    armL: built.armL,
    armR: built.armR,
    legL: built.legL,
    legR: built.legR,
    archetype: arch.label,
    pos: built.group.position,
    speed: arch.pace * rnd(0.85, 1.15),
    walkPhase: rnd(0, Math.PI * 2),
    target: pickTarget(),
    aiming: false,
    update(dt) {
      heading.subVectors(this.target, this.pos);
      heading.y = 0;
      const remaining = heading.length();
      if (remaining < 1.0) {
        this.target = pickTarget();
        return;
      }
      heading.normalize();
      this.pos.addScaledVector(heading, this.speed * dt);
      // Turn smoothly toward the travel direction instead of snapping.
      const wanted = Math.atan2(heading.x, heading.z);
      let delta = wanted - this.group.rotation.y;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.group.rotation.y += delta * Math.min(1, dt * 6);

      // Walk cycle: legs and arms swing in opposition, knees bend on the
      // back-swing, body bobs a touch at each step.
      this.walkPhase += dt * this.speed * 3.4;
      const swing = Math.sin(this.walkPhase);
      const kneeL = Math.max(0, -swing) * 0.7;
      const kneeR = Math.max(0, swing) * 0.7;
      this.legL.hip.rotation.x = swing * 0.55;
      this.legR.hip.rotation.x = -swing * 0.55;
      this.legL.knee.rotation.x = kneeL;
      this.legR.knee.rotation.x = kneeR;
      if (!this.aiming) {
        this.armL.shoulder.rotation.x = -swing * 0.45;
        this.armR.shoulder.rotation.x = swing * 0.45;
      } else {
        this.legL.hip.rotation.x = swing * 0.3;
        this.legR.hip.rotation.x = -swing * 0.3;
      }
      this.inner.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.03;
      if (Math.abs(this.pos.x) > CITY_LIMIT || Math.abs(this.pos.z) > CITY_LIMIT) {
        this.pos.x = THREE.MathUtils.clamp(this.pos.x, -CITY_LIMIT, CITY_LIMIT);
        this.pos.z = THREE.MathUtils.clamp(this.pos.z, -CITY_LIMIT, CITY_LIMIT);
        this.target = pickTarget();
      }
    },
  };
  return pedestrian;
}

// --- factory ----------------------------------------------------------------
export function createCharacters(scene) {
  const hero = makeHero();
  hero.group.position.set(0, 0, 8);
  scene.add(hero.group);

  const npcs = [];
  for (let i = 0; i < CROWD_SIZE; i++) {
    const npc = spawnPedestrian(i);
    scene.add(npc.group);
    npcs.push(npc);
  }

  // Idle breathing clock: the hero's chest rises and falls faintly when
  // standing still, so the figure never looks frozen between moves.
  let idleClock = 0;

  function update(dt) {
    idleClock += dt;
    if (hero.moving) {
      hero.walkPhase += dt * 7.5;
      const swing = Math.sin(hero.walkPhase);
      hero.legL.hip.rotation.x = swing * 0.6;
      hero.legR.hip.rotation.x = -swing * 0.6;
      hero.legL.knee.rotation.x = Math.max(0, -swing) * 0.8;
      hero.legR.knee.rotation.x = Math.max(0, swing) * 0.8;
      hero.armL.shoulder.rotation.x = -swing * 0.5;
      // Gun arm stays steadier: a small counter-swing, elbow slightly bent.
      hero.armR.shoulder.rotation.x = swing * 0.18;
      hero.armR.elbow.rotation.x = -0.25;
      hero.inner.position.y = Math.abs(Math.cos(hero.walkPhase)) * 0.035;
    } else {
      // Relax toward the idle stance; a faint breathing bob keeps the
      // figure from looking frozen.
      const ease = Math.min(1, dt * 8);
      const relax = 1 - ease;
      hero.legL.hip.rotation.x *= relax;
      hero.legR.hip.rotation.x *= relax;
      hero.legL.knee.rotation.x *= relax;
      hero.legR.knee.rotation.x *= relax;
      hero.armL.shoulder.rotation.x *= relax;
      hero.armR.shoulder.rotation.x *= relax;
      hero.armR.elbow.rotation.x *= relax;
      hero.armL.elbow.rotation.x *= relax;
      // Breathing bob replaces the walk bob once the limbs have relaxed.
      hero.inner.position.y = hero.inner.position.y * relax
        + Math.sin(idleClock * 1.8) * 0.006 * ease;
    }
    for (const npc of npcs) npc.update(dt);
  }

  return { hero, npcs, update };
}
