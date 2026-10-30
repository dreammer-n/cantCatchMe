# ART_DIRECTION.md — "Can't Catch Me!" (draft, used for the full game)

Written from the owner's PAKO Forever reference frames (2026-10-29, more on 2026-10-30). We match the **camera,
geometry and lighting approach** of the references, not their assets, logos or UI. Everything is original.

## Target look: Arcade Comic Low-Poly

Our own identity: **clean low-poly 2.5D models with punchy comic-book action on top.** Simple geometric solids,
flat-shaded faces, no textures and no outlines on models; long, crisp shadows from a low sun; vivid colours on a
deep slate ground. Action effects are where the comic style lives: ink-edged starbursts, solid cloud puffs,
four-pointed sparks and a brief hit-stop on big impacts.

## What we took from the references

| Reference observation | Our rule |
|---|---|
| Fixed elevated camera, map seen diagonally | Orthographic camera, map turned 40°, tilted 48° (`RENDER.views`, "Angled") |
| Roofs plus two sides of every car and object visible | Turned map guarantees top + two sides; 64 drawn car directions |
| One side of each object lit, the other darker | Low key light from the right; soft fill from the camera side |
| Long shadows cast to one side establish height | Shadows fall to the upper left, about 1.2 × height |
| Cars small relative to the screen, props similar scale | Car 44 × 84, 31 high; lamps ~110 high; trees 70–92; blocks 30–70 |
| Parking lots: raised islands, painted stalls, light pools | Gold-rimmed yellow islands, crisp white stalls, warm additive lamp pools, a few parked cars |
| Objects overlap correctly by position | Sorted by ground point (see `RENDERING.md`) |

## Palette

Roads deep slate `#2f3640`, city blocks a little lighter `#3a424e`, plazas `#47505d`; paint crisp white `#f8f6ef`;
curbs gold `#f39c12` around yellow tops `#f1c40f`; concrete `#b5aea2`; barrier `#d6d0c2` with red `#e8553d`;
pines `#3f8a46`/`#2f6e3a`; leafy `#5f9f3f`; lamp `#fff1bf`; player car crimson `#d7142f` with cream racing stripes
`#fdf3dc`, dark glass `#26364a`; parked cars teal `#3fbfa8`, pink `#f08fa0`, mustard `#d9a632`.
(Values live in `PALETTE` in `src/config/tuning.js`.)

## Player car

Original compact muscle-coupe built in height bands: dark tyres with grey hubs and dark sills/bumpers at the
bottom, red body with a sloped hood and boot, glass cabin (sloped windscreen and rear window, side windows with
a red pillar) and a flat red roof; cream racing stripe over hood, roof and boot; small rear spoiler; glowing
head/tail lights. Tops are the brightest surfaces, one side lit, the other in shade.

## Police car and wrecks

White patrol car (`#f5f7fa`) with a navy side stripe (`#1b2a6b`), dark push bar, and a light bar
split red (`#ff3b30`) / blue (`#3d8bff`) with alternating glows, thrown onto the road below as a pool of
light. White reads instantly against the dark asphalt and never gets confused with the red player car.
Interceptors are the same car in black and white. Destroyed cars turn into a burnt-out
dark brown wreck (`#3d3833`) with a crumpled roof, smoke and short flames, then fade away.

## Effects

All drawn in code at startup. **Explosions:** a white flash, a jagged comic star (dark ink, orange `#ff7a18`, yellow
`#ffd21f`, white) and solid flame clouds that cool from white through yellow and orange to dark red, with the wreck
flying up out of them. **Wreckage:** tyres, bumpers and panels that bounce away; the car lands on its roof or
wheels. **Smoke:** solid cloud puffs shaded on one side, cream for tyres and dark for wrecks; they swell, hold and
fade rather than drifting as haze. **Also:** four-pointed sparks, dark ragged burns that stay on the road, long
rubber marks. The Shockwave is a teal ring (`#7ff7ff`) sweeping out over the ground.

## Set dressing

**Word statues:** giant block letters on a gold plinth, in crimson, navy or cream, rising to the right on screen with
their faces in the sun. **Planted medians:** L-shaped, with rows of pines. **Parked cars:** teal vans, pink hatchbacks,
yellow sedans. **Road paint:** white arrows in the lanes, crisp stalls and crossings.

## Shockwave gift box

A wrapped gift box, orange-red (`#e8572a`) with a cream ribbon and a bow, bobbing over a soft pulsing warm glow.
When it is off screen, an arrow at the screen edge points to it. The arrow stays teal, like the Shockwave button,
because an orange one would look too much like the red police warnings.

## Interface

System font (no download), heavy italic for the logo, titles and pop-ups. Cream text (`#f4efe6`) on
dark translucent panels; red primary buttons (`#e0473c`) with a darker red "lip"; yellow (`#f0c04a`)
for best times, combos and the NEW BEST badge; teal for the Shockwave button. Big touch targets
(48–84 px), everything inside the phone's safe area.

## Still to decide (owner)

- Final camera: Angled (default) vs Angled high vs Angled low (debug mode, V).
- Time of day and seasons (current: one low-sun daylight).
- Moving civilian traffic, more car designs, environment set pieces.
