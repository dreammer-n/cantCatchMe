// A chunky block alphabet for the word statues. Each letter is a few rectangular bars
// [x0, z0, x1, z1] on a grid five units tall; bars never overlap. Only the letters the words in
// WORLD.landmarks need. Pure data, shared by the models (propModels.js) and the layout (WorldLayout.js).
const STEM = [0, 0, 1, 5];
const GLYPHS = {
  A: [STEM, [2, 0, 3, 5], [1, 4, 2, 5], [1, 2, 2, 3]],
  D: [STEM, [1, 4, 2, 5], [1, 0, 2, 1], [2, 1, 3, 4]],
  E: [STEM, [1, 4, 3, 5], [1, 2, 2.6, 3], [1, 0, 3, 1]],
  G: [STEM, [1, 4, 3, 5], [1, 0, 3, 1], [2, 1, 3, 3], [1.5, 2, 2, 3]],
  H: [STEM, [2, 0, 3, 5], [1, 2, 2, 3]],
  I: [[1, 0, 2, 5], [0, 4, 1, 5], [2, 4, 3, 5], [0, 0, 1, 1], [2, 0, 3, 1]],
  K: [STEM, [1, 2, 2, 3], [2, 3, 3, 5], [2, 0, 3, 2]],
  L: [STEM, [1, 0, 3, 1]],
  M: [STEM, [4, 0, 5, 5], [1, 4, 2, 5], [2, 3, 3, 4], [3, 4, 4, 5]],
  N: [STEM, [3, 0, 4, 5], [1, 3, 2, 4], [2, 2, 3, 3]],
  O: [STEM, [2, 0, 3, 5], [1, 4, 2, 5], [1, 0, 2, 1]],
  P: [STEM, [1, 4, 2, 5], [1, 2, 2, 3], [2, 2, 3, 5]],
  R: [STEM, [1, 4, 2, 5], [1, 2, 2, 3], [2, 3, 3, 5], [2, 0, 3, 2]],
  S: [[0, 4, 3, 5], [0, 2, 1, 4], [1, 2, 3, 3], [2, 0, 3, 2], [0, 0, 2, 1]],
  T: [[0, 4, 3, 5], [1, 0, 2, 4]],
};

export function glyphBars(letter) {
  return GLYPHS[letter];
}

// Width of a letter in grid units.
export function glyphWidth(letter) {
  return Math.max(...GLYPHS[letter].map((bar) => bar[2]));
}
