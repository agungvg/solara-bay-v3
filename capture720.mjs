// Solara Bay — screenshot capture at TRUE 1280x720.
// Uses Playwright Chromium + CDP Emulation.setDeviceMetricsOverride to force
// a real 1280x720 viewport (plain --window-size yields 1280x520 here).
// Captures 5 raw shots into out/raw/, then runs enhance_shots.py, which
// post-processes every frame (sharpen, colour, contrast) and writes the
// final JPGs into screenshots/ (under the 262,144 B entry cap) and the
// enhanced PNG mirrors into review-png/ (Lyso reviews PNGs — his phone
// renders JPGs green).
// Shots: 1-start, 2-play, 3-chase, 4-mission, 5-face.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';

const root = dirname(fileURLToPath(import.meta.url));
const gameDir = join(root, 'game');
const rawDir = join(root, 'out', 'raw');
const PORT = 8932;

mkdirSync(rawDir, { recursive: true });

async function grab(page, name, setup) {
  await setup(page);
  await page.waitForTimeout(1200);
  const png = await page.screenshot({ type: 'png' });
  writeFileSync(join(rawDir, name + '.png'), png);
  console.log(`${name}: raw ${png.length} B`);
}

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: gameDir, stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Force a true 1280x720 viewport via CDP.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__solaraBay, null, { timeout: 30000 });
  await page.waitForTimeout(2000);

  // 1-start: the start screen overlay over the city.
  await grab(page, '1-start', async () => {});

  // 2-play: start the game, hero on foot near the plaza, walking.
  await grab(page, '2-play', async (p) => {
    await p.evaluate(() => {
      const s = window.__solaraBay;
      s.start();
      s.teleport(0, 18);
      s.pressKey('w', true);
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__solaraBay.pressKey('w', false));
  });

  // 3-chase: wanted 4, police in pursuit, hero driving.
  await grab(page, '3-chase', async (p) => {
    await p.evaluate(() => {
      const s = window.__solaraBay;
      s.start();
      s.enterNearestCar();
      s.setWanted(4);
      s.pressKey('w', true);
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__solaraBay.pressKey('w', false));
  });

  // 4-mission: mission 4 (the drop) with the staged Viper shooting.
  // The follow camera can end up behind a building here, so pin an
  // elevated camera override looking down at the mission target instead.
  await grab(page, '4-mission', async (p) => {
    await p.evaluate(() => {
      const s = window.__solaraBay;
      if (s.state.inCar) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
      s.start();
      s.missions.start(3);
      const t = s.missions.getTargetPos ? s.missions.getTargetPos() : null;
      if (t) {
        s.teleport(t.x - 14, t.z + 10);
        const h = s.hero.pos;
        s.setCamOverride(
          { x: t.x + 4, y: 15, z: t.z + 16 },
          { x: (h.x + t.x) / 2, y: 1.2, z: (h.z + t.z) / 2 },
        );
      } else {
        s.teleport(20, 60);
      }
    });
    await page.waitForTimeout(1500);
  });

  // 5-face: close-up on the hero's face (camera override). Exit any car
  // first so the hero is on foot and visible, and turn the hero to face
  // the camera so the face (not the back of the head) is in frame.
  // Clear the wanted level so the frame is clean.
  await grab(page, '5-face', async (p) => {
    await p.evaluate(() => {
      const s = window.__solaraBay;
      if (s.state.inCar) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
      s.start();
      s.setWanted(0);
      s.clearCamOverride();
      s.teleport(0, 18);
      const h = s.hero.pos;
      const cx = h.x + 1.6, cz = h.z + 2.2;
      s.hero.group.rotation.y = Math.atan2(cx - h.x, cz - h.z);
      s.setCamOverride(
        { x: cx, y: 1.7, z: cz },
        { x: h.x, y: 1.55, z: h.z },
      );
    });
    await page.waitForTimeout(600);
  });

  console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
  server.kill();

  // Fail fast if any raw frame is missing before post-processing.
  for (const name of ['1-start', '2-play', '3-chase', '4-mission', '5-face']) {
    const raw = join(rawDir, name + '.png');
    const st = await import('node:fs').then((fs) => fs.statSync(raw, { throwIfNoEntry: false }));
    if (!st) throw new Error(`capture: raw frame missing: ${raw}`);
  }

  // Post-process every frame: sharpen, colour, contrast — then write the
  // final JPGs (under the entry cap) and PNG mirrors.
  await new Promise((resolve, reject) => {
    const enh = spawn('python3', ['enhance_shots.py'], { cwd: root, stdio: 'inherit' });
    enh.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('enhance_shots.py exit ' + code))));
  });
}

main().catch((e) => { console.error('capture crashed:', e); process.exit(2); });
