/**
 * supabaseClient.js
 *
 * Initialises the Supabase JS client from runtime config injected by
 * scripts/generate-config.js at build time. All other modules import
 * `supabase` from here — there is exactly one client instance.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'worddrop_session',
  },
});
