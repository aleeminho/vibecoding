<script lang="ts">
  /**
   * Sign up. Open to everyone — no invite code.
   *
   * The account is made by Supabase's own `signUp` (see session.svelte.ts);
   * this screen only collects the two fields and shows what the server
   * answers. Registration works because the dashboard keeps "Allow new users
   * to sign up" on and "Confirm email" off — nothing in code gates it.
   *
   * On success the session arrives with the response and the shell swaps this
   * screen out; the hash moves to Tagihan so the signed-in route table has a
   * case for it.
   *
   * Layout mirrors SignIn — same rows, same field rules, same eye toggle — so
   * the two doors of the same house do not look like two different houses.
   */
  import { session } from '../lib/session.svelte'

  let email = $state('')
  let password = $state('')
  let show = $state(false)
  let busy = $state(false)
  let error = $state<string | null>(null)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    error = null
    try {
      await session.signUp(email, password)
      location.hash = '#/bills'
    } catch (err) {
      error = (err as Error).message
      password = ''
    } finally {
      busy = false
    }
  }
</script>

<div class="screen">
  <div class="hero">
    <h1 class="hero-title">Daftar ke DUO</h1>
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
        <div class="row field">
          <label class="key" for="password">Password</label>
          <input
            id="password"
            class="flex"
            type={show ? 'text' : 'password'}
            required
            minlength="6"
            autocomplete="new-password"
            placeholder="minimal 6 karakter"
            bind:value={password}
            disabled={busy}
          />
          <!-- Same eye as SignIn: bare glyph, swaps open/slashed, 44px target. -->
          <button
            type="button"
            class="reveal"
            aria-pressed={show}
            aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}
            disabled={busy}
            onclick={() => (show = !show)}
          >
            {#if show}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 4l16 16" />
                <path d="M9.9 5.7A9.9 9.9 0 0 1 12 5.5c5.5 0 9.5 6.5 9.5 6.5a17.4 17.4 0 0 1-3 3.7M6.1 6.7A17.4 17.4 0 0 0 2.5 12S6.5 18.5 12 18.5a9.8 9.8 0 0 0 4.9-1.3" />
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2.5 12S6.5 5.5 12 5.5 21.5 12 21.5 12 17.5 18.5 12 18.5 2.5 12 2.5 12Z" />
                <circle cx="12" cy="12" r="3.2" />
              </svg>
            {/if}
          </button>
        </div>
      </div>
    </div>

    {#if error}
      <div class="group">
        <div class="list tint-bad">
          <div class="row error-row">
            <span class="error">{error}</span>
          </div>
        </div>
      </div>
    {/if}

    <div class="group submit">
      <button class="primary" type="submit" disabled={busy || !email.trim() || !password}>
        {busy ? 'Mendaftar…' : 'Daftar'}
      </button>
    </div>

    <div class="group signup-link">
      <button class="link" onclick={() => (location.hash = '#/bills')}>
        Sudah punya akun? Masuk
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

  .key {
    width: 88px;
    flex-shrink: 0;
    color: var(--ink);
    font-size: var(--text-base);
  }

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

  .reveal {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin: -10px -14px -10px 0;
    padding: 0;
    border: none;
    background: none;
    border-radius: 0;
    color: var(--ink-3);
  }

  .reveal:active:not(:disabled) {
    transform: none;
    color: var(--ink);
  }

  .reveal svg {
    width: 20px;
    height: 20px;
  }

  .error-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .signup-link {
    align-items: center;
  }

  .link {
    border: none;
    background: none;
    color: var(--ink-2);
    font-size: var(--text-sm);
    font-weight: 620;
  }

  .link:active:not(:disabled) {
    transform: none;
    color: var(--ink);
  }
</style>
