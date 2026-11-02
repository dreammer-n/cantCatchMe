// The game's own lettering: thick, angular capitals with cut corners, drawn in code as strokes. No font file
// to download, and the same on every device, which a system font can't promise.
//
// Each glyph is a path on a grid 6 tall, and as wide as it says. A piece of text is one small SVG per letter,
// so changing a digit on the clock only swaps that digit. The plain text stays in the page, hidden, for
// screen readers.

const HEIGHT = 6;
const STROKE = 1.75;
const PAD = STROKE / 2; // the stroke goes this far past the grid, on every side
const SHADE = 0.7; // how far under each letter its dark copy sits
const NS = 'http://www.w3.org/2000/svg';

export const GLYPHS = {
  A: [4, 'M0 6V1L1 0H3L4 1V6M0 3.6H4'],
  B: [4, 'M0 0H3L4 1V2L3 3L4 4V5L3 6H0ZM0 3H3'],
  C: [4, 'M4 0H1L0 1V5L1 6H4'],
  D: [4, 'M0 0H3L4 1V5L3 6H0Z'],
  E: [4, 'M4 0H0V6H4M0 3H3.2'],
  F: [4, 'M4 0H0V6M0 3H3.2'],
  G: [4, 'M4 0H1L0 1V5L1 6H4V3.2H2'],
  H: [4, 'M0 0V6M4 0V6M0 3H4'],
  I: [1, 'M.5 0V6'],
  J: [4, 'M4 0V5L3 6H1L0 5'],
  K: [4, 'M0 0V6M4 0L1.4 3L4 6M0 3H1.4'],
  L: [4, 'M0 0V6H4'],
  M: [5, 'M0 6V0L2.5 3.2L5 0V6'],
  N: [4, 'M0 6V0L4 6V0'],
  O: [4, 'M1 0H3L4 1V5L3 6H1L0 5V1Z'],
  P: [4, 'M0 6V0H3L4 1V2.4L3 3.4H0'],
  Q: [4, 'M1 0H3L4 1V5L3 6H1L0 5V1ZM2.4 4.2L4 6'],
  R: [4, 'M0 6V0H3L4 1V2.4L3 3.4H0M2.2 3.4L4 6'],
  S: [4, 'M4 0H1L0 1V2L1 3H3L4 4V5L3 6H0'],
  T: [4, 'M0 0H4M2 0V6'],
  U: [4, 'M0 0V5L1 6H3L4 5V0'],
  V: [4, 'M0 0L2 6L4 0'],
  W: [5, 'M0 0L1.25 6L2.5 2L3.75 6L5 0'],
  X: [4, 'M0 0L4 6M4 0L0 6'],
  Y: [4, 'M0 0L2 3L4 0M2 3V6'],
  Z: [4, 'M0 0H4L0 6H4'],
  0: [4, 'M1 0H3L4 1V5L3 6H1L0 5V1Z'],
  1: [2.4, 'M0 1.3L1.7 0V6'],
  2: [4, 'M0 1L1 0H3L4 1V2.4L0 6H4'],
  3: [4, 'M0 0H4L2.2 2.6H3L4 3.6V5L3 6H0'],
  4: [4, 'M3 6V0L0 4H4'],
  5: [4, 'M4 0H0V2.8H3L4 3.8V5L3 6H0'],
  6: [4, 'M4 0H1L0 1V5L1 6H3L4 5V3.8L3 2.8H0'],
  7: [4, 'M0 0H4L1.4 6'],
  8: [4, 'M1 0H3L4 1V2L3 3L4 4V5L3 6H1L0 5V4L1 3L0 2V1ZM1 3H3'],
  9: [4, 'M0 6H3L4 5V1L3 0H1L0 1V2.2L1 3.2H4'],
  '.': [1, 'M.5 5.6V6'],
  ',': [1, 'M.7 5.6V6L.2 7'],
  ':': [1, 'M.5 1V1.3M.5 4.7V5'],
  '!': [1, 'M.5 0V3.1M.5 5.6V6'],
  '?': [4, 'M0 1L1 0H3L4 1V2L2 3.1V3.3M2 5.6V6'],
  "'": [1, 'M.5 0V1.6'],
  '-': [2.4, 'M0 3.2H2.4'],
  '+': [3, 'M0 3.2H3M1.5 1.7V4.7'],
  '/': [3, 'M3 0L0 6'],
  '<': [3, 'M3 .6L0 3L3 5.4'],
  '>': [3, 'M0 .6L3 3L0 5.4'],
  '(': [1.6, 'M1.6 0L.4 1.5V4.5L1.6 6'],
  ')': [1.6, 'M0 0L1.2 1.5V4.5L0 6'],
  '·': [1, 'M.5 3V3.2'],
  '×': [3, 'M0 1.8L3 4.8M3 1.8L0 4.8'],
  '✓': [4, 'M0 3.2L1.6 5L4 1'],
};

