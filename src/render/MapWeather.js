import { SANDSTORM, TUMBLEWEEDS } from '../config/tuning.js';
import { depthAt } from './layers.js';
import { bakeMesh } from './lowpoly.js';
import { tumbleweed } from './propModels.js';
import { projection } from './projection.js';

// The weather of a map, all drawing only: nothing here changes the driving.
// Desert (MAPS `sandstorms`): a sandstorm every so often (its strength, 0 to 1, is drawn over the screen by
// UIScene), and tumbleweeds bowling across the car's path in the wind, bursting when a car goes through them.
// Also dust thrown up by the player's car on soft sand, on any map that has it.

const screen = { x: 0, y: 0 };
const DUST_EVERY = 0.06; // seconds between puffs of sand dust

export class MapWeather {
  constructor(scene, layers, effects) {
    this.scene = scene;
    this.effects = effects;
    this.weeds = Array.from({ length: TUMBLEWEEDS.most }, () => {
      const shadow = scene.add.image(0, 0, 'fx-blob').setTint(0x000000).setAlpha(0.22).setVisible(false);
      layers.shadows.add(shadow);
      return { body: scene.add.image(0, 0, 'fx-blob').setVisible(false), shadow, active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, cruise: 0, gust: 0, knocked: false, landings: 0, age: 0, life: 0, angle: 0 };
    });
    this.drawing = null;
    this.reset(null);
  }

  // A new run (or the title screen) on this map.
  reset(map) {
    this.storms = Boolean(map && map.sandstorms);
    this.storm = 0;
    this.stormStart = -Infinity;
    this.nextStorm = SANDSTORM.firstAt;
    // The wind blows across the screen one way or the other for the whole run.
    this.wind = (Math.random() - 0.5) * 1.2 + (Math.random() < 0.5 ? 0 : Math.PI);
    this.nextWeed = 1 + Math.random() * 2;
    this.dustClock = 0;
    for (const weed of this.weeds) this.hide(weed);
  }

  // The tumbleweed's drawing, made once (it is round, so one view does for every way it rolls).
  bake() {
    if (!this.drawing) this.drawing = bakeMesh(this.scene, 'tumbleweed-rolling', tumbleweed(), 0, projection, 'body');
    return this.drawing;
  }

  hide(weed) {
    weed.active = false;
    weed.body.setVisible(false);
    weed.shadow.setVisible(false);
  }

  // sim: the chase. running: a run is on (not the title screen or a crash).
  update(sim, dt, running) {
    const player = sim.player;
    this.updateDust(player, dt, running);
    if (!this.storms) {
      this.storm = 0;
      return;
    }
    this.updateStorm(sim, running);
    if (running) {
      this.nextWeed -= dt;
      if (this.nextWeed <= 0) {
        const [soonest, latest] = TUMBLEWEEDS.everySeconds;
        this.nextWeed = soonest + Math.random() * (latest - soonest);
        this.launch(player);
      }
    }
    for (const weed of this.weeds) if (weed.active) this.roll(weed, sim, dt);
  }

  updateStorm(sim, running) {
    const { fadeSeconds: fade, seconds } = SANDSTORM;
    if (running && sim.time >= this.nextStorm) {
      this.stormStart = sim.time;
      this.nextStorm = sim.time + fade * 2 + seconds + SANDSTORM.everyMin + Math.random() * (SANDSTORM.everyMax - SANDSTORM.everyMin);
      this.scene.toast('SANDSTORM!', 'near');
    }
    const t = sim.time - this.stormStart;
    const total = fade * 2 + seconds;
    let level = 0;
    if (t >= 0 && t < fade) level = t / fade;
    else if (t >= fade && t < fade + seconds) level = 1;
    else if (t >= fade + seconds && t < total) level = (total - t) / fade;
    this.storm = level * level * (3 - 2 * level);
  }

  // A tumbleweed starts upwind of where the car is heading, so it rolls across the car's path.
  launch(player) {
    const weed = this.weeds.find((w) => !w.active);
    if (!weed) return;
    const drawing = this.bake();
    const wx = Math.cos(this.wind);
    const wy = Math.sin(this.wind);
    const aheadX = player.x + player.vx * 1.6;
    const aheadY = player.y + player.vy * 1.6;
    const side = (Math.random() - 0.5) * 500;
    const [slow, fast] = TUMBLEWEEDS.speed;
    weed.cruise = slow + Math.random() * (fast - slow); // its own pace in the wind
    weed.x = aheadX - wx * 750 - wy * side;
    weed.y = aheadY - wy * 750 + wx * side;
    weed.z = 0;
    weed.vx = wx * weed.cruise;
    weed.vy = wy * weed.cruise;
    weed.vz = 0;
    weed.age = 0;
    weed.life = 1500 / weed.cruise;
    weed.gust = Math.random() * 10;
    weed.knocked = false;
    weed.landings = 0;
    weed.active = true;
    // Turn it about the middle of the ball, not the ground under it.
    const frameHeight = weed.body.setTexture(drawing.key).frame.height;
    const middle = (TUMBLEWEEDS.radius * projection.lift * drawing.scale) / frameHeight;
    weed.body.setOrigin(drawing.originX, drawing.originY - middle).setScale(1 / drawing.scale).setVisible(true);
    weed.shadow.setVisible(true);
  }

