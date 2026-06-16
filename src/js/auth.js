/**
 * auth.js — registration, session management, and current-user lookup.
 *
 * Registration uses email + a browser-generated random password.
 * Email confirmation must be DISABLED in the Supabase dashboard so the
 * account activates immediately. The Supabase session is auto-persisted
 * in localStorage (key: worddrop_session) and refreshed silently.
 */

import { supabase } from './modules/supabaseClient.js';

export const auth = {
  /**
   * Creates a new Supabase Auth account and inserts a users row.
   * Throws if the email is already registered or the display name is taken.
   *
   * @param {{ email: string, displayName: string }}
   * @returns {Promise<{ id, email, display_name }>} The new users row.
   */
  async register({ email, displayName }) {
    // Check display name uniqueness before touching auth
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .ilike('display_name', displayName.trim())
      .maybeSingle();

    if (existing) {
      throw new Error('That display name is already taken. Try another or auto-generate one.');
    }

    // Generate a strong random password — not given to the user since we
    // rely on the persisted Supabase session for re-authentication.
    const password = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('Sign-up failed. Please try again.');

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .insert({
        auth_id:      authData.user.id,
        email:        email.trim().toLowerCase(),
        display_name: displayName.trim(),
      })
      .select()
      .single();

    if (userError) throw userError;

    // Fire-and-forget: welcome email to user + owner notification.
    // Never let email failure block registration.
    fetch('/api/send-email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action:      'welcome',
        email:       userRow.email,
        displayName: userRow.display_name,
      }),
    }).then(async res => {
      if (!res.ok) console.error('[WordDrop] send-email (welcome) failed:', res.status, await res.text());
    }).catch(err => console.error('[WordDrop] send-email (welcome) request failed:', err));

    return userRow;
  },

  /**
   * Returns the current user's row from the users table, or null if not
   * signed in. Also returns null for anonymous sessions.
   *
   * @returns {Promise<object|null>}
   */
  async getCurrentUser() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;

    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', session.user.id)
      .maybeSingle();

    return data ?? null;
  },

  async signOut() {
    await supabase.auth.signOut();
  },
};
