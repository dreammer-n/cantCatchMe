import { DISPLAY } from '../config/tuning.js';

export function getPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, DISPLAY.maxPixelRatio);
}

let safeAreaProbe = null;

// Safe areas are the parts of the screen not covered by notches, rounded corners or home bars.
// CSS exposes them through env(); a hidden element lets us read them as pixel numbers.
export function getSafeAreaInsets() {
  if (!safeAreaProbe) {
    safeAreaProbe = document.createElement('div');
    safeAreaProbe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) ' +
      'env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
    document.body.appendChild(safeAreaProbe);
  }
  const style = getComputedStyle(safeAreaProbe);
  return {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
}
