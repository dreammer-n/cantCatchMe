import { DEPTH } from '../config/tuning.js';
import { projection } from './projection.js';

// Everything lying flat on the ground (floor, skid marks, car shadows) lives in containers that
// hold WORLD coordinates. Each is two containers: the inner one turns the map (azimuth), the outer
// one squashes it (tilt). That is exactly the camera's view of a flat ground plane, so ground
// drawings need no per-object maths.
function groundContainer(scene, depth) {
  const tilt = scene.add.container(0, 0).setDepth(depth);
  const turn = scene.add.container(0, 0);
  tilt.add(turn);
  return { tilt, turn };
}

export function createLayers(scene) {
  const ground = groundContainer(scene, DEPTH.ground);
  const shadows = groundContainer(scene, DEPTH.shadows);
  const lights = groundContainer(scene, DEPTH.shadows + 0.5);
  const lightsOver = groundContainer(scene, DEPTH.effects - 1);
  const layers = {
    ground: ground.turn, // add things here in world coordinates
    shadows: shadows.turn,
    lights: lights.turn, // glows lying on the ground: all together, so they cost one blend change
    lightsOver: lightsOver.turn, // the same, above standing objects: faint colour cast on props and cars
    applyProjection() {
      for (const layer of [ground, shadows, lights, lightsOver]) {
        layer.tilt.setScale(1, projection.squash);
        layer.turn.setRotation(projection.azimuth);
      }
    },
    get groundScaleY() {
      return ground.tilt.scaleY;
    },
  };
  layers.applyProjection();
  return layers;
}

// Sort key for anything standing on the ground: nearer the viewer (lower on screen) draws in front.
export function depthAt(x, y) {
  return DEPTH.objects + projection.depthOf(x, y);
}
