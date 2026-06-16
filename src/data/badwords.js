// Curated list of words that must not appear in any direction on a generated grid.
// Checked as uppercase strings. Keep this list specific — broad lists cause
// excessive retries and reject grids unfairly.
export const BADWORDS = new Set([
  // slurs and slurs variants (abbreviated here for source safety; expand as needed)
  'FUCK', 'SHIT', 'CUNT', 'COCK', 'DICK', 'PISS', 'PRICK', 'TWAT',
  'ARSE', 'FECK', 'DAMN', 'HELL', 'CRAP', 'SLAG', 'SLUT', 'WHORE',
  'RAPE', 'KILL', 'BOMB', 'NAZI', 'HATE',
]);
