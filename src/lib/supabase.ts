/**
 * Supabase client. See split_bill_app_spec.md section 12.
 *
 * There is no ORM here on purpose, and the reason is not preference: an ORM
 * needs a direct Postgres connection, which needs a connection string, which
 * needs the database password. That can only live on a server. This runs in a
 * browser, so the data layer is PostgREST (this client) plus RPC for anything
 * that writes. When a query stops being trivial, put it in a view or an RPC
 * rather than reaching for a query builder.
 */

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/**
 * The publishable key is designed to be public: it ships in the client bundle
 * and that is fine, because row level security is what protects the data, not
 * the secrecy of this value. The secret / service_role key bypasses RLS
 * entirely and must never appear in this project. Nothing in this architecture
 * needs it.
 */
export const supabaseConfigured = Boolean(url && publishableKey)

export const supabase = supabaseConfigured
  ? createClient(url!, publishableKey!)
  : // Not a real client. Lets the app render a "configure your env" screen
    // instead of crashing on a blank page during first setup.
    createClient('http://localhost:54321', 'public-anon-key')

// Once the Supabase project exists, generate types and thread them through:
//
//   bun run db:types
//
// then change the line above to:
//
//   createClient<Database>(url!, publishableKey!)
//
// with `import type { Database } from './database.types'`. Generating them
// from the live schema is better than maintaining a hand written copy,
// because a generated file cannot drift from the database.