  // Rolling on the wind: the gusts come and go, so it speeds up and slows down and now and then bounds into the
  // air; gravity brings it down and each landing bounces it a little; it turns as fast as it rolls. Hit by a
  // car, it is knocked flying, bounces, and breaks up.
  roll(weed, sim, dt) {
    weed.age += dt;
    if (weed.age >= weed.life) {
      this.hide(weed);
      return;
    }
    const T = TUMBLEWEEDS;
    weed.gust += dt;
    if (!weed.knocked && weed.z <= 0) {
      // Pushed along by the wind toward its own pace, harder in a gust.
      const gust = 1 + T.gust * Math.sin(weed.gust * 1.3) * Math.sin(weed.gust * 0.47 + 1);
      const wx = Math.cos(this.wind);
      const wy = Math.sin(this.wind);
      const pull = Math.min(1, dt * 2.5);
      weed.vx += (wx * weed.cruise * gust - weed.vx) * pull;
      weed.vy += (wy * weed.cruise * gust - weed.vy) * pull;
      if (Math.random() < dt * T.hopsPerSecond) weed.vz = T.hop[0] + Math.random() * (T.hop[1] - T.hop[0]);
    }
    weed.vz -= T.gravity * dt;
    weed.x += weed.vx * dt;
    weed.y += weed.vy * dt;
    weed.z += weed.vz * dt;
    if (weed.z <= 0) {
      weed.z = 0;
      if (weed.vz < -60) {
        weed.landings += 1;
        weed.vz = -weed.vz * T.bounce;
        if (weed.knocked) {
          weed.vx *= 0.7;
          weed.vy *= 0.7;
        }
      } else weed.vz = 0;
      if (weed.knocked && weed.landings >= 2) {
        this.effects.bitsBurst(weed.x, weed.y, TUMBLEWEED_BITS, 18);
        this.effects.dustRing(weed.x, weed.y, 18, 5);
        this.hide(weed);
        return;
      }
    }
    // It turns as far as it rolls, the way it is going across the screen.
    const speed = Math.hypot(weed.vx, weed.vy);
    projection.toScreen(weed.vx, weed.vy, 0, screen);
    weed.angle += ((screen.x >= 0 ? 1 : -1) * speed * dt) / T.radius;
    projection.toScreen(weed.x, weed.y, weed.z + T.radius, screen);
    weed.body.setPosition(screen.x, screen.y).setRotation(weed.angle).setDepth(depthAt(weed.x, weed.y));
    const high = Math.min(1, weed.z / 120);
    weed.shadow
      .setPosition(weed.x, weed.y)
      .setScale((T.radius * 2 * (1 - 0.35 * high)) / 128, (T.radius * 1.5 * (1 - 0.35 * high)) / 128)
      .setAlpha(0.22 * (1 - 0.6 * high));
    if (weed.knocked) return;
    // A car going through it knocks it flying.
    const reach = T.hitRadius;
    const hit = (car) => Math.abs(car.x - weed.x) < reach && Math.abs(car.y - weed.y) < reach && Math.hypot(car.x - weed.x, car.y - weed.y) < reach;
    let by = !sim.player.isFalling && hit(sim.player) ? sim.player : null;
    for (let i = 0; !by && i < sim.police.length; i += 1) if (sim.police[i].active && hit(sim.police[i].model)) by = sim.police[i].model;
    if (by) {
      weed.knocked = true;
      weed.landings = 0;
      weed.vx = by.vx * T.knock + (Math.random() - 0.5) * 120;
      weed.vy = by.vy * T.knock + (Math.random() - 0.5) * 120;
      weed.vz = T.knockUp[0] + Math.random() * (T.knockUp[1] - T.knockUp[0]);
      weed.life = Math.max(weed.life, weed.age + 3);
      this.effects.bitsBurst(weed.x, weed.y, TUMBLEWEED_BITS, 6);
    }
  }

  // Soft sand thrown up behind the player's car.
  updateDust(player, dt, running) {
    if (!running || player.surface !== 'sand' || player.speed < 90 || player.air > 0) return;
    this.dustClock -= dt;
    if (this.dustClock > 0) return;
    this.dustClock = DUST_EVERY;
    const speed = Math.max(1, player.speed);
    this.effects.tireDust(player.x - (player.vx / speed) * 30, player.y - (player.vy / speed) * 30);
  }
}

export const TUMBLEWEED_BITS = [0xb88a4e, 0xd8b078, 0x8a6434];
