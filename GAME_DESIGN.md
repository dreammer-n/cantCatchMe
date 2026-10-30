# GAME_DESIGN.md — Original Endless Car-Chase Survival Game

**Version:** 2.0 (refined for Claude implementation)  
**Status:** Development design specification, not a claim of exact reverse engineering  
**Reference:** Gemini's analysis of the supplied *PAKO Forever* gameplay recording  
**Stack:** HTML5, Phaser 3, JavaScript (ES6+), Vite  
**Distribution targets:** YouTube Playables (primary), Playgama and compatible HTML5 portals  
**Deliverable:** Original standalone browser game, complete production build **strictly under 30 MB**

> **Instructions to Claude:** Read this file together with `CLAUDE.md` before implementing gameplay. `CLAUDE.md` controls coding workflow and project practices; this file controls gameplay intent and acceptance criteria. Where requirements conflict, identify the conflict and propose the smallest resolution. Do not silently substitute mechanics. This project is inspired by genre mechanics—not a request to copy artwork, trademarks, UI, audio, or proprietary assets.

## 1. Evidence, assumptions, and design decisions

Gemini prepared the original analysis from a reference video. The classifications below preserve that provenance; **“Reported observed” means Gemini labeled the behavior observed, not that we independently measured or verified every claim.**

- **[RO] Reported observed:** An apparent behavior or UI element reported in Gemini's video analysis. Use as a reference target, subject to confirmation when ambiguous.
- **[INF] Inferred:** Explanation inferred from appearances, such as an underlying spawning algorithm or friction model. Do not treat as a proven implementation detail.
- **[DES] Design decision:** Our proposed choice for this original game, changeable after playtesting.
- **[TUNE] Prototype tuning:** Explicit trial value, *not* a measured value of the reference game.
- **[TBD] To validate:** Unresolved issue to check with the reference, the running prototype, SDK docs, or real devices.

Do not present guessed angles, engine parameters, exact enemy counts, or unlock conditions as reliably measured facts. Capture test notes and record major tuning changes in `TUNING_LOG.md`.

## 2. Product vision and priorities

### 2.1 Core fantasy

A continuously moving car must survive relentless pursuit through a dense, readable, stylized urban arena. The player escapes by steering cleverly, drifting around obstacles, inducing collisions among pursuers, collecting occasional power-ups, and chasing a personal survival-time record.

### 2.2 Core loop

**Spawn → auto-drive → steer and evade → police pursuit intensifies → use obstacles / cause pileups → optionally collect power-ups → collision / busted → show run statistics → instant retry.**

### 2.3 Design pillars

1. **Immediate readability:** The first run should be playable without reading instructions.
2. **Delightful steering:** One-dimensional input (left/right) produces nuanced drifting and momentum.
3. **Emergent pursuit:** Police AI is constrained by turning, obstacles, and collisions, creating unpredictable chain reactions.
4. **Short replay loop:** Restart is nearly instantaneous; track personal best time.
5. **Cross-device parity:** Same gameplay dynamics, normalized input and fair reaction time across portrait, landscape, desktop and touch devices.
6. **Original identity and lightweight build:** Consistent original art direction, performance-conscious visual effects and self-contained assets.

### 2.4 MVP versus later milestones

**MVP (must work before extras):** one car, continuous forward motion, keyboard/touch/mouse steering, stable camera, one arena with solid obstacles, pursuing police, car/police collisions, fail state, timer/high score, restart, responsive layout, and basic pause/mute.

**Milestone 2:** controlled drifts, skid marks, smoke, improved collisions, police pileups, meaningful difficulty escalation, sound and polish.

**Milestone 3:** power-up crate + one original power-up, combo notifications, more terrain props, additional pursuit behaviors.

**Optional post-MVP:** more power-ups, unlockable cars and handling profiles, dynamic encounters, garage, and complex destructible environment. Do not delay basic playability for optional features.

