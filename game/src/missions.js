// Solara Bay — missions.js (v3 rewrite)
// A six-mission story arc against the "Vipers" gang.
// Each mission is a self-contained definition: a title, a briefing, a
// reward, a world target, plus two small hooks — `arm` runs once when the
// mission starts (staging, wanted level), `done` runs every frame and
// reports when the player has finished it. The engine only ever talks to
// the outside world through the `opts` object the integrator passes in,
// and every subsystem call is guarded, so a missing subsystem can never
// crash the loop or soft-lock the story.

import * as THREE from 'three';

// Where each mission plays out. The integrator can override any of these
// by passing opts.targets = { pier: { x, y, z }, ... }.
const SPOTS = {
  pier:    { x: 42,  y: 0, z: -58 },
  beach:   { x: -34, y: 0, z: 52 },
  plaza:   { x: 0,   y: 0, z: 0 },
  docks:   { x: -62, y: 0, z: -38 },
  hideout: { x: 56,  y: 0, z: -44 },
  finish:  { x: -22, y: 0, z: 72 },
};

const GOLD = 0xffc233;
const GOLD_LIGHT = 0xffe066;

// Accept a plain {x,y,z} object, a Vector3, or anything falsy.
function asVec3(p) {
  if (!p) return null;
  if (p.isVector3) return p;
  if (typeof p.x === 'number' && typeof p.z === 'number') {
    return new THREE.Vector3(p.x, p.y || 0, p.z);
  }
  return null;
}

