import { INPUT } from '../config/tuning.js';

// Turns keyboard, mouse, touch and gamepad into one simple command per frame:
//   { steer: -1 | 0 | 1, activatePowerUp, pausePressed, confirmPressed, restartPressed }
// Gameplay reads only this command, so every device drives the car through the same code.
// On-screen buttons (pause, Shockwave) are HTML buttons outside the steering surface: they
// call press(), so tapping them never steers.

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);
const POWER_KEYS = new Set(['Space', 'KeyW', 'ArrowUp']);
const CONFIRM_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);
const RESTART_KEYS = new Set(['KeyR']);
const GAME_KEYS = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...PAUSE_KEYS, ...POWER_KEYS, ...CONFIRM_KEYS, ...RESTART_KEYS]);

// Button positions in the browser's "standard" gamepad layout.
const PAD_BUTTON = { primary: 0, start: 9, dpadLeft: 14, dpadRight: 15 };

const NEUTRAL = Object.freeze({ steer: 0, activatePowerUp: false, pausePressed: false, confirmPressed: false, restartPressed: false });

export class InputManager {
  constructor(surface) {
    this.surface = surface;
    this.heldKeys = new Set();
    this.pointerSides = new Map(); // pointerId -> -1 (left half) or 1 (right half)
    this.padWasPressed = { start: false, primary: false };
    this.pendingPause = false;
    this.pendingPowerUp = false;
    this.pendingConfirm = false;
    this.pendingRestart = false;
    this.command = NEUTRAL;
    this.lastDevice = 'none';

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerEnd = this.onPointerEnd.bind(this);
    this.clear = this.clear.bind(this);
    this.onVisibilityChange = () => document.hidden && this.clear();
    this.onContextMenu = (event) => event.preventDefault();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('pointermove', this.onPointerMove);
    surface.addEventListener('pointerup', this.onPointerEnd);
    surface.addEventListener('pointercancel', this.onPointerEnd);
    surface.addEventListener('lostpointercapture', this.onPointerEnd);
    surface.addEventListener('contextmenu', this.onContextMenu);
  }

  // Called once per frame, before any scene updates.
  update() {
    const pad = this.readGamepad();
    const left = this.anyKeyHeld(LEFT_KEYS) || this.isPointerHeld(-1) || pad.left;
    const right = this.anyKeyHeld(RIGHT_KEYS) || this.isPointerHeld(1) || pad.right;
    // Both sides at once cancel out, so the result is always predictable.
    const steer = left === right ? 0 : left ? -1 : 1;

    this.command = Object.freeze({
      steer,
      activatePowerUp: this.pendingPowerUp || pad.powerPressed,
      pausePressed: this.pendingPause || pad.pausePressed,
      confirmPressed: this.pendingConfirm || pad.powerPressed,
      restartPressed: this.pendingRestart,
    });
    this.pendingPause = false;
    this.pendingPowerUp = false;
    this.pendingConfirm = false;
    this.pendingRestart = false;
  }

  // For on-screen buttons: 'pause' | 'power' | 'confirm'. Takes effect next frame.
  press(action) {
    if (action === 'pause') this.pendingPause = true;
    if (action === 'power') this.pendingPowerUp = true;
    if (action === 'confirm') this.pendingConfirm = true;
  }

  getCommand() {
    return this.command;
  }

  // Releases everything held. Used on blur, tab hide, pause and touch cancel.
  clear() {
    this.heldKeys.clear();
    this.pointerSides.forEach((_, pointerId) => this.releaseCapture(pointerId));
    this.pointerSides.clear();
    this.pendingPause = false;
    this.pendingPowerUp = false;
    this.pendingConfirm = false;
    this.pendingRestart = false;
    this.command = NEUTRAL;
  }

  // Releases held steering only (pause, menus), keeping one-shot presses queued.
  releaseHeld() {
    this.heldKeys.clear();
    this.pointerSides.forEach((_, pointerId) => this.releaseCapture(pointerId));
    this.pointerSides.clear();
  }

  destroy() {
    this.clear();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerup', this.onPointerEnd);
    this.surface.removeEventListener('pointercancel', this.onPointerEnd);
    this.surface.removeEventListener('lostpointercapture', this.onPointerEnd);
    this.surface.removeEventListener('contextmenu', this.onContextMenu);
  }

  onKeyDown(event) {
    // Leave browser shortcuts (Ctrl+R, Cmd+W ...) alone.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!GAME_KEYS.has(event.code)) return;
    event.preventDefault(); // stops arrow keys / space from scrolling an embedding page
    this.lastDevice = 'keyboard';
    if (!event.repeat) {
      if (PAUSE_KEYS.has(event.code)) this.pendingPause = true;
      if (POWER_KEYS.has(event.code)) this.pendingPowerUp = true;
      if (CONFIRM_KEYS.has(event.code)) this.pendingConfirm = true;
      if (RESTART_KEYS.has(event.code)) this.pendingRestart = true;
    }
    this.heldKeys.add(event.code);
  }

  onKeyUp(event) {
    this.heldKeys.delete(event.code);
  }

  onPointerDown(event) {
    // Mouse: only the main button steers.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.lastDevice = event.pointerType === 'mouse' ? 'mouse' : 'touch';
    this.pointerSides.set(event.pointerId, this.sideOf(event.clientX));
    try {
      this.surface.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nice-to-have; steering still works without it.
    }
  }

  onPointerMove(event) {
    if (!this.pointerSides.has(event.pointerId)) return;
    // Sliding a finger across the middle switches steering direction.
    this.pointerSides.set(event.pointerId, this.sideOf(event.clientX));
  }

  onPointerEnd(event) {
    if (!this.pointerSides.has(event.pointerId)) return;
    this.pointerSides.delete(event.pointerId);
    this.releaseCapture(event.pointerId);
  }

  sideOf(clientX) {
    const rect = this.surface.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2 ? -1 : 1;
  }

  releaseCapture(pointerId) {
    try {
      if (this.surface.hasPointerCapture(pointerId)) this.surface.releasePointerCapture(pointerId);
    } catch {
      // Pointer already gone.
    }
  }

  anyKeyHeld(keys) {
    for (const code of keys) {
      if (this.heldKeys.has(code)) return true;
    }
    return false;
  }

  isPointerHeld(side) {
    for (const pointerSide of this.pointerSides.values()) {
      if (pointerSide === side) return true;
    }
    return false;
  }

  readGamepad() {
    const result = { left: false, right: false, pausePressed: false, powerPressed: false };
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads || []).find((candidate) => candidate && candidate.connected);
    if (!pad) {
      this.padWasPressed.start = false;
      this.padWasPressed.primary = false;
      return result;
    }

    const pressed = (index) => Boolean(pad.buttons[index] && pad.buttons[index].pressed);
    const stickX = pad.axes[0] || 0;
    result.left = pressed(PAD_BUTTON.dpadLeft) || stickX < -INPUT.gamepadDeadZone;
    result.right = pressed(PAD_BUTTON.dpadRight) || stickX > INPUT.gamepadDeadZone;

    // Buttons fire once per press, not every frame while held.
    const start = pressed(PAD_BUTTON.start);
    const primary = pressed(PAD_BUTTON.primary);
    result.pausePressed = start && !this.padWasPressed.start;
    result.powerPressed = primary && !this.padWasPressed.primary;
    this.padWasPressed.start = start;
    this.padWasPressed.primary = primary;

    if (result.left || result.right || start || primary) this.lastDevice = 'gamepad';
    return result;
  }
}
