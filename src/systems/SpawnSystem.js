import { HEAT, INTERCEPTOR, POLICE, ROADBLOCK, SPAWN, WORLD } from '../config/tuning.js';
import { projection } from '../render/projection.js';
import { clamp, degToRad, lerp, tableLookup } from '../utils/math.js';
import { nearestRoadPoint, pointOnRoad } from './WorldLayout.js';

const screen = { x: 0, y: 0 };
const ground = { x: 0, y: 0, northSouth: false };
const DIRECTION = { x: 0, y: 0 };

// How hard the run is at a given time (seconds of survival). See HEAT in tuning.js.
export function difficultyAt(time) {
  return {
    targetPolice: Math.min(POLICE.maxActive, Math.round(tableLookup(HEAT.police, time))),
    interval: lerp(SPAWN.intervalStart, SPAWN.intervalEnd, clamp(time / SPAWN.intervalRampSeconds, 0, 1)),
    interceptorShare: tableLookup(HEAT.interceptorShare, time),
    speedFactor: tableLookup(HEAT.speedFactor, time),
    turnDeg: tableLookup(HEAT.turnDeg, time),
    reaction: tableLookup(HEAT.reaction, time),
  };
}

// Is a ground point inside the visible screen area (plus `margin` screen units)?
// view = { cx, cy, halfW, halfH } in screen units (the camera's centre and half size).
export function isOnScreen(x, y, view, margin = 0) {
  projection.toScreen(x, y, 0, screen);
  return Math.abs(screen.x - view.cx) < view.halfW + margin && Math.abs(screen.y - view.cy) < view.halfH + margin;
}

// The way along a road that leads toward (tx, ty): north or south on a north-south road, east or
// west on the other kind.
function headingAlongRoad(northSouth, x, y, tx, ty) {
  if (northSouth) return ty < y ? 0 : Math.PI;
  return tx > x ? Math.PI / 2 : -Math.PI / 2;
}

function travelDirection(player) {
  const speed = Math.hypot(player.vx, player.vy);
  DIRECTION.x = speed > 1 ? player.vx / speed : Math.sin(player.heading);
  DIRECTION.y = speed > 1 ? player.vy / speed : -Math.cos(player.heading);
  return DIRECTION;
}

// Keeps the number of police on the map at the level the run's difficulty asks for, and every so
// often parks a roadblock on a crossing ahead.
export class SpawnDirector {
  reset() {
    this.cooldown = 0;
    this.nextRoadblock = ROADBLOCK.firstAt;
  }

  update(sim, dt, view) {
    if (sim.time < SPAWN.firstSpawnAt) return;
    if (sim.time >= this.nextRoadblock) {
      const placed = sim.activeCars < POLICE.maxCars && this.tryRoadblock(sim, view);
      this.nextRoadblock = sim.time + (placed ? lerp(ROADBLOCK.everyMin, ROADBLOCK.everyMax, sim.rng()) : ROADBLOCK.retrySeconds);
    }
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    const level = difficultyAt(sim.time);
    if (sim.pursuers >= level.targetPolice || sim.activeCars >= POLICE.maxCars) return;
    this.cooldown = this.trySpawn(sim, view, level) ? level.interval : 0.15;
  }