## 3. Driving and vehicle physics

### 3.1 Reference behavior

- **[RO]** The player car proceeds forward automatically; the primary interaction is left/right steering.
- **[RO]** Tight turns produce sustained lateral slip, tire smoke and skid marks.
- **[RO]** Some glancing contacts appear survivable, while some harder impacts end the run.
- **[INF]** The movement may be approximated by forward acceleration plus lateral grip loss and gradual grip recovery; the original internal physics engine is unknown.

### 3.2 Implementation contract

- **[DES]** Build an arcade driving model that is deterministic enough to tune, not a realism simulator.
- Advance simulation using bounded, frame-rate-independent steps; cap extreme frame delta after tab restoration.
- Separate **heading**, **velocity**, **forward component**, **lateral component**, and **steering command**.
- Apply forward drive toward a capped top speed, damp lateral velocity with a configurable grip coefficient, and clamp angular steering.
- Steering direction must remain predictable; no braking/reversing for the base game.
- Vehicle has visible wheel/skid feedback while slipping. Prefer cheap particles / decals and strict lifetime limits.
- Store numbers together in `src/config/tuning.js` (or equivalent), not scattered through entities.

### 3.3 Physics engine decision

**[DES] Prefer testing Matter.js first** if realistic rotated collision shapes and vehicle-to-vehicle contacts help the game feel. Matter is not mandatory. Simple custom kinematic driving with a focused collision solution may outperform an unconstrained rigid-body simulation at high police counts. Make the choice after a vertical slice with at least 15–30 interacting vehicles; measure frame pacing on a mid-range mobile device. Avoid introducing an additional full physics library.

Use collision categories/masks and sensors consistently. Do not attach dynamic Matter bodies to every decorative prop. For optional wrecking-ball constraints, revisit physics capabilities when that feature is scheduled.

### 3.4 Initial tuning, NOT reference measurements

| Parameter | Suggested starting point | Tuning goal |
|---|---:|---|
| Player target speed | 300 world units/sec | Enough speed for continuous decisions |
| Player steering maximum | 180°/sec | Responsive without spinning uncontrollably |
| Police target speed | 1.05–1.15 × player speed | Can catch on straights; player wins via turning |
| Police steering maximum | 65–80% of player's | Enables escapes around corners |
| Lateral grip and drift recovery | TBD through delta-time-based testing | Long enough to feel like a drift, controllable enough to evade |
| Contact severity threshold | TBD through impact tests | Glancing contact feels different from terminal impact |

**Important:** Do not use a per-render-frame multiplier like `velocity *= 0.92` without converting it into time-based damping. All starting numbers are placeholders until playtested.

### 3.5 Future handling archetypes

- **Balanced:** predictable speed, turning and moderate drift.
- **Agile:** faster response, sharper turning, potentially more sliding.
- **Heavy:** lower turning rate, wider arc, greater collision presence.

Gemini listed multiple example vehicles and precise multipliers from the reference. Those are useful inspiration only; original vehicles and unlock rules must be designed later.

## 4. Police pursuit, spawning and escalation

### 4.1 Reference behavior

- **[RO]** Multiple pursuing police cars enter from off-screen areas and chase the player.
- **[RO]** Pursuers appear to attempt direct chases, crosswise interceptions and frontal approaches.
- **[RO]** Police frequently hit obstacles or each other, generating explosions and chained effects.
- **[INF]** AI likely uses steering toward the player and/or a predicted position, rather than sophisticated obstacle pathfinding.
- **[RO—unverified transcription]** Gemini reported these on-screen snapshots: ~3 cars at 0:05, 11 at 0:15, 37 at 0:28 and 50+ at 0:40. **These might mean a cumulative CARS counter, not simultaneous active police. Do not use them as an active-population target unless the HUD meaning is verified.**

### 4.2 AI behavior

Implement a compact pursuit controller:

