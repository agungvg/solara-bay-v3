// Solara Bay — entry program (main.ts).
// Assembles the graded entry: copies game/ and screenshots/ from this
// repository into the output directory and writes dossier.json there,
// using the kit's buildDossier helper from vendor/makefun-game.ts.
//
// Local run:  MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader the output directory is /output. Runs on Node 22 with
// the standard library only, no network, inside 10 seconds.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// Resolve the repository root from this file's own location so the
// program works from any working directory it is started in.
const repoDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// Gate ceilings for this competition: the game tree, the screenshots and
// the dossier each have a hard cap, and the dossier is built against the
// same caps the gate enforces.
const ceilings = {
  textMaxBytes: 4 * 1024 * 1024,
  shots: { max: 4, max_bytes: 262144 },
  gameMaxFiles: 993,
  gameMaxBytes: 48 * 1024 * 1024,
  gamePathMaxBytes: 1000,
};

function tallyFiles(startDir: string): number {
  let total = 0;
  const pending: string[] = [startDir];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) total += 1;
    }
  }
  return total;
}

function syncDir(name: string): number {
  const from = join(repoDir, name);
  const to = join(outDir, name);
  if (!existsSync(from) || !statSync(from).isDirectory()) {
    throw new Error(`main.ts: ${name}/ is missing from the repository`);
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, dereference: true });
  return tallyFiles(to);
}

function buildEntry(): void {
  mkdirSync(outDir, { recursive: true });
  const entryHtml = join(repoDir, 'game', 'index.html');
  if (!existsSync(entryHtml)) {
    throw new Error('main.ts: game/index.html is missing from the repository');
  }
  const gameCount = syncDir('game');
  const shotCount = syncDir('screenshots');
  const dossier = buildDossier(repoDir, {
    text_max_bytes: ceilings.textMaxBytes,
    screenshots: ceilings.shots,
    game_max_files: ceilings.gameMaxFiles,
    game_max_bytes: ceilings.gameMaxBytes,
    game_path_max_bytes: ceilings.gamePathMaxBytes,
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  console.log(`solara-bay: game/ ${gameCount} files, screenshots/ ${shotCount} files`);
  console.log(`solara-bay: dossier.json ${dossier.length} bytes -> ${outDir}`);
}

buildEntry();
