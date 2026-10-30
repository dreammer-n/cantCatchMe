// Debug toolbar for tuning, shown ONLY when the page address ends in ?debug (players never see
// it). It sits outside the game surface, so tapping it never steers the car.
// Keys: 1 / 2 / 3 choose handling, V changes the camera view, T parks the car on a turntable to
// inspect it from every direction (R restarts, as in the normal game).

const KEY_TO_INDEX = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };

export class DevPanel {
  constructor({ presets, onSelectPreset, onRestart, onCycleView, onTurntable }) {
    this.presets = presets; // [{ id, label }]
    this.onSelectPreset = onSelectPreset;
    this.onRestart = onRestart;
    this.onCycleView = onCycleView;
    this.onTurntable = onTurntable;

    this.root = document.createElement('div');
    this.root.className = 'dev-panel';

    this.buttons = presets.map((preset, index) =>
      this.makeButton(`${index + 1} ${preset.label}`, () => this.onSelectPreset(preset.id)),
    );
    const group = document.createElement('div');
    group.className = 'dev-panel__group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Handling');
    this.buttons.forEach((button) => group.appendChild(button));

    const restart = this.makeButton('R Restart', () => this.onRestart());
    restart.classList.add('dev-panel__action');
    this.viewButton = this.makeButton('V View', () => this.onCycleView());
    this.viewButton.classList.add('dev-panel__action');
    this.turntableButton = this.makeButton('T Turntable', () => this.onTurntable());
    this.turntableButton.classList.add('dev-panel__action');
    this.turntableButton.setAttribute('aria-pressed', 'false');

    this.readout = document.createElement('div');
    this.readout.className = 'dev-panel__readout';

    const row = document.createElement('div');
    row.className = 'dev-panel__row';
    row.append(group, restart, this.viewButton, this.turntableButton);
    this.root.append(row, this.readout);
    document.body.appendChild(this.root);

    this.onKeyDown = (event) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code in KEY_TO_INDEX) {
        const preset = this.presets[KEY_TO_INDEX[event.code]];
        if (preset) this.onSelectPreset(preset.id);
      } else if (event.code === 'KeyV') {
        this.onCycleView();
      } else if (event.code === 'KeyT') {
        this.onTurntable();
      }
    };
    window.addEventListener('keydown', this.onKeyDown);
  }

  makeButton(text, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', () => {
      action();
      button.blur(); // so Space / Enter go to the game, not this button
    });
    return button;
  }

  setActivePreset(id) {
    this.presets.forEach((preset, index) => {
      this.buttons[index].setAttribute('aria-pressed', String(preset.id === id));
    });
  }

  setViewLabel(label) {
    this.viewButton.textContent = `V View: ${label}`;
  }

  setTurntable(on) {
    this.turntableButton.setAttribute('aria-pressed', String(on));
  }

  setReadout(text) {
    this.readout.textContent = text;
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }
}