1. Choose target point: player current position for basic pursuit, player predicted position for interceptors.
2. Compute shortest signed heading angle toward target.
3. Clamp steering to police vehicle's maximum turn rate.
4. Apply the same core forward/traction model as the player's vehicle with different configuration.
5. Let solid collisions interrupt pursuit; avoid instant orientation snapping.
6. Reacquire target at a limited interval where practical rather than performing expensive global analysis each frame.

Start with **direct tail pursuit**. Only add **interceptor** and **head-on challenger** archetypes after normal chasing behaves well. Simple lack of obstacle avoidance is an intentional source of pileups, but should not result in obviously broken pathing or unavoidable instant spawns.

### 4.3 Spawn director: resolve the original contradiction

Gemini's source included high `CARS` HUD snapshots but also a much slower example spawn rate. Do **not** assert both describe active enemies. Use these separate metrics:

- `activePoliceCount`: currently simulated living pursuers.
- `spawnedPoliceTotal`: cars spawned in the run.
- `destroyedPoliceTotal`: police vehicles destroyed during the run.
- `hudCarsValue`: defined explicitly only after checking the reference / choosing our intended UX.

**[TUNE] Starting escalation proposal:**

| Survival time | Concurrent active police target | Spawn behavior |
|---|---:|---|
| 0–10 seconds | 2–4 | Gentle introduction |
| 10–25 seconds | 5–10 | Add pressure gradually |
| 25–45 seconds | 10–18 | Frequent pursuit and pileups |
| 45–75 seconds | 18–28 | Harder survival phase |
| 75+ seconds | 25–35 soft cap | Intensify intelligently; preserve performance |

These are **our provisional targets**, not claimed reference measurements. Adjust based on how often police destroy themselves and actual device performance. Never spawn enough cars to degrade responsiveness.

Spawn just outside the visible camera plus a safety margin, checking player proximity, imminent heading and reasonable reaction time. A configurable share may be placed ahead of travel to create interceptions, but avoid unfair unavoidable spawns. Despawn or recycle pursuers far behind the camera under consistent rules.

### 4.4 Collision chain reactions

- **[RO]** Enemy-to-enemy and enemy-to-obstacle crashes can produce explosions and cascading destruction.
- **[DES]** Trigger an explosion only after exceeding a configurable relative-impact severity; avoid every light brush destroying vehicles.
- Explosion applies bounded radial damage / impulse to eligible nearby police and props.
- Prevent an individual object from exploding more than once.
- Maintain a short configurable combo attribution window (initial experiment: 1.5 seconds).
- Use object pooling for repeated visual effects if profiling supports it.
- Player collision rules differ from police rules; preserve fair glancing contacts.

## 5. World, camera and drawing perspective

### 5.1 Reference characterization

- **[RO]** Fixed high-angle, pseudo-isometric / oblique parking-complex scene with lane markings, curbs, vegetation and structures.
- **[RO]** Camera follows the player, maintaining a mostly stable world orientation.
- **[INF]** Camera may use some damping or look-ahead; degree of zoom behavior is not accurately measurable from this analysis.
- **[RO]** Gameplay seems to accommodate extended travel; whether the reference loops or procedurally generates the world is unknown.

### 5.2 MVP world

- Start with **one large, repeatable top-down 2D arena**; no infinite-world engine needed for the first playable prototype.
- Include roads / parking markings, safe open zones, islands, and collision obstacles.
- Use simple colliders for structures, breakable props for selected decoration, and cosmetic-only shapes for the rest.
- Upgrade to recycled world chunks only if playtesting shows the arena becomes predictable or insufficiently large.
- Keep objects correctly sorted by ground contact depth if using oblique-looking sprites; do not blindly use `sprite.depth = sprite.y` for UI layers or multipart sprites.

### 5.3 Camera and viewport

