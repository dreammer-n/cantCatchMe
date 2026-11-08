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
      el('div', 'hud-tele', [this.time, this.distance, this.wrecks, this.shields, this.power]),
      el('div', 'hud-right', [this.pauseButton, this.record]),
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
  setPower(name, share) {
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

  // A one-time hint ({ head, body }) for a few seconds; null takes it away.
  showTip(tip) {
    clearTimeout(this.tipTimer);
    if (!tip) {
      this.tip.hidden = true;
      return;
    }
    setDisplay(this.tipHead, tip.head);
    setDisplay(this.tipBody, tip.body);
    this.tip.hidden = false;
    this.tip.classList.remove('hud-tip-pop');
    void this.tip.offsetWidth; // restart the pop
    this.tip.classList.add('hud-tip-pop');
    this.tipTimer = setTimeout(() => (this.tip.hidden = true), TUTORIAL.tipSeconds * 1000);
  }

  // The first drive's steering lesson. touch: the screen is a touch screen (hold a side), otherwise keys.
  setSteerHint(on, touch) {
    this.steer.hidden = !on;
    if (!on) return;
    this.steer.classList.toggle('hud-steer-touch', touch);
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
