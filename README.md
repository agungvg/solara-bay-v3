# Solara Bay

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/agungvg/solara-bay-v3/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/agungvg/solara-bay-v3/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

A GTA-style open-world crime game, written from scratch for the make.fun
[Make GTA 6](https://make.fun/bounty/gta6-01) competition. It runs offline in a desktop browser from static
files — keyboard and mouse, every asset original, zero network requests.
You arrive in Solara Bay at golden hour and get pulled into a six-mission
fight with the Vipers gang: a first stolen car, a beach meeting, a police
chase, a package drop, a hideout raid, and a final sunset run down the
coast. The whole arc is playable end to end, and progress saves
automatically.

## The game

Walk the sidewalks or steal a car, outrun the police, and play through
the 6-mission story arc — $2,400 in total mission payouts.

- **Open world:** a street grid with buildings, a beach and ocean, docks
  and a pier, a central plaza, a park, palms and streetlights.
- **People:** 45 pedestrians across 7 archetypes, walking the sidewalks.
- **Cars:** 12 AI traffic cars plus 14 parked cars. Walk up to a parked
  car and steal it; drive with collisions.
- **Wanted:** 0–5 stars. Police pursue, and roadblocks appear at high
  wanted levels.
- **Missions:** 6 story missions against the Vipers, with staged
  encounters and a final sunset chase.
- **HUD:** minimap, wanted stars, health, money, mission objective.
- **Save:** progress saves to localStorage; continue where you left off.
- **Sound:** synthesized WebAudio engine, siren, gunshots and pickups.

## How to play

Press **PLAY** on the start screen, then press **M** to start the story.
Each mission shows its objective on the HUD; finishing one pays out and
the next unlocks with **M**. Your progress saves automatically, so you
can close the tab and continue where you left off.

### Controls

- **W / A / S / D** — move on foot, drive in a car
- **Shift** — run (on foot)
- **E** — enter / exit the nearest parked car
- **F** — shoot the pistol (on foot only)
- **M** — start the next mission
- **Esc** — pause
- **Mouse** — drag to look around

### The six missions

| # | Mission | Objective | Reward |
|---|---------|-----------|--------|
| 1 | First Wheels | Steal the coupe by the marina and drive to the pier | $150 |
| 2 | Beach Meeting | Walk to the beach and meet your contact while two Vipers watch | $200 |
| 3 | Dockside Heat | Shake a 2-star police pursuit and reach the plaza | $250 |
| 4 | The Drop | Carry the package to the docks past three Vipers | $300 |
| 5 | Viper Nest | Clear the four-man hideout by the pier | $500 |
| 6 | Solara Sunset | Outrun a 4-star pursuit down the coast to the beach finish line | $1,000 |

### Tips

- Steal a car early — it is the fastest way across the city, and the
  first mission teaches you how.
- Wanted stars run 0–5: the higher the heat, the harder the pursuit,
  with roadblocks at high levels. Finishing a chase mission clears them.
- On foot you can shoot (**F**); in a car you cannot, so pick your
  fights before you get in.
- Hold **Shift** to run — it matters when Vipers are closing in on foot.
- The yellow diamond on the minimap marks your current objective;
  follow it.

## Play it

Serve `game/` with any static HTTP server and open `game/index.html`
in desktop Chrome. For example:

```sh
cd game && python3 -m http.server 8080
```

Then open http://localhost:8080 in Chrome. Everything the game loads
is a file under `game/` (three.js is vendored as
`game/vendor/three.module.min.js`); there are no network requests.

## Layout

- `game/index.html` — the page; `game/style.css` — base styles.
- `game/src/main.js` — boot, game loop, input, camera.
- `game/src/characters.js`, `game/src/combat.js` — hero, NPCs, shooting.
- `game/src/city.js`, `game/src/effects.js` — the city, golden-hour rendering.
- `game/src/vehicles.js`, `game/src/traffic.js`, `game/src/police.js` — cars, traffic, wanted.
- `game/src/missions.js`, `game/src/hud.js`, `game/src/save.js`, `game/src/audio.js` — story, HUD, save, sound.
- `game/vendor/three.module.min.js` — vendored three.js (MIT).
- `main.ts` — the entry program: copies `game/` and `screenshots/` to
  the output directory and writes `dossier.json` (see `vendor/`).
- `screenshots/` — renders of the game itself (the first is the cover).

## Screenshots

The entry screenshots live in `screenshots/` (JPGs, under the 262,144 B
cap) with enhanced PNG mirrors in `review-png/`. They are captured from
the game itself by `capture720.mjs` at a true 1280x720, then
post-processed by `enhance_shots.py` (sharpen, colour, contrast) so the
final images pop: start screen, gameplay, police chase, a mission moment,
and a character face close-up.

## Tests

- `tests/e2e.mjs` — bounded E2E in headless Chromium (10 checks).
- `capture720.mjs` — captures the 5 entry screenshots at 1280x720,
  then `enhance_shots.py` post-processes them (sharpen, colour,
  contrast) into the final JPGs and PNG mirrors.

## License

MIT. See `LICENSE`. three.js is MIT (see its header in
`game/vendor/three.module.min.js`).
