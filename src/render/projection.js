import { RENDER } from '../config/tuning.js';

// The ONE place that turns the flat physics world into screen positions.
//
// World: x to the right, y DOWN the map (south), z = height above the ground (visual only).
// Camera: fixed orthographic camera. It never rotates or moves closer; it only follows the car.
//   1. Turn the map by `azimuth` (clockwise on screen):   u = x cos(a) - y sin(a)
//                                                          v = x sin(a) + y cos(a)
//      u = across the screen, v = toward the viewer (down the screen).
//   2. Tilt it by `elevation`:  screenX = u
//                               screenY = v * squash - z * lift
//      squash = sin(elevation): ground gets shorter top-to-bottom as the camera tilts.
//      lift   = cos(elevation): how far a unit of height rises up the screen.
// Azimuth 0 and elevation 90 = straight down, north up: exactly the flat Milestone 1 look.
//
// Everything with height (cars, trees, blocks) is drawn from real 3D shapes through these same
// formulas (see lowpoly.js), so the ground and the objects always share one perspective.
export class Projection {
  constructor(view) {
    this.listeners = new Set();
    this.setView(view, false);
  }

  setView({ id = 'custom', label = '', azimuthDeg = 0, elevationDeg = 90 }, notify = true) {
    const a = (azimuthDeg * Math.PI) / 180;
    const e = (elevationDeg * Math.PI) / 180;
    this.viewId = id;
    this.viewLabel = label;
    this.azimuthDeg = azimuthDeg;
    this.elevationDeg = elevationDeg;
    this.azimuth = a;
    this.cosA = Math.cos(a);
    this.sinA = Math.sin(a);
    this.squash = Math.sin(e);
    this.lift = Math.abs(Math.cos(e)) < 1e-9 ? 0 : Math.cos(e);
    this.updateShadowStep();
    if (notify) this.listeners.forEach((callback) => callback(this));
  }

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  // A unique name for this camera setup, used to cache the drawings made for it.
  get key() {
    return `${this.azimuthDeg}_${this.elevationDeg}`;
  }

  // World position (+ optional height) to screen position. Writes into `out` to avoid garbage.
  toScreen(x, y, z = 0, out = { x: 0, y: 0 }) {
    out.x = x * this.cosA - y * this.sinA;
    out.y = (x * this.sinA + y * this.cosA) * this.squash - z * this.lift;
    return out;
  }

  // Screen position back to the ground (height 0).
  groundFromScreen(sx, sy, out = { x: 0, y: 0 }) {
    const u = sx;
    const v = sy / this.squash;
    out.x = u * this.cosA + v * this.sinA;
    out.y = -u * this.sinA + v * this.cosA;
    return out;
  }

  // How far toward the viewer a ground point is (= its screen height). Used for draw order.
  depthOf(x, y) {
    return (x * this.sinA + y * this.cosA) * this.squash;
  }

  // Angle (clockwise from "up the screen") at which a ground direction with this world heading appears.
  screenHeading(heading) {
    const dx = Math.sin(heading);
    const dy = -Math.cos(heading);
    const u = dx * this.cosA - dy * this.sinA;
    const v = dx * this.sinA + dy * this.cosA;
    return Math.atan2(u, -v * this.squash);
  }

  // Where on the ground the shadow of a point `z` high lands, as a world offset from the point.
  shadowOffset(z, out = { x: 0, y: 0 }) {
    out.x = this.shadowStepX * z;
    out.y = this.shadowStepY * z;
    return out;
  }

  // The key light is fixed relative to the camera, so shadows always fall the same way on screen.
  updateShadowStep() {
    const [lu, lv, lz] = RENDER.keyLight;
    const du = (-lu / lz) * RENDER.shadowLength;
    const dv = (-lv / lz) * RENDER.shadowLength;
    this.shadowStepX = du * this.cosA + dv * this.sinA;
    this.shadowStepY = -du * this.sinA + dv * this.cosA;
  }
}

export function findView(id) {
  return RENDER.views.find((view) => view.id === id) || null;
}

export const projection = new Projection(findView(RENDER.defaultViewId));

// The patch of ground currently on screen (height 0). With the map turned, it is a slanted
// four-sided shape: `corners` gives it exactly; left/right/top/bottom is the box around it,
// enlarged by `margin` world units. Used later for spawning police just outside the view.
export function visibleGroundRect(proj, centerX, centerY, viewWidth, viewHeight, zoom, margin = 0) {
  const halfW = viewWidth / zoom / 2;
  const halfH = viewHeight / zoom / 2;
  const corners = [
    [centerX - halfW, centerY - halfH],
    [centerX + halfW, centerY - halfH],
    [centerX + halfW, centerY + halfH],
    [centerX - halfW, centerY + halfH],
  ].map(([sx, sy]) => proj.groundFromScreen(sx, sy, { x: 0, y: 0 }));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    left: Math.min(...xs) - margin,
    right: Math.max(...xs) + margin,
    top: Math.min(...ys) - margin,
    bottom: Math.max(...ys) + margin,
    corners,
  };
}
