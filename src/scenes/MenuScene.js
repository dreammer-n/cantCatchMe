import * as Phaser from 'phaser';
import { PlatformManager } from '../platform/PlatformManager.js';
import { LEADERBOARD } from '../config/tuning.js';
import { Garage, Records } from '../systems/ScoreSystem.js';
import { Settings } from '../systems/Settings.js';
import { Tips } from '../systems/Tips.js';
import { LeaderboardScreen, MenuScreen } from '../ui/Screens.js';

// Title screen (HTML) over the world, where the player's car waits on the road. PLAY (or Enter / Space /
// gamepad A) leads on to choosing a map (MapScene), then a car (GarageScene), then the run.
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    this.controls = this.registry.get('input');
    this.audio = this.registry.get('audio');
    if (!this.screen) {
      this.screen = new MenuScreen({
        onPlay: () => this.play(),
        onSound: () => this.toggleSound(),
        onMusic: () => this.toggleMusic(),
        onBoard: () => this.openBoard(),
      });
    }
    const close = () => this.close();
    this.game.events.once('run-started', close);
    this.events.once('shutdown', () => this.game.events.off('run-started', close));
    // A brand-new player skips the title: straight onto the road for the first drive (scenes/Coach.js).
    if (Tips.firstDrive()) {
      hideBootScreen();
      PlatformManager.gameReady(); // the player can interact: the first touch starts the drive
      performance.mark && performance.mark('ccm:title');
      this.scene.get('GameScene').startRun(undefined, { firstDrive: true });
      return;
    }
    const boardMode = PlatformManager.leaderboardMode();
    this.screen.show({ soundOn: Settings.sound, musicOn: Settings.music, coins: Garage.coins, boardShown: boardMode === 'in_game' || boardMode === 'native_popup' });
    this.readyAt = this.time.now + 250; // ignore a key still held from the previous screen
    hideBootScreen();
    PlatformManager.gameReady(); // first moment the player can interact
    performance.mark && performance.mark('ccm:title');
  }

  update(time) {
    if (time >= this.readyAt && this.controls.getCommand().confirmPressed) this.play();
  }

  // PLAY: on to choosing a map, then a car.
  play() {
    this.openOver('MapScene');
  }

  openOver(sceneKey, data) {
    if (!this.screen || this.screen.node.hidden || this.screen.leaving) return;
    this.audio.unlock();
    this.audio.play('click');
    this.screen.leave();
    this.scene.launch(sceneKey, data);
    this.scene.pause();
  }

  // Back from choosing a map.
  onGarageClosed() {
    this.screen.zoom(true);
    this.screen.refresh(Garage.coins);
    this.readyAt = this.time.now + 250;
    this.scene.get('GameScene').onGarageClosed();
  }

  close() {
    this.screen.hide();
    this.scene.stop();
  }

  // The HARD START leaderboard: the platform's own window where it has one, otherwise the game's screen.
  async openBoard() {
    if (!this.screen || this.screen.node.hidden) return;
    this.audio.unlock();
    this.audio.play('click');
    if (PlatformManager.leaderboardMode() === 'native_popup') {
      PlatformManager.showLeaderboard(LEADERBOARD.id);
      return;
    }
    if (!this.boardScreen) {
      this.boardScreen = new LeaderboardScreen({
        onClose: () => this.closeBoard(),
        onHardStart: () => {
          if (!Settings.hardStart) this.toggleHardStart();
          this.boardScreen.setHardOn(true);
        },
      });
    }
    this.screen.hide();
    this.boardScreen.showLoading(Records.hardBest, Settings.hardStart);
    const entries = await PlatformManager.leaderboardEntries(LEADERBOARD.id);
    if (!this.boardScreen.node.hidden) this.boardScreen.showEntries(entries, LEADERBOARD.shown);
  }

  closeBoard() {
    this.audio.play('click');
    this.boardScreen.hide();
    this.screen.node.hidden = false;
    this.readyAt = this.time.now + 250;
  }

  toggleHardStart() {
    this.audio.unlock();
    Settings.setHardStart(!Settings.hardStart);
    this.audio.play('click');
  }

  toggleSound() {
    this.audio.unlock();
    Settings.setSound(!Settings.sound);
    this.audio.setSoundOn(Settings.sound);
    this.screen.sound.setOn(Settings.sound);
    this.audio.play('click');
  }

  toggleMusic() {
    this.audio.unlock();
    Settings.setMusic(!Settings.music);
    this.audio.setMusicOn(Settings.music);
    this.screen.music.setOn(Settings.music);
    this.audio.play('click');
  }
}

function hideBootScreen() {
  const boot = document.getElementById('boot');
  if (!boot || boot.classList.contains('done')) return;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 400);
}