let defsReady = false;

// Whether every character of a text can be drawn.
export function canDisplay(text) {
  return [...String(text).toUpperCase()].every((char) => char === ' ' || GLYPHS[char]);
}

function ensureDefs() {
  if (defsReady) return;
  defsReady = true;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  const defs = document.createElementNS(NS, 'defs');
  for (const [char, [, d]] of Object.entries(GLYPHS)) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('id', glyphId(char));
    path.setAttribute('d', d);
    defs.append(path);
  }
  svg.append(defs);
  document.body.append(svg);
}

function glyphId(char) {
  return `dg-${char.charCodeAt(0)}`;
}

function shapeGlyph(svg, char) {
  const [width] = GLYPHS[char] || GLYPHS['-'];
  const href = GLYPHS[char] ? `#${glyphId(char)}` : '';
  svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${width + PAD * 2} ${HEIGHT + PAD * 2}`);
  svg.style.width = `${(width + PAD * 2) / (HEIGHT + PAD * 2)}em`;
  for (const part of svg.children) part.setAttribute('href', href);
}

function makeGlyph(char) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'dg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('stroke-width', STROKE);
  const shade = document.createElementNS(NS, 'use');
  shade.setAttribute('class', 'dg-shade');
  shade.setAttribute('transform', `translate(0 ${SHADE})`);
  svg.append(shade, document.createElementNS(NS, 'use'));
  shapeGlyph(svg, char);
  return svg;
}

function build(node, value) {
  const words = value.split(' ');
  node.dtGlyphs = [];
  const parts = [node.dtLabel];
  for (const word of words) {
    const span = document.createElement('span');
    span.className = 'dt-word';
    for (const char of word) {
      const glyph = makeGlyph(char);
      span.append(glyph);
      node.dtGlyphs.push(glyph);
    }
    parts.push(span);
  }
  node.replaceChildren(...parts);
}

// Sets the text of a node made by dt(). Cheap when only a few letters have changed.
export function setDisplay(node, text) {
  const value = String(text).toUpperCase();
  const old = node.dtValue;
  if (old === value) return;
  node.dtValue = value;
  node.dtLabel.textContent = value;
  if (old === undefined || old.length !== value.length || old.split(' ').length !== value.split(' ').length || old.indexOf(' ') !== value.indexOf(' ')) {
    build(node, value);
    return;
  }
  let g = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === ' ') continue;
    if (value[i] !== old[i]) shapeGlyph(node.dtGlyphs[g], value[i]);
    g += 1;
  }
}

// A piece of text in the game's lettering.
export function dt(className, text = '') {
  ensureDefs();
  const node = document.createElement('span');
  node.className = className ? `dt ${className}` : 'dt';
  node.dtLabel = document.createElement('span');
  node.dtLabel.className = 'dt-label';
  node.append(node.dtLabel);
  setDisplay(node, text);
  return node;
}
