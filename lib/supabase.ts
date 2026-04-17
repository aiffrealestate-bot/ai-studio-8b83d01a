import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_URL');
}
if (!supabaseServiceRoleKey) {
  throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
}
if (!supabaseAnonKey) {
  throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

/**
 * Server-side Supabase client using the service role key.
 * This client bypasses Row Level Security — use ONLY in trusted server contexts.
 * Never expose this client or the service role key to the browser.
 */
let serverClientInstance: SupabaseClient | null = null;

export function getServerSupabaseClient(): SupabaseClient {
  if (!serverClientInstance) {
    serverClientInstance = createClient(supabaseUrl!, supabaseServiceRoleKey!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return serverClientInstance;
}

/**
 * Public Supabase client using the anon key.
 * Respects Row Level Security policies.
 * Safe to use for public-facing inserts where RLS is configured.
 */
let publicClientInstance: SupabaseClient | null = null;

export function getPublicSupabaseClient(): SupabaseClient {
  if (!publicClientInstance) {
    publicClientInstance = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return publicClientInstance;
}

/**
 * Default export: public client for general use.
 */
export const supabase = getPublicSupabaseClient();
