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
| Police car state (pooled) / pursuit steering | `src/entities/PoliceCar.js`, `src/systems/PoliceAI.js` |
| Collisions (car circles, prop circles/boxes, grid) | `src/systems/CollisionSystem.js` |
| Spawn director + difficulty curve | `src/systems/SpawnSystem.js` |
| Shockwave crate power-up | `src/systems/PowerUpSystem.js` |
| Run stats, saved records, time format | `src/systems/ScoreSystem.js`; settings in `src/systems/Settings.js` |
| Synthesised sound (Web Audio, no files) | `src/systems/AudioSystem.js` |
| Chunk layouts (data shared by drawing and collisions, worked out from chunk coordinates) | `src/systems/WorldLayout.js` |
| Which chunks are loaded around the player | `src/systems/ChunkManager.js` |
| Car drawing (reads physics, never writes it), skid/tyre helpers | `src/entities/CarView.js` |
| Camera (world → screen), visible-ground helper | `src/render/projection.js` |
| Camera behaviour: look-ahead, speed zoom, trauma shake (pure maths) | `src/render/CameraRig.js` |
| Ground/shadow layers, depth sorting | `src/render/layers.js` |
| Low-poly renderer (solids, flat shading, shadows, baking) | `src/render/lowpoly.js` |
| Car models (player, police, wreck) / car drawing sheets | `src/render/carModels.js`, `src/render/carAtlas.js` |
| Prop models (blocks, barriers, trees, lamps, cones, islands, crates, containers, monument, roundabout) | `src/render/propModels.js` |
| Drawing the loaded chunks (floor, holes, pooled props), culling, knocked props | `src/render/Scenery.js` |
| Particles, flashes, scorch marks, shockwave ring | `src/render/Effects.js` |
| Skid marks (capped pool) | `src/systems/SkidMarks.js` |
| HTML interface: HUD, title / pause / results screens | `src/ui/Hud.js`, `src/ui/Screens.js`, `src/ui/dom.js`, styles in `src/styles/main.css` |
| Debug toolbar (`?debug` only) | `src/dev/DevPanel.js` |
| Debug test hooks (`window.__carChaseDebug`, perf probe; `?debug` only) | `GameScene.installDebugHooks()` |
| Bundling the Playgama SDK file locally | `vite.config.js` (plugin), `public/playgama-bridge-config.json` (placeholder) |
| Math helpers, seeded random | `src/utils/math.js` |
| Game-logic tests (`npm test`) and bot balance runs (`npm run balance`) | `tests/` |
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
  - **M3 game feel:** tyre smoke, skid marks for all cars, fire/debris/flash/scorch, camera shake, close
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
