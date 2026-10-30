import { POLICE, SPAWN } from '../config/tuning.js';
import { projection } from '../render/projection.js';
import { clamp, headingOf, lerp, tableLookup } from '../utils/math.js';

const screen = { x: 0, y: 0 };
const ground = { x: 0, y: 0 };

// How hard the run is at a given time (seconds of survival).
export function difficultyAt(time) {
  const ramp = clamp(time / POLICE.rampSeconds, 0, 1);
  return {
    targetPolice: Math.min(POLICE.maxActive, Math.round(tableLookup(SPAWN.table, time))),
    interval: lerp(SPAWN.intervalStart, SPAWN.intervalEnd, clamp(time / SPAWN.intervalRampSeconds, 0, 1)),
    interceptorShare:
      time < SPAWN.interceptorsFrom
        ? 0
        : SPAWN.interceptorMaxShare * clamp((time - SPAWN.interceptorsFrom) / SPAWN.interceptorRampSeconds, 0, 1),
    speedFactor: lerp(POLICE.speedStart, POLICE.speedEnd, ramp),
    turnDeg: lerp(POLICE.turnStartDeg, POLICE.turnEndDeg, ramp),
  };
}

// Is a ground point inside the visible screen area (plus `margin` screen units)?
// view = { cx, cy, halfW, halfH } in screen units (the camera's centre and half size).
export function isOnScreen(x, y, view, margin = 0) {
  projection.toScreen(x, y, 0, screen);
  return Math.abs(screen.x - view.cx) < view.halfW + margin && Math.abs(screen.y - view.cy) < view.halfH + margin;
}

// Keeps the number of police on the map at the level the run's difficulty asks for.
export class SpawnDirector {
  reset() {
    this.cooldown = 0;
  }

  update(sim, dt, view) {
    if (sim.time < SPAWN.firstSpawnAt) return;
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    const level = difficultyAt(sim.time);
    if (sim.alivePolice >= level.targetPolice || sim.activeCars >= POLICE.maxCars) return;
    this.cooldown = this.trySpawn(sim, view, level) ? level.interval : 0.15;
  }

  trySpawn(sim, view, level) {
    const player = sim.player;
    const rng = sim.rng;
    const ahead = rng() < SPAWN.aheadShare;
    // Direction of travel on screen.
    const speed = Math.hypot(player.vx, player.vy);
    const dirX = speed > 1 ? player.vx / speed : Math.sin(player.heading);
    const dirY = speed > 1 ? player.vy / speed : -Math.cos(player.heading);
    const travelScreen = Math.atan2((dirX * projection.sinA + dirY * projection.cosA) * projection.squash, dirX * projection.cosA - dirY * projection.sinA);

    for (let attempt = 0; attempt < SPAWN.attempts; attempt += 1) {
      // Ahead: within 50 degrees of the direction of travel; otherwise anywhere outside that cone.
      const angle = ahead ? travelScreen + (rng() - 0.5) * 1.75 : travelScreen + 1.05 + rng() * (Math.PI * 2 - 2.1);
      const ex = Math.cos(angle);
      const ey = Math.sin(angle);
      const hw = view.halfW + SPAWN.screenMargin;
      const hh = view.halfH + SPAWN.screenMargin;
      const t = Math.min(hw / Math.max(1e-6, Math.abs(ex)), hh / Math.max(1e-6, Math.abs(ey)));
      projection.groundFromScreen(view.cx + ex * t, view.cy + ey * t, ground);
      const x = ground.x;
      const y = ground.y;

      const dx = x - player.x;
      const dy = y - player.y;
      const distance = Math.hypot(dx, dy);
      const towardUs = (dx * dirX + dy * dirY) / Math.max(1, distance) > 0.35;
      if (distance < (towardUs ? SPAWN.minAheadDistance : SPAWN.minDistance)) continue;
      if (!sim.world.isClear(x, y, SPAWN.clearance, 40)) continue;
      if (sim.isNearCar(x, y, 110)) continue;

      const role = rng() < level.interceptorShare ? 'interceptor' : 'chaser';
      const lead = role === 'interceptor' ? 0.8 : 0;
      const heading = headingOf(player.x + player.vx * lead - x, player.y + player.vy * lead - y);
      sim.spawnPolice(x, y, heading, { role, speedFactor: level.speedFactor, turnDeg: level.turnDeg, aimSide: rng() * 2 - 1 });
      return true;
    }
    return false;
  }
}
