import { el, uiRoot } from './dom.js';

// A one-time pointer on the menus (owner, 2026-11-13): a small amber arrow by one button, bobbing gently, and the
// button glowing softly. No words: the button says what it does. One at a time; it never blocks anything: any tap
// hides it, and onTap(hitTarget) says whether the tap was on the button itself. It follows the button every frame,
// so it stays put while a screen zooms or the window turns, and it goes to the other side if there is no room.
const GRACE_MS = 350; // a tap still landing from the screen before doesn't hide it
const GAP = 4; // between the button and the arrow's tip
const SIZE = 18; // the arrow's height, as in main.css

let node = null;
let arrow = null;
let current = null;

function build() {
  arrow = el('div', 'guide-arrow');
  node = el('div', 'guide', [arrow]);
  node.hidden = true;
  uiRoot().append(node);
  // Capture: seen before the button's own handler, which may then show the next pointer.
  document.addEventListener('pointerdown', (event) => {
    if (!current || performance.now() < current.since + GRACE_MS) return;
    const { target, onTap } = current;
    const hit = target.contains(event.target);
    Guide.hide();
    if (onTap) onTap(hit);
  }, true);
}

function follow() {
  if (!current) return;
  current.frame = requestAnimationFrame(follow);
  const box = current.target.isConnected ? current.target.getBoundingClientRect() : null;
  const seen = box && box.width > 0 && box.height > 0;
  node.style.visibility = seen ? 'visible' : 'hidden';
  if (!seen) return;
  const roomAbove = box.top - GAP - SIZE > 8;
  const roomBelow = box.bottom + GAP + SIZE < window.innerHeight - 8;
  const below = current.below ? roomBelow || !roomAbove : !roomAbove;
  node.classList.toggle('below', below);
  arrow.style.left = `${box.left + box.width / 2}px`;
  arrow.style.top = below ? `${box.bottom + GAP}px` : `${box.top - GAP}px`;
}

export const Guide = {
  // below: under the button, pointing up, where there is room (else above it, pointing down).
  point(target, onTap = null, { below = false } = {}) {
    if (!node) build();
    this.hide();
    if (!target) return;
    target.classList.add('btn-pointer');
    current = { target, onTap, below, since: performance.now(), frame: 0 };
    node.hidden = false;
    node.style.visibility = 'hidden';
    follow();
  },

  hide() {
    if (!current) return;
    cancelAnimationFrame(current.frame);
    current.target.classList.remove('btn-pointer');
    current = null;
    node.hidden = true;
  },

  get showing() {
    return Boolean(current);
  },
};