  // A car already at speed, off screen, in a lane of a road leading toward the player. Chasers come
  // from anywhere. Interceptors come in from the sides, along cross streets.
  trySpawn(sim, view, level) {
    const player = sim.player;
    const rng = sim.rng;
    const interceptor = rng() < level.interceptorShare;
    const ahead = rng() < SPAWN.aheadShare;
    const side = rng() < 0.5 ? -1 : 1;
    const dir = travelDirection(player);
    const dirX = dir.x;
    const dirY = dir.y;
    const travelScreen = Math.atan2((dirX * projection.sinA + dirY * projection.cosA) * projection.squash, dirX * projection.cosA - dirY * projection.sinA);
    const travellingNorthSouth = Math.abs(dirY) >= Math.abs(dirX);

    for (let attempt = 0; attempt < SPAWN.attempts; attempt += 1) {
      let angle;
      if (interceptor) angle = travelScreen + side * degToRad(lerp(INTERCEPTOR.spawnAngleDeg[0], INTERCEPTOR.spawnAngleDeg[1], rng()));
      // Ahead: within 50 degrees of the direction of travel; otherwise anywhere outside that cone.
      else if (ahead) angle = travelScreen + (rng() - 0.5) * 1.75;
      else angle = travelScreen + 1.05 + rng() * (Math.PI * 2 - 2.1);
      const ex = Math.cos(angle);
      const ey = Math.sin(angle);
      const hw = view.halfW + SPAWN.screenMargin;
      const hh = view.halfH + SPAWN.screenMargin;
      const t = Math.min(hw / Math.max(1e-6, Math.abs(ex)), hh / Math.max(1e-6, Math.abs(ey)));
      projection.groundFromScreen(view.cx + ex * t, view.cy + ey * t, ground);

      // Onto a road, in the lane on the right of the way it will drive.
      if (interceptor) pointOnRoad(ground.x, ground.y, !travellingNorthSouth, ground);
      else nearestRoadPoint(ground.x, ground.y, ground);
      const heading = headingAlongRoad(ground.northSouth, ground.x, ground.y, player.x, player.y);
      const x = ground.x + Math.cos(heading) * SPAWN.laneOffset;
      const y = ground.y + Math.sin(heading) * SPAWN.laneOffset;

      // It must still be out of sight and on a loaded chunk.
      if (isOnScreen(x, y, view, SPAWN.screenMargin / 2) || !sim.chunks.contains(x, y)) continue;
      const dx = x - player.x;
      const dy = y - player.y;
      const distance = Math.hypot(dx, dy);
      const towardUs = (dx * dirX + dy * dirY) / Math.max(1, distance) > 0.35;
      if (distance < (towardUs ? SPAWN.minAheadDistance : SPAWN.minDistance)) continue;
      if (!sim.world.isClear(x, y, SPAWN.clearance)) continue;
      if (sim.isNearCar(x, y, 110)) continue;

      sim.spawnPolice(x, y, heading, {
        role: interceptor ? 'interceptor' : 'chaser',
        speedFactor: level.speedFactor + (interceptor ? INTERCEPTOR.speedBonus : 0),
        turnDeg: level.turnDeg + (interceptor ? INTERCEPTOR.turnBonusDeg : 0),
        aimSide: rng() * 2 - 1,
        launchShare: lerp(SPAWN.speedMin, SPAWN.speedMax, rng()),
        reaction: interceptor ? level.reaction : 1,
      });
      return true;
    }
    return false;
  }

  // Parked cruisers across a crossing ahead, placed where the camera can't see yet. The lots at the
  // crossing's corners stay open, so there is always a way round.
  tryRoadblock(sim, view) {
    let parked = 0;
    for (const police of sim.police) if (police.alive && police.parked) parked += 1;
    if (parked + ROADBLOCK.cars > ROADBLOCK.maxParked) return false;
    const player = sim.player;
    const dir = travelDirection(player);
    const cell = WORLD.cell;
    const northSouth = Math.abs(dir.y) >= Math.abs(dir.x);
    for (const distance of ROADBLOCK.distances) {
      const x = Math.round((player.x + dir.x * distance) / cell) * cell;
      const y = Math.round((player.y + dir.y * distance) / cell) * cell;
      if (!sim.chunks.contains(x, y) || isOnScreen(x, y, view, ROADBLOCK.screenMargin)) continue;
      if (!sim.world.isClear(x, y, ROADBLOCK.clearance) || sim.isNearCar(x, y, ROADBLOCK.clearance)) continue;
      for (let i = 0; i < ROADBLOCK.cars; i += 1) {
        const offset = (i - (ROADBLOCK.cars - 1) / 2) * ROADBLOCK.spacing;
        const heading = (northSouth ? Math.PI / 2 : 0) + (sim.rng() - 0.5) * ROADBLOCK.angleJitter;
        sim.spawnPolice(x + (northSouth ? offset : 0), y + (northSouth ? 0 : offset), heading, {
          role: 'roadblock',
          speedFactor: 1,
          turnDeg: 0,
          aimSide: 0,
          launchShare: 0,
        });
      }
      return true;
    }
    return false;
  }
}
