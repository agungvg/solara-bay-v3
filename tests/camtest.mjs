// Solara Bay — camera-override smoke test.
// Boots the game, starts it, teleports the hero, pins the camera on the
// hero's face via setCamOverride, and confirms the override sticks.
// Saves a frame to /tmp/camtest.png for a quick visual check.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const gameDir = '/home/hatch/workspace/makefun/solara-bay-v3/game';

const server = spawn('python3', ['-m', 'http.server', '8933', '--bind', '127.0.0.1'], { cwd: gameDir, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1000));
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const vp = page.viewportSize();
if (!vp || vp.width !== 1280 || vp.height !== 720) throw new Error('camtest: viewport is not 1280x720');
await page.goto('http://127.0.0.1:8933/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.__solaraBay, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const placed = await page.evaluate(() => {
  const s = window.__solaraBay;
  s.start();
  s.teleport(0, 18);
  const h = s.hero.pos;
  s.setCamOverride({ x: h.x + 1.6, y: 1.7, z: h.z + 2.2 }, { x: h.x, y: 1.55, z: h.z });
  return { hasOverride: !!s.state?.camOverride, heroPos: { x: h.x, y: h.y, z: h.z } };
});
console.log('override set:', JSON.stringify(placed));
await page.waitForTimeout(1000);
const held = await page.evaluate(() => ({ overrideStillSet: !!window.__solaraBay.state?.camOverride }));
console.log('override still set after 1s:', JSON.stringify(held));
await page.screenshot({ path: '/tmp/camtest.png' });
await browser.close();
server.kill();
console.log('saved /tmp/camtest.png');
