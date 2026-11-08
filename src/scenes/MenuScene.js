import * as Phaser from 'phaser';
import { PlatformManager } from '../platform/PlatformManager.js';
import { LEADERBOARD } from '../config/tuning.js';
import { Garage, Records } from '../systems/ScoreSystem.js';
import { Settings } from '../systems/Settings.js';
import { Tips } from '../systems/Tips.js';
import { LeaderboardScreen, MenuScreen } from '../ui/Screens.js';

// Title screen (HTML) over the world, where the player's car waits on the start ring.
// Play with the button, Enter / Space or gamepad A.
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
        onGarage: () => this.openOver('GarageScene', { from: 'MenuScene' }),
        onMaps: () => this.openOver('MapScene'),
        onHardStart: () => this.toggleHardStart(),
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
    const touch = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    const boardMode = PlatformManager.leaderboardMode();
    this.screen.show({ soundOn: Settings.sound, musicOn: Settings.music, touch, coins: Garage.coins, hardStart: Settings.hardStart, boardShown: boardMode === 'in_game' || boardMode === 'native_popup' });
    this.readyAt = this.time.now + 250; // ignore a key still held from the previous screen
    hideBootScreen();
    PlatformManager.gameReady(); // first moment the player can interact
    performance.mark && performance.mark('ccm:title');
  }

  update(time) {
    if (time >= this.readyAt && this.controls.getCommand().confirmPressed) this.play();
  }

  play() {
    if (!this.screen || this.screen.node.hidden) return;
    this.audio.unlock();
    this.audio.play('click');
    this.scene.get('GameScene').startRun(); // emits 'run-started', which closes this screen
  }

  openOver(sceneKey, data) {
    if (!this.screen || this.screen.node.hidden) return;
    this.audio.unlock();
    this.audio.play('click');
    this.screen.hide();
    this.scene.launch(sceneKey, data);
    this.scene.pause();
  }

  // Back from the garage or the maps.
  onGarageClosed() {
    this.screen.node.hidden = false;
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
    this.screen.hard.setOn(Settings.hardStart);
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
