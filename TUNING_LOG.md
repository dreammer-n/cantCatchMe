# TUNING_LOG.md

Records changes to physics, camera, AI and spawn balance. All values are prototype guesses until playtested.

| Date | Milestone | Setting | Value | Why |
|---|---|---|---|---|
| 2026-10-28 | M0 | `VIEW.shortSideWorldUnits` | 900 | Same world width across the narrow screen side on every device. At the planned 300 units/s, the car crosses the narrow view in ~3 s. Re-check in M1 with real driving, especially in portrait. |
| 2026-10-28 | M0 | `DISPLAY.maxPixelRatio` | 2 | 3x phone screens render at 2x: less GPU work, little visible difference. |
| 2026-10-28 | M0 | `DISPLAY.maxFrameDeltaMs` | 50 | Caps simulated time after hitches or tab switches. |
| 2026-10-28 | M0 | `ARENA` size | 4000 × 4000 | Placeholder bounded arena; revisit once driving speed is tuned. |
| 2026-10-28 | M1 | Driving model | see `HANDLING_PRESETS` | First version. Top speed 300, acceleration 420, steering 170–185°/s. Three temporary presets (Grippy / Balanced / Drifty) for playtesting. |
| 2026-10-28 | M1 | Balanced preset | grip 9 straight / 5.5 turning | Measured in tests: ~30° peak drift in a 1.5 s turn, speed stays above 245. |
| 2026-10-28 | M1 | Drifty preset | grip 6.5 / 3.8, scrub 0.35, turn 185°/s | First guess (grip 3) slid 55° and dropped to 155 speed. Now ~45° peak, speed stays above 175. |
| 2026-10-28 | M1 | Grippy preset | grip 14 / 11 | ~14° peak drift, no speed loss. |
| 2026-10-28 | M1 | `CAMERA` | follow 6/s, look-ahead 0.45 s, max 22% of narrow view | Camera sits ~90 units ahead of the car at full speed. Check in portrait on a real phone. |
| 2026-10-28 | M1 | `WALLS` | bounce 0.45, keep 0.7 | Temporary bounce until crash rules in M2. |
| 2026-10-28 | M1 | `SKIDS` | max 500 marks, 2.6 s fade, threshold 70 units/s sideways | Hard cap; oldest mark reused. |
| 2026-10-28 | M1.5 | `RENDER.defaultElevationDeg` | 55° (options 45 / 55 / 65 / flat) | First 2.5D camera angle. Ground looks 18% shorter top-to-bottom; up/down motion looks slower on screen than sideways motion (physics unchanged). Portrait phone now shows 2378 ground units top-to-bottom (was 1948). |
| 2026-10-28 | M1.5 | `RENDER.directions` | 16 (9 drawings, mirrored) | Leftover rotation up to ~14° is applied to hide frame jumps. Revisit with real art. |
| 2026-10-28 | M1.5 | `CAR_MODEL` | body 20, cabin 15 high | Placeholder box car only. |
| 2026-10-29 | M1.6 | Camera | Angled: map turned 40°, tilted 48° (options: Angled high 40°/58°, Angled low 35°/40°, North-up 0°/55°) | Matches the reference perspective: top + two sides of everything visible. Replaces the north-up 55° camera. |
| 2026-10-29 | M1.6 | `RENDER.directions` | 64 drawings, no mirroring | Drawn from the 3D model at startup. Leftover rotation under 4°. 4.8 MB graphics memory. |
| 2026-10-29 | M1.6 | Light | key (0.7, 0.05, 0.7) from the right, fill 0.15, ambient 0.5 | First try (light from upper right and behind) made both visible sides almost equally bright (121 vs 117); now clearly lit vs shaded. |
| 2026-10-29 | M1.6 | Shadows | length 0.75 × height, alpha 0.3, fall to the left | Reference look; long enough to show height without hiding the ground. |
| 2026-10-29 | M1.6 | `CAR_MODEL` | body 6–17, cabin to 31, wheels 13 high, 1.5 outset | Low-poly coupe; footprint unchanged (44 × 84 = physics size). |
| 2026-10-29 | M1.6 | `RENDER.bakeScale` | 1.5 px per world unit | Screens show 0.9–2 px per unit; sharp enough without wasting memory. |
| 2026-10-29 | M1.7 | `CAR_MODEL` | rebuilt in height bands: tyres 0–13 outside the body (x 19–23.5) with hubs; dark sills/bumpers 4–10; body 9.5–17 with sloped hood (to 14) and boot (to 16); glass cabin to 30 | Owner asked for roof, windscreen, sides, hood and body height to read apart. Tyres were hidden under the body before. |
| 2026-10-29 | M1.7 | Light | ambient 0.5 → 0.42, new `skyGain` 0.1 (upward faces only) | Tops 0.95, lit side 0.75, shaded side 0.54 (was 0.93 / 0.83 / 0.62): roof and hood no longer blend into the sides. |
| 2026-10-29 | M1.7 | `RENDER.contactShadow` | alpha 0.22, footprint + 3 | Dark patch right under the car so it sits on the ground at every heading. |
| 2026-10-29 | M1.7 | `SCENERY.treeScale` | 1.25 | Trees were small next to the car (crown 1.4× car width); now pine ≈ 4 car heights, crown ≈ 2× car width. |
| 2026-10-29 | M2 | `ARENA` size | 6000 × 6000, city grid of 600-unit blocks with 190-wide roads | Room for long chases; generated with a fixed seed (`WORLD.seed`), same map every run. Bot test: with no police the bot drives 240 s without hitting anything, so the map is navigable. |
| 2026-10-29 | M2 | `POLICE_HANDLING` / `POLICE` | speed 1.04 → 1.14 × player over 150 s; turning 118 → 136°/s (player 180) | Design doc: police catch you on straights, you escape in turns. |
| 2026-10-29 | M2 | `SPAWN.table` | 2 police at 0 s, 4 at 10 s, 7 at 25 s, 12 at 45 s, 17 at 75 s, 22 at 110 s, 26 at 160 s (cap 28) | Gentle start, then pressure. Spawned off screen (never on screen in 1,800 bot spawns), ≥ 700 units away, ≥ 820 when coming from ahead. |
| 2026-10-29 | M2 | `POLICE.awareness` | 0.6 chance per reaction to swerve around a prop ahead | Fully blind police wrecked themselves ~9 times per 15 s run on props; with 60 % awareness pile-ups still happen but pursuits last. |
| 2026-10-29 | M2 | `CRASH.playerImpact` | 195 → 215 | Bot runs: busts mostly came from police hitting the rear quarter while turning; 215 lets shallow side-swipes through. |
| 2026-10-29 | M2 | `SPAWN.minDistance` | 620 → 700 | One bust in 30 runs was by a police car under 1.5 s old; more room to react. |
| 2026-10-29 | M2 | Bot balance (skill 1.3, 30 runs, phone portrait) | median 24.8 s, p75 39.5 s, best 64 s; 25 police wrecked per run | Bot is far weaker than a person (0.7–0.9 s look-ahead, three fixed steering choices). Expect people to survive longer; re-tune after real playtests. |
| 2026-10-29 | M3 | `NEAR_MISS` | gap ≈ 30 units at > 170 units/s relative | Rare enough to feel special (≈ 1 per bot run). |
| 2026-10-29 | M3 | `POWERUP` | first crate at 14 s, then every 17 s while not holding one; Shockwave radius 340 | One clear, easy power-up (design doc M3). |
| 2026-10-30 | Feel 1 | Slide extras, Balanced | `slideGripLoss` 0.12, `counterSteerBonus` 0.5, `deepSlideScrub` 40 (starts at 30° slip, full at 50°) | Peak drift 30° → 34°; slowest point of a 1.5 s full turn 246 → 222. A first try (0.2 / 0.5 / 100) dropped to 193, too much for a "slight" scrub. Counter-steering turns the nose back 21° vs 13° in 0.25 s. |
| 2026-10-30 | Feel 1 | Slide extras, Drifty / Grippy | Drifty 0.05 / 0.7 / 20; Grippy 0.1 / 0.3 / 30 | Drifty is already near the limit (47° peak, slowest 167); Grippy barely slides, so these change it little (15° peak). |
| 2026-10-30 | Feel 1 | Police handling | slide extras stay 0 | Police keep their old handling; catching slides is the player's advantage. |
| 2026-10-30 | Feel 1 | `rollMaxDeg` 5, `rollResponse` 8 | Visual body-lean value | Calculated and tracked only. Not drawn yet: cars are pre-drawn images, so showing it is an art decision. |
| 2026-10-30 | Feel 1 | `CURB` | keep 82% of speed, nudge 0.3, nose 0.12; `curbEngineShare` 0.15 | Islands can be driven over, by police too. 18% loss at any angle, once per crossing. Acceleration is so strong (420) that the penalty would vanish in 0.13 s, so the engine is mostly cut while on the curb. Above 0 so a car can't stall into a "pinned" bust. |
| 2026-10-30 | Feel 1 | `CONES.lampSlowdown` 0.88, `lampSpin` 5 | Lamp posts knocked away instead of solid | They were thin, deadly and on every island, which would make crossing a curb feel unfair. Trees stay solid. |
| 2026-10-30 | Feel 1 | `CRASH.scrapeImpact` | 20 | Light touches now report a `scrape` event for screen shake. `CRASH.playerImpact` (215) is the existing fatal impact speed, unchanged: 35° glances survive at top speed, 75° hits are fatal. |
| 2026-10-30 | Feel 1 | `CAMERA` | lead 2.2 s limited to 21% of the view, swing rate 1.6/s, follow 8/s | Car sits 17.5–19.7% of the view behind the centre (rear third = at least 16.7%) in 8 directions on portrait, landscape and desktop. Low swing rate: at most 448 screen units/s relative to the car in hard weaving. |
| 2026-10-30 | Feel 1 | `CAMERA` zoom | 0.90× at speed 300, starts at 150, rate 1.5/s | Keeps more road in view at speed. The car is near top speed most of the time, so 0.90× is effectively the normal view. Check car size on a real phone. |
| 2026-10-30 | Feel 1 | `TRAUMA` | scrape 0.25, knock 0.2, curb 0.3, bump 0.35, near miss 0.4, explosion up to 0.55, pulse 0.6, crash 1; decay 1.3/s; max 36 units | Shake size = trauma². Replaces Phaser's fixed shake. All first guesses, never felt on a real device. |
| 2026-10-30 | Feel 1 | `POLICE.despawnDistance` | 2100 → 2900 | Needed by the new camera: spawn points ahead reach about 2200 units on a portrait phone, so police would be recycled the moment they spawned. |
| 2026-10-30 | Feel 1 | Bot balance (skill 1.3, 30 runs, phone portrait) | median 24.8 → 29.6 s, p90 58.9 → 66.9 s, police wrecked per run 25.6 → 31.2 | Within the run-to-run noise: with 60 other seeds, a v1.0-like setup gave 20.5 s and all changes (first balance test) 22.0 s. Regression guard only; a bot can't judge feel. |
