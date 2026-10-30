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
| 2026-10-30 | Step 2 | `CHUNKS.size` / `activeRadius` | 2400 units, 3 x 3 | 1200 (the example in the request) would show the world ending on screen: the grid only guarantees one chunk's width ahead, and the camera shows about 2030 units along a map axis on tall phones. |
| 2026-10-30 | Step 2 | `CHUNKS.presets` | city 30, parking 25, industrial 20, ruins 13, plaza 12 | First guess at the mix. Road holes per chunk: ruins 2–4, city and industrial 0–1, others none. Sinkhole blocks: ruins 45%, city 5%. |
| 2026-10-30 | Step 2 | `CHUNKS.propPool` | 800 | Fullest chunk found in 784 was 80 props, so 720 for a grid of them. Typical grid: about 450. |
| 2026-10-30 | Step 2 | `VOID` holes | road holes radius 55–80 (one lane left open), missing sections 92 half-width, 55–85 half-length, 35% of road holes; block sinkholes 95–150 | A car falls only when its centre is over the hole, and the drawn hole is about 16 units bigger, so clipping an edge is safe. Holes never touch a chunk's border roads. |
| 2026-10-30 | Step 2 | `VOID` fall | 0.85 s, friction 2.5, ends at 20% size, 90 units down, results 0.7 s later | First guesses. The survival clock stops at the edge. |
| 2026-10-30 | Step 2 | `POLICE.despawnDistance` | removed | Police now leave when they are off screen and outside the 3 x 3 grid. |
| 2026-10-30 | Step 2 | `DEPTH` | objects 1e9, effects 4e9 | The old bands (1000 / 100000) would have broken draw order after a few minutes' driving in one direction. |
| 2026-10-30 | Step 2 | Curb colour (`PALETTE.curb`) | yellow, 0xe6bd45 | Owner asked for yellow curbs. Also used on roundabouts. |
| 2026-10-30 | Step 2 | Bot balance (skill 1.3, 30 runs, phone portrait) | median 29.6 → 27.1 s, p90 66.9 → 62.9 s, police wrecked per run 31.2 → 28.7; run endings: police 24, wreck 3, obstacle 2, void 1 | Within run-to-run noise. Bot avoids holes well; people may fall in more often. Bot no longer steers toward the old map centre. |
| 2026-10-30 | Step 3 | `SPAWN.speedMin` / `speedMax`, `laneOffset` | 80–100% of top speed, 45 from the centre line | Police already spawned moving (85%), but pointed straight at the player. Now along a road, in the right-hand lane, toward the player. |
| 2026-10-30 | Step 3 | Chaser aim | at the player's current position (was 0.3 s ahead) | True tail-chasing: they catch you by your mistakes and in turns. Still aim a little to one side while far away (70 units), so they don't drive in one line. |
| 2026-10-30 | Step 3 | `INTERCEPTOR` lead | 0.45–1.6 s (time for the car to reach the player, within those limits) | From a side street it reaches a player driving dead straight (closest 1 unit); a chaser from the same place never gets within 222. |
| 2026-10-30 | Step 3 | `INTERCEPTOR` tactics | aim at a crossing within 170 of the predicted point, when over 420 from the player; flank by 170 when behind and within 650 | Ambushes and flanking, per the request. First guesses. |
| 2026-10-30 | Step 3 | `INTERCEPTOR` speed | +0.07 top speed (333 at the start vs 312), +8°/s turning | "Fast" cruisers. |
| 2026-10-30 | Step 3 | `HEAT` curve | police 2 → 4 (15 s) → 8 (30 s) → 12 (45 s) → 18 (75 s) → 23 → 26; interceptors 0 before 15 s, then 30% → 35% → 50% → 60%; speed 1.04 → 1.05 (30 s) → 1.10 (45 s) → 1.14; interceptor reactions 35% quicker by 90 s | Requested stages. Replaces `SPAWN.table` and the `POLICE` speed ramp. |
| 2026-10-30 | Step 3 | `ROADBLOCK` | from 30 s, every 10–16 s, 2 cars 92 apart, at most 6 parked | Nearly fills a 190-wide road; the lots at the corners stay open. Placed out of sight, 900–2300 ahead. |
| 2026-10-30 | Step 3 | `WARNING` | interceptors closing over 60 units/s, others over 200, within 5 s of arriving; at most 5 arrows, fading over the first 130 screen units in view | A tailing chaser closes at about 12–40 units/s, so it never sets one off. |
| 2026-10-30 | Step 3 | Graphics memory | car drawing sheets 11 → 16 MB | The interceptor's 64 directions. Watch this on low-end phones; 32 directions would halve its share. |
| 2026-10-30 | Step 3 | Bot balance (skill 1.3, 30 runs, phone portrait) | median 27.1 → 34.9 s, p10 11.8 → 9.3, p90 62.9 → 59.2, police wrecked per run 28.7 → 28.1; run endings: police 24, wreck 4, void 2 | Tailing chasers leave more room in the middle of a run; the swarm then ends it sooner. Mostly within run-to-run noise. A bot can't react to warning arrows, so this says nothing about how they play. |
| 2026-10-30 | Step 4 | Light | key (0.72, 0.2, 0.62), gain 0.58, ambient 0.38, `shadowLength` 1 | A properly low sun: shadows 1.21 x height, upper left. Tops 0.93, lit side 0.81, shaded side 0.62. |
| 2026-10-30 | Step 4 | Shadows | alpha 0.3 → 0.42, contact patch 0.22 → 0.3 | Crisp and dark enough to read on the darker road. |
| 2026-10-30 | Step 4 | Palette | see `ART_DIRECTION.md` | Requested comic-arcade scheme. Hole rim brightened, or holes would fade into the darker road. |
| 2026-10-30 | Step 4 | `SKIDS` | life 2.6 → 7 s, pool 500 → 900, one mark per 10 units (was 6), alpha 0.6 | Longer marks. Fewer, longer pieces and a bigger pool, so the pool holds two cars drifting flat out for the full 7 s. |
| 2026-10-30 | Step 4 | `HITSTOP` | scrape 36 ms, bump and parked car 40, double wreck or more 45; cooldown 320 ms | 2 frames at 60 fps. The first frame after a hit always freezes, or below 25 fps there would be no freeze at all. With non-stop hits, at most about 10% of the time is frozen. |
| 2026-10-30 | Step 4 | `EFFECTS` starbursts | 8 at once; sizes crash 1.5, wreck 1.05, parked car 0.6, bump 0.42, scrape 0.24 | First guesses. |
| 2026-10-30 | Step 4 | Siren light on the road | radius 105, alpha 0.62, pulsing | Visible on the dark road without hiding it. |
| 2026-10-30 | Step 4 | `WORLD.parkedCarChance` | 0.13 per stall | 0.16 looked crowded. About 21 cars in a parking chunk, at most 33. |
| 2026-10-30 | Step 4 | `CONES.kinds.civilian` | keep 82% of speed, knocked at 0.8 x car speed, 190 sideways | Costs real speed (246 at the slowest, from 300); shoved to the side it was hit on, so it clears the way. |
| 2026-10-30 | Step 4 | `CHUNKS.propPool` | 800 → 1000 | Fullest chunk is now 89 props, 801 for a grid of them. |
| 2026-10-30 | Step 4 | Bot balance (skill 1.3, 30 runs, phone portrait) | median 34.9 → 28.0 s, p10 9.3 (same), p90 59.2 → 65.2, police wrecked per run 28.1 → 25.6; run endings: police 26, void 2, wreck 2 | Within run-to-run noise. The bot and police both ignore parked cars, and lose speed to them. |
| 2026-10-30 | Drama | `TUMBLE` | 70-115 high, 0.6 s in the air, 20% bounce over 0.24 s, 60% land on the roof | Drawing only. First guesses. The player's crash plays at 0.6 x real time, so it finishes during the slow motion, before the results. |
| 2026-10-30 | Drama | `WRECK.kick`, `spinKick` | 130 units/s in a random direction, up to 9 rad/s | A wreck never just stops. This is physics, so wrecks now end up in slightly different places. |
| 2026-10-30 | Drama | Fireball | 17 flame clouds (26 for the player's crash), growing 0.7 to 2.0 over 0.36-0.68 s, capped at 120 | At 0.45-1.25 the comic star hid them completely. Star moved behind the flames. |
| 2026-10-30 | Drama | Wreckage, rings, burns | 3 pieces a wreck (5 for the player), 24 at most; rings 170 / 240 units over 0.36 s; burns last 45 s, 30 at most | Requested. All capped and pooled. |
| 2026-10-30 | Drama | `HITSTOP` | wreck within 520 units 40 ms, player crash 45 ms | Added to the existing freezes; the same 320 ms cooldown applies. |
| 2026-10-30 | Drama | Siren beams | up to 5, reach 80% of the way to the player (at most 1500), 300 wide, alpha 0.38 | 0.5 looked harsh. One per warning arrow. |
| 2026-10-30 | Drama | Siren wash | alpha 0.15, 1.5 x the ground pool's radius | Faint colour on nearby props and cars, on top of the ground pool. |
| 2026-10-30 | Drama | Word statues | 75% of chunks, letters 85 tall, 20 thick, 10 apart | About 1 on every second screen on a phone. Thickness 26 made the gaps in letters hard to read. |
| 2026-10-30 | Drama | `CHUNKS.presets` | gardens added to city, parking and plaza; average 62 props a chunk (was about 48) | The map was too empty. |
| 2026-10-30 | Drama | `CHUNKS.propPool` | stays 1000 | Fullest chunk is 106 props, 954 for a grid of them. Close to the limit: raise it if chunks get fuller. |
| 2026-10-30 | Drama | `RENDER.shadowBakeScale`, `flatBakeScale` | 0.75, 1 (others 1.5) | Prop drawings would have been 25.9 MB, now 12.4 MB. Shadows are slightly softer, not visibly in screenshots. |
| 2026-10-30 | Drama | Gift box | 44 across (was 30) | Easier to spot. Pick-up distance unchanged. |
| 2026-10-30 | Drama | Bot balance (skill 1.3, 30 runs, phone portrait) | median 28.0 -> 30.5 s, p90 65.2 -> 56.1, police wrecked per run 25.6 -> 25.0; run endings: police 25, wreck 3, obstacle 2 | Within run-to-run noise. |
