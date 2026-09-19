<script lang="ts">
  /**
   * App shell. Deliberately no router library: there are four screens and a
   * hash router is a dozen lines. A dependency here would cost more than it
   * saves.
   *
   * The session gate is not decoration. Every table is behind row level
   * security keyed on auth.uid(), so an unauthenticated app shows empty lists
   * and refuses every commit. Signing in is what makes the data layer work.
   *
   * Two chromes for two scenes. On a phone the tabs are index tabs welded to
   * the bottom edge; on a wide screen the same four tabs move into a left
   * rail and the letterhead grows the operator and the sign-out. Both are flat
   * opaque bars ruled off with the stamp-orange 2px line; nothing is
   * translucent and nothing blurs.
   */
  import { onMount } from 'svelte'
  import { supabaseConfigured } from './lib/supabase'
  import { session } from './lib/session.svelte'
  import { notifications } from './lib/notifications.svelte'
  import { bundleByBill } from './lib/notify'
  import { isDemo } from './lib/demo'
  import { applyPhoneFrame } from './lib/frame'
  import SignIn from './routes/SignIn.svelte'
  import Bills from './routes/Bills.svelte'
  import Capture from './routes/Capture.svelte'
  import Review from './routes/Review.svelte'
  import Report from './routes/Report.svelte'
  import Settle from './routes/Settle.svelte'
  import Preview from './routes/Preview.svelte'
  import Nota from './routes/Nota.svelte'
  import Bayar from './routes/Bayar.svelte'
  import Notif from './routes/Notif.svelte'
  import Orang from './routes/Orang.svelte'

  type Route =
    | 'bills'
    | 'capture'
    | 'settle'
    | 'report'
    | 'review'
    | 'preview'
    | 'nota'
    | 'bayar'
    | 'notif'
    | 'orang'

  /** Routes that are a document rather than a screen: no chrome, white page. */
  const PAPER: Route[] = ['nota', 'bayar']

  /**
   * Tab icons as SVG source. Trusted constants, never user input — which is the
   * only reason `{@html}` is acceptable here.
   *
   * Drawn rather than imported: SF Symbols are licensed for Apple platform UIs
   * and cannot be shipped inside a web app.
   */
  const tabs: { id: Route; label: string; icon: string }[] = [
    {
      id: 'bills',
      label: 'Tagihan',
      icon: `<path d="M4 6h16M4 12h16M4 18h10" stroke-linecap="round"/>`,
    },
    {
      id: 'capture',
      label: 'Foto',
      icon: `<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2a1.5 1.5 0 0 0 1.25-.67l.6-.9A1.5 1.5 0 0 1 9.8 4.8h4.4a1.5 1.5 0 0 1 1.25.67l.6.9A1.5 1.5 0 0 0 17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.3"/>`,
    },
    {
      id: 'settle',
      label: 'Tagih',
      icon: `<path d="M4 8h12M13 5l3 3-3 3M20 16H8M11 13l-3 3 3 3" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
    {
      id: 'report',
      label: 'Report',
      icon: `<path d="M5 19V11M12 19V5M19 19v-5" stroke-linecap="round"/>`,
    },
  ]

  function parseHash(): Route {
    // The query part is stripped before matching. Without this, `#/preview?done`
    // is compared as the literal string "preview?done", matches nothing, and
    // silently falls back to the default route — which looks like the query
    // param was ignored rather than like a routing bug.
    const raw = location.hash.replace(/^#\/?/, '').split('?')[0]
    const known: Route[] = [
      'bills',
      'capture',
      'settle',
      'report',
      'review',
      'preview',
      'nota',
      'bayar',
      'notif',
      'orang',
    ]
    return known.includes(raw as Route) ? (raw as Route) : 'bills'
  }

  let route = $state<Route>(parseHash())

  $effect(() => {
    const onHash = () => (route = parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  })

  function go(id: Route) {
    location.hash = `#/${id}`
  }

  /**
   * Paint the page white on the document routes.
   *
   * The nota and the payment page leave the app — as a print, or as a
   * screenshot in a group chat — so they sit on the cleanest paper the world
   * has. Done here rather than inside those components because a `:global()`
   * rule in a component's style block is in the stylesheet for the whole
   * session the moment the component is bundled, which would take every other
   * screen with it.
   */
  $effect(() => {
    document.body.classList.toggle('paper', PAPER.includes(route))
    return () => document.body.classList.remove('paper')
  })

  /**
   * True when the URL asks for fixture data (see lib/demo.ts). Re-read whenever
   * the route changes, because the flag lives in the hash and the hash is not
   * reactive on its own.
   */
  let demo = $derived.by(() => {
    void route
    return import.meta.env.DEV && isDemo()
  })

  const TITLES: Record<Route, string> = {
    bills: 'Tagihan',
    capture: 'Foto Struk',
    settle: 'Yang Perlu Ditagih',
    report: 'Report',
    review: 'Bagi Rata',
    preview: 'Preview',
    nota: 'Nota',
    bayar: 'Bayar',
    notif: 'Notifikasi',
    orang: 'Orang',
  }

  onMount(() => {
    session.init()

    // Dev-only phone frame. The guard is written literally at the call site
    // rather than hidden behind a helper, because Vite substitutes
    // `import.meta.env.DEV` with `false` and then drops the branch — which only
    // works if the flag is visible to the bundler right here. Behind a call, it
    // cannot be eliminated, and the code ships to the phone.
    if (import.meta.env.DEV) applyPhoneFrame()
  })

  /**
   * Bills with something unread, not payments.
   *
   * The badge has to agree with the screen it opens: the feed's unit is the
   * invoice, so a bill three people paid is one thing to look at and lights one
   * count, not three.
   */
  let unreadBundles = $derived(bundleByBill(notifications.unread).length)

  /**
   * Keep the notification badge roughly current.
   *
   * Loaded when a session lands, on every return to the tab, and on a slow
   * interval while the tab stays visible. No realtime subscription and no
   * polling while hidden: the badge is a convenience, and a phone in a pocket
   * asking the database every minute is a cost with no reader.
   *
   * A failed refresh is swallowed on purpose — the feed we already have is
   * still true, and an error banner over the app because a background poll
   * missed is worse than a badge that is a minute stale.
   */
  $effect(() => {
    if (!session.current && !demo) return

    void notifications.load().catch(() => {})

    const refresh = () => {
      if (document.visibilityState === 'visible') void notifications.load().catch(() => {})
    }

    const timer = setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  })
</script>

<div class="shell">
  <!--
    The nota is not a screen in the app, it is a document that leaves it. No
    header and no tab bar, so printing has nothing to hide and the page that
    reaches the print dialog is only the report.
  -->
  {#if !PAPER.includes(route)}
  <header class="app-header">
    <div class="brand">
      <!--
        The Dua Ply mark: the stamped square with its carbon copy behind it.
        Drawn here rather than loaded as an image so it inherits the stamp ink
        and stays crisp at any size.
      -->
      <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
        <rect x="17" y="17" width="39" height="39" rx="6" fill="none" stroke="var(--stamp)" stroke-width="3" opacity="0.4" />
        <rect x="8" y="8" width="39" height="39" rx="6" fill="var(--stamp)" />
        <path fill="#fff" fill-rule="evenodd" d="M19 16h9a12.5 12.5 0 0 1 0 25h-9V16Zm5.5 6v13h3a6.5 6.5 0 0 0 0-13h-3Z" />
      </svg>
      <span class="brand-text">
        <strong>DUO</strong>
        <small>Split Bill</small>
      </span>
    </div>
    <div class="header-actions">
      {#if session.email || demo}
        <!--
          The pad's inbox: proofs of payment that have landed since the operator
          last looked. Drawn as a bell because that is the one control every
          phone already taught them, then counted in a stamped square — the
          number is attention, and attention is the stamp ink.
        -->
        <button
          class="bell"
          class:unread={unreadBundles > 0}
          aria-label={unreadBundles > 0
            ? `Notifikasi, ${unreadBundles} tagihan baru`
            : 'Notifikasi'}
          onclick={() => go('notif')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
            <path
              d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path d="M13.8 20.5a2 2 0 0 1-3.6 0" stroke-linecap="round" />
          </svg>
          {#if unreadBundles > 0}
            <span class="bell-badge num">{unreadBundles > 9 ? '9+' : unreadBundles}</span>
          {/if}
        </button>
      {/if}
      {#if session.email}
        <span class="operator">operator <b>{session.email}</b></span>
        <button class="plain nav-action" onclick={() => session.signOut()}>Keluar</button>
      {/if}
    </div>
  </header>
  {/if}

  {#if route === 'nota'}
    <Nota />
  {:else if route === 'bayar'}
    <!--
      Ahead of the session gate, and that is the point of it. The person opening
      this is someone the operator split a bill with: they have no account here
      and never will. Requiring a login to upload a screenshot would mean the
      feature is never used.
    -->
    <Bayar />
  {:else if import.meta.env.DEV && route === 'preview'}
    <!--
      Dev-only, and deliberately ahead of the session gate: the whole point is
      to look at the Review screen without a login, a camera, an API call and a
      round trip in the way.
    -->
    <main><Preview /></main>
    <nav class="tab-bar">
      {#each tabs as tab (tab.id)}
        <button class="tab" class:active={route === tab.id} onclick={() => go(tab.id)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            {@html tab.icon}
          </svg>
          <span>{tab.label}</span>
        </button>
      {/each}
    </nav>
  {:else if !demo && !supabaseConfigured}
    <div class="banner">
      <strong>Supabase belum dikonfigurasi.</strong>
      <span>
        Isi <code>VITE_SUPABASE_URL</code> dan
        <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> di <code>.env.local</code>,
        terus restart dev server.
      </span>
    </div>
  {:else if !demo && !session.ready}
    <main><p class="dim">Memuat…</p></main>
  {:else if !demo && !session.current}
    <main><SignIn /></main>
  {:else}
    <div class="workspace">
      <!-- The same four tabs, moved to the pad's edge on a wide screen. -->
      <nav class="rail">
        {#each tabs as tab (tab.id)}
          <button class="rail-tab" class:active={route === tab.id} onclick={() => go(tab.id)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
              {@html tab.icon}
            </svg>
            <span>{tab.label}</span>
          </button>
        {/each}
      </nav>

      <main>
        <!--
          The person screen writes its own title, because for that one the title
          is a name rather than a word — "Orang" above "Budi" says the same thing
          twice. On a wide screen the rail carries the orientation, so the title
          steps aside.
        -->
        {#if route !== 'orang'}
          <h1 class="page-title">{TITLES[route]}</h1>
        {/if}
        {#if route === 'bills'}
          <Bills />
        {:else if route === 'capture'}
          <Capture onReview={() => go('review')} />
        {:else if route === 'settle'}
          <Settle />
        {:else if route === 'review'}
          <Review onDone={() => go('bills')} />
        {:else if route === 'orang'}
          <Orang />
        {:else if route === 'notif'}
          <Notif />
        {:else}
          <Report />
        {/if}
      </main>
    </div>

    <nav class="tab-bar">
      {#each tabs as tab (tab.id)}
        <button class="tab" class:active={route === tab.id} onclick={() => go(tab.id)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            {@html tab.icon}
          </svg>
          <span>{tab.label}</span>
        </button>
      {/each}
    </nav>
  {/if}
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    background: var(--ground);
  }

  /*
   * The pad's letterhead. Flat sheet, ruled edge, opaque — so the content
   * scrolling under it is hidden rather than showing through. Capped and
   * centred on a phone; full width on a wide screen, where it also carries the
   * operator and the sign-out.
   */
  .app-header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
    min-height: 56px;
    padding: calc(6px + env(safe-area-inset-top)) 16px 6px;
    background: var(--sheet);
    border-bottom: 2px solid var(--stamp);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .mark {
    width: 36px;
    height: 36px;
    flex: none;
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }

  .brand-text strong {
    font-size: var(--text-base);
    font-weight: 750;
    letter-spacing: -0.01em;
  }

  .brand-text small {
    font-size: 12px;
    color: var(--ink-2);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
  }

  /* The operator is bookkeeping for the letterhead, not for the thumb. */
  .operator {
    display: none;
    font-size: 13px;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .operator b {
    font-family: var(--mono);
    font-weight: 500;
    color: var(--ink);
  }

  .nav-action {
    min-height: 36px;
    padding: 0 8px;
  }

  /*
   * The notification bell. A paper control gone quiet: no fill, no frame, ink-2
   * at rest and stamp-deep only while something is new. The count rides in a
   * stamped square — 3px corners, the stamp fill and its deep border, white
   * tabular figures — because the number is attention, and attention is the
   * stamp ink everywhere else in this app.
   */
  .bell {
    position: relative;
    width: 44px;
    min-height: 44px;
    padding: 0;
    background: none;
    border-color: transparent;
    border-radius: var(--radius-sm);
    color: var(--ink-2);
  }

  .bell:active:not(:disabled) {
    opacity: 0.7;
    transform: none;
  }

  .bell.unread {
    color: var(--stamp-deep);
  }

  .bell svg {
    width: 22px;
    height: 22px;
    display: block;
    margin: 0 auto;
  }

  .bell-badge {
    position: absolute;
    top: 3px;
    right: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    background: var(--stamp);
    border: 1px solid var(--stamp-deep);
    border-radius: var(--radius-sm);
    color: #fff;
    font-size: 10px;
    font-weight: 750;
    line-height: 1;
  }

  /* The page title: large, in the content, and it scrolls away. Hidden on a
     wide screen, where the rail already says which screen this is. */
  .page-title {
    font-size: var(--text-xl);
    font-weight: 750;
    letter-spacing: -0.02em;
    padding: 0 16px 4px;
  }

  .banner {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 16px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--attention-tint);
    border: 1px solid var(--attention-rule);
    color: var(--stamp-deep);
    font-size: var(--text-sm);
  }

  .banner code {
    background: var(--sheet-3);
    color: var(--ink);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 13px;
  }

  .workspace {
    display: flex;
    flex: 1;
    min-width: 0;
  }

  main {
    flex: 1;
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
    padding: 16px 0 0;
  }

  /* The rail exists only on a wide screen. */
  .rail {
    display: none;
  }

  /*
   * The pad's index tabs: a flat bar welded to the bottom edge, ruled off with
   * the stamp-orange 2px line the letterhead wears. The active tab is the one
   * pulled forward, filled with the stamp.
   *
   * sticky rather than fixed, deliberately: both keep it in view, but fixed
   * positions against the viewport — so inside the 390px dev preview frame it
   * would stretch the full width of the browser window and the preview would
   * lie about the layout.
   */
  .tab-bar {
    position: sticky;
    bottom: 0;
    z-index: 10;
    display: flex;
    gap: 4px;
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
    /* Pinned to the same value the commit bar reserves, so the two bars can
       never overlap or leave a stripe of content wedged between them. */
    min-height: var(--tab-space);
    padding: 6px 10px calc(6px + env(safe-area-inset-bottom));
    background: var(--sheet);
    border-top: 2px solid var(--stamp);
  }

  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 50px;
    padding: 5px 0 4px;
    background: none;
    border: 1px solid transparent;
    border-top: 2px solid transparent;
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    color: var(--ink-2);
    font-size: 10px;
    font-weight: 600;
  }

  .tab:active:not(:disabled) {
    opacity: 0.6;
    transform: none;
  }

  .tab svg {
    width: 23px;
    height: 23px;
  }

  .tab.active {
    color: #fff;
    background: var(--stamp);
    border-color: var(--stamp-deep);
  }

  /*
   * The wide screen: the letterhead runs the full width, the tabs move to the
   * left rail, and the content stops being a phone column. Each route decides
   * what to do with the room; the shell only stops constraining it.
   */
  @media (min-width: 1100px) {
    .app-header {
      max-width: none;
      min-height: 64px;
      padding: 8px 28px;
      gap: 16px;
    }

    .mark {
      width: 40px;
      height: 40px;
    }

    .operator {
      display: inline;
    }

    .page-title {
      display: none;
    }

    main {
      max-width: none;
      margin: 0;
      padding: 22px 28px 28px;
    }

    .rail {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 92px;
      flex: none;
      padding: 18px 10px;
      background: var(--sheet);
      border-right: 1px solid var(--rule);
    }

    .rail-tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 12px 0 10px;
      background: none;
      color: var(--ink-2);
      font-size: 10.5px;
      font-weight: 650;
      border: 1px solid transparent;
      border-top: 2px solid transparent;
      border-radius: var(--radius);
    }

    .rail-tab:active:not(:disabled) {
      opacity: 0.7;
      transform: none;
    }

    .rail-tab svg {
      width: 24px;
      height: 24px;
    }

    .rail-tab.active {
      color: #fff;
      background: var(--stamp);
      border-color: var(--stamp-deep);
      border-top-color: var(--stamp-deep);
    }

    .tab-bar {
      display: none;
    }
  }
</style>
