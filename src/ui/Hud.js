import { button, el, uiRoot } from './dom.js';
import { dt, setDisplay } from './displayFont.js';
import { formatClock, formatDistance } from '../systems/ScoreSystem.js';

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
    this.hintBox = el('div', 'hud-hint', [dt('', '')]);
    this.node = el('div', 'hud', [
      el('div', 'hud-tele', [this.time, this.distance, this.wrecks]),
      el('div', 'hud-right', [this.pauseButton, this.record]),
      this.toasts,
      this.hintBox,
    ]);
    this.node.hidden = true;
    uiRoot().append(this.node);
    this.shownWrecks = -1;
    this.nextRefresh = 0;
  }

  show(visible) {
    this.node.hidden = !visible;
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

  hint(text, ms) {
    setDisplay(this.hintBox.firstChild, text);
    this.hintBox.classList.add('visible');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hintBox.classList.remove('visible'), ms);
  }

  hideHint() {
    clearTimeout(this.hintTimer);
    this.hintBox.classList.remove('visible');
  }

  clearToasts() {
    this.toasts.replaceChildren();
  }
}