- Camera remains north-up and follows the player with mild smoothing.
- Optional velocity-based look-ahead improves response time at speed.
- Camera framing is adapted for aspect ratio; physics / world scale must not change merely because the browser changes shape.
- Minimize blindside collisions in narrow portrait screens: tune zoom, lead distance and spawn safety to preserve practical reaction time.
- Maintain a fixed logical game-coordinate system and resize the renderer responsively. Avoid stretching sprites.

### 5.4 Visual rendering choices

- **[DES]** Prefer economical 2D sprites / atlases, rotated vehicle top views, shadows, skid decals, smoke and lightweight blast particles.
- A convincing original 2.5D visual style may later require pre-rendered directional artwork; **32 frames per car and specialized shaders are optional, not mandatory**.
- Art direction belongs in `ART_DIRECTION.md` and may replace temporary placeholders without rewriting physics.

## 6. Environment and object interactions

| Category | Examples from Gemini's analysis | Intended behavior |
|---|---|---|
| Solid world obstacles | concrete bases, dividers, building edges | can block movement, cause terminal collision if severity warrants |
| Breakable / movable props | streetlights, small trees, barriers, parked cars | visual debris and a tunable velocity penalty; not always fatal |
| Dynamic hazards (later) | rolling boulders, special encounter threats | optional late-game variant, not MVP |

Gemini described the presence of special random encounters and a possible tornado; a tornado was specifically inferred and should not be treated as confirmed reference behavior. Implement only after the ordinary traffic/obstacle interaction feels satisfying.

For every collision category define: collision mask, response, destruction threshold, lifetime, particle budget, audio cue and score/combo credit.

## 7. Power-ups and abilities

### 7.1 Source summary

**[RO per Gemini]** Floating mystery/gift crates can be collected. Collected abilities are stored and activated later, with temporary HUD feedback. Gemini listed the following reference effects: drone escort, shrinking police, giant player, trailing wrecking ball, airstrike, radial bomb and temporary freeze. Timing and exact scale factors in that document are not independently verified.

### 7.2 Our design rules

- **MVP:** no power-ups are necessary to validate driving/pursuit.
- **Milestone 3:** add **one original, easy-to-understand power-up**, ideally a brief pulse that clears nearby police, and validate balance.
- Optional additional power-ups may borrow general mechanical categories, but must receive original names, visuals and presentation.
- Every power-up has explicit acquisition, stored/available, activation, active/expired and cooldown states.
- Power-up activation must not conflict with steering on touch devices.
- Duration, force, hitbox effects, invulnerability and UI indicators are configurable.
- Gift/crate spawning near obstacles can increase reward-risk tension, but must leave a navigable route.

## 8. Scoring, progression and game-over

### 8.1 Reference telemetry

Gemini reported elapsed time, distance traveled, a `CARS` counter, record, police crashes and a BUSTED game-over presentation. Listed vehicle unlock requirements are reference-specific and should not be copied verbatim.

### 8.2 Our scoring

- Primary score: **survival time**, measured from active gameplay only (not paused time).
- Secondary stats: total distance driven, police destroyed, highest combo and highest survival record.
- Define any `CARS` HUD label unambiguously or replace it with `PURSUERS`.
- High score persists locally when permitted; if storage is unavailable, gameplay remains fully functional.
- After terminal collision, freeze the gameplay simulation once, show results clearly, and offer a prominent instant retry.
- Pause stops timers/physics/AI, not just player input.

### 8.3 Optional progression

Add a garage and original unlockable vehicles only after the core replay loop is fun. Avoid requiring sign-in, backend or external services.

## 9. Universal input and control parity

### 9.1 Canonical input interface

Create `InputManager` that outputs a normalized immutable gameplay command each simulation step:

```js
{ steer: -1 | 0 | 1, activatePowerUp: boolean, pausePressed: boolean }
```

Gameplay must not directly inspect keyboard, touch or pointer events. InputManager resolves priority and simultaneous inputs consistently.

### 9.2 Control mapping

