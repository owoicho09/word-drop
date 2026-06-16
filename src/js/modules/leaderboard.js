/**
 * leaderboard.js — score submission and per-session leaderboard reads.
 */

import { supabase } from './supabaseClient.js';

export const leaderboard = {
  /**
   * Submits a score for a registered player.
   * Guests never call this.
   *
   * @param {{ sessionId, userId, displayName, score, wordsFound, timeTaken }} params
   */
  async submitScore({ sessionId, userId, displayName, score, wordsFound, timeTaken }) {
    const { error } = await supabase.from('scores').insert({
      session_id:   sessionId,
      user_id:      userId,
      display_name: displayName,
      score,
      words_found:  wordsFound,
      time_taken:   timeTaken,
    });
    if (error) throw error;
  },

  /**
   * Fetches top scores for a session, sorted by score descending.
   *
   * @param {string} sessionId
   * @param {number} [limit=10]
   * @returns {Promise<Array<{ display_name, score, words_found, time_taken }>>}
   */
  async fetchForSession(sessionId, limit = 10) {
    const { data, error } = await supabase
      .from('scores')
      .select('display_name, score, words_found, time_taken')
      .eq('session_id', sessionId)
      .order('score', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
  },
};
