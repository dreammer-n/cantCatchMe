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
5. **Shadows**: props bake their shadow (the solid cast along the light onto the ground) into a second
   image; cars draw a live outline of their body cast along the light, each frame, plus a soft contact
   patch right underneath. Car and prop shadows use the same light, so they always fall the same way.
   No real-time lighting.
6. **Light** (`RENDER` in `tuning.js`): ambient + key light from the right + soft fill from the camera side
   + a little "sky" light on upward faces. Result: tops brightest, the side facing the key medium, the other
   side darkest, for every object. The light is fixed to the camera, so it never changes while driving.

## The player car (`src/render/carModels.js`)

Built in height bands, each its own solid so it catches the light differently:

| Band | Parts | Height (world units) |
|---|---|---|
| layer 0 | tyres with hubs (outside the body so they always show), dark sills, bumpers | 0–13 |
| layer 1 | body: sloped hood, middle, sloped boot; head/tail lights and grille as flat paint | 9.5–17 |
| layer 2 | glass cabin (windscreen, rear window, side windows with a pillar), flat roof, spoiler | 17–30 |

Footprint is exactly the physics size (44 × 84). The same builder makes the **police car** (white, blue
side stripe, push bar, red/blue light bar) and the **wreck** (burnt colours, crumpled roof). Drawn
directions per model: player 64, police 64, wreck 32 (`RENDER.carDirections`; wrecks barely turn).
Police light bars get two small glows on top (`CarView.updateLights`), alternating red / blue. They use
normal blending on purpose: an additive blend between cars in the draw order cost one extra draw call per
police car (39 → 7 draw calls with 24 police on screen).

Result: 0 bytes of downloaded art, about 7 draw calls per frame even with 24 police on screen, 11 MB
of graphics memory for the three car drawing sheets (player 4.5, police 4.4, wreck 2.1, measured). Switching camera views (debug tool only)
redraws everything in about a second.

## Layers and draw order (`DEPTH` in `tuning.js`)

| Band | What | How it is drawn |
|---|---|---|
| `ground` (0) | floor (roads darker, city blocks lighter), markings, skid marks, scorch marks, lamp light pools, shockwave ring | world-coordinate container, turned and squashed; the floor is split into 1000-unit squares and off-screen squares are skipped |
| `raised` (10) | low curbs and parking islands | baked images, always under cars |
| `shadows` (20) | car shadows, prop shadows, crate glow | cars: one shared live drawing in a ground container (all cars, cleared each frame); props: baked images |
| `objects` (1000 + screen Y) | cars, police lights, blocks, trees, lamps, barriers, cones, crate | sorted by their ground point: nearer the viewer = in front |
| far walls (900) / near walls (99990) | arena edge barriers | far side always behind, near side always in front |
| `effects` (100000+) | tyre smoke, wreck smoke and flames, fire, debris, flashes | particles in screen space (positions through the projection), capped by `EFFECTS` |
| UI | HUD, menus | separate `UIScene`, never affected by the camera |

Rules:
- Anything standing up gets **one** depth from its ground point (`depthAt(x, y)`), its centre.
- Keep standing props compact (under ~150 units across). Long things are split into pieces
  (walls are 200-unit barrier segments) or kept low in the `raised` band.
- Physics never reads `RENDER`, `DEPTH`, `PALETTE` or the camera.

## Culling (skipping what is off screen)

Every frame, props, floor squares and cars outside the camera's view (plus a margin) are hidden, so
Phaser doesn't process them. The map has ~420 props; usually 20–60 are on screen.

## Inspecting a car from every direction

The title screen shows the car turning slowly on the start ring. In debug mode (`?debug`) press **T**
during a run: the car parks and spins; hold ← / → to turn it by hand; the readout shows which way it
faces. Press T again to drive off.

## Adding a new object

1. Build it in `propModels.js` from `box`, `frustum`, `ngon` (+ `decal` for paint, `glowing` for lamps).
   Local axes: x right, y forward, z up, centred on its ground point.
2. Place it in `src/systems/WorldLayout.js` (an item with a `collider` if it should be solid) and add
   its model to `meshFor()` in `Scenery.js`.
3. Parts are painted in `layer` order (lower first), so list them bottom to top / inside to outside.

## Known limitations

- Draw order uses each object's centre, so a car squeezed diagonally against a large object's corner
  can briefly sort wrongly. Solid obstacles keep cars out of most of those spots.
- Low curbs/islands always draw under cars, so a car just behind a curb shows its bottom edge over it.
- Particles (smoke, fire) are drawn above everything, so smoke can show in front of a nearer tree.
- Police light glows sit with their car in the draw order; a light can show over a prop right behind it.

## Not used, on purpose

Shaders/post-effects, 3D engines (Three.js etc.), non-uniform camera zoom, isometric tilemaps, rotating or
skewing the whole canvas.

## Open art-direction decisions (see `ART_DIRECTION.md`)

- Final camera: Angled (40°/48°, default) vs Angled high / Angled low (try them with the View button).
- Final palette, car designs (player + police), ground detail.