| Device | Steering | Power-up | Pause |
|---|---|---|---|
| Keyboard | A/D or left/right arrows | Space | Escape or P |
| Touch phone/tablet | hold left/right playable screen zones | dedicated visible button | separate pause icon |
| Mouse | hold left/right zones or optional on-screen arrows | click visible button | pause icon |
| Gamepad if supported | D-pad or left-stick horizontal with dead zone | primary face button | Start/Menu |

- One finger must be enough for steering, and steering should not be interrupted by a second finger activating a power-up.
- Prevent default page scrolling/zoom gestures while interacting with the game surface, while respecting browser embedding constraints.
- On simultaneous left and right, use a predictable neutral input unless a tested alternative is specifically requested.
- Track pointer IDs for multi-touch, cancel stale input on `pointercancel`, blur or pause.
- Avoid double-tap activation as the only power-up control; it creates accidental activations and varies across devices.
- Support input remapping later if needed; initial gameplay should require no setup.

### 9.3 Responsive UI

- Support portrait and landscape without making either unplayable.
- Position timer, score and pause in safe areas; keep steering zones / power-up button from obscuring the player.
- Scale UI relative to available CSS pixel dimensions and device pixel ratio with rendering limits.
- Handle resizing, visibility loss, focus loss and orientation changes gracefully; clear stuck held inputs.
- Test narrow phones, wide desktop windows, tablets and unusual aspect ratios.

## 10. Platform and Playgama integration

### 10.1 Architectural boundary

Create `src/platform/PlatformManager.js` exposing neutral operations such as:

- `initialize()`
- `gameReady()`
- `pause()` / `resume()` coordination
- `getStoredValue(key)` / `setStoredValue(key, value)`
- `setMuted(isMuted)`
- optional supported advertisement methods when explicitly requested

These are **internal interface names, not assertions about actual Playgama SDK methods**. Implement adapters against official API documentation when integration starts. Gameplay scenes talk only to this interface.

### 10.2 Integration schedule

1. Establish platform abstraction and local fallback immediately.
2. Build and test a driving + chasing vertical slice without requiring remote platform services.
3. Integrate Playgama Bridge early enough to validate lifecycle, readiness, focus, audio and storage; **do not postpone until after all gameplay/polish is finished**.
4. Verify actual YouTube Playables requirements and whether Playgama's integration covers them; use platform-specific adapters only where needed.
5. Test on each target platform / simulator when available. Do not claim a platform passes without testing.

### 10.3 Distribution constraints

- Treat **less than 30 MB for the entire distributable production build** as a project requirement; target less than 25 MB for headroom.
- Bundle required playable assets locally; avoid assuming unrestricted network, CDN assets or analytics.
- Consult current YouTube Playables and Playgama policies before submission; publishing and SDK details can change.
- Respect platform start, focus, pause/resume, audio unlock, saving, game-ready and advertisement policies where applicable.
- Game runs locally without the SDK, advertising or network access.

## 11. Performance, size and technical architecture

### 11.1 Technical principles

- Use Phaser 3 and ES modules bundled by Vite.
- Keep world entities separate from scenes and from platform integration.
- Object-pool high-churn objects only when it improves profiling results. Set strict caps on particles, debris, decals and active pursuers.
- Use spatial broad-phase / collision categories where suitable. Avoid full N² all-car collision scans in custom systems.
- Delta-time stepping must survive 30/60/120 Hz displays and recover from tab backgrounding.
- Never allocate unbounded persistent skid marks; use a capped set of decals or recycling render textures.
- For performance tests, record FPS, frame-time spikes, concurrent police, draw calls where measurable and memory behavior.

### 11.2 Asset budget (planning allowances, not actual file measurements)

| Component | Target allowance |
|---|---:|
| Engine, source and production JavaScript | 3 MB |
| Vehicle and environment artwork | 7 MB |
| Particles / effects / UI / fonts | 4 MB |
| Sound effects and music | 5 MB |
| Reserve for platform requirements and future additions | 6 MB |
| **Planning target** | **25 MB** |

