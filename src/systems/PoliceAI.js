import { INTERCEPTOR, POLICE, WORLD } from '../config/tuning.js';
import { clamp, headingOf, lerp, wrapAngle } from '../utils/math.js';

// Pursuit steering for one police car. Cheap on purpose:
//   1. Every 0.1-0.3 s (a reaction time) pick a target point. Chasers aim at where the player IS,
//      so they end up tailing. Interceptors aim at where the player WILL BE, which makes them cut
//      corners, wait at crossings and come in from the side.
//   2. Every frame, steer toward that point. The car's own turn rate and grip limit how fast it
//      can actually turn, so police overshoot sharp turns: that is how the player escapes.
//   3. Obstacle awareness, deliberately imperfect: at each reaction a car may glance ahead and,
//      if a prop is right in its path, swerve to the clearer side until its next reaction. Cars
//      that don't notice (or have nowhere to go) crash into it: that is what makes pile-ups.
export function steerPolice(police, player, dt, rng, world) {
  const car = police.model;
  police.retarget -= dt;
  if (police.retarget <= 0) {
    police.retarget = lerp(POLICE.retargetMin, POLICE.retargetMax, rng()) * police.reaction;
    if (rng() < 0.08) police.aimSide = rng() * 2 - 1;
    chooseTarget(police, player);
    police.avoid = world && rng() < POLICE.awareness ? swerveFrom(car, world) : 0;
  }
  if (police.avoid) {
    police.steer = police.avoid;
    return;
  }
  const desired = headingOf(police.targetX - car.x, police.targetY - car.y);
  police.steer = clamp(wrapAngle(desired - car.heading) * POLICE.steerGain, -1, 1);
}

// 0 if the way ahead is clear, otherwise -1 / 1 (steer left / right toward the clearer side).
function swerveFrom(car, world) {
  const reach = POLICE.lookAhead + car.speed * POLICE.lookAheadSeconds;
  if (probeClear(car, world, 0, reach)) return 0;
  const right = probeClear(car, world, POLICE.swerveAngle, reach);
  const left = probeClear(car, world, -POLICE.swerveAngle, reach);
  if (right === left) return 0; // boxed in, or both sides clear: keep chasing
  return right ? 1 : -1;
}

function probeClear(car, world, angle, reach) {
  const heading = car.heading + angle;
  return world.isClear(car.x + Math.sin(heading) * reach, car.y - Math.cos(heading) * reach, POLICE.probeRadius);
}

export function chooseTarget(police, player) {
  if (police.role === 'interceptor') aimAhead(police, player);
  else aimAtPlayer(police, player);
}

// Chaser: straight at the player, each car a little to its own side while far away, so they don't
// all follow one line.
function aimAtPlayer(police, player) {
  const car = police.model;
  const distance = Math.hypot(player.x - car.x, player.y - car.y);
  police.targetX = player.x;
  police.targetY = player.y;
  if (distance < POLICE.ramDistance) return;
  const speed = Math.hypot(player.vx, player.vy) || 1;
  const side = police.aimSide * POLICE.aimJitter * clamp(distance / 600, 0, 1);
  police.targetX += (-player.vy / speed) * side;
  police.targetY += (player.vx / speed) * side;
}

// Interceptor: at the player's predicted position. The further away, the further ahead it aims.
function aimAhead(police, player) {
  const car = police.model;
  const dx = car.x - player.x;
  const dy = car.y - player.y;
  const distance = Math.hypot(dx, dy);
  const leadTime = clamp(distance / Math.max(120, car.speed), INTERCEPTOR.leadMin, INTERCEPTOR.leadMax);
  let tx = player.x + player.vx * leadTime;
  let ty = player.y + player.vy * leadTime;

  if (distance >= POLICE.ramDistance) {
    const speed = Math.hypot(player.vx, player.vy) || 1;
    const dirX = player.vx / speed;
    const dirY = player.vy / speed;
    const crossX = Math.round(tx / WORLD.cell) * WORLD.cell;
    const crossY = Math.round(ty / WORLD.cell) * WORLD.cell;
    if (distance > INTERCEPTOR.ambushDistance && Math.hypot(tx - crossX, ty - crossY) < INTERCEPTOR.crossingSnap) {
      // The player is about to reach a crossing: make for it and meet them there.
      tx = crossX;
      ty = crossY;
    } else if (dx * dirX + dy * dirY < 0 && distance < INTERCEPTOR.flankDistance) {
      // Behind the player: swing out on its own side to draw level, rather than tailgating.
      const sideways = dx * -dirY + dy * dirX;
      const side = sideways < 0 ? -1 : 1;
      tx += -dirY * side * INTERCEPTOR.flankOffset;
      ty += dirX * side * INTERCEPTOR.flankOffset;
    }
  }
  police.targetX = tx;
  police.targetY = ty;
}
