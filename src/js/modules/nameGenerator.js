/**
 * nameGenerator.js
 *
 * Produces readable display names in the form "AdjectiveNoun" (e.g. "BraveEagle").
 * Checks Supabase for uniqueness before returning; appends a short random suffix
 * after MAX_ATTEMPTS clean combos fail.
 */

import { supabase } from './supabaseClient.js';

const ADJECTIVES = [
  'Agile', 'Amber', 'Astute', 'Brave', 'Bright', 'Brisk', 'Calm', 'Clever',
  'Crisp', 'Daring', 'Deft', 'Dense', 'Eager', 'Ebony', 'Elite', 'Fierce',
  'Fiery', 'Firm', 'Fleet', 'Fluid', 'Frosty', 'Gilded', 'Glad', 'Grand',
  'Grave', 'Gritty', 'Hardy', 'Hasty', 'Honed', 'Icy', 'Inky', 'Jade',
  'Jolly', 'Keen', 'Kind', 'Lively', 'Lone', 'Lucky', 'Lunar', 'Mighty',
  'Nimble', 'Noble', 'Neon', 'Obsid', 'Oaken', 'Prism', 'Prime', 'Pure',
  'Quick', 'Quiet', 'Rapid', 'Ready', 'Regal', 'Rosy', 'Rustic', 'Sable',
  'Savvy', 'Scarlet', 'Serene', 'Sharp', 'Silver', 'Sleek', 'Slick', 'Smart',
  'Solar', 'Sonic', 'Spry', 'Stark', 'Steady', 'Steel', 'Stern', 'Stout',
  'Sunny', 'Super', 'Supra', 'Swift', 'Teal', 'Terse', 'Tidy', 'Turbo',
  'Vivid', 'Warm', 'Wild', 'Wily', 'Wise', 'Witty', 'Zappy', 'Zesty',
];

const NOUNS = [
  'Adder', 'Ant', 'Apex', 'Archer', 'Arrow', 'Ash', 'Atlas', 'Axe',
  'Bear', 'Blaze', 'Bolt', 'Cactus', 'Cedar', 'Cobra', 'Comet', 'Core',
  'Crane', 'Dash', 'Dawn', 'Drake', 'Drift', 'Dune', 'Eagle', 'Echo',
  'Falcon', 'Fang', 'Fern', 'Flame', 'Flash', 'Flux', 'Forge', 'Frost',
  'Gale', 'Gem', 'Ghost', 'Glyph', 'Hawk', 'Haze', 'Heron', 'Hive',
  'Jade', 'Knot', 'Lark', 'Leaf', 'Lion', 'Lodge', 'Lynx', 'Mace',
  'Mako', 'Maple', 'Mist', 'Mote', 'Nova', 'Oak', 'Onyx', 'Orbit',
  'Otter', 'Panda', 'Peak', 'Petal', 'Pike', 'Prism', 'Pulse', 'Raven',
  'Reef', 'Ridge', 'River', 'Rune', 'Rush', 'Saber', 'Sage', 'Scout',
  'Shard', 'Spark', 'Spire', 'Spray', 'Star', 'Stone', 'Storm', 'Surge',
  'Talon', 'Tiger', 'Torch', 'Trace', 'Trail', 'Trek', 'Tusk', 'Vane',
  'Viper', 'Volt', 'Wave', 'Wren', 'Wolf', 'Zinc', 'Zone', 'Zephyr',
];

const MAX_ATTEMPTS = 20;

async function isAvailable(name) {
  const { data } = await supabase
    .from('users')
    .select('id')
    .ilike('display_name', name)
    .maybeSingle();
  return data === null;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generates a unique display name and returns it.
 * The name is NOT reserved here — the caller must save it to the users table
 * immediately to avoid a race condition (acceptable for a casual game).
 *
 * @returns {Promise<string>}
 */
export async function generateUniqueName() {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const name = pick(ADJECTIVES) + pick(NOUNS);
    if (await isAvailable(name)) return name;
  }
  // All random combos taken — append a 3-digit suffix
  return pick(ADJECTIVES) + pick(NOUNS) + Math.floor(Math.random() * 900 + 100);
}
