/**
 * streakManager.js
 *
 * Reads and updates per-user streak + high-score data in the `users` table.
 * Requires four columns added via the SQL migration:
 *   high_score, current_streak, longest_streak, last_played_date
 *
 * Streak rules:
 *   - Same day as last_played_date → streak unchanged (already counted today)
 *   - Yesterday's date              → streak increments
 *   - Any older / null              → streak resets to 1 (first play or missed a day)
 * longest_streak is updated whenever current_streak exceeds it.
 */

import { supabase } from './supabaseClient.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function yesterdayISO() {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

export const streakManager = {
  /**
   * Reads current streak + high score for a user.
   * @param {string} userId — UUID from public.users.id
   * @returns {Promise<{ highScore, currentStreak, longestStreak, lastPlayedDate }>}
   */
  async fetchStats(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('high_score, current_streak, longest_streak, last_played_date')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return {
      highScore:      data.high_score      ?? 0,
      currentStreak:  data.current_streak  ?? 0,
      longestStreak:  data.longest_streak  ?? 0,
      lastPlayedDate: data.last_played_date ?? null,
    };
  },

  /**
   * Called once per game completion (registered users only).
   * Updates streak and high score atomically.
   *
   * @param {string} userId — UUID from public.users.id
   * @param {number} score  — final game score
   * @returns {Promise<{
   *   streak: number,
   *   longest: number,
   *   highScore: number,
   *   isNewHighScore: boolean,
   *   isNewDay: boolean,
   * }>}
   */
  async updateAfterGame(userId, score) {
    const { data, error } = await supabase
      .from('users')
      .select('high_score, current_streak, longest_streak, last_played_date')
      .eq('id', userId)
      .single();
    if (error) throw error;

    const today     = todayISO();
    const yesterday = yesterdayISO();
    const lastPlayed = data.last_played_date;

    const isNewDay = lastPlayed !== today;
    let newStreak  = data.current_streak ?? 0;

    if (isNewDay) {
      if (lastPlayed === yesterday) {
        newStreak = newStreak + 1;          // continuing the streak
      } else {
        newStreak = 1;                      // first play ever, or missed a day
      }
    }

    const prevHighScore  = data.high_score ?? 0;
    const newLongest     = Math.max(data.longest_streak ?? 0, newStreak);
    const newHighScore   = Math.max(prevHighScore, score);

    const { error: updateErr } = await supabase
      .from('users')
      .update({
        current_streak:   newStreak,
        longest_streak:   newLongest,
        high_score:       newHighScore,
        last_played_date: today,
      })
      .eq('id', userId);

    if (updateErr) throw updateErr;

    return {
      streak:         newStreak,
      longest:        newLongest,
      highScore:      newHighScore,
      isNewHighScore: newHighScore > prevHighScore,
      isNewDay,
    };
  },
};
