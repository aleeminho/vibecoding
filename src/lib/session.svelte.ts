/**
 * The operator's session.
 *
 * Auth exists here for a reason that is easy to miss: every table has row level
 * security keyed on `auth.uid()`. Without a signed-in user, every read returns
 * nothing and `commit_bill` raises 'not authenticated'. So this is not a login
 * screen bolted on for show, it is what makes the data layer work at all.
 *
 * PASSWORD, NOT A MAGIC LINK. An earlier version of this used email magic
 * links, and it was the wrong call for this app. Three reasons, all of which
 * showed up in practice:
 *
 *   1. Supabase's built-in mailer is capped at a handful of emails per hour and
 *      that cap cannot be raised. Repeated link requests hit it immediately.
 *   2. The redirect URL has to be allowlisted, and Supabase falls back SILENTLY
 *      to the site URL when it is not. On a phone that means a link pointing at
 *      localhost, with no error explaining why.
 *   3. The app is used at a restaurant table with a waiter waiting. Waiting for
 *      an email is the wrong shape for that moment.
 *
 * A password removes the mailer and the redirect from the flow entirely.
 *
 * Staying signed in is Supabase's default, not something added here: the
 * session lives in localStorage and the refresh token rotates on its own. The
 * one caveat is iOS, which can evict storage for a plain Safari tab that goes
 * unvisited for a week — installing to the home screen avoids that.
 */

import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './supabase'

class SessionStore {
  /** Null until we know either way, which is why `ready` is separate. */
  current = $state<Session | null>(null)
  ready = $state(false)

  async init(): Promise<void> {
    if (!supabaseConfigured) {
      this.ready = true
      return
    }

    // Restores the persisted session, which is what makes the app stay signed
    // in across launches.
    const { data } = await supabase.auth.getSession()
    this.current = data.session
    this.ready = true

    supabase.auth.onAuthStateChange((_event, session) => {
      this.current = session
    })
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) throw new Error(error.message)
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut()
  }

  get email(): string | null {
    return this.current?.user.email ?? null
  }
}

export const session = new SessionStore()
