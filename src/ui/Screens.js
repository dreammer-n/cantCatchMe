import { ICONS, button, el, uiRoot } from './dom.js';
import { formatTime } from '../systems/ScoreSystem.js';

// Full-screen menus: title, pause and results. Each has one primary action that Enter / Space /
// gamepad A also trigger (see the scenes), so every screen works with any input device.

function soundButton(onToggle) {
  const node = button('btn btn-icon btn-sound', ICONS.soundOn, () => onToggle(), 'Sound on / off');
  node.setSound = (on) => {
    node.innerHTML = on ? ICONS.soundOn : ICONS.soundOff;
    node.setAttribute('aria-pressed', String(on));
    node.classList.toggle('off', !on);
  };
  return node;
}

class Screen {
  constructor(className, children) {
    this.node = el('div', `screen ${className}`, [el('div', 'screen-panel', children)]);
    this.node.hidden = true;
    uiRoot().append(this.node);
  }

  show() {
    this.node.hidden = false;
    this.node.classList.remove('leaving');
  }

  hide() {
    this.node.hidden = true;
  }
}

export class MenuScreen extends Screen {
  constructor({ onPlay, onSound }) {
    const logo = el('h1', 'logo', [el('span', 'logo-line', "CAN'T"), el('span', 'logo-line', 'CATCH'), el('span', 'logo-line logo-me', 'ME!')]);
    const play = button('btn btn-primary btn-play', el('span', '', 'PLAY'), onPlay, 'Play');
    play.prepend(iconSpan(ICONS.play));
    const stats = el('div', 'menu-stats', '');
    const sound = soundButton(onSound);
    const hint = el('p', 'menu-hint', '');
    super('menu', [
      el('div', 'menu-top', [logo, el('p', 'tagline', 'Outrun the police. Lure them into crashes. Survive.')]),
      el('div', 'menu-bottom', [stats, play, el('div', 'menu-row', [sound]), hint]),
    ]);
    this.stats = stats;
    this.sound = sound;
    this.hint = hint;
  }

  show({ best, totals, soundOn, touch }) {
    const parts = [];
    if (best.time > 0) parts.push(`BEST ${formatTime(best.time)}`);
    if (totals.wrecks > 0) parts.push(`${totals.wrecks} POLICE WRECKED`);
    this.stats.textContent = parts.join('  ·  ');
    this.sound.setSound(soundOn);
    this.hint.textContent = touch
      ? 'Hold the left or right side of the screen to steer'
      : 'Steer with ← → or A D  ·  Space: Shockwave  ·  Esc: pause';
    super.show();
  }
}

export class PauseScreen extends Screen {
  constructor({ onResume, onRestart, onMenu, onSound }) {
    const resume = button('btn btn-primary', el('span', '', 'RESUME'), onResume, 'Resume');
    resume.prepend(iconSpan(ICONS.play));
    const sound = soundButton(onSound);
    super('pause', [
      el('h2', 'screen-title', 'PAUSED'),
      resume,
      el('div', 'menu-row', [button('btn btn-secondary', 'RESTART', onRestart, 'Restart'), sound, button('btn btn-secondary', 'MENU', onMenu, 'Main menu')]),
    ]);
    this.sound = sound;
  }

  show({ soundOn }) {
    this.sound.setSound(soundOn);
    super.show();
  }
}

const CAUSES = {
  police: ['BUSTED!', 'Rammed by the police'],
  pinned: ['BUSTED!', 'Boxed in by the police'],
  wreck: ['WRECKED!', 'You hit a burning wreck'],
  obstacle: ['WRECKED!', 'You crashed into the scenery'],
  wall: ['WRECKED!', 'You hit the city wall'],
};

export class GameOverScreen extends Screen {
  constructor({ onRetry, onMenu }) {
    const title = el('h2', 'screen-title over-title', 'BUSTED!');
    const cause = el('p', 'over-cause', '');
    const time = el('div', 'over-time', '0:00.0');
    const badge = el('div', 'over-badge', 'NEW BEST!');
    const grid = el('div', 'over-grid', '');
    const retry = button('btn btn-primary', el('span', '', 'RETRY'), onRetry, 'Retry');
    retry.prepend(iconSpan(ICONS.retry));
    super('over', [title, cause, time, badge, grid, retry, button('btn btn-secondary', 'MENU', onMenu, 'Main menu')]);
    Object.assign(this, { title, cause, time, badge, grid });
  }

  show({ summary, best, newBest, cause }) {
    const [title, line] = CAUSES[cause] || CAUSES.police;
    this.title.textContent = title;
    this.cause.textContent = line;
    this.time.textContent = formatTime(summary.time);
    this.badge.hidden = !newBest;
    const stat = (label, value) => el('div', 'over-stat', [el('span', 'over-stat-value', value), el('span', 'over-stat-label', label)]);
    this.grid.replaceChildren(
      stat('BEST', formatTime(best.time)),
      stat('POLICE WRECKED', String(summary.wrecks)),
      stat('CLOSE CALLS', String(summary.nearMisses)),
      stat('BEST COMBO', summary.combo > 1 ? `×${summary.combo}` : '–'),
    );
    super.show();
  }
}

function iconSpan(svg) {
  const span = el('span', 'btn-glyph');
  span.innerHTML = svg;
  return span;
}
