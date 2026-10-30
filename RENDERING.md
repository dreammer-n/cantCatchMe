# RENDERING.md — How the low-poly 2.5D view works

The game is flat underneath. Physics, collisions and AI work on a top-down map in world units and never
read anything visual. Everything you see is drawn through one fixed camera, so the visual style can change
without touching gameplay.

## Why earlier versions looked flat

- **Milestone 1** looked straight down, so a box showed only its top: a rectangle.
- **Milestone 1.5** tilted the camera but kept the map north-up. A box then showed only its top and one
  side, both lit almost the same, with black outlines: it still read as a flat diagram.
- The reference look needs the map **turned** (about 40°) *and* tilted, so you see the top plus **two**
  sides of everything, with **one side lit and one in shade**, and shadows cast to one side.

## The method (hybrid, no 3D engine)

1. **One camera** (`src/render/projection.js`). Fixed orthographic camera: the map is turned by
   `azimuth` and tilted by `elevation`. It never rotates. It follows the car with look-ahead, widens
   slightly at speed and shakes on impacts (`src/render/CameraRig.js`); drawings are not affected.
   `u = x·cos a − y·sin a`, `v = x·sin a + y·cos a`, `screenX = u`, `screenY = v·sin e − z·cos e`.
   Azimuth 0 + elevation 90 gives exactly the flat Milestone 1 view. Nothing else converts world → screen.
2. **Real 3D shapes** (`src/render/lowpoly.js`). Cars and props are built from a few convex solids
   (boxes, tapered boxes, simple cones). Faces turned away from the camera are skipped, each visible face
   gets one flat colour from a fixed light (`RENDER.keyLight` + soft fill), parts are painted back to front.
3. **Drawn once, at startup.** The camera never rotates, so a prop looks the same all game: each prop
   is drawn once into an image. Each car is drawn in **64 directions** into one atlas
   (`src/render/carAtlas.js`); while driving, the game picks the nearest drawing and rotates it by the
   small leftover angle (under 4°) for smooth 360° turning.
4. **The ground** is a flat plane, and the camera's view of a flat plane is just a turn plus a squash, so
   the floor, markings, skid marks and car shadows live in containers that do exactly that
   (`src/render/layers.js`). They stay in world coordinates.
5. **Shadows** come from a low sun: about 1.2 × the height of what casts them, falling to the upper left.
   Props bake their shadow (the solid cast along the light onto the ground) into a second
   image; cars draw a live outline of their body cast along the light, each frame, plus a soft contact
   patch right underneath. Car and prop shadows use the same light, so they always fall the same way.
   No real-time lighting.
6. **Light** (`RENDER` in `tuning.js`): ambient + low key light from the right + soft fill from the camera side
   + a little "sky" light on upward faces. Result: tops brightest, the side facing the key medium, the other
   side darkest, for every object. The light is fixed to the camera, so it never changes while driving.

## The player car (`src/render/carModels.js`)

Built in height bands, each its own solid so it catches the light differently:

| Band | Parts | Height (world units) |
|---|---|---|
| layer 0 | tyres with hubs (outside the body so they always show), dark sills, bumpers | 0–13 |
| layer 1 | body: sloped hood, middle, sloped boot; head/tail lights and grille as flat paint | 9.5–17 |
| layer 2 | glass cabin (windscreen, rear window, side windows with a pillar), flat roof, spoiler | 17–30 |

Footprint is exactly the physics size (44 × 84). The same builder makes the **police car** (white, navy
side stripe, push bar, red/blue light bar), the **interceptor** (the same car in black and white), the
**wreck** (burnt colours, crumpled roof) and the **wreck on its roof**. Drawn directions per model: player 64,
police 64, interceptor 64, wreck 32, upside-down wreck 16 (`RENDER.carDirections`; wrecks barely turn).

Solids here have no bottom face, because nothing sees under a car on its wheels. The upside-down wreck adds
an underside plate, or it would look like a hollow shell.
Police light bars get two small glows on top (`CarView.updateLights`), alternating red / blue. They use
normal blending on purpose: an additive blend between cars in the draw order cost one extra draw call per
police car (39 → 7 draw calls with 24 police on screen).

Result: 0 bytes of downloaded art, about 7-10 draw calls per frame even with 24 police on screen. Graphics
memory, measured: car drawing sheets 17.4 MB, prop drawings 12.4 MB. Shadows and flat props are drawn coarser
to keep that down (`RENDER.shadowBakeScale`, `flatBakeScale`). Switching camera views (debug tool only)
redraws everything in about a second.

## Layers and draw order (`DEPTH` in `tuning.js`)

