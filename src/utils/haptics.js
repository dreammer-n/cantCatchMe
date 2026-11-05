// A buzz on phones that can vibrate, on a crash. Only on touch screens: a laptop has nothing to shake. Browsers that
// don't support it (iPhones, desktops) simply do nothing.
const touch = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;

export function vibrate(pattern) {
  if (!touch || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Not allowed here: no buzz.
  }
}
