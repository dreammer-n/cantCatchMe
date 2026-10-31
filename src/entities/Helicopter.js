import { HELICOPTER } from '../config/tuning.js';
import { clamp, headingOf, lerp, smoothFactor, wrapAngle } from '../utils/math.js';

// The police helicopter, as pure logic (no Phaser; render/HelicopterView.js draws it). It can't be hit
// or stopped. It flies above the player, keeps a searchlight on the car, and now and then
// swoops down to drop a concrete block into the player's path.
//
// A drop goes: 'warning' (a burning flare marks the spot, then the block falls) -> 'down' (a solid
// obstacle) -> 'sinking' (no longer solid) -> gone.
export class Helicopter {
  constructor() {
    this.drops = Array.from({ length: HELICOPTER.maxDrops }, () => ({ active: false, state: 'idle', x: 0, y: 0, time: 0, shape: null }));
    this.active = false;
  }

  reset(sim) {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.z = HELICOPTER.height;
    this.heading = 0;
    this.spotX = 0;
    this.spotY = 0;
    this.clock = 0;
    this.nextDrop = 0;
    this.dive = 0; // 0..1: how far into a swoop it is
    for (const drop of this.drops) this.clearDrop(sim, drop);
  }

  // Comes in from behind the player, out of sight.
  arrive(sim) {
    const player = sim.player;
    const speed = Math.max(1, player.speed);
    this.active = true;
    this.x = player.x - (player.vx / speed) * HELICOPTER.arriveDistance;
    this.y = player.y - (player.vy / speed) * HELICOPTER.arriveDistance;
    this.heading = player.heading;
    this.spotX = this.x;
    this.spotY = this.y;
    this.nextDrop = HELICOPTER.firstDropAfter;
    sim.emit('helicopter', {});
  }

  update(sim, dt) {
    const player = sim.player;
    if (!this.active) {
      if (sim.state === 'running' && sim.time >= HELICOPTER.firstAt) this.arrive(sim);
      else return;
    }
    this.clock += dt;

    // It flies to a point ahead of the car, weaving a little from side to side.
    const speed = Math.max(1, player.speed);
    const sway = Math.sin(this.clock * HELICOPTER.swaySpeed) * HELICOPTER.sway;
    const targetX = player.x + player.vx * HELICOPTER.leadSeconds + (-player.vy / speed) * sway;
    const targetY = player.y + player.vy * HELICOPTER.leadSeconds + (player.vx / speed) * sway;
    const k = smoothFactor(HELICOPTER.followSharpness, dt);
    const moveX = (targetX - this.x) * k;
    const moveY = (targetY - this.y) * k;
    this.x += moveX;
    this.y += moveY;
    if (Math.hypot(moveX, moveY) > 0.05) {
      const turn = wrapAngle(headingOf(moveX, moveY) - this.heading);
      this.heading = wrapAngle(this.heading + turn * smoothFactor(HELICOPTER.turnSharpness, dt));
    }

    // The searchlight always lags a little behind the car.
    const spotK = smoothFactor(HELICOPTER.spotSharpness, dt);
    this.spotX += (player.x - this.spotX) * spotK;
    this.spotY += (player.y - this.spotY) * spotK;

    // It swoops low while it has a drop under way.
    const dropping = this.drops.some((drop) => drop.active && drop.state === 'warning');
    this.dive = clamp(this.dive + (dropping ? dt : -dt) / HELICOPTER.swoopSeconds, 0, 1);
    this.z = lerp(HELICOPTER.height + Math.sin(this.clock * 0.9) * 14, HELICOPTER.swoopHeight, this.dive * this.dive * (3 - 2 * this.dive));

    this.updateDrops(sim, dt);
    if (sim.state !== 'running') return;
    this.nextDrop -= dt;
    if (this.nextDrop <= 0) {
      const placed = this.tryDrop(sim);
      this.nextDrop = placed ? lerp(HELICOPTER.dropEveryMin, HELICOPTER.dropEveryMax, sim.rng()) : 1;
    }
  }

  // Marks a spot on the player's path, far enough ahead to steer round it.
  tryDrop(sim) {
    const player = sim.player;
    const speed = player.speed;
    const drop = this.drops.find((candidate) => !candidate.active);
    if (!drop || speed < HELICOPTER.minTargetSpeed || player.isFalling) return false;
    const x = player.x + player.vx * HELICOPTER.dropAheadSeconds;
    const y = player.y + player.vy * HELICOPTER.dropAheadSeconds;
    if (!sim.chunks.contains(x, y) || !sim.world.isClear(x, y, HELICOPTER.blockHalfSize + 20)) return false;
    drop.active = true;
    drop.state = 'warning';
    drop.time = 0;
    drop.x = x;
    drop.y = y;
    sim.emit('flare', { x, y });
    return true;
  }

  updateDrops(sim, dt) {
    for (const drop of this.drops) {
      if (!drop.active) continue;
      drop.time += dt;
      if (drop.state === 'warning' && drop.time >= HELICOPTER.warningSeconds) this.land(sim, drop);
      else if (drop.state === 'down' && drop.time >= HELICOPTER.blockSeconds) this.crumble(sim, drop);
      else if (drop.state === 'sinking' && drop.time >= HELICOPTER.sinkSeconds) this.clearDrop(sim, drop);
    }
  }

  land(sim, drop) {
    const player = sim.player;
    // Never right on top of the car: nobody could have dodged that.
    if (Math.hypot(player.x - drop.x, player.y - drop.y) < HELICOPTER.safeDistance * player.scale) {
      drop.active = false;
      drop.state = 'idle';
      return;
    }
    drop.state = 'down';
    drop.time = 0;
    const half = HELICOPTER.blockHalfSize;
    drop.shape = sim.world.add({
      kind: 'dropblock',
      isDrop: true,
      drop,
      x: drop.x,
      y: drop.y,
      heading: 0,
      collider: { type: 'box', hw: half, hl: half },
      breakable: false,
    });
    sim.emit('dropLand', { x: drop.x, y: drop.y });
  }

  // It stops being solid at once, then sinks out of sight.
  crumble(sim, drop) {
    if (drop.state !== 'down') return;
    sim.world.remove(drop.shape);
    drop.shape = null;
    drop.state = 'sinking';
    drop.time = 0;
    sim.emit('pillarCrumble', { x: drop.x, y: drop.y });
  }

  clearDrop(sim, drop) {
    if (drop.shape) sim.world.remove(drop.shape);
    drop.shape = null;
    drop.active = false;
    drop.state = 'idle';
  }
}
