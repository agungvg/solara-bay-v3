// Solara Bay — effects / rendering (round-3 rewrite).
//
// Owns the golden-hour look: renderer setup, low warm sun, gradient sky
// dome with a glowing sun disc, drifting clouds and lamp glows. There is no
// vendored post-processing in this build (the import map only exposes
// "three", no addons), so the pop comes from ACES tone mapping, a punchy
// exposure, emissive materials and additive glow sprites instead.
//
// Exported API:
//   createEffects(renderer, scene, camera) -> { update(dt) }
//
// Streetlight glow: city.js tags lamp heads with userData.lamp = true.
// This module hangs one additive glow sprite on each tagged lamp the first
// time update() runs, so the build order of city vs. effects does not
// matter.
import * as THREE from 'three';

export function createEffects(renderer, scene, camera) {
  // ---- renderer: filmic, sharp, a touch hot --------------------------------
  // Antialias is a creation-time WebGL flag — it has to be passed to
  // new THREE.WebGLRenderer({ antialias: true }) and cannot be switched on
  // here, so this module only documents that requirement.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ---- sun: low, warm, from the south-west ----------------------------------
  const sunDir = new THREE.Vector3(165, 52, 88).normalize();
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.8);
  sun.position.copy(sunDir).multiplyScalar(220);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 520;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.target.position.set(0, 0, 20);
  scene.add(sun);
  scene.add(sun.target);

  // Warm bounce off the sea on the opposite side, so shadowed faces never
  // go muddy. No shadows on this one — it is fill, not a second sun.
  const bounce = new THREE.DirectionalLight(0xffb36b, 0.35);
  bounce.position.set(-120, 80, -60);
  scene.add(bounce);

  // Sky bounce + a whisper of warm ambient so nothing crushes to black.
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x8a6a4a, 0.75);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffe2b8, 0.4);
  scene.add(ambient);

  // ---- fog + backdrop ---------------------------------------------------------
  scene.fog = new THREE.FogExp2(0xf6c98d, 0.00065);
  scene.background = new THREE.Color(0xf6c98d);

  // ---- sky dome: three-band gradient + sun halo -------------------------------
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(700, 32, 16),
    skyMaterial(sunDir));
  dome.frustumCulled = false;
  scene.add(dome);

  // ---- the sun itself: a soft disc + wide halo --------------------------------
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(256, [
      [0, 'rgba(255,246,214,1)'],
      [0.22, 'rgba(255,228,152,0.95)'],
      [0.5, 'rgba(255,198,112,0.32)'],
      [1, 'rgba(255,198,112,0)'],
    ]),
    transparent: true,
    depthWrite: false,
    fog: false,
    opacity: 0.95,
  }));
  sunSprite.scale.set(120, 120, 1);
  scene.add(sunSprite);

  // ---- clouds: soft billboards drifting over the bay ---------------------------
  const rng = makeRng(987654321);
  const cloudTex = puffTexture(rng);
  const clouds = [];
  for (let i = 0; i < 10; i++) {
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, depthWrite: false, fog: false,
      opacity: 0.5 + rng() * 0.3,
      color: 0xffe9c4, // warm sunset tint so the clouds catch the low sun
    }));
    const size = 70 + rng() * 80;
    cloud.scale.set(size, size * 0.45, 1);
    cloud.position.set(-320 + rng() * 640, 130 + rng() * 70, -320 + rng() * 640);
    cloud.userData.drift = 1 + rng() * 1.6;
    scene.add(cloud);
    clouds.push(cloud);
  }

  // ---- lamp glows: attached lazily, exactly once -------------------------------
  const lampTex = glowTexture(128, [
    [0, 'rgba(255,232,160,0.95)'],
    [0.35, 'rgba(255,214,120,0.4)'],
    [1, 'rgba(255,214,120,0)'],
  ]);
  let glowsAttached = false;
  const attachLampGlows = () => {
    if (glowsAttached) return;
    glowsAttached = true;
    scene.traverse((obj) => {
      if (!obj.userData || !obj.userData.lamp) return;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: lampTex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0.9,
      }));
      glow.scale.set(6, 6, 1);
      obj.add(glow);
    });
  };

  // ---- per-frame ----------------------------------------------------------------
  let elapsed = 0;
  const sunOffset = new THREE.Vector3(); // reused scratch, no per-frame alloc
  const update = (dt) => {
    elapsed += dt;
    attachLampGlows();
    // The dome and the sun disc ride along with the camera, so the player
    // can never drive out of the sky or past the sun.
    if (camera) {
      dome.position.set(camera.position.x, 0, camera.position.z);
      sunOffset.copy(sunDir).multiplyScalar(620);
      sunSprite.position.set(
        camera.position.x + sunOffset.x,
        sunOffset.y,
        camera.position.z + sunOffset.z);
    }
    // Clouds drift east and wrap around the play area.
    for (const cloud of clouds) {
      cloud.position.x += cloud.userData.drift * dt;
      if (cloud.position.x > 380) cloud.position.x = -380;
    }
    // The sun breathes gently — a slow swell in size and brightness.
    const swell = Math.sin(elapsed * 0.8);
    const s = 120 + swell * 4;
    sunSprite.scale.set(s, s, 1);
    sunSprite.material.opacity = 0.92 + swell * 0.04;
  };

  return { update };
}

// ---------------------------------------------------------------------------
// Deterministic RNG (xorshift32), shared shape with the city module.
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

// A soft radial falloff painted once on a canvas and reused by every glow
// sprite in the scene (sun disc, lamp halos).
function glowTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A puffy cloud: several soft blobs merged into one sprite texture.
function puffTexture(rng) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 11; i++) {
    const x = 36 + rng() * 184;
    const y = 44 + rng() * 40;
    const r = 20 + rng() * 32;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,250,240,0.85)');
    g.addColorStop(0.6, 'rgba(255,244,228,0.35)');
    g.addColorStop(1, 'rgba(255,244,228,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Gradient sky with a hot spot around the sun. The dome is pinned to the
// far plane (gl_Position.z = gl_Position.w) so it never clips the city.
function skyMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color(0x3d7ac8) },
      middle: { value: new THREE.Color(0x8fc3e8) },
      horizon: { value: new THREE.Color(0xffc98a) },
      sunDir: { value: sunDir.clone() },
      sunTint: { value: new THREE.Color(0xffe6b0) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 middle;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      uniform vec3 sunTint;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, middle, smoothstep(0.0, 0.22, h));
        col = mix(col, zenith, smoothstep(0.18, 0.65, h));
        if (h < 0.0) col = mix(horizon, horizon * 0.72, clamp(-h * 4.0, 0.0, 1.0));
        float facing = max(dot(d, normalize(sunDir)), 0.0);
        col += sunTint * (pow(facing, 350.0) * 1.4 + pow(facing, 8.0) * 0.32);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// Integrator notes:
// - Build the renderer with { antialias: true } — that flag is fixed at
//   construction time and this module cannot enable it afterwards.
// - Call once after the city exists (order is free: lamp glows attach
//   lazily on the first update): const fx = createEffects(renderer, scene,
//   camera); then fx.update(dt) every frame.
// - No post-processing modules are imported or vendored.
