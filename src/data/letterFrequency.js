// Standard English corpus letter frequencies (percentage basis).
// HARD_LETTER_WEIGHTS skews toward consonant clusters that nearly form words
// — more vowel-lean tiles, higher R/S/T noise — to bait wrong guesses.

export const LETTER_WEIGHTS = {
  E: 12.7, T: 9.1, A: 8.2, O: 7.5, I: 7.0, N: 6.7,
  S: 6.3,  H: 6.1, R: 6.0, D: 4.3, L: 4.0, C: 2.8,
  U: 2.8,  M: 2.4, W: 2.4, F: 2.2, G: 2.0, Y: 2.0,
  P: 1.9,  B: 1.5, V: 1.0, K: 0.8, J: 0.2, X: 0.2,
  Q: 0.1,  Z: 0.1,
};

export const HARD_LETTER_WEIGHTS = {
  E: 7.0,  T: 10.5, A: 6.0,  O: 5.5,  I: 5.0,  N: 8.0,
  S: 9.0,  H: 7.5,  R: 8.5,  D: 5.5,  L: 5.5,  C: 4.0,
  U: 2.0,  M: 3.0,  W: 3.0,  F: 3.0,  G: 3.0,  Y: 2.5,
  P: 2.5,  B: 2.0,  V: 1.5,  K: 1.5,  J: 0.3,  X: 0.3,
  Q: 0.1,  Z: 0.1,
};
