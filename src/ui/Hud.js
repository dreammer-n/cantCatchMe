import { ICONS, button, el, uiRoot } from './dom.js';
import { formatTime } from '../systems/ScoreSystem.js';

// In-game overlay: survival timer (big, top centre), best time, police wrecked, pause button,
// the power-up button (only while an item is held) and short pop-up messages.
export class Hud {
  constructor({ onPause, onPower }) {
    this.time = el('div', 'hud-time', '0:00.0');
    this.best = el('div', 'hud-best', '');
    const icon = el('span', 'hud-wrecks-icon');
    icon.innerHTML = ICONS.police;
    this.wrecks = el('div', 'hud-wrecks', [icon, el('span', 'hud-wrecks-count', '0')]);
    this.wrecks.title = 'Police wrecked';
    this.wrecksCount = this.wrecks.lastChild;
    this.pauseButton = button('btn hud-pause', ICONS.pause, onPause, 'Pause');
    this.power = button('hud-power', ICONS.bolt, onPower, 'Use power-up');
    this.powerLabel = el('span', 'hud-power-label', '');
    this.power.append(this.powerLabel);
    this.toasts = el('div', 'hud-toasts');
    this.hintBox = el('div', 'hud-hint', '');
    this.node = el('div', 'hud', [
      el('div', 'hud-top', [this.wrecks, el('div', 'hud-clock', [this.time, this.best]), this.pauseButton]),
      this.toasts,
      this.hintBox,
      this.power,
    ]);
    this.node.hidden = true;
    uiRoot().append(this.node);
    this.shown = { time: -1, wrecks: -1, power: null };
  }

  show(visible) {
    this.node.hidden = !visible;
  }

  setBest(seconds) {
    this.best.textContent = seconds > 0 ? `BEST ${formatTime(seconds)}` : '';
  }

  // Cheap to call every frame: only touches the page when a value changes.
  // power: what the power-up button should say, or null to hide it.
  update(time, wrecks, power) {
    const tenths = Math.floor(time * 10);
    if (tenths !== this.shown.time) {
      this.shown.time = tenths;
      this.time.textContent = formatTime(time);
    }
    if (wrecks !== this.shown.wrecks) {
      this.shown.wrecks = wrecks;
      this.wrecksCount.textContent = String(wrecks);
      this.wrecks.classList.remove('bump');
      void this.wrecks.offsetWidth; // restart the little bounce animation
      if (wrecks > 0) this.wrecks.classList.add('bump');
    }
    if (power !== this.shown.power) {
      this.shown.power = power;
      this.power.classList.toggle('ready', Boolean(power));
      if (power) this.powerLabel.textContent = power;
    }
  }

  // kind: 'combo' | 'near' | 'power' | 'ready' | 'info'
  toast(text, kind = 'info', ms = 1400) {
    const node = el('div', `toast toast-${kind}`, text);
    this.toasts.append(node);
    while (this.toasts.childElementCount > 3) this.toasts.firstChild.remove();
    setTimeout(() => node.remove(), ms);
  }

  hint(text, ms) {
    this.hintBox.textContent = text;
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
