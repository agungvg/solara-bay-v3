// Solara Bay — bounded E2E test in headless Chromium.
// Serves game/ over HTTP, loads it, and runs 10 checks:
// boot, zero page errors, hero, NPCs, traffic, parked cars, missions,
// driving, wanted, save. Exits 0 only when all 10 pass.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = join(here, '..', 'game');
const PORT = 8931;

const outcomes = [];
function verdict(name, ok, detail = '') {
  outcomes.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

async function bootPage() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: gameDir, stdio: 'ignore',
  });
  // Give the server a moment to bind.
  await new Promise((r) => setTimeout(r, 1200));

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  return { server, browser, page, errors };
}

async function run() {
  const { server, browser, page, errors } = await bootPage();
  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 30000 });
    // Wait for the game hook (set after boot).
    await page.waitForFunction(() => window.__solaraBay, null, { timeout: 30000 });
    // Let a few frames run.
    await page.waitForTimeout(2500);

    const snapshot = await page.evaluate(() => {
      const s = window.__solaraBay;
      return {
        hasState: !!s.state,
        hero: !!s.hero,
        npcs: s.characters ? s.characters.npcs.length : 0,
        traffic: s.traffic ? s.traffic.cars.length : 0,
        parked: s.parked ? s.parked.cars.length : 0,
        missions: s.missions && s.missions.missions ? s.missions.missions.length : 0,
        missionIndex: s.state.missionIndex,
        money: s.state.money,
        wanted: s.state.wanted,
        objective: s.missions ? s.missions.getObjective() : '',
      };
    });

    verdict('1. page boots, game hook present', snapshot.hasState && snapshot.hero);
    verdict('2. zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    verdict('3. hero present', snapshot.hero);
    verdict('4. 45 NPC pedestrians', snapshot.npcs === 45, `got ${snapshot.npcs}`);
    verdict('5. 12 AI traffic cars', snapshot.traffic === 12, `got ${snapshot.traffic}`);
    verdict('6. 14 parked cars', snapshot.parked === 14, `got ${snapshot.parked}`);
    verdict('7. 6 missions', snapshot.missions === 6 && typeof snapshot.objective === 'string' && snapshot.objective.length > 0, `got ${snapshot.missions}, objective="${snapshot.objective}"`);

    // Driving: start the game, enter a car, drive forward, confirm movement.
    // Use real keyboard events — the game's keydown handler owns E/F, and the
    // frame loop reads the held keys for driving.
    const drive = await page.evaluate(() => {
      const s = window.__solaraBay;
      s.start();
      const entered = s.enterNearestCar();
      if (!entered) return { entered: false };
      return { entered: true, before: { x: s.hero.pos.x, z: s.hero.pos.z } };
    });
    let moved = 0;
    let inCar = false;
    if (drive.entered) {
      await page.keyboard.down('w');
      await page.waitForTimeout(2000);
      await page.keyboard.up('w');
      const after = await page.evaluate(() => {
        const s = window.__solaraBay;
        return { x: s.hero.pos.x, z: s.hero.pos.z, inCar: !!s.state.inCar };
      });
      moved = Math.round(Math.hypot(after.x - drive.before.x, after.z - drive.before.z) * 10) / 10;
      inCar = after.inCar;
    }
    verdict('8. car stealing + driving moves the player', drive.entered && moved > 3, `moved ${moved}m, inCar=${inCar}`);

    // Wanted: exit the car (real E key), then fire a shot on foot (real F key)
    // and confirm the wanted level rises.
    const wantedBefore = await page.evaluate(() => {
      const s = window.__solaraBay;
      return { before: s.state.wanted, inCar: !!s.state.inCar };
    });
    if (wantedBefore.inCar) {
      await page.keyboard.press('e');
      await page.waitForTimeout(400);
    }
    await page.keyboard.press('f');
    await page.waitForTimeout(600);
    const wantedAfter = await page.evaluate(() => window.__solaraBay.state.wanted);
    verdict('9. shooting raises wanted', wantedAfter > wantedBefore.before, `${wantedBefore.before} -> ${wantedAfter}`);

    // Save: set money, write a save through the game's own hook, reload the
    // page, confirm the money persists.
    await page.evaluate(() => {
      const s = window.__solaraBay;
      s.state.money = 12345;
      s.saveNow();
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__solaraBay, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const restored = await page.evaluate(() => window.__solaraBay.state.money);
    verdict('10. save restores money on reload', restored === 12345, `restored money=${restored}`);

    const passed = outcomes.filter((r) => r.ok).length;
    console.log(`\nRESULT: passed=${passed} failed=${outcomes.length - passed}`);
    return passed === outcomes.length ? 0 : 1;
  } finally {
    await browser.close();
    server.kill();
  }
}

run()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('E2E crashed:', e);
    process.exit(2);
  });
