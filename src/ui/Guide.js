import { el, uiRoot } from './dom.js';

// A one-time pointer on the menus (owner, 2026-11-13; bigger and clearer 2026-11-14): a chunky amber arrow moving
// in towards one button again and again, growing as it goes, like a tap. Only the arrow moves; the button stays as
// it is. No words: the button says what it does. One at a time.
// It stays until the player taps what it points at (taps elsewhere leave it), then onTap() runs; it never blocks
// anything. It goes on whichever side of the button is clearest (above, below, left or right: the one covering the
// least of the screen's buttons and words), checked twice a second, and follows the button every frame, so it stays
// put while a screen moves or the window turns.
const GAP = 6; // between the button and the arrow's tip, clear of the button as it grows
const SIZE = 38; // the arrow's length and width, as in main.css
const REACH = 10; // how far it moves in and out (main.css guide-tap)
const MARGIN = 6; // from the edge of the screen
const RECHECK_MS = 500;
const SIDES = ['above', 'below', 'left', 'right'];
const ALONG = [0.5, 0.3, 0.7, 0.15, 0.85]; // where along the button's edge the arrow may point (the middle first)
const YELLOW_WEIGHT = 5; // covering something yellow counts this much more: the amber arrow would be lost on it

const ARROW_SVG = `<svg viewBox="0 0 38 38" aria-hidden="true"><path d="M13 2 H25 V18 H34 L19 35 L4 18 H13 Z"/></svg>`;

let node = null;
let arrow = null;
let current = null;

function build() {
  arrow = el('div', 'guide-arrow');
  arrow.innerHTML = ARROW_SVG;
  node = el('div', 'guide', [arrow]);
  node.hidden = true;
  uiRoot().append(node);
  // Capture: seen before the button's own handler, which may then show the next pointer.
  document.addEventListener('pointerdown', (event) => {
    if (!current || !current.target.contains(event.target)) return;
    const { onTap } = current;
    Guide.hide();
    if (onTap) onTap(true);
  }, true);
}

// Where the arrow's box would be on each side of the button (its tip GAP away, room for its movement), its tip
// `along` the way along that edge.
function boxFor(side, box, along = 0.5) {
  const cx = box.left + box.width * along;
  const cy = box.top + box.height * along;
  const far = GAP + SIZE + REACH;
  if (side === 'above') return { left: cx - SIZE / 2, right: cx + SIZE / 2, top: box.top - far, bottom: box.top - GAP, tipX: cx, tipY: box.top - GAP };
  if (side === 'below') return { left: cx - SIZE / 2, right: cx + SIZE / 2, top: box.bottom + GAP, bottom: box.bottom + far, tipX: cx, tipY: box.bottom + GAP };
  if (side === 'left') return { left: box.left - far, right: box.left - GAP, top: cy - SIZE / 2, bottom: cy + SIZE / 2, tipX: box.left - GAP, tipY: cy };
  return { left: box.right + GAP, right: box.right + far, top: cy - SIZE / 2, bottom: cy + SIZE / 2, tipX: box.right + GAP, tipY: cy };
}

// The buttons and words on the screens showing, apart from the one pointed at: what the arrow should not cover.
function screenThings(target) {
  const things = [];
  const area = window.innerWidth * window.innerHeight;
  for (const thing of uiRoot().querySelectorAll('.screen:not([hidden]) *')) {
    if (thing.tagName === 'CANVAS' || target.contains(thing) || thing.contains(target)) continue;
    const leaf = thing.children.length === 0 || thing.tagName === 'BUTTON' || thing.tagName === 'svg';
    if (!leaf || (thing.parentElement && thing.parentElement.tagName === 'BUTTON')) continue;
    const r = thing.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.width * r.height > area * 0.25) continue;
    const style = getComputedStyle(thing);
    r.weight = isYellow(style.backgroundColor) || (thing.children.length === 0 && isYellow(style.color)) ? YELLOW_WEIGHT : 1;
    things.push(r);
  }
  return things;
}

function isYellow(colour) {
  const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/.exec(colour);
  return Boolean(m) && (m[4] === undefined || Number(m[4]) > 0.3) && Number(m[1]) > 200 && Number(m[2]) > 150 && Number(m[3]) < 140;
}

function overlap(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

// The clearest place that fits on screen: a side, and where along it. The preferred side, and the middle of an
// edge, win a tie.
function choosePlace(box) {
  const things = screenThings(current.target);
  const order = [current.prefer, ...SIDES.filter((side) => side !== current.prefer)];
  let best = null;
  let bestCover = Infinity;
  for (const along of ALONG) {
    for (const side of order) {
      const b = boxFor(side, box, along);
      if (b.left < MARGIN || b.top < MARGIN || b.right > window.innerWidth - MARGIN || b.bottom > window.innerHeight - MARGIN) continue;
      const cover = things.reduce((sum, r) => sum + overlap(b, r) * r.weight, 0) * (along === 0.5 ? 1 : 1.15);
      if (cover < bestCover - 1) {
        best = { side, along };
        bestCover = cover;
      }
    }
  }
  return best || { side: current.prefer, along: 0.5 };
}

function follow() {
  if (!current) return;
  current.frame = requestAnimationFrame(follow);
  const box = current.target.isConnected ? current.target.getBoundingClientRect() : null;
  const seen = box && box.width > 0 && box.height > 0;
  node.style.visibility = seen ? 'visible' : 'hidden';
  if (!seen) return;
  const now = performance.now();
  if (!current.place || now > current.checkAt) {
    current.place = choosePlace(box);
    current.checkAt = now + RECHECK_MS;
    arrow.dataset.side = current.place.side;
  }
  const b = boxFor(current.place.side, box, current.place.along);
  arrow.style.left = `${b.tipX}px`;
  arrow.style.top = `${b.tipY}px`;
}

export const Guide = {
  // below: the side tried first is under the button (else above it); the clearest side wins in the end.
  point(target, onTap = null, { below = false } = {}) {
    if (!node) build();
    this.hide();
    if (!target) return;
    current = { target, onTap, prefer: below ? 'below' : 'above', place: null, checkAt: 0, frame: 0 };
    node.hidden = false;
    node.style.visibility = 'hidden';
    follow();
  },

  hide() {
    if (!current) return;
    cancelAnimationFrame(current.frame);
    current = null;
    node.hidden = true;
  },

  get showing() {
    return Boolean(current);
  },

  get target() {
    return current ? current.target : null;
  },
};
