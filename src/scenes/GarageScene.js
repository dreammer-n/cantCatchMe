import * as Phaser from 'phaser';
import { CARS } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { Progress } from '../systems/Progress.js';
import { Garage } from '../systems/ScoreSystem.js';
import { Settings } from '../systems/Settings.js';
import { GarageScreen } from '../ui/Screens.js';

// Browse, buy and choose cars. Opened as the last step after PLAY (flow: from the map step, the big button reads
// DRIVE), or from the results. Steer left and right to browse, Enter / Space / gamepad A for the big button, P to
// go back, so it works on any device.
export class GarageScene extends Phaser.Scene {
  constructor() {
    super('GarageScene');
  }

  init(data) {
    this.from = data.from;
    this.flow = Boolean(data.flow);
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
        onUpgrade: (kind) => this.upgrade(kind),
        onHardStart: () => this.toggleHardStart(),
      });
    }
    this.screen.setFlow(this.flow, Settings.hardStart);
    this.index = CARS.findIndex((car) => car.id === Garage.selected);
    this.lastSteer = 0;
    this.readyAt = this.time.now + 250; // ignore a key still held from the previous screen
    this.driving = false;
    this.screen.show();
    this.screen.forget();
    this.showCar(); // drawn first (the map behind and the car), then the move starts
    this.screen.zoom();
    this.stopWatching = Garage.onChange(() => this.showCar());
    this.events.once('shutdown', () => {
      this.stopWatching();
      this.screen.leave(!this.driving);
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
      Garage.select(car.id);
      this.audio.play('click');
      return; // bought: the button now reads DRIVE
    }
    Garage.select(car.id);
    this.audio.play('click');
    if (this.flow) this.drive();
  }

  // The end of PLAY's steps: map and car chosen, off we go. The title and map step close behind.
  drive() {
    if (this.driving) return;
    this.driving = true;
    this.audio.unlock();
    this.scene.stop();
    this.scene.stop('MapScene');
    this.scene.get('GameScene').startRun(); // emits 'run-started', which closes the title
  }

  toggleHardStart() {
    Settings.setHardStart(!Settings.hardStart);
    this.screen.hard.setOn(Settings.hardStart);
    this.audio.play('click');
  }

  // An upgrade for every car, if the player's level and coins allow it.
  upgrade(kind) {
    if (!Progress.upgrade(kind)) return;
    this.audio.play('click');
    PlatformManager.sendEvent('upgrade_bought', { kind, tier: Progress.tier(kind) });
    this.showCar();
  }

  close() {
    if (this.driving || this.screen.leaving) return;
    this.audio.play('click');
    const parent = this.scene.get(this.from);
    this.scene.stop();
    this.scene.resume(this.from);
    parent.onGarageClosed();
  }
}
