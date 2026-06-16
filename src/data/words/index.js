import animals from './animals.js';
import countries from './countries.js';
import names from './names.js';
import general from './general.js';
import foodDrinks from './foodDrinks.js';
import sports from './sports.js';
import cities from './cities.js';

// Registry of all categories. Add a new entry here + a new word file to extend.
export const CATEGORIES = [
  { id: 'animals',   label: 'Animals',       words: animals   },
  { id: 'countries', label: 'Countries',      words: countries },
  { id: 'names',     label: 'Names',          words: names     },
  { id: 'general',   label: 'General',        words: general   },
  { id: 'food',      label: 'Food & Drinks',  words: foodDrinks },
  { id: 'sports',    label: 'Sports',         words: sports    },
  { id: 'cities',    label: 'Cities',         words: cities    },
];

/** Returns a deduped, uppercase word array for the given category id. */
export function getWords(categoryId) {
  const cat = CATEGORIES.find(c => c.id === categoryId);
  if (!cat) throw new Error(`Unknown category: ${categoryId}`);
  return [...new Set(cat.words.map(w => w.toUpperCase()))];
}

export const CATEGORY_IDS = CATEGORIES.map(c => c.id);
