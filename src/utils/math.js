// Shared math helpers.

// Fraction of the remaining gap to close this step, for smoothing that behaves the same at any frame rate.
// rate = "how many times per second" the gap shrinks by a factor of e.
export function smoothFactor(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

// Keeps an angle between -PI and PI.
export function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function degToRad(degrees) {
  return (degrees * Math.PI) / 180;
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Heading (0 = north, clockwise) of the direction (dx, dy). Matches Car.heading.
export function headingOf(dx, dy) {
  return Math.atan2(dx, -dy);
}

// Small repeatable random generator (mulberry32): same seed, same sequence. Returns 0..1.
export function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value from a table of [x, y] pairs (sorted by x), blended linearly between rows.
export function tableLookup(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i += 1) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return table[table.length - 1][1];
}
