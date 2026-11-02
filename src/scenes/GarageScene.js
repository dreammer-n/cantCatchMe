import * as Phaser from 'phaser';
import { CARS } from '../config/tuning.js';
import { Garage } from '../systems/ScoreSystem.js';
import { GarageScreen } from '../ui/Screens.js';

// Browse, buy and choose cars. Opened over the title or the results, which wait underneath. Steer left and
// right to browse, Enter / Space / gamepad A for the big button, Esc to go back, so it works on any device.
export class GarageScene extends Phaser.Scene {
  constructor() {
    super('GarageScene');
  }

  init(data) {
    this.from = data.from;
  }

  create() {
    this.controls = this.registry.get('input');
    this.audio = this.registry.get('audio');
    if (!this.screen) {
      this.screen = new GarageScreen({
        onPrev: () => this.browse(-1),
        onNext: () => this.browse(1),
        onAction: () => this.act(),
        onBack: () => this.close(),
      });
    }
    this.index = CARS.findIndex((car) => car.id === Garage.selected);
    this.lastSteer = 0;
    this.readyAt = this.time.now + 250; // ignore a key still held from the previous screen
    this.screen.show();
    this.screen.forget();
    this.showCar();
    this.stopWatching = Garage.onChange(() => this.showCar());
    this.events.once('shutdown', () => {
      this.stopWatching();
      this.screen.hide();
    });
  }

  update(time) {
    this.screen.drawCar();
    if (time < this.readyAt) return;
    const command = this.controls.getCommand();
    if (command.steer !== 0 && command.steer !== this.lastSteer) this.browse(command.steer);
    this.lastSteer = command.steer;
    if (command.confirmPressed) this.act();
    else if (command.pausePressed) this.close();
  }

  showCar() {
    this.screen.showCar(CARS[this.index], this.index, CARS.length);
  }

  browse(step) {
    this.audio.play('click');
    this.index = (this.index + step + CARS.length) % CARS.length;
    this.showCar();
  }

  // Buys or selects the car on show. A car you have just paid for is the one you want to drive.
  act() {
    const car = CARS[this.index];
    if (!Garage.owns(car.id)) {
      if (!Garage.buy(car.id)) return;
    }
    Garage.select(car.id);
    this.audio.play('click');
  }

  close() {
    this.audio.play('click');
    const parent = this.scene.get(this.from);
    this.scene.stop();
    this.scene.resume(this.from);
    parent.onGarageClosed();
  }
}
