import { ICONS, button, el, uiRoot } from './dom.js';
import { dt, setDisplay } from './displayFont.js';
import { formatClock, formatDistance } from '../systems/ScoreSystem.js';
import { TUTORIAL } from '../config/tuning.js';

const REFRESH_MS = 33; // the clock changes every frame: no need to touch the page that often

// In-game overlay: time, distance and police wrecked top left, pause and the record top right, and short
// pop-up messages. Nothing else: a held power-up is used by double tap, or goes off by itself.
export class Hud {
  constructor({ onPause }) {
    this.time = dt('hud-line', 'TIME: 00:00.00');
    this.distance = dt('hud-line', 'DIST: 0.00 M');
    this.wrecks = dt('hud-line', 'CARS: 0');
    this.record = dt('hud-record', 'RECORD: 00:00.00');
    // The WANTED level: five stars under the record, lit as new trouble joins the chase.
    this.wantedStars = Array.from({ length: 5 }, () => {
      const star = el('span', 'hud-wanted-star');
      star.innerHTML = ICONS.star;
      return star;
    });
    this.wanted = el('div', 'hud-wanted', this.wantedStars);
    this.wantedHead = dt('hud-call-head', '');
    this.wantedBody = dt('hud-call-body', '');
    this.call = el('div', 'hud-call', [this.wantedHead, this.wantedBody]);
    this.call.hidden = true;
    this.pauseButton = button('btn hud-pause', dt('', 'PAUSE'), onPause, 'Pause');
    this.toasts = el('div', 'hud-toasts');
    this.count = dt('hud-count', '');
    this.count.hidden = true;
    // One-time hints (scenes/Coach.js): a word in amber, a line in white, on a dark plate.
    this.tipHead = dt('hud-tip-head', '');
    this.tipBody = dt('hud-tip-body', '');
    this.tip = el('div', 'hud-tip', [this.tipHead, this.tipBody]);
    this.tip.hidden = true;
    // The first drive's steering lesson: the two halves of the screen glow softly (touch), and a line says how.
    this.steerText = dt('hud-steer-text', '');
    this.steer = el('div', 'hud-steer', [el('div', 'hud-steer-side hud-steer-left'), el('div', 'hud-steer-side hud-steer-right'), this.steerText]);
    this.steer.hidden = true;
    this.shields = el('div', 'hud-shields');
    // The item working now: a ring that runs down, and its name.
    this.powerRing = el('span', 'hud-power-ring');
    this.powerName = dt('hud-power-name', '');
    this.power = el('div', 'hud-power', [this.powerRing, this.powerName]);
    this.power.hidden = true;
    this.shownPower = null;
    this.node = el('div', 'hud', [
      el('div', 'hud-tele', [this.time, this.wrecks, this.shields, this.power]), // distance: kept out, to keep it clean
      el('div', 'hud-right', [this.pauseButton, this.record, this.wanted]),
      this.call,
      this.toasts,
      this.count,
      this.steer,
      this.tip, // right after the steering lesson, so it can sit above it (main.css)
    ]);
    this.node.hidden = true;
    uiRoot().append(this.node);
    this.shownWrecks = -1;
    this.nextRefresh = 0;
  }

  show(visible) {
    this.node.hidden = !visible;
  }

  // The armour left, as shield icons: lost ones stay, faded. None at all for a car without armour.
  setShields(left, max) {
    this.shields.hidden = max <= 0;
    if (this.shields.childElementCount !== max) {
      this.shields.replaceChildren(...Array.from({ length: max }, () => {
        const icon = el('span', 'hud-shield');
        icon.innerHTML = ICONS.shield;
        return icon;
      }));
    }
    [...this.shields.children].forEach((icon, i) => icon.classList.toggle('lost', i >= left));
  }

  // name: the item working now (null: none). share: how much of its time is left, 1 to 0.
  // held: an item caught and waiting for the player (its name beats; the ring is full), else the one working now.
  setPower(name, share, held = false) {
    this.power.classList.toggle('hud-power-held', held);
    this.power.hidden = !name;
    if (!name) {
      this.shownPower = null;
      return;
    }
    if (name !== this.shownPower) {
      this.shownPower = name;
      setDisplay(this.powerName, name);
    }
    this.powerRing.style.setProperty('--p', share.toFixed(3));
  }