| Band | What | How it is drawn |
|---|---|---|
| `ground` (0) | floor (roads darker, city blocks lighter), markings, sinkholes, skid marks, scorch marks, lamp light pools, shockwave ring | world-coordinate container, turned and squashed; each chunk's floor is split into 800-unit squares and off-screen squares are skipped |
| `raised` (10) | low curbs, parking islands, roundabouts | baked images, always under cars |
| `shadows` (20) | car shadows, prop shadows, crate glow, siren light on the road | cars: one shared live drawing in a ground container (all cars, cleared each frame); props: baked images; siren light: one additive image per cruiser, all in their own ground layer (`layers.lights`), so 24 cruisers cost one blend change, not 24 |
| `objects` (1e9 + screen Y) | cars, police lights, blocks, trees, lamps, barriers, cones, crates, containers, monuments | sorted by their ground point: nearer the viewer = in front. The band is huge because screen Y has no limit in an endless world |
| `effects` (4e9+) | tyre smoke, wreck smoke and flames, sparks, debris, starbursts | particles in screen space (positions through the projection), capped by `EFFECTS` |
| UI | HUD, menus | separate `UIScene`, never affected by the camera |

Rules:
- Anything standing up gets **one** depth from its ground point (`depthAt(x, y)`), its centre.
- Keep standing props compact (under ~150 units across). Long things are kept low in the `raised` band, or
  split up: a word statue is one prop per letter on a low plinth.
- Physics never reads `RENDER`, `DEPTH`, `PALETTE` or the camera.

## Wrecks

Wrecks are thrown about on screen only. The physics keeps a car on the flat map; `render/Tumble.js` works out a
height, a roll and an extra turn, and `CarView` shows them by lifting the sprite, turning it and squashing it
while it rolls side-on, switching to the upside-down drawing past 90°. While in the air the car is drawn in front
of the flames. The explosion is layered, back to front: comic star, flame clouds that cool from white through yellow and
orange to dark red, flying pieces and the car, then a white flash on top. Smoke rises as the flames die, a ring runs
out along the ground and the road keeps a burn for 45 s.

## Culling (skipping what is off screen)

Every frame, props, floor squares and cars outside the camera's view (plus a margin) are hidden, so
Phaser doesn't process them. The 9 loaded chunks hold about 450 props; usually 20–60 are on screen.

## Streaming (the endless world)

The world exists only as data worked out from chunk coordinates (`WorldLayout.js`). `ChunkManager.js` keeps
a 3 x 3 grid of chunks loaded around the player, and `Scenery.sync` draws whatever is loaded:

- **Nothing is created during play.** Floors are one fixed set of drawings per grid slot, redrawn when a
  chunk arrives. Prop images come from a pool made at startup (`CHUNKS.propPool`).
- **Every prop drawing is made at startup** from `propCatalogue()`. If you add a prop or a new turn angle to
  a layout, add it there too; a test fails if you forget.
- **One new chunk per frame.** New chunks arrive beyond what the camera shows, so spreading them out is
  invisible and avoids a hitch. A restart or a long jump fills everything in at once.
- **The grid must out-reach the camera.** `CHUNKS.size` must stay larger than the furthest ground the camera
  shows along a map axis (about 2030 units on tall phones). A test checks this.
- **Sinkholes** are drawn in the ground layer: a broken rim, a far wall, then the dark part pushed toward
  the viewer, which is what makes the hole read as deep.
- **Falling cars** shrink, sink and fade (`CarView.drawFalling`) and lose their shadow. The physics only
  tracks `fallProgress`; the drop itself is drawn.

## Inspecting a car from every direction

The title screen shows the car turning slowly on the start ring. In debug mode (`?debug`) press **T**
during a run: the car parks and spins; hold ← / → to turn it by hand; the readout shows which way it
faces. Press T again to drive off.

## Adding a new object

1. Build it in `propModels.js` from `box`, `frustum`, `ngon` (+ `decal` for paint, `glowing` for lamps).
   Local axes: x right, y forward, z up, centred on its ground point.
2. Place it in `src/systems/WorldLayout.js` (an item with a `collider` if it should be solid) and add
   its model to `buildMesh()` in `Scenery.js`.
3. Add it to `propCatalogue()` in `WorldLayout.js`, so its drawing is made at startup.
4. Parts are painted in `layer` order (lower first), so list them bottom to top / inside to outside.

## Known limitations

- Draw order uses each object's centre, so a car squeezed diagonally against a large object's corner
  can briefly sort wrongly. Solid obstacles keep cars out of most of those spots.
- Low curbs/islands always draw under cars, so a car just behind a curb shows its bottom edge over it.
- Particles (smoke, fire) are drawn above everything, so smoke can show in front of a nearer tree.
- Police light glows sit with their car in the draw order; a light can show over a prop right behind it.
- A car in the air is drawn in front of everything standing, so a tumbling wreck can pass over a nearby tree.
- Siren colour on props is a faint wash laid over everything nearby, not real lighting on each surface.
- A falling car is drawn over its hole's near edge (no clipping), so it reads as shrinking into the dark
  rather than disappearing behind the rim.

## Not used, on purpose

Shaders/post-effects, 3D engines (Three.js etc.), non-uniform camera zoom, isometric tilemaps, rotating or
skewing the whole canvas.

## Open art-direction decisions (see `ART_DIRECTION.md`)

- Final camera: Angled (40°/48°, default) vs Angled high / Angled low (try them with the View button).
- Final palette, car designs (player + police), ground detail.
