<script lang="ts">
  /**
   * Sign in. One user, so there is no signup: the account is created once in
   * the Supabase dashboard (Authentication -> Users -> Add user, with "Auto
   * Confirm User" ticked so no email is involved).
   *
   * Password and not a magic link — see the note in session.svelte.ts for why
   * that changed.
   *
   * On success the session lands in localStorage and refreshes itself, so this
   * screen is seen once and then not again until a sign out or a cleared
   * browser.
   *
   * On the layout, which was three nested rectangles.
   *
   * The hero sat in its own card, the form sat in a second card, and each field
   * carried the global `input` border on top of that — so the screen was a box
   * inside a box inside a box, with the actual content being two hollow
   * outlines you were meant to type into. `.flex` removed the background and
   * the radius but not the border, which is the whole bug in one line.
   *
   * A settings-style field does not need a box. The row already has a hairline
   * under it and a label at its left edge; that is enough to say "type here",
   * and it is what every iOS form does. Focus highlights the ROW rather than
   * ringing an input that is no longer visible.
   */
  import { session } from '../lib/session.svelte'

  let email = $state('')
  let password = $state('')
  let busy = $state(false)
  let error = $state<string | null>(null)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    error = null
    try {
      await session.signIn(email, password)
      // No navigation here: the auth listener flips `session.current`, and the
      // app shell swaps this screen out on its own.
    } catch (err) {
      error = (err as Error).message
      password = ''
    } finally {
      busy = false
    }
  }
</script>

<div class="screen">
  <!-- No card. The title is the screen's anchor, not a panel — and no second
       stamp mark, because the letterhead above already prints the one the pad
       owns. -->
  <div class="hero">
    <h1 class="hero-title">Masuk ke DUO</h1>
    <p class="hero-sub">Split the bill. Not the friendship.</p>
  </div>

  <form class="form" onsubmit={submit}>
    <div class="group">
      <div class="list">
        <label class="row field">
          <span class="key">Email</span>
          <input
            class="flex"
            type="email"
            required
            autocomplete="username"
            placeholder="email@contoh.com"
            bind:value={email}
            disabled={busy}
          />
        </label>
        <label class="row field">
          <span class="key">Password</span>
          <input
            class="flex"
            type="password"
            required
            autocomplete="current-password"
            placeholder="••••••••"
            bind:value={password}
            disabled={busy}
          />
        </label>
      </div>
    </div>

    {#if error}
      <div class="group">
        <div class="list tint-bad">
          <div class="row error-row">
            <span class="error">{error}</span>
            <span class="error-hint">
              Kalau salah password, reset-nya dari Supabase dashboard: Authentication → Users.
            </span>
          </div>
        </div>
      </div>
    {/if}

    <div class="group submit">
      <button class="primary" type="submit" disabled={busy || !email.trim() || !password}>
        {busy ? 'Masuk…' : 'Masuk'}
      </button>
    </div>
  </form>
</div>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
  }

  /* The gaps live here, not only on .screen. The form is a single child of
     .screen, so .screen's gap never applied between the form's own children —
     which put the error card flush against the field card, zero pixels apart. */
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 44px 32px 16px;
    text-align: center;
  }

  .hero-title {
    font-size: var(--text-xl);
    font-weight: 750;
    letter-spacing: -0.02em;
  }

  .hero-sub {
    max-width: 36ch;
    font-size: var(--text-sm);
    color: var(--ink-2);
  }

  /* The label column and the field on one row, which is how a settings form is
     laid out. */
  .key {
    width: 88px;
    flex-shrink: 0;
    color: var(--ink);
    font-size: var(--text-base);
  }

  /*
   * A field with no chrome of its own.
   *
   * `border: none` is the line that matters. Without it the global `input`
   * rule draws its rounded outline here, inside a card that already has one.
   */
  .flex {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    box-shadow: none;
    padding: 0;
    min-height: auto;
    text-align: right;
    border-radius: 0;
  }

  .flex:focus {
    outline: none;
    /* The global focus ring would draw an orange halo around a box that is no
       longer there. The row highlights instead — see .field:focus-within. */
    box-shadow: none;
  }

  .flex::placeholder {
    color: var(--ink-3);
  }

  .field {
    transition: background 0.15s ease;
  }

  .field:focus-within {
    background: var(--sheet-2);
  }

  .error-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .error-hint {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
</style>
