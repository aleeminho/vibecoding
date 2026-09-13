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
   * The chrome is two flat opaque bars — a branded header at the top and a tab
   * bar at the bottom, each separated from the content by a hairline. Nothing
   * is translucent and nothing blurs; see the note at the top of app.css for
   * why that is deliberate rather than unfinished.
   */
  import { onMount } from 'svelte'
  import { supabaseConfigured } from './lib/supabase'
  import { session } from './lib/session.svelte'
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
   * The app is dark, but the nota and the payment page leave it — as a PDF, a
   * print, or a screenshot in a group chat — and a dark document is worse in
   * all three. Done here rather than inside those components because a
   * `:global()` rule in a component's style block is in the stylesheet for the
   * whole session the moment the component is bundled, which would take the
   * app's own background with it everywhere else.
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
</script>

<div class="shell">
  <!--
    The nota is not a screen in the app, it is a document that leaves it. No
    header and no tab bar, so printing has nothing to hide and the page that
    reaches the PDF is only the report.
  -->
  {#if !PAPER.includes(route)}
  <header class="app-header">
    <div class="brand">
      <span class="mark">D</span>
      <span class="brand-text">
        <strong>DUO</strong>
        <small>Split Bill</small>
      </span>
    </div>
    {#if session.email}
      <button class="plain nav-action" onclick={() => session.signOut()}>Keluar</button>
    {/if}
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
    <main>
      <!--
        The person screen writes its own title, because for that one the title
        is a name rather than a word — "Orang" above "Budi" says the same thing
        twice.
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
      {:else}
        <Report />
      {/if}
    </main>

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
    background: var(--bg);
  }

  /*
   * Flat and full-width. Opaque, so the content scrolling under it is hidden
   * rather than showing through — which is the whole reason the previous
   * translucent version needed a blur to stay readable.
   */
  .app-header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 56px;
    padding: calc(6px + env(safe-area-inset-top)) 16px 6px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .mark {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: linear-gradient(180deg, var(--brand), var(--brand-deep));
    color: #fff;
    font-size: 19px;
    font-weight: 700;
    display: grid;
    place-items: center;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.28),
      0 4px 14px var(--brand-glow);
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }

  .brand-text strong {
    font-size: var(--text-base);
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .brand-text small {
    font-size: 12px;
    color: var(--label-2);
  }

  .nav-action {
    min-height: 36px;
  }

  /* The page title from the original design: large, in the content, and it
     scrolls away. The bar above it stays. */
  .page-title {
    font-size: var(--text-xl);
    font-weight: 700;
    letter-spacing: -0.03em;
    padding: 0 16px 4px;
  }

  .banner {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 16px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: #2a2113;
    color: var(--warn);
    font-size: var(--text-sm);
  }

  .banner code {
    background: rgba(255, 255, 255, 0.12);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 13px;
  }

  main {
    flex: 1;
    padding: 16px 0 0;
  }

  /*
   * A flat bar across the bottom edge. It does not hover, it does not blur, and
   * it has no side margins — the floating capsule was part of the look that was
   * asked to be removed, and a bar welded to the edge is what a bar does.
   *
   * Opaque, so content scrolling underneath is hidden rather than showing
   * through it.
   *
   * sticky rather than fixed, deliberately. Both keep it in view, but fixed
   * positions against the viewport — so inside the 390px dev preview frame it
   * would stretch the full width of the browser window and the preview would
   * lie about the layout. sticky stays inside its container and behaves
   * identically in the real app.
   */
  .tab-bar {
    position: sticky;
    bottom: 0;
    z-index: 10;
    display: flex;
    gap: 4px;
    /* Pinned to the same value the commit bar reserves, so the two bars can
       never overlap or leave a stripe of content wedged between them. */
    min-height: var(--tab-space);
    padding: 5px 12px calc(5px + env(safe-area-inset-bottom));
    background: var(--bg);
    border-top: 1px solid var(--border);
  }

  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 50px;
    padding: 6px 0 5px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--label-2);
    font-size: 10px;
    font-weight: 560;
  }

  .tab:active:not(:disabled) {
    opacity: 0.6;
    transform: none;
  }

  .tab svg {
    width: 24px;
    height: 24px;
  }

  .tab.active {
    color: var(--brand-light);
    background: var(--brand-tint);
    border-color: rgba(208, 74, 2, 0.32);
  }
</style>