// Flat (XZ) distance — missions are checked on the ground plane.
function flatDist(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function createMissions(opts) {
  const o = opts || {};
  const spots = Object.assign({}, SPOTS, o.targets || {});

  // ---------------------------------------------------------- live state
  // Delay (seconds) between "Mission Complete" and the next briefing.
  const NEXT_BEAT = 2.5;

  const run = {
    at: -1,            // index of the active mission, -1 = idle
    clock: 0,          // seconds spent inside the active mission
    hold: 0,           // fallback "hold the area" timer (viper nest)
    ambushFired: false,
    killsAtStart: -1,
    killsNeeded: 0,
    nextIn: -1,        // countdown to auto-starting the next mission
    finished: 0,       // missions completed so far
  };

  // ---------------------------------------------------------- 3D marker
  // A tall light beam, a ground ring and a spinning gem mark the target.
  let beacon = null;
  let gem = null;
  let gemPhase = 0;

  function dropBeacon() {
    if (beacon && o.scene && typeof o.scene.remove === 'function') {
      o.scene.remove(beacon);
    }
    beacon = null;
    gem = null;
  }

  function raiseBeacon(at) {
    dropBeacon();
    if (!o.scene || typeof o.scene.add !== 'function') return;
    try {
      const group = new THREE.Group();

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 2.4, 32, 18, 1, true),
        new THREE.MeshBasicMaterial({
          color: GOLD, transparent: true, opacity: 0.26,
          side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      beam.position.y = 16;
      group.add(beam);

      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(2.4, 0.16, 10, 40),
        new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85 }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.2;
      group.add(halo);

      gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.95),
        new THREE.MeshBasicMaterial({ color: GOLD_LIGHT }),
      );
      gem.position.y = 4.6;
      group.add(gem);

      group.position.set(at.x, at.y || 0, at.z);
      o.scene.add(group);
      beacon = group;
    } catch (err) {
      beacon = null;
      gem = null;
    }
  }

  // ---------------------------------------------------------- safe dep calls
  // Every helper below swallows errors on purpose: the mission layer must
  // keep running even if a subsystem is absent or misbehaves.

  function whereIsPlayer() {
    try {
      if (typeof o.getPlayerPos === 'function') return asVec3(o.getPlayerPos());
    } catch (err) { /* no position available */ }
    return null;
  }

  function playerRiding() {
    try {
      if (typeof o.getPlayerInCar === 'function') return !!o.getPlayerInCar();
      if (typeof o.isPlayerInCar === 'function') return !!o.isPlayerInCar();
    } catch (err) { /* unknown */ }
    return null; // unknown — callers must not gate on it
  }

  function applyWanted(level) {
    const police = o.police;
    try {
      if (police && typeof police.setWanted === 'function') { police.setWanted(level); return; }
      if (police && typeof police.setStars === 'function') { police.setStars(level); return; }
      if (police && level === 0 && typeof police.clearWanted === 'function') { police.clearWanted(); return; }
    } catch (err) { /* fall through to the HUD */ }
    try {
      if (o.hud && typeof o.hud.setWanted === 'function') o.hud.setWanted(level);
    } catch (err) { /* ignore */ }
  }

  function tellHudObjective(text) {
    try {
      if (o.hud && typeof o.hud.setObjective === 'function') o.hud.setObjective(text);
    } catch (err) { /* ignore */ }
  }

  function tellHudTarget(pos) {
    try {
      if (o.hud && typeof o.hud.setMissionTarget === 'function') o.hud.setMissionTarget(pos);
    } catch (err) { /* ignore */ }
  }

  function announce(title, sub) {
    try {
      if (o.hud && typeof o.hud.showBanner === 'function') o.hud.showBanner(title, sub);
    } catch (err) { /* ignore */ }
    if (sub) tellHudObjective(sub);
  }

  function grant(amount) {
    if (!amount) return;
    try {
      if (typeof o.onMoney === 'function') o.onMoney(amount);
    } catch (err) { /* ignore */ }
  }

  function playRewardSound() {
    try {
      if (o.audio && typeof o.audio.jingle === 'function') o.audio.jingle();
    } catch (err) { /* ignore */ }
  }

  // Try each known enemy-spawn entry point in turn; returns whatever the
  // subsystem returns, or false when nothing could spawn.
  function bringInEnemy(pos, traits) {
    const tries = [
      [o.characters, o.characters && o.characters.spawnEnemy],
      [o.characters, o.characters && o.characters.spawn],
      [o.characters, o.characters && o.characters.addEnemy],
      [o.combat, o.combat && o.combat.spawnEnemy],
    ];
    for (const [owner, fn] of tries) {
      if (typeof fn !== 'function') continue;
      try {
        return fn.call(owner, pos, traits || {});
      } catch (err) { /* try the next spelling */ }
    }
    return false;
  }

  // How many staged enemies are still standing, or null when no subsystem
  // can answer that question (callers fall back to a hold timer).
  function enemiesLeft() {
    try {
      if (o.combat && typeof o.combat.getAliveEnemies === 'function') return o.combat.getAliveEnemies();
      if (o.combat && typeof o.combat.enemiesAlive === 'function') return o.combat.enemiesAlive();
      if (o.combat && typeof o.combat.getEnemiesAlive === 'function') return o.combat.getEnemiesAlive();
      if (o.characters && typeof o.characters.getAliveCount === 'function') return o.characters.getAliveCount();
      if (o.characters && Array.isArray(o.characters.enemies)) {
        return o.characters.enemies.filter((e) => e && e.alive !== false && e.health > 0).length;
      }
      if (o.combat && typeof o.combat.getDefeatedCount === 'function' && run.killsAtStart >= 0) {
        const done = o.combat.getDefeatedCount() - run.killsAtStart;
        return Math.max(0, run.killsNeeded - done);
      }
    } catch (err) { /* ignore */ }
    return null;
  }

  function spotVec(key) {
    return asVec3(spots[key]) || new THREE.Vector3(0, 0, 0);
  }

  function playerNear(key, radius) {
    const p = whereIsPlayer();
    return !!p && flatDist(p, spotVec(key)) <= radius;
  }

  // ---------------------------------------------------------- mission list
  // `arm` stages the mission; `done` is checked every frame. Both close
  // over the shared helpers above, so each mission reads like a recipe.

  const list = [
    {
      id: 'first-wheels',
      title: 'First Wheels',
      briefing: 'An unlocked coupe is parked by the marina. Take it and drive to the pier — the Vipers will notice soon enough.',
      objective: 'Steal a parked car and drive to the pier',
      reward: 150,
      spot: 'pier',
      arm() { /* nothing to stage — the car is already parked */ },
      done() {
        if (!playerNear('pier', 9)) return false;
        // If we cannot tell whether the player is in a car, arriving on
        // foot still counts — never soft-lock on an unknown.
        return playerRiding() !== false;
      },
    },
    {
      id: 'beach-meeting',
      title: 'Beach Meeting',
      briefing: 'Your contact waits on the sand. Two Vipers are already watching the beach — walk in calm, eyes open.',
      objective: 'Walk to the beach and meet your contact',
      reward: 200,
      spot: 'beach',
      arm() {
        const t = spotVec('beach');
        bringInEnemy({ x: t.x - 3, y: 0, z: t.z - 6 }, { gang: 'Vipers', pose: 'aim', weapon: 'pistol' });
        bringInEnemy({ x: t.x + 3, y: 0, z: t.z - 6 }, { gang: 'Vipers', pose: 'aim', weapon: 'pistol' });
      },
      done() { return playerNear('beach', 6); },
    },
    {
      id: 'dockside-heat',
      title: 'Dockside Heat',
      briefing: 'The patrols are on you — 2 stars and climbing. Lose them and get to the plaza, fast.',
      objective: 'Escape the police pursuit and reach the plaza',
      reward: 250,
      spot: 'plaza',
      arm() { applyWanted(2); },
      done() { return playerNear('plaza', 10); },
      wrapUp() { applyWanted(0); },
    },
    {
      id: 'the-drop',
      title: 'The Drop',
      briefing: 'Carry the package to the docks. Three Vipers are closing in — one of them is already drawing.',
      objective: 'Deliver the package to the docks',
      reward: 300,
      spot: 'docks',
      arm() {
        const t = spotVec('docks');
        bringInEnemy({ x: t.x - 6, y: 0, z: t.z + 8 }, { gang: 'Vipers', approach: true });
        bringInEnemy({ x: t.x, y: 0, z: t.z + 10 }, { gang: 'Vipers', approach: true });
        bringInEnemy({ x: t.x + 6, y: 0, z: t.z + 8 }, { gang: 'Vipers', approach: true, fires: true });
      },
      done() {
        // Staged scare: about two seconds in, the Viper posted by the
        // drop point fires one shot toward the player.
        if (!run.ambushFired && run.clock > 2) {
          run.ambushFired = true;
          const p = whereIsPlayer();
          const t = spotVec('docks');
          try {
            if (p && o.combat && typeof o.combat.shoot === 'function') {
              const from = { x: t.x - 4, y: 1.5, z: t.z + 5 };
              o.combat.shoot(from, {
                x: p.x - from.x,
                y: (p.y + 1.2) - from.y,
                z: p.z - from.z,
              }, false);
            }
          } catch (err) { /* ignore */ }
          try {
            if (o.audio && typeof o.audio.gunshot === 'function') o.audio.gunshot();
          } catch (err) { /* ignore */ }
        }
        return playerNear('docks', 6);
      },
    },
    {
      id: 'viper-nest',
      title: 'Viper Nest',
      briefing: 'Their hideout is by the pier, four deep. Clear it out — no one walks away from this one.',
      objective: 'Clear the Viper hideout near the pier',
      reward: 500,
      spot: 'hideout',
      arm() {
        const t = spotVec('hideout');
        run.killsNeeded = 4;
        try {
          if (o.combat && typeof o.combat.getDefeatedCount === 'function') {
            run.killsAtStart = o.combat.getDefeatedCount();
          }
        } catch (err) { run.killsAtStart = -1; }
        bringInEnemy({ x: t.x - 5, y: 0, z: t.z - 4 }, { gang: 'Vipers', weapon: 'pistol' });
        bringInEnemy({ x: t.x + 5, y: 0, z: t.z - 4 }, { gang: 'Vipers', weapon: 'pistol' });
        bringInEnemy({ x: t.x - 4, y: 0, z: t.z + 5 }, { gang: 'Vipers', weapon: 'pistol' });
        bringInEnemy({ x: t.x + 5, y: 0, z: t.z + 5 }, { gang: 'Vipers', weapon: 'pistol' });
      },
      done(dt) {
        if (!playerNear('hideout', 14)) return false;
        const left = enemiesLeft();
        if (left === null) {
          // No kill counter exists anywhere: holding the hideout for ten
          // seconds counts as clearing it.
          run.hold += dt;
          return run.hold >= 10;
        }
        return left <= 0;
      },
    },
    {
      id: 'solara-sunset',
      title: 'Solara Sunset',
      briefing: 'Full heat — 4 stars, the whole bay chasing. One run down the coast to the beach finish line. End this.',
      objective: 'Outrun the 4-star pursuit to the beach finish line',
      reward: 1000,
      spot: 'finish',
      arm() { applyWanted(4); },
      done() { return playerNear('finish', 10); },
      wrapUp() { applyWanted(0); },
    },
  ];

  // Public view of the missions: the definitions plus a convenience
  // starter and a "is this one done right now?" check.
  const missions = list.map((def, i) => ({
    id: def.id,
    title: def.title,
    briefing: def.briefing,
    objective: def.objective,
    reward: def.reward,
    start() { start(i); },
    isComplete() {
      if (run.at !== i) return false;
      return !!def.done(0);
    },
  }));

  // ---------------------------------------------------------- public API

  function start(index) {
    if (typeof index !== 'number' || index < 0 || index >= list.length) return false;
    const def = list[index];
    run.at = index;
    run.clock = 0;
    run.hold = 0;
    run.ambushFired = false;
    run.killsAtStart = -1;
    run.killsNeeded = 0;
    run.nextIn = -1;
    try {
      def.arm();
    } catch (err) {
      // A staging failure must not break the mission start — the player
      // can still walk to the marker and finish it.
    }
    const target = spotVec(def.spot);
    raiseBeacon(target);
    tellHudTarget(target);
    announce(def.title, def.briefing);
    tellHudObjective(def.objective);
    return true;
  }

  function finishActive() {
    const def = list[run.at];
    if (!def) return;
    if (typeof def.wrapUp === 'function') {
      try { def.wrapUp(); } catch (err) { /* ignore */ }
    }
    dropBeacon();
    tellHudTarget(null);
    grant(def.reward);
    playRewardSound();
    announce('Mission Complete', def.title + '  •  +$' + def.reward);
    run.finished += 1;
    if (run.at + 1 < list.length) {
      run.nextIn = NEXT_BEAT; // a short beat, then the next briefing
    } else {
      run.at = -1;
      run.nextIn = -1;
      tellHudObjective('Story complete — Solara Bay is yours.');
    }
  }

  function update(dt) {
    const step = typeof dt === 'number' && dt > 0 ? Math.min(dt, 0.1) : 0.016;
    // Keep the beacon gem spinning and bobbing while it stands.
    if (gem) {
      gemPhase += step;
      gem.rotation.y += step * 1.5;
      gem.position.y = 4.6 + Math.sin(gemPhase * 2) * 0.4;
    }
    if (run.nextIn > 0) {
      run.nextIn -= step;
      if (run.nextIn <= 0) {
        run.nextIn = -1;
        start(run.at + 1);
      }
      return;
    }
    if (run.at < 0 || run.at >= list.length) return;
    run.clock += step;
    if (list[run.at].done(step)) finishActive();
  }

  function getObjective() {
    if (run.at >= 0 && run.at < list.length) return list[run.at].objective;
    if (run.finished >= list.length) return 'Story complete — Solara Bay is yours.';
    return 'Press M to start the story';
  }

  // Current mission target in world space, so the integrator can draw it
  // on the minimap even without the 3D beacon. Null when idle.
  function getTargetPos() {
    if (run.at < 0 || run.at >= list.length) return null;
    const t = spotVec(list[run.at].spot);
    return { x: t.x, y: t.y || 0, z: t.z };
  }

  // Lets combat/characters report a kill directly when no pollable
  // counter exists (narrows the nest fallback window).
  function notifyKill() {
    if (run.at >= 0 && list[run.at].id === 'viper-nest') {
      run.hold += 2.5;
    }
  }

  return {
    missions,
    get current() { return run.at >= 0 ? missions[run.at] : null; },
    start,
    update,
    getObjective,
    getTargetPos,
    notifyKill,
    // Read-only progress for save/load.
    get missionIndex() { return run.at; },
    get completedCount() { return run.finished; },
  };
}
