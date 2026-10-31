# CLAUDE.md — Project rules and approved decisions

@PROJECT_INSTRUCTIONS.md

The full development rules are in `PROJECT_INSTRUCTIONS.md` (copy of the Claude Project instructions, imported above).
Gameplay intent lives in `GAME_DESIGN.md`. This file records decisions the owner has approved, which clarify or override those documents.

## Approved decisions (2026-10-28)

1. **Physics:** custom arcade driving model and custom collisions. Matter.js only if collisions prove inadequate in testing.
2. **Saving:** all persistence goes through `src/platform/PlatformManager.js` (platform storage on platforms; LocalStorage only as the local browser fallback). Gameplay code never touches LocalStorage directly.
3. **Size:** target **under 15 MB** (YouTube Playables recommended initial-bundle size); 30 MB is the absolute maximum. Measure every milestone.
4. **World:** one large bounded arena for the prototype; keep world code flexible for a larger or endless world later.
5. **Process:** one milestone at a time. Do not start the next milestone until the owner has tested and approved the current one.
6. **Owner is not a programmer:** explain decisions in plain language and give exact step-by-step instructions for anything they must do manually.
7. **Graphics:** everything is code-drawn low-poly (no image files); `ART_DIRECTION.md` is the style guide (still a draft).
8. **Milestone 1 (approved 2026-10-28):** temporary solid wall bounce at arena edges; capped skid marks; three temporary handling presets (Grippy / Balanced / Drifty); car drives on page load, R restarts.
9. **2.5D presentation (Milestone 1.5, approved 2026-10-28):** stylized 2.5D comic-book look, high-angle oblique camera (north-up, fixed, 55° default under test). Physics stays flat and never reads visual settings. All drawing goes through `src/render/projection.js`. Rules in `RENDERING.md`. No shaders.
10. **Low-poly 2.5D look (Milestone 1.6, approved with M1.7 on 2026-10-29):** game name "Can't Catch Me!". Minimalist low-poly, flat-shaded, matching the camera/geometry/lighting approach of the owner's PAKO Forever reference frames (not their assets). Fixed orthographic camera with the map turned (40°) and tilted (48°); cars and props built from 3D solids and drawn once at startup (cars in 64 directions). Replaces the north-up camera and comic outlines of decision 9. Draft style rules in `ART_DIRECTION.md`.
11. **Full game in one pass (2026-10-29):** owner said "proceed with the rest of the milestones and provide the full game" (M2–M5 together, then test). Single Shockwave power-up, no adverts, no analytics.
12. **Endless world (Step 2, 2026-10-30):** owner asked for an endless chunk-streaming world with sinkholes instead of a fence. Replaces decision 4. Active grid is 3 x 3 chunks; chunks are 2400 units, not the 1200 suggested as an example, because the grid only guarantees one chunk's width ahead and the camera shows about 2030 units on tall phones (`tests/test_world.mjs` checks this). Every chunk keeps the same 600-unit road grid, so roads always line up; holes never touch a chunk's border roads.
13. **Pursuit (Step 3, 2026-10-30):** owner asked for two police types (tailing chasers; black-and-white interceptors that aim at the player's predicted position, make for upcoming crossings and flank), parked roadblocks from 30 s, red warning chevrons for police arriving from out of sight, and a heat curve in four stages (`HEAT` in `tuning.js`). Parked cruisers don't count toward the police number. Police still spawn in motion, now along a road.
14. **Comic-arcade look (Step 4, 2026-10-30):** owner's own "Arcade Comic Low-Poly" identity: clean low-poly models with comic-book action effects (ink-edged starbursts, puffy cloud smoke, hit-stop). Low sun with shadows about 1.2 x height, falling to the upper left. Palette in `ART_DIRECTION.md`. The owner's PAKO Forever frames are a reference for lighting, shadows and density only: no copied assets, props or branding. Parked civilian cars are breakable props (knocked aside), not physics bodies, to stay cheap on phones.
15. **Crashes and set dressing (2026-10-30):** owner asked for more drama. Wrecks tumble (drawing only: physics stays flat; `render/Tumble.js`), with fireballs, flying wreckage and lasting burns. Word statues are one solid prop per letter, so draw order stays right. Siren beams warn of arriving police. The power-up is an orange gift box, but its arrow and the Shockwave button stay teal, so they are never mistaken for the red warnings. Prop drawings have a memory budget, checked by `tests/test_set.mjs`.
16. **Lucky die (Step 6, 2026-10-30):** the power-up is a violet die, replacing the gift box so the game has its own look (the owner asked for something original). It bounces after the car from the moment it appears, sinks into it, and gives a random item: Shockwave, Giant, Freeze, Pillars or Flamer. Held items fire by themselves after 4 s. Used by double tap (touch), Space / W / Up, gamepad A or the round button. Giant changes the car's real size (`Car.scale`), so collisions, shadows and camera all follow it. Double tap is never the only control (GAME_DESIGN section 9). Audio is on hold: effects reuse existing sounds until the owner's files arrive.
17. **Tactical units (Step 7, 2026-10-30):** owner asked for SWAT Bearcats (from 30 s), roadblocks with spike strips (from 35 s, replacing the 30 s start of decision 13) and a police helicopter (from 45 s). Bearcats are heavy (`BEARCAT`), plough through light props and kill on contact unless the player is Giant; a frozen one can be smashed like any frozen car (decision 18). Spikes give 3 s of flat tires (`FLAT_TIRE`); they only affect the player, and Giant ignores them and mends them. How the car behaves on a flat is in decision 18. The helicopter can't be stopped; it lights up the car and drops concrete blocks ahead, each marked by a red flare 1.2 s first, and a block never lands on the car (`HELICOPTER`). All code-drawn.
18. **Owner's changes after Step 7 (2026-10-30):** (a) The player crashing into a frozen police car smashes it to bits and drives on through, losing 15% of its speed; no wreck, no explosion. This includes frozen Bearcats and parked cruisers. Police hitting a frozen car still both wreck. (b) Power-ups have original names on screen: KABOOM (`shockwave`), MONSTER (`giant`), COLD SNAP (`freeze`), STONEWALL (`pillars`), SCORCHER (`flamer`). The code and older notes keep the working names in brackets; `POWERUP.names` holds what the player sees. (c) "Tire" is the spelling everywhere except the owner's copied `PROJECT_INSTRUCTIONS.md`. (d) A flat tire behaves like one failed corner rather than a spin: a jolt, a constant pull to that side that steering can just about hold, speed bleeding off, then a smooth recovery, all within the 3 s. This replaces the "uncontrollable drift spin" of the Step 7 brief.

## Platform facts to respect (checked 2026-10-28, re-verify before Milestone 3)

- YouTube Playables: initial bundle MUST be < 30 MiB and SHOULD be < 15 MiB (measured compressed, until `gameReady`).
- No external network calls; all files bundled; relative paths only (`base: './'` in Vite).
- Pause/resume must follow the platform's pause/resume callbacks; platform mute always wins over in-game audio settings.
- Progress must be saved through the platform's save mechanism.
- `gameReady` only when the player can interact (menu or gameplay), never during loading.
- Must work in every aspect ratio, with no orientation lock.

## Project file map

| Area | File |
|---|---|
| Startup, responsive canvas, platform pause wiring | `src/main.js`, `src/utils/screen.js` |
| All tunable numbers | `src/config/tuning.js` |
| Debug flag (`?debug` in the address) | `src/config/debug.js` |
| Input (keyboard, mouse, touch, gamepad, on-screen buttons) | `src/systems/InputManager.js` |
| Platform boundary (Playgama Bridge v2 + local fallback, saving) | `src/platform/PlatformManager.js` |
| Scenes: boot, world, HUD/pause overlay, title, results | `src/scenes/BootScene.js`, `GameScene.js`, `UIScene.js`, `MenuScene.js`, `GameOverScene.js` |
| One chase as pure logic (no Phaser): steps cars, collisions, rules, events | `src/systems/ChaseSimulation.js` |
| Shared driving model (player + police), pure maths | `src/entities/Car.js` |
| Police helicopter, as pure logic (flying, searchlight target, dropped blocks) / its drawing | `src/entities/Helicopter.js`, `src/render/HelicopterView.js` |
| Police car state (pooled) / pursuit steering (chasers, interceptors, Bearcats) | `src/entities/PoliceCar.js`, `src/systems/PoliceAI.js` |
| Which police get a warning arrow (drawn by `UIScene.drawThreats`) | `src/systems/ThreatRadar.js` |
| Collisions (car circles, prop circles/boxes, grid) | `src/systems/CollisionSystem.js` |
| Spawn director, roadblocks, difficulty curve (numbers in `HEAT`) | `src/systems/SpawnSystem.js` |
| Mystery box and all power-ups (Giant, Freeze, Pillars, Flamer, Shockwave) | `src/systems/PowerUpSystem.js` |
| Run stats, saved records, time format | `src/systems/ScoreSystem.js`; settings in `src/systems/Settings.js` |
| Synthesised sound (Web Audio, no files) | `src/systems/AudioSystem.js` |
| Chunk layouts (data shared by drawing and collisions, worked out from chunk coordinates) | `src/systems/WorldLayout.js` |
| Which chunks are loaded around the player | `src/systems/ChunkManager.js` |
| Car drawing (reads physics, never writes it), skid/tire helpers | `src/entities/CarView.js` |
| Camera (world → screen), visible-ground helper | `src/render/projection.js` |
| Camera behaviour: look-ahead, speed zoom, trauma shake (pure maths) | `src/render/CameraRig.js` |
| Ground/shadow layers, depth sorting | `src/render/layers.js` |
| Low-poly renderer (solids, flat shading, shadows, baking) | `src/render/lowpoly.js` |
| Car models (player, police, interceptor, Bearcat, helicopter, wreck, upside-down wreck) / car drawing sheets | `src/render/carModels.js`, `src/render/carAtlas.js` |
| Prop models (blocks, barriers, trees, lamps, cones, islands, crates, containers, monument, roundabout, parked cars, block letters, lucky die, spike strip) | `src/render/propModels.js` |
| Drawing the loaded chunks (floor, holes, pooled props), culling, knocked props | `src/render/Scenery.js` |
| Comic starbursts, puffy smoke, sparks, scorch marks, shockwave ring | `src/render/Effects.js` |
| Hit-stop (brief freeze on big hits) | `src/systems/HitStop.js` |
| Wreck tumbling and flying-piece maths (drawing only) | `src/render/Tumble.js` |
| Siren beams ahead of arriving police | `src/render/SirenBeams.js` |
| Block letters for the word statues | `src/render/blockFont.js` |
| Skid marks (capped pool) | `src/systems/SkidMarks.js` |
| HTML interface: HUD, title / pause / results screens | `src/ui/Hud.js`, `src/ui/Screens.js`, `src/ui/dom.js`, styles in `src/styles/main.css` |
| Debug toolbar (`?debug` only) | `src/dev/DevPanel.js` |
| Debug test hooks (`window.__carChaseDebug`, perf probe; `?debug` only) | `GameScene.installDebugHooks()` |
| Bundling the Playgama SDK file locally | `vite.config.js` (plugin), `public/playgama-bridge-config.json` (placeholder) |
| Math helpers, seeded random | `src/utils/math.js` |
| Game-logic tests (`npm test`) and bot balance runs (`npm run balance`) | `tests/` |
| Try any power-up on demand (`?debug` toolbar buttons) | `src/dev/DevPanel.js`, `GameScene.givePower` |
| Bring on a Bearcat, roadblock or helicopter on demand (`?debug` toolbar buttons) | `src/dev/DevPanel.js`, `GameScene.summon` |
| 2.5D rendering rules | `RENDERING.md` |
| Art direction | `ART_DIRECTION.md` |
| Tuning history | `TUNING_LOG.md` |

Phaser is imported as `import * as Phaser from 'phaser'` (Phaser 3.90 has no default export).

## Where the project stands (handoff, 2026-10-29)

- **Done:** M0, M1, M1.6, M1.7 (approved), then on 2026-10-29 the owner asked to "proceed with the rest of
  the milestones and provide the full game". Built in one pass:
  - **M2 survival loop:** solid props and arena walls, police (shared `Car.js` model, pursuit AI with
    imperfect obstacle awareness, chasers + interceptors), off-screen spawn director with a difficulty
    curve, crash rules (impact thresholds, "pinned" bust), wrecks as obstacles, explosions with chain
    reactions, survival timer, results, instant retry, saved best/totals.
  - **M3 game feel:** tire smoke, skid marks for all cars, fire/debris/flash/scorch, camera shake, close
    calls, combos, knock-over cones, Shockwave crate power-up with an off-screen arrow.
  - **M4 art/audio/UI:** police and wreck low-poly models, flashing light bars, crate model, lighter city
    blocks vs roads, synthesised Web Audio sound (engine, squeal, siren, crashes, UI), HTML title / HUD /
    pause / results screens, sound setting, safe areas, portrait + landscape.
  - **M5 platform:** Playgama Bridge v2 adapter (game_ready, level_* messages, pause/audio events,
    platform storage) with local fallback; SDK bundled locally through the Vite plugin.
  - Dev toolbar, turntable and test hooks now only exist with `?debug` in the address.
- **Tested here:** 36 simulation checks + bot balance runs (Node); 58 browser checks (desktop, phone
  portrait/landscape with rotation, platform stand-in SDK, 24-police stress = 7 draw calls, repeated runs).
- **Never verified yet (owner's computer):** `npm install`, `npm run dev`, `npm run build` with real Vite
  (the cloud sandbox has no npm registry; an esbuild stand-in build was used), real phones (feel, frame
  rate, sound), the real Playgama SDK file and Playgama's QA tool, YouTube Playables review.
- **Before submission:** install `@playgama/bridge` (or put `playgama-bridge.js` in `public/`), replace the
  placeholder `public/playgama-bridge-config.json` with one from Playgama's config editor, run the QA tool.
- **Still open (owner):** final camera (Angled is the default), ART_DIRECTION approval, difficulty after
  real playtests, whether to add more power-ups, unlockable cars or adverts (none are in the game).
- **Owner is not a programmer:** explain simply, give exact manual steps.
