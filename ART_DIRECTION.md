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

Original compact muscle-coupe built in height bands: dark tires with grey hubs and dark sills/bumpers at the
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
flying up out of them. **Wreckage:** tires, bumpers and panels that bounce away; the car lands on its roof or
wheels. **Smoke:** solid cloud puffs shaded on one side, cream for tires and dark for wrecks; they swell, hold and
fade rather than drifting as haze. **Also:** four-pointed sparks, dark ragged burns that stay on the road, long
rubber marks. Kaboom is an amber ring (`#ffc64a`) sweeping out over the ground.

## Set dressing

**Word statues:** giant block letters on a gold plinth, in crimson, navy or cream, rising to the right on screen with
their faces in the sun. **Planted medians:** L-shaped, with rows of pines. **Parked cars:** teal vans, pink hatchbacks,
yellow sedans. **Road paint:** white arrows in the lanes, crisp stalls and crossings.

## Weight in the cars

The best player cars (Coupe, Pickup, Ram, Rally, Hypercar) set the standard: a body with a shoulder line and raised fenders, thin black lips round polygon wheel arches, chunky tires with light rims, body-coloured frames round dark glass with a streak of reflection, and one or two accessories that say what the car is. Details smaller than about 2 units vanish in play, so a good outline and good wheels come first.

Cars must never look like a rotated picture. In a turn the body leans to the outside (up to 8 degrees), the wheels stay
on the road, the tail slides out with smoke from the rear wheels, and the body settles with a small bounce afterwards.
Wheels are round: ten-sided, with a lighter sidewall and a hub. Knocks make the car jump. Wreckage must be seen to fall:
every flying piece has a shadow, tires bounce and roll, panels thud down.

The screen has no steering arrows or press flash: the car's own response is the feedback.

## The suburban map

Slate asphalt (`#3e444f`), slightly lighter lots, warm cream curbs (`#ece5d8`) around fresh lime grass (`#98c43d`), white
concrete barriers with red stripes (`#e84118`). Round faceted trees in lime and forest green, grey rocks, wooden benches, a
gas station with a bright red roof on a white rim, grey repair shops with dark garage doors, small guard booths, and a
billboard with a gold crown. Parked cars are blue, yellow, white and red, in white stalls.

## Winter, Desert and Woods

Winter: blue-grey road, white snow on the islands and in patches on the road, pines capped with snow, wooden cabins.
Desert: warm grey road through sand, cacti, red rock mesas, wooden water towers and telegraph poles. Woods: dusty road
through olive grass with tufts, green pines, bare orange trees, felled logs, wooden cabins.

## Interface

Our own lettering: thick angular capitals with cut corners, leaning forward, drawn in code. Buttons are parallelograms
with no rounded corners. One main colour, amber (`#e0a526`), for the main button, coins, stars and the power-up, on dark
ink and white. Green only for what is done. Red only for danger.

## The player's cars

Chunky low-poly toys in one strong colour. Their panels have bevelled edges and cut corners (`shell` in `lowpoly.js`), with
wheel wells, door lines, grilles, mirrors and glass with a reflection, so they look pressed rather than stacked. Each has
one feature that reads at a glance:
the wing on the Rally Wing, the tailfins, the Fire Engine's ladder, the Bulldozer's blade, the Tank's gun. The Battering
Ram's orange plate keeps it from being mistaken for the police's dark grey SWAT truck. Gold is the colour of coins.

## Tactical units

- **SWAT Bearcat:** a tall slab-sided truck in dark grey (`#565e69`), kept clearly lighter than the road, with a heavy
  near-black lower hull, a barred ram plate wider than the body, slit windows, a yellow stripe and small roof lights.
- **Helicopter:** bright police blue (`#2f62d6`) with a white band and tail fin, so it stands out against the road from
  above. Its shadow falls far off to the upper left, which shows how high it is.
- **Searchlight:** warm white (`#fff4c9`), the only light that follows the player.
- **Flare:** a spitting red star and a closing ring on the road. Red means danger, as on the warning arrows.
- **Spike strip:** a low near-black bar with yellow hazard paint and rows of bright steel teeth.
- **Flat tire:** one corner only: the car sits down on it and rattles, with sparks, smoke and a dark scrape line from that wheel.
- **Smashed frozen car:** a white flash, a burst of ice sparkles and flying panels. No fire, so it reads differently from a wreck.

## The lucky die

The power-up is our own: a big dark amber die (`#b8800f`), the game's main colour, with dark brown spots and a
bevelled top, over a soft pulsing glow. It bounces after the car from the moment it appears, squashing as it lands
and showing new numbers each bounce, then sinks into the car. A die suits it: you never know what you will get. When
it is off screen, an amber arrow at the screen edge points to it.

## Power-ups

**Titan:** the car itself, huge. **Cold Snap:** a frost ring (`#7fe9ff`), white and cyan sparkles, icy blue cars (`#9fdcff`).
**Stonewall:** rough grey stone (`#a39c8e`) with a pale top, in clouds of dust. **Scorcher:** yellow to deep orange flame
clouds over a glowing road.

## Still to decide (owner)

- Final camera: Angled (default) vs Angled high vs Angled low (debug mode, V).
- Time of day and seasons (current: one low-sun daylight).
- Moving civilian traffic, more car designs, environment set pieces.

## Nothing with a visible outline on the ground

Light, smoke, burns and patches on the ground fade to nothing and are uneven: no clean circles or hard edges. Explosions are fire and smoke, not comic stars. Flying pieces are solid, with thickness. Winter and Desert have no painted roads: open snow and sand, drifts and dunes, and faint tire tracks to follow.