Measure actual output of `dist/` after every major milestone and keep the final packaged output under 30 MB. Be explicit about whether the upload platform adds any required wrapper files. Do not claim compliance from a budget table alone.

### 11.3 Suggested simple modules

```text
src/
  main.js
  config/tuning.js
  scenes/BootScene.js
  scenes/MenuScene.js
  scenes/GameScene.js
  scenes/GameOverScene.js
  entities/PlayerCar.js
  entities/PoliceCar.js
  systems/InputManager.js
  systems/PoliceDirector.js
  systems/CollisionRules.js
  systems/ScoreManager.js
  platform/PlatformManager.js
  utils/math.js
public/assets/
index.html
package.json
vite.config.js
CLAUDE.md
GAME_DESIGN.md
ART_DIRECTION.md
TUNING_LOG.md
```

These are suggestions, not a mandate to create empty files or large frameworks before they're needed.

## 12. Delivery milestones and objective acceptance criteria

### Milestone A — Driving vertical slice

- Game boots locally and fits both portrait and landscape.
- Car moves continuously with tunable drift and steering.
- Keyboard, mouse and touch control the **same** handling code.
- Camera follows smoothly; no stuck steering after tab blur or touch cancellation.
- Measure a production build size.

### Milestone B — Survival loop

- Add at least one obstacle type, basic pursuit, off-screen police spawning and collision-based failure.
- Timer, game over and retry work repeatedly without memory growth.
- Active police and spawned police are tracked distinctly.
- Difficulty increases without unavoidable instant collisions.

### Milestone C — Game feel

- Tune near misses, drift and police turning so players can intentionally bait police into collisions.
- Add collision effects, combos and limited breakable props.
- Test moderate and heavy police counts on actual devices; adjust caps and pools.

### Milestone D — Original art and audio

- Replace placeholders with cohesive original art using `ART_DIRECTION.md`.
- Add and test compressed local audio, settings, mute and safe-area HUD.
- Preserve gameplay parity across orientations.

### Milestone E — Platform readiness

- Integrate and verify Playgama Bridge methods against current docs.
- Check YouTube Playables requirements separately.
- Verify lifecycle, storage, audio, focus and readiness behavior in available test contexts.
- Produce self-contained production build, enumerate its files, and verify final total under 30 MB.

## 13. Rules for Claude on each task

1. Read `CLAUDE.md` and this file first.
2. Identify whether the requested mechanic is `[RO]`, `[INF]`, `[DES]`, `[TUNE]` or `[TBD]`.
3. Briefly state the smallest implementation plan and files affected.
4. Implement one milestone-sized change; don't rewrite unrelated systems.
5. Add tunable constants instead of burying numbers in source code.
6. Run available build/tests; report what was tested and what was not.
7. Update `TUNING_LOG.md` when changing physics, camera, AI or spawn balance.
8. Measure `dist/` after relevant changes, report total and largest assets.
9. Never claim device performance, video-observed behavior or SDK compliance without evidence.
10. Do not implement later-stage features unless requested.

## 14. Decisions to keep open

- Final original art style, palette, car proportions and UI aesthetic (`ART_DIRECTION.md`).
- Matter-based versus custom kinematic collision implementation after profiling.
- Whether the long-term map is bounded, chunk-recycled or intentionally looping.
- Exact camera angle and sprite projection technique for the chosen art style.
- Intended meaning of the reference `CARS` counter.
- Difficulty escalation based on time, distance, player skill, or a combination.
- Final power-up roster, naming, and unlockable vehicles.
- Precise SDK initialization, storage and lifecycle calls per current platform docs.

---

**Success definition:** A responsive, replayable, original cross-platform HTML5 car-chase game whose steering and pursuit interactions are genuinely fun, that can be tested on its target platforms, and whose measured complete production package stays under 30 MB.
