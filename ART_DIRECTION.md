# ART_DIRECTION.md — "Can't Catch Me!" (draft, used for the full game)

Written from the owner's five PAKO Forever reference frames (2026-10-29). We match the **camera, geometry
and lighting approach** of the references, not their assets, colours, logos or UI. Everything is original.

## Target look

Minimalist **low-poly 2.5D**: simple geometric solids, flat-shaded faces, no textures, no outlines,
clear directional shadows, bright readable colours on a dark asphalt ground.

## What we took from the references

| Reference observation | Our rule |
|---|---|
| Fixed elevated camera, map seen diagonally | Orthographic camera, map turned 40°, tilted 48° (`RENDER.views`, "Angled") |
| Roofs plus two sides of every car and object visible | Turned map guarantees top + two sides; 64 drawn car directions |
| One side of each object lit, the other darker | Key light from the right and above; soft fill from the camera side |
| Shadows cast to one side establish height | Shadows fall to the left, length ~0.75 × height |
| Cars small relative to the screen, props similar scale | Car 44 × 84, 31 high; lamps ~110 high; trees 70–92; blocks 30–70 |
| Parking lots: raised islands, painted stalls, light pools | Curbed grass islands, white stalls, warm additive lamp pools |
| Objects overlap correctly by position | Sorted by ground point (see `RENDERING.md`) |

## Palette (placeholder, original)

Roads blue-grey `#4a515e`, city blocks a little lighter `#575f6c`; paint `#e4e0d4`; curbs `#d1c8b6`; grass `#7aa94b`; concrete `#b5aea2`;
barrier `#d6d0c2` with red `#e8553d`; pines `#3f8a46`/`#2f6e3a`; leafy `#5f9f3f`; lamp `#fff1bf`;
player car red `#e0473c` with cream racing stripes `#f4efe6`, dark glass `#26364a`.
(Values live in `PALETTE` in `src/config/tuning.js`.)

## Player car

Original compact muscle-coupe built in height bands: dark tyres with grey hubs and dark sills/bumpers at the
bottom, red body with a sloped hood and boot, glass cabin (sloped windscreen and rear window, side windows with
a red pillar) and a flat red roof; cream racing stripe over hood, roof and boot; small rear spoiler; glowing
head/tail lights. Tops are the brightest surfaces, one side lit, the other in shade.

## Police car and wrecks

White patrol car (`#eef1f4`) with a blue side stripe (`#2f6fe0`), dark push bar, and a light bar
split red (`#ff3b30`) / blue (`#3d8bff`) with alternating glows. White reads instantly against the
dark asphalt and never gets confused with the red player car. Destroyed cars turn into a burnt-out
dark brown wreck (`#3d3833`) with a crumpled roof, smoke and short flames, then fade away.

## Effects

Soft round particles only (no sprite sheets): pale grey tyre smoke, dark wreck smoke, additive
orange/yellow fire, small dark debris chips, a white flash, dark scorch marks on the ground. The
Shockwave is a teal ring (`#7ff7ff`) sweeping out over the ground.

## Shockwave crate

Teal gift box (`#2fc4b2`) with a cream ribbon and a glowing lid, bobbing over a pulsing teal glow.
When it is off screen, a teal arrow at the screen edge points to it.

## Interface

System font (no download), heavy italic for the logo, titles and pop-ups. Cream text (`#f4efe6`) on
dark translucent panels; red primary buttons (`#e0473c`) with a darker red "lip"; yellow (`#f0c04a`)
for best times, combos and the NEW BEST badge; teal for the Shockwave button. Big touch targets
(48–84 px), everything inside the phone's safe area.

## Still to decide (owner)

- Final camera: Angled (default) vs Angled high vs Angled low (debug mode, V).
- Final palette / time of day (current: neutral daylight).
- Civilian traffic, more car designs, environment set pieces.
