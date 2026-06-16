/**
 * sessionManager.js
 *
 * Supabase CRUD for game sessions.
 * Sessions expire server-side after 3 hours (expires_at column);
 * this module enforces the TTL client-side too so we don't render stale data.
 */

import { supabase } from './supabaseClient.js';

/** Generates a short, URL-safe session ID (8 lowercase alphanumeric chars). */
function makeSessionId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

export const sessionManager = {
  /**
   * Persists a newly generated grid to Supabase and returns the session ID.
   * Called only for registered players (guests never write sessions).
   *
   * @param {{ grid, hiddenWords, category, difficulty, seed }} params
   * @returns {Promise<string>} The session_id used in shareable links.
   */
  async createSession({ grid, hiddenWords, category, difficulty, seed }) {
    const session_id = makeSessionId();
    const { error } = await supabase.from('sessions').insert({
      session_id,
      grid,
      hidden_words: hiddenWords,
      category,
      difficulty,
      seed,
    });
    if (error) throw error;
    return session_id;
  },

  /**
   * Fetches a session by ID. Returns null if not found or expired.
   *
   * @param {string} sessionId
   * @returns {Promise<object|null>}
   */
  async fetchSession(sessionId) {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (error || !data) return null;
    if (new Date(data.expires_at) < new Date()) return null; // client-side TTL guard
    return data;
  },
};
