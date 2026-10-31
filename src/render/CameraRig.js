import { CAMERA, GIANT, TRAUMA } from '../config/tuning.js';
import { clamp, lerp, smoothFactor } from '../utils/math.js';
import { projection } from './projection.js';

const ground = { x: 0, y: 0 };

// Where the camera wants to be: look-ahead, speed zoom and trauma shake, as plain numbers.
// No Phaser, so it can be tested and used by the bot runs. It reads the car and never changes it.
export class CameraRig {
  constructor() {
    this.reset(0, 0);
  }

  reset(x, y) {
    this.x = x; // the point the camera centres on (world units)
    this.y = y;
    this.leadX = 0; // look-ahead (screen units)
    this.leadY = 0;
    this.zoom = 1; // multiplies the screen's base zoom
    this.trauma = 0;
    this.shakeX = 0; // screen units
    this.shakeY = 0;
    this.clock = 0;
  }

  addTrauma(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  // baseHalfW / baseHalfH: half the view in screen units at zoom factor 1.
  update(car, dt, baseHalfW, baseHalfH) {
    const speedShare = clamp((car.speed - CAMERA.zoomStartSpeed) / (CAMERA.zoomFullSpeed - CAMERA.zoomStartSpeed), 0, 1);
    const giantShare = clamp((car.scale - 1) / (GIANT.scale - 1), 0, 1);
    const wanted = lerp(1, CAMERA.zoomOut, speedShare) * lerp(1, CAMERA.giantZoom, giantShare);
    this.zoom += (wanted - this.zoom) * smoothFactor(CAMERA.zoomSharpness, dt);

    // Velocity as seen on screen x lead time, limited to an ellipse the shape of the view. That
    // puts the car the same share of the view behind the centre in every direction and on every screen.
    const maxX = (baseHalfW / this.zoom) * 2 * CAMERA.leadViewFraction;
    const maxY = (baseHalfH / this.zoom) * 2 * CAMERA.leadViewFraction;
    let wantX = (car.vx * projection.cosA - car.vy * projection.sinA) * CAMERA.leadSeconds;
    let wantY = (car.vx * projection.sinA + car.vy * projection.cosA) * projection.squash * CAMERA.leadSeconds;
    const over = Math.hypot(wantX / maxX, wantY / maxY);
    if (over > 1) {
      wantX /= over;
      wantY /= over;
    }
    const leadK = smoothFactor(CAMERA.leadSharpness, dt);
    this.leadX += (wantX - this.leadX) * leadK;
    this.leadY += (wantY - this.leadY) * leadK;

    projection.groundFromScreen(this.leadX, this.leadY, ground);
    const k = smoothFactor(CAMERA.followSharpness, dt);
    this.x += (car.x + ground.x - this.x) * k;
    this.y += (car.y + ground.y - this.y) * k;

    this.trauma = Math.max(0, this.trauma - TRAUMA.decayPerSecond * dt);
    this.clock += dt * TRAUMA.shakeSpeed;
    const size = this.trauma * this.trauma * TRAUMA.maxOffset;
    // Mixed sine waves: an irregular shake that is smooth from frame to frame.
    this.shakeX = (size * (Math.sin(this.clock) + 0.5 * Math.sin(this.clock * 1.7))) / 1.5;
    this.shakeY = (size * (Math.sin(this.clock * 1.2 + 1) + 0.5 * Math.sin(this.clock * 1.9 + 2))) / 1.5;
  }
}