  setRecord(seconds) {
    setDisplay(this.record, `RECORD: ${formatClock(seconds)}`);
  }

  // Cheap to call every frame: only touches the page when a value changes.
  update(time, distance, wrecks) {
    const now = performance.now();
    if (now >= this.nextRefresh) {
      this.nextRefresh = now + REFRESH_MS;
      setDisplay(this.time, `TIME: ${formatClock(time)}`);
      setDisplay(this.distance, `DIST: ${formatDistance(distance)}`);
    }
    if (wrecks !== this.shownWrecks) {
      this.shownWrecks = wrecks;
      setDisplay(this.wrecks, `CARS: ${wrecks}`);
    }
  }

  // kind: 'combo' | 'near' | 'power' | 'ready' | 'info'
  toast(text, kind = 'info', ms = 1400) {
    const node = el('div', `toast toast-${kind}`, [dt('', text)]);
    this.toasts.append(node);
    while (this.toasts.childElementCount > 3) this.toasts.firstChild.remove();
    setTimeout(() => node.remove(), ms);
  }

  clearToasts() {
    this.toasts.replaceChildren();
  }

  // level: stars lit (1 to 5). call: what joins the chase now, shown big for a moment (null: no call-out).
  setWanted(level, call) {
    this.wantedStars.forEach((star, i) => star.classList.toggle('lit', i < level));
    if (!call) return;
    this.wantedStars[level - 1].classList.remove('hud-wanted-new');
    void this.wantedStars[level - 1].offsetWidth;
    this.wantedStars[level - 1].classList.add('hud-wanted-new');
    clearTimeout(this.callTimer);
    setDisplay(this.wantedHead, `WANTED LEVEL ${level}!`);
    setDisplay(this.wantedBody, call);
    this.call.hidden = false;
    this.call.classList.remove('hud-call-pop');
    void this.call.offsetWidth;
    this.call.classList.add('hud-call-pop');
    this.callTimer = setTimeout(() => (this.call.hidden = true), 2400);
  }

  // A one-time hint ({ head, body }) for a few seconds; null takes it away.
  showTip(tip) {
    clearTimeout(this.tipTimer);
    // sides: the two halves of a touch screen glow while the hint is up (TURN SHARP!: hold one).
    this.sidesOn = Boolean(tip && tip.sides);
    this.showSteer();
    if (!tip) {
      this.tip.hidden = true;
      return;
    }
    setDisplay(this.tipHead, tip.head);
    setDisplay(this.tipBody, tip.body);
    this.tip.hidden = false;
    this.tip.classList.remove('hud-tip-pop', 'hud-tip-hold');
    void this.tip.offsetWidth; // restart the pop
    // hold: a DOUBLE TAP! prompt stays until it is taken away (showTip(null)).
    this.tip.classList.add(tip.hold ? 'hud-tip-hold' : 'hud-tip-pop');
    if (!tip.hold) this.tipTimer = setTimeout(() => (this.tip.hidden = true), TUTORIAL.tipSeconds * 1000);
  }

  // The glowing halves show for the steering lesson (with its line) or for a hint that asks for them.
  showSteer() {
    this.steer.hidden = !(this.steerOn || this.sidesOn);
    this.steerText.hidden = !this.steerOn;
  }

  // The first drive's steering lesson. touch: the screen is a touch screen (hold a side), otherwise keys.
  setSteerHint(on, touch) {
    this.steerOn = on;
    this.steer.classList.toggle('hud-steer-touch', touch);
    this.showSteer();
    if (!on) return;
    setDisplay(this.steerText, touch ? 'HOLD LEFT OR RIGHT TO STEER' : 'STEER WITH < > OR A / D');
  }

  // The count after a revive: 3, 2, 1, then GO! (0) for a moment. null hides it.
  setCount(value) {
    clearTimeout(this.countTimer);
    if (value === null) {
      this.count.hidden = true;
      return;
    }
    setDisplay(this.count, value > 0 ? String(value) : 'GO!');
    this.count.hidden = false;
    this.count.classList.remove('hud-count-pop');
    void this.count.offsetWidth; // restart the pop for each number
    this.count.classList.add('hud-count-pop');
    if (value === 0) this.countTimer = setTimeout(() => (this.count.hidden = true), 650);
  }
}
